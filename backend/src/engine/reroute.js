// backend/src/engine/reroute.js
//
// Módulo de rerouting reactivo.
//
// rerouteDriver(driverId) recalcula el orden óptimo de stops del driver
// y emite SSE 'route_update' con la nueva secuencia.
//
// Se llama en cada evento que cambia la ruta del driver:
//   - Pedido asignado (acceptOffer)
//   - Pedido cancelado
//   - Pickup completado (driver recogió pedido en restaurante)
//   - Delivery completado (driver entregó pedido al cliente)
//   - Rebalanceo: driver pierde o gana un pedido
//   - Disputa resuelta
//
// El secuenciador usa el mismo algoritmo de permutaciones con poda SLA
// para garantizar consistencia entre asignación y navegación en tiempo real.

import { query } from '../config/db.js';
import { haversineMeters } from '../utils/geo.js';
import { etaEstimator } from './eta.js';
import { getParam } from './params.js';
import { sseHub } from '../modules/events/hub.js';
import { ACTIVE_STATUSES } from '../modules/orders/assignment/constants.js';
import { groupPickupStops } from './stop-grouper.js';

// ─── Carga de stops activos ───────────────────────────────────────────────────

/**
 * Carga los stops activos del driver desde DB con toda la metadata necesaria
 * para el secuenciador: posición, SLA, estado, tiempo de cocina.
 *
 * @param {string} driverId
 * @returns {Promise<Array<RerouteStop>>}
 *
 * @typedef {object} RerouteStop
 * @property {'pickup'|'delivery'} type
 * @property {string}  orderId
 * @property {string}  pairOrderId    — mismo orderId, para mantener precedencia
 * @property {{lat:number,lng:number}} pos
 * @property {number|null} pickedUpAtSec
 * @property {number}  slaDeadlineSec — epoch segundos en que vence el SLA
 * @property {number}  kitchenReadyAtSec — epoch segundos en que estará listo (pickups)
 * @property {number}  volumeLiters
 */
async function loadDriverStopsForReroute(driverId) {
  const nowSec    = Date.now() / 1000;
  const maxSlaSec = getParam('max_delivery_time_s', 1800);

  const r = await query(
    `SELECT
       o.id,
       o.status,
       o.picked_up_at,
       o.created_at,
       o.delivery_lat                          AS cust_lat,
       o.delivery_lng                          AS cust_lng,
       COALESCE(ru.home_lat, rest.lat)         AS rest_lat,
       COALESCE(ru.home_lng, rest.lng)         AS rest_lng,
       COALESCE(o.estimated_volume_liters, 0)  AS volume_liters,
       o.kitchen_estimated_ready,
       rest.id                                 AS restaurant_id,
       $3                                      AS max_delivery_time_s
     FROM orders o
     JOIN restaurants rest ON rest.id = o.restaurant_id
     LEFT JOIN users ru    ON ru.id   = rest.owner_user_id
     WHERE o.driver_id = $1
       AND o.status    = ANY($2::text[])
     ORDER BY o.accepted_at ASC NULLS LAST`,
    [driverId, ACTIVE_STATUSES, maxSlaSec]
  );

  const { stops } = groupPickupStops(r.rows, nowSec, 'reroute');
  return stops;
}

// ─── Secuenciador greedy puro + simulación ETA diferida ──────────────────────
//
// Construcción de secuencia:
//   1. Si forceFirstStop está presente, ese stop va primero sin importar nada.
//   2. lockedStop guard: si el driver está dentro del radio de lock, ese stop
//      va primero (solo si no hay forceFirstStop).
//   3. En cada paso, seleccionar el stop viable más cercano (greedy puro).
//      Viable = pickup siempre, delivery solo si su pickup ya fue procesado.
//   4. Una vez construida la secuencia completa, simular ETAs reales con
//      estimateSync y verificar slaDeadlineSec por delivery.
//
// El SLA emerge de la simulación final — no se necesitan zonas ni herencia.

/**
 * Construye la secuencia óptima de stops usando greedy puro por distancia,
 * simula ETAs en una sola pasada y verifica SLA por delivery.
 *
 * @param {RerouteStop[]} stops
 * @param {{lat,lng}}     driverPos
 * @param {object}        driverObj     — { speed_kmh }
 * @param {number}        nowSec
 * @param {RerouteStop|null} forceFirstStop — si se proporciona, este stop va primero
 * @returns {{
 *   sequence:     RerouteStop[],
 *   slaBreaches:  string[],
 *   stopsWithEta: Array<{
 *     type, orderId, orderIds, pos,
 *     etaFromNowSec, slaDeadlineSec, slaRemainingSec
 *   }>
 * }}
 */
