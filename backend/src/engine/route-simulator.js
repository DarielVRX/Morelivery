// backend/src/engine/route-simulator.js
//
// RouteInsertionSimulator adaptado para producción.
// Simula la ruta completa del driver incluyendo el nuevo pedido,
// calculando el ETA real hacia el cliente nuevo y verificando
// que no se rompa el SLA de los pedidos ya asignados.
//
// CAMBIOS respecto a versión anterior:
//   - Fix: deduplicación de pickups por restaurante compartido
//     (dos pedidos del mismo restaurante comparten un solo stop de pickup)
//   - viableStop: respeta el punto de inserción óptimo calculado por candidate-finder
//   - prefixToViable: congela stops comprometidos antes del punto de inserción
//   - estimateRestaurantWait: consulta kitchen_ready_at desde DB para estimar
//     tiempo de espera en cocina (antes ignorado completamente)
//   - totalCost: delegado a scoreCandidate() — única autoridad de scoring
//   - findOptimalSequence de reroute.js reutilizada para secuenciar stops
//     post-viableStop (misma lógica que navegación en tiempo real)

import { query } from '../config/db.js';
import { haversineMeters } from '../utils/geo.js';
import { etaEstimator } from './eta.js';
import { getParam } from './params.js';
import { scoreCandidate } from './scoring.js';
import { findOptimalSequence } from './reroute.js';
import { ACTIVE_STATUSES, log, logWarn } from '../modules/orders/assignment/constants.js';

// ─── Carga de stops del driver ────────────────────────────────────────────────

/**
 * Carga los pedidos activos del driver con sus coordenadas.
 *
 * CAMBIO: Deduplica pickups por restaurante compartido.
 * Si dos pedidos tienen el mismo restaurante y ambos están pendientes de recoger,
 * se genera un solo stop de pickup con los orderIds agrupados — el driver
 * recoge ambos en la misma parada.
 *
 * @param {string} driverId
 * @returns {Promise<Array<SimStop>>}
 *
 * @typedef {object} SimStop
 * @property {'pickup'|'delivery'} type
 * @property {string[]} orderIds      — uno o más (pickups agrupados por restaurante)
 * @property {string}   orderId       — alias: primer orderId del grupo (compatibilidad)
 * @property {{lat,lng}} pos
 * @property {Date|null} pickedUpAt
 * @property {number}   volumeLiters
 * @property {number}   kitchenReadyAtSec
 */
async function loadDriverStops(driverId) {
  const nowSec = Date.now() / 1000;

  const r = await query(
    `SELECT
       o.id,
       o.status,
       o.picked_up_at,
       o.delivery_lat                         AS cust_lat,
       o.delivery_lng                         AS cust_lng,
       COALESCE(ru.home_lat, rest.lat)        AS rest_lat,
       COALESCE(ru.home_lng, rest.lng)        AS rest_lng,
       COALESCE(o.estimated_volume_liters, 0) AS volume_liters,
       o.kitchen_estimated_ready,
       rest.id                                AS restaurant_id,
       $3                                     AS max_delivery_time_s
     FROM orders o
     JOIN restaurants rest ON rest.id = o.restaurant_id
     LEFT JOIN users ru    ON ru.id   = rest.owner_user_id
     WHERE o.driver_id = $1
       AND o.status    = ANY($2::text[])
     ORDER BY o.accepted_at ASC NULLS LAST`,
    [driverId, ACTIVE_STATUSES, getParam('max_delivery_time_s', 1800)]
  );

  // ── Agrupar pickups por restaurante ──────────────────────────────────────
  // Key: restaurantId → stop de pickup compartido
  const pickupByRestaurant = new Map();
  const stops = [];

  for (const row of r.rows) {
    const pickedUpAt = row.picked_up_at ? new Date(row.picked_up_at) : null;
    const kitchenReadyAtSec = row.kitchen_estimated_ready
      ? new Date(row.kitchen_estimated_ready).getTime() / 1000
      : nowSec;

    // Pickup pendiente (no recogido aún)
    if (row.status !== 'on_the_way' && row.rest_lat && row.rest_lng) {
      const restId = row.restaurant_id;

      if (pickupByRestaurant.has(restId)) {
        // Agrupar con pickup existente del mismo restaurante
        const existing = pickupByRestaurant.get(restId);
        existing.orderIds.push(row.id);
        existing.volumeLiters += Number(row.volume_liters) || 0;
        // Usar el kitchenReadyAt más tardío (hay que esperar al último en prepararse)
        existing.kitchenReadyAtSec = Math.max(existing.kitchenReadyAtSec, kitchenReadyAtSec);
      } else {
        const stop = {
          type:             'pickup',
          orderIds:         [row.id],
          orderId:          row.id, // alias para compatibilidad
          pos:              { lat: Number(row.rest_lat), lng: Number(row.rest_lng) },
          pickedUpAt:       null,
          volumeLiters:     Number(row.volume_liters) || 0,
          kitchenReadyAtSec,
        };
        pickupByRestaurant.set(restId, stop);
        stops.push(stop);
      }
    }

    // Delivery pendiente (uno por pedido, siempre)
    if (row.cust_lat && row.cust_lng) {
      stops.push({
        type:             'delivery',
        orderIds:         [row.id],
        orderId:          row.id,
        pos:              { lat: Number(row.cust_lat), lng: Number(row.cust_lng) },
        pickedUpAt,
        volumeLiters:     Number(row.volume_liters) || 0,
        kitchenReadyAtSec: nowSec,
        slaDeadlineSec:   (pickedUpAt ? pickedUpAt.getTime() / 1000 : nowSec)
                          + Number(row.max_delivery_time_s),
        pairOrderId:      row.id,
      });
    }
  }

  return stops;
}

