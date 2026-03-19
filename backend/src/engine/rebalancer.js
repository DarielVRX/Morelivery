// backend/src/engine/rebalancer.js
//
// RebalancingEngine adaptado para producción.
// Corre cada N segundos (configurable via rebalancer_interval_s, default 300s = 5 min).
// Busca drivers con ruta sobreextendida y transfiere pedidos aún no recogidos a
// drivers con mejor posición geográfica.
//
// DIFERENCIAS respecto al simulador:
//   - No usa world.drivers en memoria — consulta la DB
//   - Timeout de ejecución: si tarda más de 8s, abandona la iteración actual
//   - Circuit breaker: si hay error grave, espera antes de reintentar
//   - Writes a DB solo al confirmar transferencia (no en evaluación)

import { query } from '../config/db.js';
import { haversineMeters } from '../utils/geo.js';
import { etaEstimator } from './eta.js';
import { getParam } from './params.js';
import { sseHub } from '../modules/events/hub.js';
import { shortId } from '../utils/geo.js';
import { ACTIVE_STATUSES } from '../modules/orders/assignment/constants.js';

const MAX_EXEC_MS = 8_000;  // timeout de seguridad por ejecución

/**
 * Carga drivers activos con sus pedidos y posición GPS.
 */
async function loadActiveDrivers() {
  const maxActive = getParam('max_active_orders_per_driver', 4);

  const r = await query(
    `SELECT
       dp.user_id      AS id,
       dp.vehicle_type,
       dp.last_lat     AS lat,
       dp.last_lng     AS lng,
       dp.disconnect_penalties,
       ARRAY_AGG(o.id ORDER BY o.accepted_at ASC) FILTER (WHERE o.id IS NOT NULL) AS order_ids,
       COUNT(o.id)::int AS active_orders
     FROM driver_profiles dp
     JOIN users u ON u.id = dp.user_id
     LEFT JOIN orders o ON o.driver_id = dp.user_id AND o.status = ANY($1::text[])
     WHERE dp.is_available = true
       AND u.status = 'active'
       AND dp.last_lat IS NOT NULL
       AND dp.last_lng IS NOT NULL
     GROUP BY dp.user_id, dp.vehicle_type, dp.last_lat, dp.last_lng, dp.disconnect_penalties`,
    [ACTIVE_STATUSES]
  );

  return r.rows.map(row => ({
    id:                  row.id,
    vehicleType:         row.vehicle_type,
    speedKmh:            speedKmhByVehicle(row.vehicle_type),
    pos:                 { lat: Number(row.lat), lng: Number(row.lng) },
    disconnectPenalties: row.disconnect_penalties ?? 0,
    orderIds:            row.order_ids ?? [],
    activeOrders:        row.active_orders ?? 0,
  }));
}

function speedKmhByVehicle(v) {
  switch (v) {
    case 'bike':       return 20;
    case 'motorcycle': return 35;
    case 'car':        return 40;
    default:           return 30;
  }
}

/**
 * Carga los detalles de un pedido transferible.
 * "Transferible" = assigned + no recogido + sin cooldown de transferencia reciente.
 */
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
}

/**
 * Estima ETA total de la ruta del driver (suma de segments a todos sus stops).
 */
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

