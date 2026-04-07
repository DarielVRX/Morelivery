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
// que route-simulator.js para garantizar consistencia entre asignación
// y navegación en tiempo real.

import { query } from '../config/db.js';
import { haversineMeters } from '../utils/geo.js';
import { etaEstimator } from './eta.js';
import { getParam } from './params.js';
import { sseHub } from '../modules/events/hub.js';
import { ACTIVE_STATUSES } from '../modules/orders/assignment/constants.js';

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

  // Agrupar pickups por restaurante — dos pedidos del mismo local
  // comparten un solo stop de pickup: el driver los recoge en una sola parada.
  const pickupByRestaurant = new Map();
  const stops = [];

  for (const row of r.rows) {
    const pickedUpAtSec = row.picked_up_at
      ? new Date(row.picked_up_at).getTime() / 1000
      : null;

    // SLA deadline: desde cuándo se recogió (o desde ahora si aún no se recoge)
    const slaBase        = pickedUpAtSec ?? nowSec;
    const slaDeadlineSec = slaBase + Number(row.max_delivery_time_s);

    // Tiempo estimado en que la cocina tendrá listo el pedido
    const kitchenReadyAtSec = row.kitchen_estimated_ready
      ? new Date(row.kitchen_estimated_ready).getTime() / 1000
      : nowSec; // si no hay dato, asumir listo ya

    // Pickup pendiente — deduplicar por restaurante
    if (row.status !== 'on_the_way' && row.rest_lat && row.rest_lng) {
      const restId = row.restaurant_id;

      if (pickupByRestaurant.has(restId)) {
        // Agrupar con el pickup existente del mismo restaurante
        const existing = pickupByRestaurant.get(restId);
        // Esperar al pedido que tarde más en estar listo
        existing.kitchenReadyAtSec = Math.max(existing.kitchenReadyAtSec, kitchenReadyAtSec);
        existing.volumeLiters     += Number(row.volume_liters) || 0;
        existing.orderIds.push(row.id); // P4: acumular todos los orderIds del grupo
        // pairOrderId del grupo apunta al primer orderId — las deliveries
        // de los pedidos agrupados mantienen su propio pairOrderId individual
      } else {
        const stop = {
          type:             'pickup',
          orderId:          row.id,
          orderIds:         [row.id], // P4: array para badge multi-pedido
          pairOrderId:      row.id,
          pos:              { lat: Number(row.rest_lat), lng: Number(row.rest_lng) },
          pickedUpAtSec:    null,
          slaDeadlineSec,
          kitchenReadyAtSec,
          volumeLiters:     Number(row.volume_liters) || 0,
          restaurantId:     restId,
        };
        pickupByRestaurant.set(restId, stop);
        stops.push(stop);
      }
    }

    // Delivery pendiente — uno por pedido, siempre
    if (row.cust_lat && row.cust_lng) {
      // pairOrderId apunta al pickup del mismo restaurante si fue agrupado,
      // o al propio orderId si tiene pickup individual
      const restId     = row.restaurant_id;
      const pickupStop = pickupByRestaurant.get(restId);
      const pairId     = (pickupStop && row.status !== 'on_the_way')
        ? pickupStop.orderId
        : row.id;

      stops.push({
        type:             'delivery',
        orderId:          row.id,
        pairOrderId:      pairId,
        pos:              { lat: Number(row.cust_lat), lng: Number(row.cust_lng) },
        pickedUpAtSec,
        slaDeadlineSec,
        kitchenReadyAtSec,
        volumeLiters:     Number(row.volume_liters) || 0,
      });
    }
  }

  return stops;
}

// ─── Secuenciador greedy puro + simulación ETA diferida ──────────────────────
//
// Construcción de secuencia:
//   1. lockedStop guard: si el driver está dentro del radio de lock, ese stop
//      va primero sin importar el resultado del greedy.
//   2. En cada paso, seleccionar el stop viable más cercano (greedy puro).
//      Viable = pickup siempre, delivery solo si su pickup ya fue procesado.
//   3. Una vez construida la secuencia completa, simular ETAs reales con
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
 * @returns {{
 *   sequence:     RerouteStop[],
 *   slaBreaches:  string[],
 *   stopsWithEta: Array<{
 *     type, orderId, orderIds, pos,
 *     etaFromNowSec, slaDeadlineSec, slaRemainingSec
 *   }>
 * }}
 */
