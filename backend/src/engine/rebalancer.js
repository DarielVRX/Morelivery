// backend/src/engine/rebalancer.js
//
// RebalancingEngine adaptado para producción.
// Corre cada N segundos (configurable via rebalancer_interval_s, default 300s = 5 min).
// Busca drivers con ruta sobreextendida y transfiere pedidos aún no recogidos a
// drivers con mejor posición geográfica.
//
// CAMBIOS respecto a versión anterior:
//   - Pase 2 (rebalanceo automático): usa evaluateCandidates() para evaluar
//     receptores — consistencia con el assignment inicial.
//   - Pase 1 (disputas): mantiene ETA puro al restaurante — criterio de
//     urgencia, no de optimización de ruta.
//   - rerouteDriver() se llama tras cada transferencia exitosa (ambos pases)
//   - FIX: rebalancer ya no asigna directo — usa serializedOffer/offerNextDrivers
//     para que el driver receptor deba aceptar manualmente.
//     El filtro anti-spam queda cubierto por order_driver_offers con wait_until.

import { query } from '../config/db.js';
import { haversineMeters } from '../utils/geo.js';
import { etaEstimator } from './eta.js';
import { getParam } from './params.js';
import { rerouteDriver } from './reroute.js';
import { sendPushToUser } from '../modules/notifications/pushSubscription.js';
import { sseHub } from '../modules/events/hub.js';
import { shortId } from '../utils/geo.js';
import { ACTIVE_STATUSES } from '../modules/orders/assignment/constants.js';
import { serializedOffer } from '../modules/orders/assignment/queue.js';
import { offerNextDrivers } from '../modules/orders/assignment/core.js';

const MAX_EXEC_MS = 8_000;

function speedKmhByVehicle(v) {
  switch (v) {
    case 'bike':       return 20;
    case 'motorcycle': return 35;
    case 'car':        return 40;
    default:           return 30;
  }
}

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

async function loadTransferableOrders(driverId) {
  const cooldownSec = getParam('transfer_cooldown_s', 60);
  const r = await query(
    `SELECT o.id, o.restaurant_id,
            o.estimated_volume_liters,
            o.kitchen_estimated_ready,
            o.created_at,
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
       -- FIX anti-spam: excluir pedidos que ya tienen oferta pending a otro driver
       AND NOT EXISTS (
         SELECT 1 FROM order_driver_offers od
         WHERE od.order_id = o.id
           AND od.status = 'pending'
       )
     ORDER BY o.accepted_at DESC
     LIMIT 1`,
    [driverId, cooldownSec]
  );

  return r.rows.map(row => ({
    id:                     row.id,
    estimated_volume_liters: Number(row.estimated_volume_liters) || 0,
    kitchen_estimated_ready: row.kitchen_estimated_ready,
    created_at:             row.created_at,
    restaurantPos:          { lat: Number(row.rest_lat), lng: Number(row.rest_lng) },
    customerPos:            { lat: Number(row.cust_lat), lng: Number(row.cust_lng) },
  }));
}

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

        const stillDisputed = await query(
          `SELECT id FROM orders
           WHERE id=$1 AND is_disputed=true AND picked_up_at IS NULL AND driver_id=$2`,
          [order.id, order.driverId]
        );
        if (stillDisputed.rowCount === 0) continue;

        // FIX: marcar last_transferred_at y dejar que offerNextDrivers elija al receptor
        // en lugar de asignar directo — el driver debe aceptar
        await query(
          `UPDATE orders
           SET is_disputed=false, disputed_until=NULL, disputed_by=NULL,
               last_transferred_at=NOW(), updated_at=NOW()
           WHERE id=$1`,
          [order.id]
        );

        console.log(`[rebalancer:disputa] order=${shortId(order.id)} liberada para re-oferta`);

        sseHub.sendToUser(order.driverId, 'order_transferred_away', {
          orderId:  order.id,
          disputed: true,
          message:  'Tu pedido en disputa fue liberado para reasignación.',
        });

        // Usar serializedOffer para respetar el flujo normal de ofertas
        serializedOffer(order.id, offerNextDrivers, onOffer);

        totalTransfers++;
      }
    }

    // ── Pase 2: rebalanceo automático ─────────────────────────────────────────
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
          // Verificar que el pedido sigue transferible
          const stillTransferable = await query(
            `SELECT id FROM orders
             WHERE id=$1 AND status='assigned' AND picked_up_at IS NULL AND driver_id=$2`,
            [order.id, sourceDriver.id]
          );
          if (stillTransferable.rowCount === 0) continue;

          // FIX: marcar last_transferred_at para cooldown y dejar que
          // offerNextDrivers elija al mejor receptor con su propio scoring.
          // El filtro anti-spam en order_driver_offers evita re-ofertar
          // a drivers que ya rechazaron este pedido.
          await query(
            `UPDATE orders
             SET last_transferred_at=NOW(), updated_at=NOW()
             WHERE id=$1`,
            [order.id]
          );

          console.log(
            `[rebalancer] order=${shortId(order.id)} ` +
            `liberada de ${shortId(sourceDriver.id)} para re-oferta`
          );

          sseHub.sendToUser(sourceDriver.id, 'order_transferred_away', {
            orderId: order.id,
            message: 'Un pedido fue liberado para reasignación.',
          });

          // Usar serializedOffer — hereda filtro de rechazos, scoring completo
          // y requiere aceptación manual del driver receptor
          serializedOffer(order.id, offerNextDrivers, onOffer);

          // Actualizar estado local para siguiente iteración
          sourceDriver.orderIds     = sourceDriver.orderIds.filter(id => id !== order.id);
          sourceDriver.activeOrders = Math.max(0, sourceDriver.activeOrders - 1);

          await rerouteDriver(sourceDriver.id);

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
    console.log(`[rebalancer] ${totalTransfers} pedido(s) liberados para re-oferta en ${Date.now() - startMs}ms`);
  }

  return totalTransfers;
}