// ─── Espera de cocina ─────────────────────────────────────────────────────────

/**
 * Estima cuántos segundos debe esperar el driver al llegar al restaurante.
 * Basado en kitchen_ready_at de DB — si ya pasó, espera 0.
 *
 * @param {SimStop} pickupStop
 * @param {number}  arrivalSec   — epoch segundos estimado de llegada del driver
 * @returns {number}             segundos de espera
 */
function estimateRestaurantWait(pickupStop, arrivalSec) {
  return Math.max(0, pickupStop.kitchenReadyAtSec - arrivalSec);
}

// ─── Simulación principal ─────────────────────────────────────────────────────

/**
 * Simula la ruta del driver incluyendo el nuevo pedido y calcula:
 * - etaToNewCustomer: segundos hasta entregar el nuevo pedido
 * - valid: no rompe SLA del nuevo pedido
 * - validExisting: no rompe SLA de pedidos ya asignados
 * - slaBreaches: lista de order IDs con SLA roto
 * - totalCost: score final via scoreCandidate() — única autoridad
 *
 * NUEVA LÓGICA:
 *   1. Stops antes del viableStop (prefixToViable) se recorren en orden
 *      comprometido sin reordenar — no se puede cambiar lo que el driver
 *      ya tiene enrutado.
 *   2. Stops a partir del viableStop se secuencian con findOptimalSequence()
 *      (mismo algoritmo que reroute.js) incluyendo el nuevo pedido.
 *
 * @param {object} candidate    — de findCandidates()
 * @param {object} order        — { id, restaurant_id, customer_id, estimated_volume_liters }
 * @param {{ lat, lng }} restaurantPos
 * @param {{ lat, lng }} customerPos
 * @param {number} nowSec       — Date.now() / 1000
 * @returns {Promise<object>}
 */
