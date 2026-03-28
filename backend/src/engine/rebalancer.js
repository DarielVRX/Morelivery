// backend/src/engine/rebalancer.js
//
// RebalancingEngine adaptado para producción.
// Corre cada N segundos (configurable via rebalancer_interval_s, default 300s = 5 min).
// Busca drivers con ruta sobreextendida y transfiere pedidos aún no recogidos a
// drivers con mejor posición geográfica.
//
// CAMBIOS respecto a versión anterior:
//   - Pase 2 (rebalanceo automático): usa scoreCandidate() para evaluar
//     receptores en lugar de ETA simple — consistencia con el assignment inicial.
//   - Pase 1 (disputas): mantiene ETA puro al restaurante — criterio de
//     urgencia, no de optimización de ruta.
//   - rerouteDriver() se llama tras cada transferencia exitosa (ambos pases)
//     para que el driver actualice su ruta inmediatamente via SSE.

import { query } from '../config/db.js';
import { haversineMeters } from '../utils/geo.js';
import { etaEstimator } from './eta.js';
import { getParam } from './params.js';
import { scoreCandidate } from './scoring.js';
import { rerouteDriver } from './reroute.js';
import { sseHub } from '../modules/events/hub.js';
import { shortId } from '../utils/geo.js';
import { ACTIVE_STATUSES } from '../modules/orders/assignment/constants.js';

const MAX_EXEC_MS = 8_000;

// ─── Helpers de velocidad ─────────────────────────────────────────────────────

function speedKmhByVehicle(v) {
  switch (v) {
    case 'bike':       return 20;
    case 'motorcycle': return 35;
    case 'car':        return 40;
    default:           return 30;
  }
}

// ─── Carga de drivers activos ─────────────────────────────────────────────────

async function loadActiveDrivers() {
  const r = await query(
    `SELECT
       dp.user_id      AS id,
       dp.vehicle_type,
       dp.last_lat     AS lat,
       dp.last_lng     AS lng,
       dp.disconnect_penalties,
       dp.bag_capacity_liters,
       ARRAY_AGG(o.id ORDER BY o.accepted_at ASC) FILTER (WHERE o.id IS NOT NULL) AS order_ids,
       COUNT(o.id)::int AS active_orders
     FROM driver_profiles dp
     JOIN users u ON u.id = dp.user_id
     LEFT JOIN orders o ON o.driver_id = dp.user_id AND o.status = ANY($1::text[])
     WHERE dp.is_available = true
       AND u.status = 'active'
       AND dp.last_lat IS NOT NULL
       AND dp.last_lng IS NOT NULL
     GROUP BY dp.user_id, dp.vehicle_type, dp.last_lat, dp.last_lng,
              dp.disconnect_penalties, dp.bag_capacity_liters`,
    [ACTIVE_STATUSES]
  );

  return r.rows.map(row => ({
    id:                  row.id,
    vehicleType:         row.vehicle_type,
    speedKmh:            speedKmhByVehicle(row.vehicle_type),
    pos:                 { lat: Number(row.lat), lng: Number(row.lng) },
    disconnectPenalties: row.disconnect_penalties ?? 0,
    bagCapacityLiters:   Number(row.bag_capacity_liters) || 25,
    orderIds:            row.order_ids ?? [],
    activeOrders:        row.active_orders ?? 0,
  }));
}

// ─── Carga de pedidos transferibles ──────────────────────────────────────────

async function loadTransferableOrders(driverId) {
  const cooldownSec = getParam('transfer_cooldown_s', 60);
  const r = await query(
    `SELECT o.id, o.restaurant_id,
            COALESCE(ru.home_lat, rest.lat) AS rest_lat,
            COALESCE(ru.home_lng, rest.lng) AS rest_lng,
            o.delivery_lat    AS cust_lat,
            o.delivery_lng    AS cust_lng,
            o.last_transferred_at
     FROM orders o
     JOIN restaurants rest ON rest.id = o.restaurant_id
     LEFT JOIN users ru ON ru.id = rest.owner_user_id
     WHERE o.driver_id = $1
       AND o.status = 'assigned'
       AND o.picked_up_at IS NULL
       AND o.is_disputed = false
       AND (o.last_transferred_at IS NULL
            OR o.last_transferred_at < NOW() - ($2 * INTERVAL '1 second'))
     ORDER BY o.accepted_at DESC
     LIMIT 1`,
    [driverId, cooldownSec]
  );

  return r.rows.map(row => ({
    id:            row.id,
    restaurantPos: { lat: Number(row.rest_lat), lng: Number(row.rest_lng) },
    customerPos:   { lat: Number(row.cust_lat), lng: Number(row.cust_lng) },
  }));
}

