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

// ─── Secuenciador de permutaciones ───────────────────────────────────────────

/**
 * Genera todas las permutaciones válidas de stops respetando la invariante
 * de precedencia: pickup de un pedido siempre antes de su delivery.
 *
 * Con max_active_orders=4 el peor caso son 8 stops → máx ~2520 permutaciones.
 *
 * @param {RerouteStop[]} stops
 * @returns {RerouteStop[][]}
 */
function generateValidPermutations(stops) {
  const results = [];

  function permute(remaining, current, pickedUp) {
    if (remaining.length === 0) {
      results.push(current);
      return;
    }

    for (let i = 0; i < remaining.length; i++) {
      const stop = remaining[i];

      // Invariante de precedencia hard: no hacer delivery si no se hizo el pickup
      if (stop.type === 'delivery' && !pickedUp.has(stop.pairOrderId)) continue;

      const newPickedUp = stop.type === 'pickup'
        ? new Set([...pickedUp, stop.pairOrderId])
        : pickedUp;

      permute(
        [...remaining.slice(0, i), ...remaining.slice(i + 1)],
        [...current, stop],
        newPickedUp
      );
    }
  }

  // Stops de pedidos ya recogidos (on_the_way) no tienen pickup pendiente —
  // sus pairOrderIds ya están en el set inicial de pickedUp
  const alreadyPickedUp = new Set(
    stops
      .filter(s => s.type === 'delivery' && s.pickedUpAtSec !== null)
      .map(s => s.pairOrderId)
  );

  permute(stops, [], alreadyPickedUp);
  return results;
}

/**
 * Poda permutaciones donde un delivery en riesgo crítico llega tarde,
 * siempre que el stop que lo bloquea NO esté también en riesgo.
 *
 * Es una poda suave — no fuerza posiciones, solo descarta secuencias
 * matemáticamente malas.
 *
 * @param {RerouteStop[][]} permutations
 * @param {{lat,lng}} driverPos
 * @param {object} driverObj  — { speed_kmh }
 * @param {number} nowSec
 * @returns {RerouteStop[][]}
 */
function pruneBySla(permutations, driverPos, driverObj, nowSec) {
  const criticalMargin = getParam('sla_critical_margin_s', 180);

  // Identificar stops con margen crítico
  const criticalOrders = new Set();
  for (const perm of permutations.slice(0, 1)) { // usar primera perm solo para identificar críticos
    let pos  = driverPos;
    let time = nowSec;
    for (const stop of perm) {
      const eta = etaEstimator.estimateSync(pos, stop.pos, driverObj);
      time += eta;
      pos   = stop.pos;
      if (stop.type === 'delivery') {
        const remaining = stop.slaDeadlineSec - nowSec;
        if (remaining < criticalMargin) criticalOrders.add(stop.orderId);
      }
    }
  }

  if (criticalOrders.size === 0) return permutations; // nada crítico, no podar

  return permutations.filter(perm => {
    let pos  = driverPos;
    let time = nowSec;

    for (const stop of perm) {
      const eta = etaEstimator.estimateSync(pos, stop.pos, driverObj);
      time += eta;
      pos   = stop.pos;

      if (stop.type === 'delivery' && criticalOrders.has(stop.orderId)) {
        // Si este delivery crítico llega tarde en esta permutación, descartar
        // a menos que el stop anterior sea también crítico (conflicto inevitable)
        if (time > stop.slaDeadlineSec) return false;
      }
    }

    return true;
  });
}

/**
 * Evalúa el costo global de una secuencia de stops.
 * Costo = Σ max(0, etaEntrega_i - slaDeadline_i)
 * Una sola cifra que representa el daño total al SLA del conjunto.
 *
 * @param {RerouteStop[]} sequence
 * @param {{lat,lng}} driverPos
 * @param {object} driverObj
 * @param {number} nowSec
 * @returns {number}
 */