export function findOptimalSequence(stops, driverPos, driverObj, nowSec) {
  const empty = { sequence: [], slaBreaches: [], stopsWithEta: [] };
  if (stops.length === 0) return empty;
  if (stops.length === 1) {
    // Simular el único stop directamente
    const stop      = stops[0];
    const travelSec = etaEstimator.estimateSync(driverPos, stop.pos, driverObj);
    const arrivalSec = nowSec + travelSec;
    return {
      sequence:    stops,
      slaBreaches: [],
      stopsWithEta: [{
        type:           stop.type,
        orderId:        stop.orderId,
        orderIds:       stop.orderIds ?? [stop.orderId],
        pos:            stop.pos,
        etaFromNowSec:  Math.round(travelSec),
        slaDeadlineSec: Math.round(stop.slaDeadlineSec),
        slaRemainingSec: Math.round(stop.slaDeadlineSec - arrivalSec),
      }],
    };
  }

  const lockRadiusM = getParam('reroute_lock_radius_m', 200);
  const maxSla      = getParam('max_delivery_time_s', 1800);

  // Set de pairOrderIds ya recogidos (pedidos on_the_way)
  const pickedUp = new Set(
    stops
      .filter(s => s.type === 'delivery' && s.pickedUpAtSec !== null)
      .map(s => s.pairOrderId)
  );

  const sequence  = [];
  const remaining = [...stops];

  // lockedStop guard: si el driver está dentro del radio de lock de algún stop,
  // ese stop va primero sin importar el resultado del greedy
  let lockedStop = null;
  for (const stop of remaining) {
    const dist = haversineMeters(driverPos, stop.pos);
    if (dist <= lockRadiusM) {
      if (stop.type === 'pickup' || pickedUp.has(stop.pairOrderId)) {
        lockedStop = stop;
        break;
      }
    }
  }

  if (lockedStop) {
    sequence.push(lockedStop);
    remaining.splice(remaining.indexOf(lockedStop), 1);
    if (lockedStop.type === 'pickup') pickedUp.add(lockedStop.pairOrderId);
  }

  // Greedy puro por distancia
  let currentPos = lockedStop ? lockedStop.pos : driverPos;

  while (remaining.length > 0) {
    const viable = remaining.filter(s =>
      s.type === 'pickup' || pickedUp.has(s.pairOrderId)
    );

    if (viable.length === 0) break; // no debería ocurrir con datos consistentes

    const next = viable.reduce((best, stop) => {
      const dist = haversineMeters(currentPos, stop.pos);
      return dist < best.dist ? { stop, dist } : best;
    }, { stop: viable[0], dist: haversineMeters(currentPos, viable[0].pos) }).stop;

    sequence.push(next);
    remaining.splice(remaining.indexOf(next), 1);
    if (next.type === 'pickup') pickedUp.add(next.pairOrderId);
    currentPos = next.pos;
  }

  // ── Simulación ETA diferida + verificación SLA + construcción de payload ──
  // Una sola pasada: acumula tiempos reales, verifica SLA y construye stopsWithEta.
  const slaBreaches  = [];
  const stopsWithEta = [];
  const simPickedUpAt = new Map(); // orderId → epoch sec del pickup simulado
  let pos     = driverPos;
  let timeSec = nowSec;

  for (const stop of sequence) {
    const travelSec = etaEstimator.estimateSync(pos, stop.pos, driverObj);
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
export async function rerouteDriver(driverId) {
  try {
    const driverData = await loadDriverPos(driverId);
    if (!driverData) return; // driver sin posición registrada — skip silencioso

    const { pos: driverPos, vehicleType } = driverData;
    const speedKmh  = speedKmhByVehicle(vehicleType);
    const driverObj = { speed_kmh: speedKmh };
    const nowSec    = Date.now() / 1000;

    const stops = await loadDriverStopsForReroute(driverId);

    if (stops.length === 0) {
      // Sin stops activos — notificar al driver que está libre
      sseHub.sendToUser(driverId, 'route_update', {
        stops:     [],
        totalStops: 0,
        message:   'Sin pedidos activos.',
      });
      return;
    }

    const { stopsWithEta, slaBreaches } = findOptimalSequence(stops, driverPos, driverObj, nowSec);

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