// ─── ETA de ruta completa ─────────────────────────────────────────────────────

async function estimateRouteEta(driver) {
  if (driver.orderIds.length === 0) return 0;

  const r = await query(
    `SELECT o.id, o.status, o.picked_up_at,
            COALESCE(ru.home_lat, rest.lat) AS rest_lat,
            COALESCE(ru.home_lng, rest.lng) AS rest_lng,
            o.delivery_lat AS cust_lat,
            o.delivery_lng AS cust_lng
     FROM orders o
     JOIN restaurants rest ON rest.id = o.restaurant_id
     LEFT JOIN users ru ON ru.id = rest.owner_user_id
     WHERE o.id = ANY($1::uuid[])`,
    [driver.orderIds]
  );

  const stops = [];
  for (const row of r.rows) {
    if (row.status !== 'on_the_way' && row.rest_lat) {
      stops.push({ pos: { lat: Number(row.rest_lat), lng: Number(row.rest_lng) } });
    }
    if (row.cust_lat) {
      stops.push({ pos: { lat: Number(row.cust_lat), lng: Number(row.cust_lng) } });
    }
  }

  if (stops.length === 0) return 0;

  const driverObj = { speed_kmh: driver.speedKmh };
  let currentPos  = { ...driver.pos };
  let totalEta    = 0;

  for (const stop of stops) {
    const t = await etaEstimator.estimate(currentPos, stop.pos, driverObj);
    totalEta += t;
    currentPos = { ...stop.pos };
  }

  return totalEta;
}

// ─── Carga de disputas ────────────────────────────────────────────────────────

async function loadDisputedOrders() {
  const r = await query(
    `SELECT o.id, o.driver_id, o.created_at,
            COALESCE(ru.home_lat, rest.lat) AS rest_lat,
            COALESCE(ru.home_lng, rest.lng) AS rest_lng,
            o.delivery_lat  AS cust_lat,
            o.delivery_lng  AS cust_lng,
            o.disputed_by
     FROM orders o
     JOIN restaurants rest ON rest.id = o.restaurant_id
     LEFT JOIN users ru ON ru.id = rest.owner_user_id
     WHERE o.is_disputed = true
       AND o.picked_up_at IS NULL
     ORDER BY o.created_at ASC`,
    []
  );

  return r.rows.map(row => ({
    id:            row.id,
    driverId:      row.driver_id,
    disputedBy:    row.disputed_by,
    createdAt:     row.created_at,
    restaurantPos: { lat: Number(row.rest_lat), lng: Number(row.rest_lng) },
    customerPos:   { lat: Number(row.cust_lat), lng: Number(row.cust_lng) },
  }));
}

// ─── Motor principal ──────────────────────────────────────────────────────────

/**
 * Motor de rebalanceo principal.
 * Retorna el número de transferencias aplicadas.
 *
 * Pase 1 — disputas (criterio: ETA puro al restaurante)
 *   Reasignaciones urgentes solicitadas por el driver. Se prioriza
 *   velocidad sobre optimización de ruta.
 *
 * Pase 2 — rebalanceo automático (criterio: scoreCandidate())
 *   Consistente con el assignment inicial — mismo modelo de costo.
 *
 * @param {Function} onOffer
 * @returns {Promise<number>}
 */