export async function findOptimalSequence(stops, driverPos, driverObj, nowSec, forceFirstStop = null, { blockPos, blockRadiusM } = {}) {
  const empty = { sequence: [], slaBreaches: [], stopsWithEta: [] };
  if (stops.length === 0) return empty;
  if (stops.length === 1) {
    const stop       = stops[0];
    const travelSec  = await etaEstimator.estimate(driverPos, stop.pos, driverObj);
    const arrivalSec = nowSec + travelSec;
    return {
      sequence:    stops,
      slaBreaches: [],
      stopsWithEta: [{
        type:            stop.type,
        orderId:         stop.orderId,
        orderIds:        stop.orderIds ?? [stop.orderId],
        pos:             stop.pos,
        etaFromNowSec:   Math.round(travelSec),
        slaDeadlineSec:  Math.round(stop.slaDeadlineSec),
        slaRemainingSec: Math.round(stop.slaDeadlineSec - arrivalSec),
      }],
    };
  }

  const lockRadiusM = getParam('reroute_lock_radius_m', 200);
  const maxSla      = getParam('max_delivery_time_s', 1800);

  const pickedUp = new Set(
    stops
      .filter(s => s.type === 'delivery' && s.pickedUpAtSec !== null)
      .map(s => s.orderId)
  );

  const sequence  = [];
  const remaining = [...stops];
  let currentPos  = driverPos;

  // lockedStop y forceFirstStop usan haversine — solo para filtro de proximidad
  if (forceFirstStop) {
    const forceStopIndex = remaining.findIndex(s =>
      s.type === forceFirstStop.type &&
      s.orderId === forceFirstStop.orderId
    );
    if (forceStopIndex !== -1) {
      const forcedStop = remaining[forceStopIndex];
      sequence.push(forcedStop);
      remaining.splice(forceStopIndex, 1);
      if (forcedStop.type === 'pickup') pickedUp.add(forcedStop.orderId);
      currentPos = forcedStop.pos;
    }
  }

  if (!forceFirstStop) {
    let lockedStop = null;
    for (const stop of remaining) {
      const dist = haversineMeters(driverPos, stop.pos);
      if (dist <= lockRadiusM) {
        if (stop.type === 'pickup' || pickedUp.has(stop.orderId)) {
          // No lockear stops dentro de la zona bloqueada
          if (blockPos && blockRadiusM) {
            const distToBlock = haversineMeters(stop.pos.lat, stop.pos.lng, blockPos.lat, blockPos.lng);
            if (distToBlock < blockRadiusM) continue;
          }
          lockedStop = stop;
          break;
        }
      }
    }
    if (lockedStop) {
      sequence.push(lockedStop);
      remaining.splice(remaining.indexOf(lockedStop), 1);
      if (lockedStop.type === 'pickup') pickedUp.add(lockedStop.orderId);
      currentPos = lockedStop.pos;
    }
  }

  // Greedy con OSRM — elige el stop viable con menor ETA real en cada paso
  while (remaining.length > 0) {
    const viable = remaining.filter(s =>
      s.type === 'pickup' || pickedUp.has(s.orderId)
    );
    if (viable.length === 0) break;

    // Calcular ETA efectivo para cada stop viable con límite de concurrencia (8 simultáneos)
    const kitchenTolerance = getParam('kitchen_wait_tolerance_s', 180);
    const CONCURRENCY = 8;
    const withEta = [];
    for (let i = 0; i < viable.length; i += CONCURRENCY) {
      const batch = viable.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(async stop => {
        const travelEta = await etaEstimator.estimate(currentPos, stop.pos, driverObj);
        let effectiveEta = travelEta;
        if (stop.type === 'pickup' && stop.kitchenReadyAtSec) {
          const arrivalSec = nowSec + travelEta;
          const wait = Math.max(0, stop.kitchenReadyAtSec - arrivalSec);
          effectiveEta = travelEta + Math.max(0, wait - kitchenTolerance);
        }
        return { stop, eta: effectiveEta, travelEta };
      }));
      withEta.push(...results);
    }

    const best = withEta.reduce((a, b) => a.eta < b.eta ? a : b);
    sequence.push(best.stop);
    remaining.splice(remaining.indexOf(best.stop), 1);
    if (best.stop.type === 'pickup') pickedUp.add(best.stop.orderId);
    currentPos = best.stop.pos;
  }

  // Simulación de ETAs finales con OSRM
  const slaBreaches   = [];
  const stopsWithEta  = [];
  const simPickedUpAt = new Map();
  let pos     = driverPos;
  let timeSec = nowSec;

  for (const stop of sequence) {
    const travelSec = await etaEstimator.estimate(pos, stop.pos, driverObj);
    timeSec += travelSec;

    if (stop.type === 'pickup') {
      const waitSec = Math.max(0, stop.kitchenReadyAtSec - timeSec);
      timeSec += waitSec;
      for (const oid of (stop.orderIds ?? [stop.orderId])) {
        simPickedUpAt.set(oid, timeSec);
      }
    } else {
      const pickedAt = stop.pickedUpAtSec ?? simPickedUpAt.get(stop.orderId) ?? nowSec;
      const elapsed  = timeSec - pickedAt;
      if (elapsed > maxSla || timeSec > stop.slaDeadlineSec) {
        slaBreaches.push(stop.orderId);
      }
    }

    stopsWithEta.push({
      type:            stop.type,
      orderId:         stop.orderId,
      orderIds:        stop.orderIds ?? [stop.orderId],
      pos:             stop.pos,
      etaFromNowSec:   Math.round(timeSec - nowSec),
      slaDeadlineSec:  Math.round(stop.slaDeadlineSec),
      slaRemainingSec: Math.round(stop.slaDeadlineSec - timeSec),
    });

    pos = stop.pos;
  }

  return { sequence, slaBreaches, stopsWithEta };
}