/**
 * Carga pedidos en disputa (rebalanceo manual solicitado por el driver).
 * Criterio: assignment inicial — solo ETA al restaurante, sin minGain ni maxRouteEta.
 * El created_at original se preserva para no sacrificar el SLA.
 */
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
       AND o.disputed_until > NOW()
       AND o.picked_up_at IS NULL
     ORDER BY o.disputed_until ASC`,
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

/**
 * Motor de rebalanceo principal.
 * Retorna el número de transferencias aplicadas.
 *
 * @param {Function} onOffer  — callback SSE
 * @returns {Promise<number>}
 */
export async function runRebalancer(onOffer) {
  const startMs       = Date.now();
  const minGainSec    = getParam('transfer_min_gain_s', 10);
  const maxRouteSec   = getParam('transfer_max_route_eta_s', 180);
  const maxIterations = 5;

  let totalTransfers = 0;

  try {
    const drivers = await loadActiveDrivers();
    const maxActive = getParam('max_active_orders_per_driver', 4);
    const driverObj = (d) => ({ speed_kmh: d.speedKmh });

    // ── Pase 1: pedidos en disputa (rebalanceo manual) ────────────────────────
    // Criterio: assignment inicial — el mejor driver por ETA al restaurante.
    // Sin minGain ni maxRouteEta — el driver que solicitó la disputa ya aceptó
    // que el pedido sigue en su ruta si nadie lo toma.
    if (Date.now() - startMs <= MAX_EXEC_MS) {
      const disputed = await loadDisputedOrders();

      for (const order of disputed) {
        if (Date.now() - startMs > MAX_EXEC_MS) break;

        // Receptores: cualquier driver disponible excepto el que tiene el pedido
        // y el que solicitó la disputa (ya tiene cooldown largo para este pedido)
        const recipients = drivers.filter(d =>
          d.id !== order.driverId &&
          d.id !== order.disputedBy &&
          d.activeOrders < maxActive
        );

        if (recipients.length === 0) continue;

        // Evaluar por ETA al restaurante — criterio puro de assignment inicial
        const evaluations = await Promise.all(
          recipients.map(async d => ({
            driver:       d,
            etaToPickup:  await etaEstimator.estimate(d.pos, order.restaurantPos, driverObj(d)),
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

        // Transferir y limpiar disputa
        await query(
          `UPDATE orders
           SET driver_id=$1, last_driver_id=$2, last_transferred_at=NOW(),
               is_disputed=false, disputed_until=NULL, disputed_by=NULL,
               updated_at=NOW()
           WHERE id=$3`,
          [best.driver.id, order.driverId, order.id]
        );

        console.log(`[rebalancer:disputa] order=${shortId(order.id)} ${shortId(order.driverId)} → ${shortId(best.driver.id)} (eta ~${Math.round(best.etaToPickup)}s)`);

        sseHub.sendToUser(order.driverId, 'order_transferred_away', {
          orderId:  order.id,
          disputed: true,
          message:  'Tu pedido en disputa fue tomado por otro conductor.',
        });
        sseHub.sendToUser(best.driver.id, 'order_transferred_in', {
          orderId: order.id,
          message: 'Se te asignó un pedido en disputa.',
        });

        // Actualizar estado local
        const sourceLocal = drivers.find(d => d.id === order.driverId);
        if (sourceLocal) {
          sourceLocal.orderIds    = sourceLocal.orderIds.filter(id => id !== order.id);
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

    // ── Pase 2: rebalanceo automático normal ──────────────────────────────────
    for (let iter = 0; iter < maxIterations; iter++) {
      // Timeout de seguridad
      if (Date.now() - startMs > MAX_EXEC_MS) {
        console.warn('[rebalancer] timeout de seguridad — abortando iteración');
        break;
      }

      // Calcular ETAs de rutas actuales
      const routeEtas = await Promise.all(
        drivers.map(async d => ({
          driver:           d,
          routeEta:         await estimateRouteEta(d),
          transferableOrders: await loadTransferableOrders(d.id),
        }))
      );

      // Filtrar drivers sobrecargados (ruta muy larga Y tienen pedidos transferibles)
      const overloaded = routeEtas.filter(r =>
        r.routeEta > maxRouteSec && r.transferableOrders.length > 0
      );

      if (overloaded.length === 0) break;

      let didTransfer = false;

      for (const { driver: sourceDriver, transferableOrders } of overloaded) {
        if (Date.now() - startMs > MAX_EXEC_MS) break;

        for (const order of transferableOrders) {
          const maxActive = getParam('max_active_orders_per_driver', 4);
          const recipients = drivers.filter(d =>
            d.id !== sourceDriver.id && d.activeOrders < maxActive
          );

          if (recipients.length === 0) continue;

          const driverObj = (d) => ({ speed_kmh: d.speedKmh });

          // ETA del driver origen al restaurante (sin el pedido)
          const sourceEta = await etaEstimator.estimate(
            sourceDriver.pos, order.restaurantPos, driverObj(sourceDriver)
          );

          // Evaluar receptores
          const evaluations = await Promise.all(
            recipients.map(async recipient => {
              const recipientEta = await etaEstimator.estimate(
                recipient.pos, order.restaurantPos, driverObj(recipient)
              );
              const gain = sourceEta - recipientEta;
              return { driver: recipient, gain, recipientEta };
            })
          );

          const best = evaluations
            .filter(e => e.gain >= minGainSec)
            .sort((a, b) => b.gain - a.gain)[0];

          if (!best) continue;

          // Confirmar que el pedido aún es transferible (guard de race condition)
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

          console.log(`[rebalancer] order=${shortId(order.id)} ${shortId(sourceDriver.id)} → ${shortId(best.driver.id)} (ganancia ~${Math.round(best.gain)}s)`);

          // Notificar vía SSE al driver que pierde y al que recibe
          sseHub.sendToUser(sourceDriver.id, 'order_transferred_away', {
            orderId: order.id,
            message: 'Un pedido fue reasignado a otro conductor.',
          });
          sseHub.sendToUser(best.driver.id, 'order_transferred_in', {
            orderId: order.id,
            message: 'Se te asignó un pedido transferido.',
          });

          // Actualizar estado local para próximas iteraciones
          sourceDriver.orderIds = sourceDriver.orderIds.filter(id => id !== order.id);
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

        if (didTransfer) break; // recomputar estado global
      }

      if (!didTransfer) break; // convergencia
    }
  } catch (e) {
    console.error('[rebalancer] error:', e.message);
  }

  if (totalTransfers > 0) {
    console.log(`[rebalancer] ${totalTransfers} transferencia(s) en ${Date.now() - startMs}ms`);
  }

  return totalTransfers;
}