export async function simulateDriverWithOrder(candidate, order, restaurantPos, customerPos, nowSec) {
  const driver           = candidate.driver;
  const driverPos        = { ...driver.pos };
  const driverObj        = { speed_kmh: driver.speedKmh };
  const maxSla           = getParam('max_delivery_time_s', 1800);
  const bagCapacityLiters = Number(driver.bagCapacityLiters)
    || getParam('default_bag_capacity_liters', 25);
  const newOrderVolume   = Number(order.estimated_volume_liters) || 0;

  log(`simulator order=${order.id} driver=${driver.id}`, 'inicio simulación', {
    driverPos,
    viableStopType: candidate.viableStop?.type ?? 'none',
    viableStopDist: Math.round(candidate.viableStop?.distToRestaurant ?? 0),
    activeOrders:   driver.activeOrders,
    speedKmh:       driver.speedKmh,
    bagCapacity:    bagCapacityLiters,
    newOrderVolume,
  });

  // Estado de simulación por orderId
  const simState = {};

  // Cargar stops actuales del driver (con deduplicación de pickups)
  const existingStops = await loadDriverStops(driver.id);

  for (const stop of existingStops) {
    for (const oid of stop.orderIds) {
      if (!simState[oid]) {
        simState[oid] = {
          status:        stop.type === 'delivery' && stop.pickedUpAt ? 'on_the_way' : 'assigned',
          pickedUpAtSec: stop.pickedUpAt ? stop.pickedUpAt.getTime() / 1000 : null,
        };
      }
    }
  }

  // Añadir nuevo pedido
  simState[order.id] = {
    status:        'assigned',
    pickedUpAtSec: null,
    isNew:         true,
  };

  // ── viableStop y prefixToViable ───────────────────────────────────────────
  // viableStop: punto de inserción óptimo desde candidate-finder
  // prefixToViable: stops comprometidos ANTES del punto de inserción
  // — se recorren en orden fijo, sin reordenar
  const viableStop = candidate.viableStop ?? { type: 'driver' };

  const prefixStops = [];
  if (viableStop.type !== 'driver') {
    for (const stop of existingStops) {
      const match =
        stop.type    === viableStop.type &&
        stop.orderId === viableStop.orderId;
      prefixStops.push(stop);
      if (match) break;
    }
  }

  log(`simulator order=${order.id} driver=${driver.id}`, 'stops cargados', {
    existingStopsCount: existingStops.length,
    prefixStopsCount:   prefixStops.length,
    postStopsCount:     existingStops.length - prefixStops.length,
    viableStop:         viableStop.type,
    prefixStops: prefixStops.map(s => ({ type: s.type, orderId: s.orderId })),
  });

  // Stops post-viableStop (los que se secuenciarán de forma óptima)
  const prefixOrderIds = new Set(prefixStops.flatMap(s => s.orderIds));
  const postStops = existingStops.filter(s =>
    !s.orderIds.every(oid => prefixOrderIds.has(oid))
  );

  // ── Volumen inicial ───────────────────────────────────────────────────────
  let currentVolume = 0;
  for (const stop of existingStops) {
    if (stop.type === 'delivery' && stop.pickedUpAt !== null) {
      currentVolume += stop.volumeLiters;
    }
  }
  let peakVolume = currentVolume;

  let currentPos       = { ...driverPos };
  let simNow           = nowSec;
  let etaToNewCustomer = Infinity;

  // ── Fase 1: recorrer prefixToViable en orden comprometido ─────────────────
  for (const stop of prefixStops) {
    const travelSec = await etaEstimator.estimate(currentPos, stop.pos, driverObj);
    simNow     += travelSec;
    currentPos  = { ...stop.pos };

    if (stop.type === 'pickup') {
      const waitSec = estimateRestaurantWait(stop, simNow);
      simNow += waitSec;

      for (const oid of stop.orderIds) {
        if (simState[oid]) {
          simState[oid].status      = 'on_the_way';
          simState[oid].pickedUpAtSec = simNow;
        }
      }
      currentVolume += stop.volumeLiters;
      if (currentVolume > peakVolume) peakVolume = currentVolume;

    } else if (stop.type === 'delivery') {
      if (simState[stop.orderId]) simState[stop.orderId].status = 'delivered';
      currentVolume = Math.max(0, currentVolume - stop.volumeLiters);

      if (stop.orderId === order.id) {
        etaToNewCustomer = simNow - nowSec;
      }
    }
  }

  // ── Fase 2: secuenciar stops post-viableStop + nuevo pedido ───────────────
  // Construir lista de stops para el secuenciador en formato RerouteStop
  const stopsForSequencer = [];

  // Stops existentes post-viableStop que aún no están completados
  for (const stop of postStops) {
    const state = simState[stop.orderId];
    if (!state) continue;

    if (stop.type === 'pickup' && state.status === 'assigned') {
      stopsForSequencer.push({
        type:             'pickup',
        orderId:          stop.orderId,
        pairOrderId:      stop.orderId,
        pos:              stop.pos,
        pickedUpAtSec:    null,
        slaDeadlineSec:   simNow + maxSla, // aproximación conservadora
        kitchenReadyAtSec: stop.kitchenReadyAtSec,
        volumeLiters:     stop.volumeLiters,
        _simStop:         stop,
      });
    } else if (stop.type === 'delivery' && state.status === 'on_the_way') {
      stopsForSequencer.push({
        type:             'delivery',
        orderId:          stop.orderId,
        pairOrderId:      stop.orderId,
        pos:              stop.pos,
        pickedUpAtSec:    state.pickedUpAtSec,
        slaDeadlineSec:   (state.pickedUpAtSec ?? simNow) + maxSla,
        kitchenReadyAtSec: simNow,
        volumeLiters:     stop.volumeLiters,
        _simStop:         stop,
      });
    }
  }

  // Agregar pickup del nuevo pedido
  stopsForSequencer.push({
    type:             'pickup',
    orderId:          order.id,
    pairOrderId:      order.id,
    pos:              restaurantPos,
    pickedUpAtSec:    null,
    slaDeadlineSec:   simNow + maxSla,
    kitchenReadyAtSec: nowSec, // nuevo pedido — cocina recién arranca
    volumeLiters:     newOrderVolume,
  });

  // Agregar delivery del nuevo pedido — el secuenciador respeta precedencia
  stopsForSequencer.push({
    type:             'delivery',
    orderId:          order.id,
    pairOrderId:      order.id,
    pos:              customerPos,
    pickedUpAtSec:    null, // se actualizará durante la simulación
    slaDeadlineSec:   simNow + maxSla,
    kitchenReadyAtSec: simNow,
    volumeLiters:     newOrderVolume,
  });

  // Obtener secuencia óptima (precedencia + poda SLA + costo global mínimo)
  const optimalSequence = findOptimalSequence(
    stopsForSequencer,
    currentPos,
    driverObj,
    simNow
  );

  // ── Fase 3: simular la secuencia óptima ───────────────────────────────────
  const pickupDoneSet = new Set();

  for (const stop of optimalSequence) {
    const travelSec = await etaEstimator.estimate(currentPos, stop.pos, driverObj);
    simNow     += travelSec;
    currentPos  = { ...stop.pos };

    if (stop.type === 'pickup') {
      const waitSec = estimateRestaurantWait(stop, simNow);
      simNow += waitSec;

      if (simState[stop.orderId]) {
        simState[stop.orderId].status       = 'on_the_way';
        simState[stop.orderId].pickedUpAtSec = simNow;
      }

      currentVolume += stop.volumeLiters;
      if (currentVolume > peakVolume) peakVolume = currentVolume;
      pickupDoneSet.add(stop.orderId);

    } else if (stop.type === 'delivery') {
      // Sólo simular delivery si el pickup ya fue procesado (precedencia)
      if (!pickupDoneSet.has(stop.pairOrderId) && stop.orderId !== order.id) continue;

      if (simState[stop.orderId]) simState[stop.orderId].status = 'delivered';
      currentVolume = Math.max(0, currentVolume - stop.volumeLiters);

      if (stop.orderId === order.id) {
        etaToNewCustomer = simNow - nowSec;
        // Actualizar slaDeadline del delivery del nuevo pedido
        const pickupSec = simState[order.id]?.pickedUpAtSec ?? simNow;
        stop.slaDeadlineSec = pickupSec + maxSla;
      }
    }
  }

  // ── Verificación SLA ──────────────────────────────────────────────────────
  const delay = Math.max(0, etaToNewCustomer - maxSla);
  const valid = Number.isFinite(etaToNewCustomer) && delay === 0;

  const slaBreaches = [];
  for (const stop of existingStops) {
    if (stop.type !== 'delivery') continue;
    const st = simState[stop.orderId];
    if (!st || st.status !== 'delivered') continue;
    const pickedUp = st.pickedUpAtSec ?? nowSec;
    const elapsed  = simNow - pickedUp;
    if (elapsed > maxSla) slaBreaches.push(stop.orderId);
  }

  const validExisting = slaBreaches.length === 0;

  // ── Volumen de mochila ────────────────────────────────────────────────────
  const bagOverflowPct = bagCapacityLiters > 0
    ? Math.round((peakVolume / bagCapacityLiters) * 100)
    : 0;

  // ── Score final — scoreCandidate() es la única autoridad ─────────────────
  const simResult = {
    ...candidate,
    etaToNewCustomer,
    activeOrders:                  driver.activeOrders ?? 0,
    bridgePenaltyS:                candidate.bridgePenaltyS ?? 0,
    directDriverToRestaurantMeters: candidate.directDriverToRestaurantMeters ?? 0,
    driverSpeedKmh:                driver.speedKmh ?? 30,
  };

  const { totalCost, ...scoreParts } = scoreCandidate(
    simResult,
    { max_delivery_time_s: null },
    driver.disconnectPenalties ?? 0
  );

  log(`simulator order=${order.id} driver=${driver.id}`, 'resultado simulación', {
    etaToNewCustomer:  Math.round(etaToNewCustomer),
    valid,
    validExisting,
    slaBreaches,
    newOrderDelay:     Math.round(delay),
    peakVolumeLiters:  Math.round(peakVolume * 10) / 10,
    bagOverflowPct,
    totalCost:         Math.round(totalCost),
    stopsSecuenciados: optimalSequence.length,
  });

  if (!valid) {
    logWarn(`simulator order=${order.id} driver=${driver.id}`, 'simulación inválida', {
      etaToNewCustomer: Math.round(etaToNewCustomer),
      maxSla,
      delay: Math.round(delay),
      slaBreaches,
    });
  }

  return {
    ...simResult,
    valid:            valid && validExisting,
    validExisting,
    slaBreaches,
    newOrderDelay:    delay,
    totalCost,
    ...scoreParts,
    // Volumen
    bagCapacityLiters,
    peakVolumeLiters: Math.round(peakVolume * 1000) / 1000,
    bagOverflowPct,
  };
}