// ─── Carga de posición del driver ─────────────────────────────────────────────

async function loadDriverPos(driverId) {
  const r = await query(
    `SELECT last_lat AS lat, last_lng AS lng, vehicle_type
     FROM driver_profiles
     WHERE user_id = $1`,
    [driverId]
  );
  if (r.rowCount === 0) return null;
  const row = r.rows[0];
  if (!row.lat || !row.lng) return null;
  return {
    pos:        { lat: Number(row.lat), lng: Number(row.lng) },
    vehicleType: row.vehicle_type,
  };
}

function speedKmhByVehicle(vehicleType) {
  switch (vehicleType) {
    case 'bike':       return 20;
    case 'motorcycle': return 35;
    case 'car':        return 40;
    default:           return 30;
  }
}

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Recalcula la ruta óptima del driver y emite SSE 'route_update'.
 *
 * Puntos de llamada:
 *   - acceptOffer         (events.js)
 *   - cancelOrder         (orders route / admin)
 *   - pickup completado   (orders route — at_restaurant)
 *   - delivery completado (orders route — at_customer)
 *   - rebalanceo          (rebalancer.js — pierde o gana pedido)
 *   - disputa resuelta    (rebalancer.js — pase 1)
 *
 * @param {string} driverId
 * @returns {Promise<void>}
 */
export async function rerouteDriver(driverId, { blockPos, blockRadiusM } = {}) {
  try {
    const driverData = await loadDriverPos(driverId);
    if (!driverData) return;

    const { pos: driverPos, vehicleType } = driverData;
    const speedKmh  = speedKmhByVehicle(vehicleType);
    const driverObj = { speed_kmh: speedKmh };
    const nowSec    = Date.now() / 1000;

    const stops = await loadDriverStopsForReroute(driverId);

    if (stops.length === 0) {
      sseHub.sendToUser(driverId, 'route_update', {
        stops:     [],
        totalStops: 0,
        message:   'Sin pedidos activos.',
      });
      return;
    }

    // Si hay bloqueo activo, filtrar el lockedStop guard para evitar la zona bloqueada
    // y forzar que la secuencia busque ruta alternativa desde la posición actual
    const sequenceOpts = (blockPos && blockRadiusM)
      ? { blockPos, blockRadiusM }
      : {};

    const { stopsWithEta, slaBreaches } = await findOptimalSequence(
      stops, driverPos, driverObj, nowSec, null, sequenceOpts
    );

    sseHub.sendToUser(driverId, 'route_update', {
      stops:      stopsWithEta,
      totalStops: stopsWithEta.length,
    });

    if (slaBreaches.length > 0) {
      console.warn(
        `[reroute] driver=${driverId.slice(0,8)} → SLA comprometido por evento externo:`,
        slaBreaches.map(id => id.slice(0,8))
      );
    }

    console.log(
      `[reroute] driver=${driverId.slice(0,8)} → ${stopsWithEta.length} stops recalculados`
    );
  } catch (e) {
    console.error(`[reroute] error driver=${driverId.slice(0,8)}:`, e.message);
  }
}