function evaluateSequenceCost(sequence, driverPos, driverObj, nowSec) {
  let pos           = driverPos;
  let time          = nowSec;
  let slaCost       = 0;
  let kitchenWait   = 0;
  let totalDistance = 0;

  for (const stop of sequence) {
    const travelSec = etaEstimator.estimateSync(pos, stop.pos, driverObj);
    totalDistance  += haversineMeters(pos, stop.pos);
    time           += travelSec;
    pos             = stop.pos;

    if (stop.type === 'pickup') {
      const waitSec = Math.max(0, stop.kitchenReadyAtSec - time);
      kitchenWait  += waitSec;
      time         += waitSec;
    }

    if (stop.type === 'delivery') {
      const violation = Math.max(0, time - stop.slaDeadlineSec);
      slaCost += violation;
    }
  }

  const totalEta = time - nowSec;
  return { slaCost, kitchenWait, totalDistance, totalEta };
}

export function findOptimalSequence(stops, driverPos, driverObj, nowSec) {
  if (stops.length === 0) return [];
  if (stops.length === 1) return stops;

  const permutations = generateValidPermutations(stops);
  if (permutations.length === 0) return stops;

  const pruned = pruneBySla(permutations, driverPos, driverObj, nowSec);
  const pool   = pruned.length > 0 ? pruned : permutations;

  console.log(`[reroute:seq] ${stops.length} stops → ${permutations.length} perms → ${pool.length} tras poda SLA`);

  let bestSeq  = pool[0];
  let bestEval = evaluateSequenceCost(pool[0], driverPos, driverObj, nowSec);

  // Log permutación inicial
  console.log(`[reroute:seq] perm[0] ${pool[0].map(s => `${s.type}(${s.orderId?.slice(0,6)})`).join('→')} | slaCost=${Math.round(bestEval.slaCost)} dist=${Math.round(bestEval.totalDistance)} kitWait=${Math.round(bestEval.kitchenWait)} eta=${Math.round(bestEval.totalEta)}`);

  for (let i = 1; i < pool.length; i++) {
    const eval_ = evaluateSequenceCost(pool[i], driverPos, driverObj, nowSec);

    const label = pool[i].map(s => `${s.type}(${s.orderId?.slice(0,6)})`).join('→');
    console.log(`[reroute:seq] perm[${i}] ${label} | slaCost=${Math.round(eval_.slaCost)} dist=${Math.round(eval_.totalDistance)} kitWait=${Math.round(eval_.kitchenWait)} eta=${Math.round(eval_.totalEta)}`);

    const betterSla      = eval_.slaCost       < bestEval.slaCost;
    const sameSla        = eval_.slaCost      === bestEval.slaCost;
    const betterDist     = eval_.totalDistance < bestEval.totalDistance;
    const sameDist       = eval_.totalDistance === bestEval.totalDistance;
    const betterWait     = eval_.kitchenWait   < bestEval.kitchenWait;
    const sameWait       = eval_.kitchenWait  === bestEval.kitchenWait;
    const betterEta      = eval_.totalEta      < bestEval.totalEta;

    if (
      betterSla ||
      (sameSla && betterDist) ||
      (sameSla && sameDist && betterWait) ||
      (sameSla && sameDist && sameWait && betterEta)
    ) {
      const reason = betterSla ? 'mejor slaCost'
        : betterDist ? 'mismo sla, menor distancia'
        : betterWait ? 'mismo sla+dist, menor kitchenWait'
        : 'mismo sla+dist+wait, menor eta';
      console.log(`[reroute:seq] ↑ nuevo mejor [${i}] por: ${reason}`);
      bestEval = eval_;
      bestSeq  = pool[i];
    }
  }

  console.log(`[reroute:seq] GANADOR: ${bestSeq.map(s => `${s.type}(${s.orderId?.slice(0,6)})`).join('→')} | slaCost=${Math.round(bestEval.slaCost)} dist=${Math.round(bestEval.totalDistance)} kitWait=${Math.round(bestEval.kitchenWait)} eta=${Math.round(bestEval.totalEta)}`);

  return bestSeq;
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