export async function runRebalancer(onOffer) {
  const startMs     = Date.now();
  const minGainSec  = getParam('transfer_min_gain_s', 10);
  const maxRouteSec = getParam('transfer_max_route_eta_s', 180);
  const maxIterations = 5;

  let totalTransfers = 0;

  try {
    const drivers   = await loadActiveDrivers();
    const maxActive = getParam('max_active_orders_per_driver', 4);

    // ── Pase 1: pedidos en disputa ────────────────────────────────────────────
    // Criterio: ETA puro al restaurante — urgencia, no optimización.
    if (Date.now() - startMs <= MAX_EXEC_MS) {
      const disputed = await loadDisputedOrders();

      for (const order of disputed) {
        if (Date.now() - startMs > MAX_EXEC_MS) break;

        const recipients = drivers.filter(d =>
          d.id !== order.driverId &&
          d.id !== order.disputedBy &&
          d.activeOrders < maxActive
        );

        if (recipients.length === 0) continue;

        const driverObj = (d) => ({ speed_kmh: d.speedKmh });
        const evaluations = await Promise.all(
          recipients.map(async d => ({
            driver:      d,
            etaToPickup: await etaEstimator.estimate(d.pos, order.restaurantPos, driverObj(d)),
          }))
        );

        const best = evaluations.sort((a, b) => a.etaToPickup - b.etaToPickup)[0];
        if (!best) continue;

        // Guard de race condition
        const stillDisputed = await query(
          `SELECT id FROM orders
           WHERE id=$1 AND is_disputed=true AND picked_up_at IS NULL AND driver_id=$2`,
          [order.id, order.driverId]
        );
        if (stillDisputed.rowCount === 0) continue;

        await query(
          `UPDATE orders
           SET driver_id=$1, last_driver_id=$2, last_transferred_at=NOW(),
               is_disputed=false, disputed_until=NULL, disputed_by=NULL,
               updated_at=NOW()
           WHERE id=$3`,
          [best.driver.id, order.driverId, order.id]
        );

        console.log(
          `[rebalancer:disputa] order=${shortId(order.id)} ` +
          `${shortId(order.driverId)} → ${shortId(best.driver.id)} ` +
          `(eta ~${Math.round(best.etaToPickup)}s)`
        );

        sseHub.sendToUser(order.driverId, 'order_transferred_away', {
          orderId:  order.id,
          disputed: true,
          message:  'Tu pedido en disputa fue tomado por otro conductor.',
        });
        sseHub.sendToUser(best.driver.id, 'order_transferred_in', {
          orderId: order.id,
          message: 'Se te asignó un pedido en disputa.',
        });

        // Rerouting inmediato para ambos drivers
        await Promise.all([
          rerouteDriver(order.driverId),
          rerouteDriver(best.driver.id),
        ]);

        // Actualizar estado local
        const sourceLocal = drivers.find(d => d.id === order.driverId);
        if (sourceLocal) {
          sourceLocal.orderIds     = sourceLocal.orderIds.filter(id => id !== order.id);
          sourceLocal.activeOrders = Math.max(0, sourceLocal.activeOrders - 1);
        }
        const recipientLocal = drivers.find(d => d.id === best.driver.id);
        if (recipientLocal) {
          recipientLocal.orderIds.push(order.id);
          recipientLocal.activeOrders++;
        }

        totalTransfers++;
      }
    }

    // ── Pase 2: rebalanceo automático con scoreCandidate() ────────────────────
    // Usa el mismo modelo de costo que el assignment inicial.
    for (let iter = 0; iter < maxIterations; iter++) {
      if (Date.now() - startMs > MAX_EXEC_MS) {
        console.warn('[rebalancer] timeout de seguridad — abortando iteración');
        break;
      }

      const routeEtas = await Promise.all(
        drivers.map(async d => ({
          driver:             d,
          routeEta:           await estimateRouteEta(d),
          transferableOrders: await loadTransferableOrders(d.id),
        }))
      );

      const overloaded = routeEtas.filter(r =>
        r.routeEta > maxRouteSec && r.transferableOrders.length > 0
      );

      if (overloaded.length === 0) break;

      let didTransfer = false;

      for (const { driver: sourceDriver, transferableOrders } of overloaded) {
        if (Date.now() - startMs > MAX_EXEC_MS) break;

        for (const order of transferableOrders) {
          const recipients = drivers.filter(d =>
            d.id !== sourceDriver.id && d.activeOrders < maxActive
          );
          if (recipients.length === 0) continue;

          const driverObj = (d) => ({ speed_kmh: d.speedKmh });

          // Evaluar receptores con scoreCandidate() para consistencia con assignment
          const evaluations = await Promise.all(
            recipients.map(async recipient => {
              const etaToPickup = await etaEstimator.estimate(
                recipient.pos, order.restaurantPos, driverObj(recipient)
              );
              const etaPickupToCustomer = await etaEstimator.estimate(
                order.restaurantPos, order.customerPos, driverObj(recipient)
              );
              const distToRestaurant = haversineMeters(recipient.pos, order.restaurantPos);

              // Construir candidato mínimo compatible con scoreCandidate()
              const candidateForScore = {
                etaToNewCustomer:               etaToPickup + etaPickupToCustomer,
                activeOrders:                   recipient.activeOrders,
                bridgePenaltyS:                 distToRestaurant / Math.max(1, (recipient.speedKmh * 1000) / 3600),
                directDriverToRestaurantMeters: distToRestaurant,
                driverSpeedKmh:                 recipient.speedKmh,
              };

              const { totalCost } = scoreCandidate(
                candidateForScore,
                { max_delivery_time_s: null },
                recipient.disconnectPenalties ?? 0
              );

              return { driver: recipient, totalCost, etaToPickup };
            })
          );

          // Score del driver origen para este pedido (baseline)
          const sourceEtaToPickup = await etaEstimator.estimate(
            sourceDriver.pos, order.restaurantPos, driverObj(sourceDriver)
          );
          const sourceEtaToCustomer = await etaEstimator.estimate(
            order.restaurantPos, order.customerPos, driverObj(sourceDriver)
          );
          const sourceDistToRestaurant = haversineMeters(sourceDriver.pos, order.restaurantPos);
          const sourceCandidateForScore = {
            etaToNewCustomer:               sourceEtaToPickup + sourceEtaToCustomer,
            activeOrders:                   sourceDriver.activeOrders,
            bridgePenaltyS:                 sourceDistToRestaurant / Math.max(1, (sourceDriver.speedKmh * 1000) / 3600),
            directDriverToRestaurantMeters: sourceDistToRestaurant,
            driverSpeedKmh:                 sourceDriver.speedKmh,
          };
          const { totalCost: sourceCost } = scoreCandidate(
            sourceCandidateForScore,
            { max_delivery_time_s: null },
            sourceDriver.disconnectPenalties ?? 0
          );

          // Mejor receptor: menor totalCost con ganancia mínima sobre el origen
          const best = evaluations
            .filter(e => (sourceCost - e.totalCost) >= minGainSec)
            .sort((a, b) => a.totalCost - b.totalCost)[0];

          if (!best) continue;

          // Guard de race condition
          const stillTransferable = await query(
            `SELECT id FROM orders
             WHERE id=$1 AND status='assigned' AND picked_up_at IS NULL AND driver_id=$2`,
            [order.id, sourceDriver.id]
          );
          if (stillTransferable.rowCount === 0) continue;

          // Aplicar transferencia
          await query(
            `UPDATE orders
             SET driver_id=$1, last_driver_id=$2, last_transferred_at=NOW(), updated_at=NOW()
             WHERE id=$3`,
            [best.driver.id, sourceDriver.id, order.id]
          );

          console.log(
            `[rebalancer] order=${shortId(order.id)} ` +
            `${shortId(sourceDriver.id)} → ${shortId(best.driver.id)} ` +
            `(score origen=${Math.round(sourceCost)} receptor=${Math.round(best.totalCost)})`
          );

          sseHub.sendToUser(sourceDriver.id, 'order_transferred_away', {
            orderId: order.id,
            message: 'Un pedido fue reasignado a otro conductor.',
          });
          sseHub.sendToUser(best.driver.id, 'order_transferred_in', {
            orderId: order.id,
            message: 'Se te asignó un pedido transferido.',
          });

          // Rerouting inmediato para ambos drivers
          await Promise.all([
            rerouteDriver(sourceDriver.id),
            rerouteDriver(best.driver.id),
          ]);

          // Actualizar estado local
          sourceDriver.orderIds     = sourceDriver.orderIds.filter(id => id !== order.id);
          sourceDriver.activeOrders = Math.max(0, sourceDriver.activeOrders - 1);
          const recipient = drivers.find(d => d.id === best.driver.id);
          if (recipient) {
            recipient.orderIds.push(order.id);
            recipient.activeOrders++;
          }

          totalTransfers++;
          didTransfer = true;
          break;
        }

        if (didTransfer) break;
      }

      if (!didTransfer) break;
    }

  } catch (e) {
    console.error('[rebalancer] error:', e.message);
  }

  if (totalTransfers > 0) {
    console.log(`[rebalancer] ${totalTransfers} transferencia(s) en ${Date.now() - startMs}ms`);
  }

  return totalTransfers;
}
