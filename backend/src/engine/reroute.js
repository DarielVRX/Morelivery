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

// ─── Secuenciador greedy con SLA condicional ─────────────────────────────────
//
// Reemplaza el secuenciador de permutaciones.
//
// Lógica de selección en cada paso:
//   1. Construir pool de stops viables (respetando precedencia pickup→delivery)
//   2. Leer slaDeadlineSec de todos los deliveries — incluyendo los de pickups
//      aún no viables (herencia de urgencia)
//   3. Clasificar cada stop viable en: normal / warning / crítico
//   4. Selección:
//      - Si hay críticos → el más urgente, desempate por distancia
//      - Si hay warnings → el más urgente, desempate por distancia
//        (solo si el desvío no supera el greedy puro significativamente)
//      - Si todo normal  → el más cercano (greedy puro)
//   5. lockedStop guard: si el driver está dentro del radio de lock,
//      el primer stop queda congelado independientemente del resultado

/**
 * Selecciona el siguiente stop óptimo desde el pool de viables.
 *
 * @param {RerouteStop[]} viableStops   — stops que pueden visitarse ahora
 * @param {RerouteStop[]} allStops      — todos los stops (para herencia SLA)
 * @param {{lat,lng}}     fromPos       — posición actual
 * @param {object}        driverObj     — { speed_kmh }
 * @param {number}        nowSec
 * @returns {RerouteStop}
 */
function selectNextStop(viableStops, allStops, fromPos, driverObj, nowSec) {
  const criticalThreshold = getParam('sla_critical_threshold_s', 600);
  const warningThreshold  = getParam('sla_warning_threshold_s',  1200);

  // Mapa de urgencia: para cada stop viable, leer el SLA más urgente
  // asociado — si es pickup, usar el slaDeadlineSec de su delivery asociado
  const deliverySlaBypairId = new Map();
  for (const s of allStops) {
    if (s.type === 'delivery') {
      deliverySlaBypairId.set(s.pairOrderId, s.slaDeadlineSec);
    }
  }

  // Enriquecer cada stop viable con su urgencia real y distancia
  const enriched = viableStops.map(stop => {
    const dist = haversineMeters(fromPos, stop.pos);
    const effectiveSla = stop.type === 'pickup'
      ? (deliverySlaBypairId.get(stop.pairOrderId) ?? stop.slaDeadlineSec)
      : stop.slaDeadlineSec;
    const remaining = effectiveSla - nowSec;

    let zone;
    if (remaining < criticalThreshold) zone = 'critical';
    else if (remaining < warningThreshold) zone = 'warning';
    else zone = 'normal';

    return { stop, dist, remaining, zone };
  });

  // Clasificar por zona
  const critical = enriched.filter(e => e.zone === 'critical');
  const warning  = enriched.filter(e => e.zone === 'warning');

  if (critical.length > 0) {
    // Más urgente primero, desempate por distancia
    return critical.sort((a, b) =>
      a.remaining !== b.remaining ? a.remaining - b.remaining : a.dist - b.dist
    )[0].stop;
  }

  if (warning.length > 0) {
    // Más urgente primero, desempate por distancia
    return warning.sort((a, b) =>
      a.remaining !== b.remaining ? a.remaining - b.remaining : a.dist - b.dist
    )[0].stop;
  }

  // Todo normal — greedy puro por distancia
  return enriched.sort((a, b) => a.dist - b.dist)[0].stop;
}

/**
 * Construye la secuencia óptima de stops usando greedy con SLA condicional.
 * Respeta precedencia pickup→delivery y lockedStop guard.
 *
 * @param {RerouteStop[]} stops
 * @param {{lat,lng}}     driverPos
 * @param {object}        driverObj
 * @param {number}        nowSec
 * @returns {RerouteStop[]}
 */
export function findOptimalSequence(stops, driverPos, driverObj, nowSec) {
  if (stops.length === 0) return [];
  if (stops.length === 1) return stops;

  const lockRadiusM = getParam('reroute_lock_radius_m', 200);

  // Set de pairOrderIds ya recogidos (pedidos on_the_way)
  const pickedUp = new Set(
    stops
      .filter(s => s.type === 'delivery' && s.pickedUpAtSec !== null)
      .map(s => s.pairOrderId)
  );

  const sequence = [];
  const remaining = [...stops];

  // lockedStop guard: si el driver está dentro del radio de lock de algún stop,
  // ese stop va primero sin importar el resultado del greedy
  let lockedStop = null;
  for (const stop of remaining) {
    const dist = haversineMeters(driverPos, stop.pos);
    if (dist <= lockRadiusM) {
      // Verificar que sea viable (si es delivery, su pickup ya se hizo)
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

  // Greedy iterativo
  let currentPos = lockedStop ? lockedStop.pos : driverPos;

  while (remaining.length > 0) {
    // Stops viables en este momento
    const viable = remaining.filter(s =>
      s.type === 'pickup' || pickedUp.has(s.pairOrderId)
    );

    if (viable.length === 0) break; // no debería ocurrir con datos consistentes

    const next = selectNextStop(viable, stops, currentPos, driverObj, nowSec);
    sequence.push(next);
    remaining.splice(remaining.indexOf(next), 1);
    if (next.type === 'pickup') pickedUp.add(next.pairOrderId);
    currentPos = next.pos;
  }

  return sequence;
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

    const optimalSequence = findOptimalSequence(stops, driverPos, driverObj, nowSec);

    // Construir payload SSE con ETAs estimados por stop
    let pos     = driverPos;
    let timeSec = nowSec;
    const stopsWithEta = [];

    for (const stop of optimalSequence) {
      const travelSec = etaEstimator.estimateSync(pos, stop.pos, driverObj);
      timeSec += travelSec;

      if (stop.type === 'pickup') {
        const waitSec = Math.max(0, stop.kitchenReadyAtSec - timeSec);
        timeSec += waitSec;
      }

      stopsWithEta.push({
        type:             stop.type,
        orderId:          stop.orderId,
        orderIds:         stop.orderIds ?? [stop.orderId], // P4: array para badge multi-pedido
        pos:              stop.pos,
        etaFromNowSec:    Math.round(timeSec - nowSec),
        slaDeadlineSec:   Math.round(stop.slaDeadlineSec),
        slaRemainingeSec: Math.round(stop.slaDeadlineSec - timeSec),
      });

      pos = stop.pos;
    }

    sseHub.sendToUser(driverId, 'route_update', {
      stops:      stopsWithEta,
      totalStops: stopsWithEta.length,
    });

    console.log(
      `[reroute] driver=${driverId.slice(0,8)} → ${stopsWithEta.length} stops recalculados`
    );
  } catch (e) {
    console.error(`[reroute] error driver=${driverId.slice(0,8)}:`, e.message);
  }
}
