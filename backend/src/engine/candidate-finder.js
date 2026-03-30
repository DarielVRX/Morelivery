// backend/src/engine/candidate-finder.js
//
// AssignmentCandidateFinder adaptado para producción.
// En lugar de iterar sobre world.drivers en memoria, consulta la DB
// para obtener drivers elegibles y construye el sobre de candidatos
// usando OSRM real (con caché).
//
// CAMBIOS respecto a versión anterior:
//   - Agrega _getClosestViableStop(): encuentra el mejor punto de inserción
//     en la ruta actual del driver (posición actual o stop ya comprometido
//     cercano al restaurante). Portado de AssignmentCandidateFinder.js.
//   - Agrega loadDriverActiveStops(): carga stops activos del driver desde DB
//     para poder calcular el viableStop correctamente.
//   - etaToRestaurant ahora se calcula via viableStop, no directo desde pos del driver.
//   - bridgePenaltyS ahora refleja el desvío real desde viableStop al restaurante.
//   - approxScore se mantiene en el envelope pero NO se usa como criterio de ranking
//     en topDrivers — el simulador es el árbitro final.
//   - viableStop y activeStops se exponen en cada candidato para el simulador.

import { query } from '../config/db.js';
import { haversineMeters } from '../utils/geo.js';
import { etaEstimator } from './eta.js';
import { getParam } from './params.js';
import { ACTIVE_STATUSES, log, logWarn } from '../modules/orders/assignment/constants.js';

/**
 * Velocidad promedio según tipo de vehículo.
 * @param {string|null} vehicleType
 * @returns {number} km/h
 */
function speedKmhByVehicle(vehicleType) {
  switch (vehicleType) {
    case 'bike':       return 20;
    case 'motorcycle': return 35;
    case 'car':        return 40;
    default:           return 30;
  }
}

/**
 * Carga drivers candidatos desde la DB:
 * - Disponibles y activos
 * - Bajo el límite de max_active_orders_per_driver
 * - Sin cooldown activo para ESTE pedido
 * - Con posición GPS registrada
 *
 * @param {string} orderId
 * @returns {Promise<Array>}
 */
async function loadCandidateDrivers(orderId) {
  const maxActive    = getParam('max_active_orders_per_driver', 4);
  const maxPenalties = getParam('disconnect_penalty_max', 3);

  const r = await query(
    `SELECT
       dp.user_id          AS id,
       dp.driver_number,
       dp.vehicle_type,
       dp.disconnect_penalties,
       dp.bag_capacity_liters,
       dp.last_lat         AS lat,
       dp.last_lng         AS lng,
       (SELECT COUNT(*)::int FROM orders o
        WHERE o.driver_id = dp.user_id AND o.status = ANY($1::text[])
       )                   AS active_orders
     FROM driver_profiles dp
     JOIN users u ON u.id = dp.user_id
     WHERE dp.is_available = true
       AND u.status = 'active'
       AND dp.last_lat IS NOT NULL
       AND dp.last_lng IS NOT NULL
       AND (
         SELECT COUNT(*) FROM orders o
         WHERE o.driver_id = dp.user_id AND o.status = ANY($1::text[])
       ) < $2
       AND NOT EXISTS (
         SELECT 1 FROM order_driver_offers od
         WHERE od.order_id = $3
           AND od.driver_id = dp.user_id
           AND od.status IN ('rejected','released','expired')
           AND od.wait_until > NOW()
       )
       AND NOT EXISTS (
         SELECT 1 FROM order_driver_offers od
         WHERE od.order_id = $3
           AND od.driver_id = dp.user_id
           AND od.status = 'accepted'
       )
       AND dp.disconnect_penalties < $4`,
    [ACTIVE_STATUSES, maxActive, orderId, maxPenalties]
  );

  const result = r.rows.map(row => ({
    id:                  row.id,
    driverNumber:        row.driver_number,
    vehicleType:         row.vehicle_type,
    speedKmh:            speedKmhByVehicle(row.vehicle_type),
    disconnectPenalties: row.disconnect_penalties ?? 0,
    bagCapacityLiters:   Number(row.bag_capacity_liters) || 25,
    pos:                 { lat: Number(row.lat), lng: Number(row.lng) },
    activeOrders:        row.active_orders ?? 0,
  }));
  log(`finder order=${orderId}`, `loadCandidateDrivers: ${result.length} drivers en DB`, {
    drivers: result.map(d => ({ id: d.id, activeOrders: d.activeOrders, vehicle: d.vehicleType })),
  });
  return result;
}

/**
 * Carga los stops activos de un driver desde DB.
 * Se usa para calcular el viableStop (punto de inserción óptimo).
 *
 * @param {string} driverId
 * @returns {Promise<Array<{ type, orderId, pos, routeIndex }>>}
 */
async function loadDriverActiveStops(driverId) {
  const r = await query(
    `SELECT
       o.id,
       o.status,
       o.delivery_lat                         AS cust_lat,
       o.delivery_lng                         AS cust_lng,
       COALESCE(ru.home_lat, rest.lat)        AS rest_lat,
       COALESCE(ru.home_lng, rest.lng)        AS rest_lng
     FROM orders o
     JOIN restaurants rest ON rest.id = o.restaurant_id
     LEFT JOIN users ru    ON ru.id   = rest.owner_user_id
     WHERE o.driver_id = $1
       AND o.status    = ANY($2::text[])
     ORDER BY o.accepted_at ASC NULLS LAST`,
    [driverId, ACTIVE_STATUSES]
  );

  const stops = [];
  let idx = 0;

  for (const row of r.rows) {
    if (row.status !== 'on_the_way' && row.rest_lat && row.rest_lng) {
      stops.push({
        type:       'pickup',
        orderId:    row.id,
        pos:        { lat: Number(row.rest_lat), lng: Number(row.rest_lng) },
        routeIndex: idx++,
      });
    }
    if (row.cust_lat && row.cust_lng) {
      stops.push({
        type:       'delivery',
        orderId:    row.id,
        pos:        { lat: Number(row.cust_lat), lng: Number(row.cust_lng) },
        routeIndex: idx++,
      });
    }
  }

  return stops;
}

/**
 * Encuentra el punto de inserción óptimo para el nuevo pedido en la ruta
 * actual del driver.
 *
 * Candidatos:
 *   1. Posición actual del driver (type: 'driver')
 *   2. Cualquier stop ya comprometido en ruta que esté dentro del radio
 *      del restaurante — insertar el pickup nuevo después de ese stop
 *      puede ser más eficiente que desviar desde la posición actual.
 *
 * Retorna el candidato con menor distancia al restaurante.
 *
 * @param {{lat,lng}} driverPos
 * @param {Array}     activeStops   — de loadDriverActiveStops()
 * @param {{lat,lng}} restaurantPos
 * @param {number}    maxRadiusM
 * @returns {{ type, orderId, pos, distToRestaurant, routeIndex? } | null}
 */
function getClosestViableStop(driverPos, activeStops, restaurantPos, maxRadiusM) {
  const candidates = [];

  // Posición actual del driver
  const driverDist = haversineMeters(driverPos, restaurantPos);
  if (driverDist < maxRadiusM) {
    candidates.push({
      type:              'driver',
      orderId:           null,
      pos:               { ...driverPos },
      distToRestaurant:  driverDist,
    });
  } else {
    logWarn('finder', 'getClosestViableStop: driver fuera de radio', {
      driverDist: Math.round(driverDist),
      maxRadiusM,
    });
  }

  // Stops ya en ruta
  for (const stop of activeStops) {
    const dist = haversineMeters(stop.pos, restaurantPos);
    if (dist >= maxRadiusM) continue;
    candidates.push({
      type:             stop.type,
      orderId:          stop.orderId,
      pos:              { ...stop.pos },
      routeIndex:       stop.routeIndex,
      distToRestaurant: dist,
    });
  }

  if (candidates.length === 0) {
    logWarn('finder', 'getClosestViableStop: sin candidatos viables', {
      driverDist: Math.round(driverDist),
      maxRadiusM,
      activeStopsCount: activeStops.length,
      activeStopDists: activeStops.map(s => ({
        type: s.type,
        orderId: s.orderId,
        dist: Math.round(haversineMeters(s.pos, restaurantPos)),
      })),
    });
    return null;
  }

  // Retornar el candidato más cercano al restaurante
  candidates.sort((a, b) => a.distToRestaurant - b.distToRestaurant);
  return candidates[0];
}

/**
 * Estima el ETA del driver hasta el viableStop recorriendo los stops previos
 * en orden de ruta.
 *
 * Si viableStop es la posición del driver (type='driver'), ETA = 0.
 *
 * @param {{lat,lng}}  driverPos
 * @param {Array}      activeStops
 * @param {object}     viableStop
 * @param {object}     driverObj    — { speed_kmh }
 * @returns {Promise<number>}       segundos
 */
async function estimateEtaToViableStop(driverPos, activeStops, viableStop, driverObj) {
  if (!viableStop || viableStop.type === 'driver') return 0;

  let pos     = driverPos;
  let eta     = 0;

  for (const stop of activeStops) {
    const travelSec = await etaEstimator.estimate(pos, stop.pos, driverObj);
    eta += travelSec;
    pos  = stop.pos;

    const match =
      (Number.isFinite(viableStop.routeIndex) && viableStop.routeIndex === stop.routeIndex) ||
      (stop.type === viableStop.type && stop.orderId === viableStop.orderId);

    if (match) return eta;
  }

  return 0;
}

/**
 * Construye el envelope de candidatos para un pedido.
 * Para cada driver calcula ETAs relevantes usando el viableStop real.
 *
 * @param {string} orderId
 * @param {{ lat: number, lng: number }} restaurantPos
 * @param {{ lat: number, lng: number }} customerPos
 * @returns {Promise<{ topDrivers: Array, viableDrivers: Array }>}
 */
export async function findCandidates(orderId, restaurantPos, customerPos) {
  const maxRadiusM  = getParam('max_pickup_radius_km', 5) * 1000;
  const hardTopK    = Math.max(1, getParam('assignment_hard_top_k', 5));
  const nearbyPrefM = Math.max(25, getParam('nearby_driver_preference_m', 250));

  const drivers = await loadCandidateDrivers(orderId);
  if (drivers.length === 0) {
    logWarn(`finder order=${orderId}`, 'findCandidates: 0 drivers elegibles en DB');
    return { topDrivers: [], viableDrivers: [] };
  }

  // Filtrar por radio (distancia directa driver→restaurante como pre-filtro rápido)
  const withRadius = drivers.filter(d =>
    haversineMeters(d.pos, restaurantPos) < maxRadiusM
  );
  log(`finder order=${orderId}`, `filtro radio: ${drivers.length} total → ${withRadius.length} dentro de ${maxRadiusM}m`, {
    descartadosPorRadio: drivers
      .filter(d => haversineMeters(d.pos, restaurantPos) >= maxRadiusM)
      .map(d => ({ id: d.id, dist: Math.round(haversineMeters(d.pos, restaurantPos)) })),
  });
  if (withRadius.length === 0) {
    logWarn(`finder order=${orderId}`, 'findCandidates: 0 drivers dentro del radio');
    return { topDrivers: [], viableDrivers: [] };
  }

  // Construir envelopes en paralelo
  const envelopes = await Promise.all(
    withRadius.map(async d => {
      const driverObj  = { speed_kmh: d.speedKmh };
      const speedMs    = Math.max(1, (d.speedKmh * 1000) / 3600);

      // Cargar stops activos del driver para calcular viableStop
      const activeStops = await loadDriverActiveStops(d.id);

      // Encontrar punto de inserción óptimo
      const viableStop = getClosestViableStop(d.pos, activeStops, restaurantPos, maxRadiusM);

      // Sin viableStop el driver no puede tomar el pedido
      if (!viableStop) {
        logWarn(`finder order=${orderId}`, `driver=${d.id} descartado: sin viableStop`, {
          driverPos: d.pos,
          activeStopsCount: activeStops.length,
        });
        return null;
      }

      // ETAs
      const [etaToViableStop, etaViableToRestaurant, etaRestaurantToCustomer] = await Promise.all([
        estimateEtaToViableStop(d.pos, activeStops, viableStop, driverObj),
        etaEstimator.estimate(viableStop.pos, restaurantPos, driverObj),
        etaEstimator.estimate(restaurantPos, customerPos, driverObj),
      ]);

      const directDriverToRestaurantMeters = haversineMeters(d.pos, restaurantPos);

      // bridgePenaltyS: desvío desde viableStop al restaurante
      // Más preciso que antes donde se calculaba desde la posición directa del driver
      const driverBridgeMeters = Math.max(
        0,
        directDriverToRestaurantMeters - (viableStop.distToRestaurant ?? 0)
      );
      const bridgePenaltyS = driverBridgeMeters / speedMs;
      const loadPenalty    = d.activeOrders * getParam('fairness_penalty_per_order_s', 120);

      // approxScore se conserva en el envelope para logging/debug
      // pero NO se usa como criterio de ranking — el simulador decide
      const approxScore =
        etaToViableStop +
        etaViableToRestaurant +
        etaRestaurantToCustomer +
        loadPenalty +
        bridgePenaltyS * getParam('pickup_bridge_penalty_factor', 1);

      log(`finder order=${orderId}`, `envelope driver=${d.id}`, {
        viableStopType:       viableStop.type,
        viableStopDist:       Math.round(viableStop.distToRestaurant ?? 0),
        etaToViableStop:      Math.round(etaToViableStop),
        etaViableToRestaurant: Math.round(etaViableToRestaurant),
        etaRestaurantToCustomer: Math.round(etaRestaurantToCustomer),
        etaToNewCustomer:     Math.round(etaToViableStop + etaViableToRestaurant + etaRestaurantToCustomer),
        bridgePenaltyS:       Math.round(bridgePenaltyS),
        activeOrders:         d.activeOrders,
        approxScore:          Math.round(approxScore),
      });

      return {
        driver:                        d,
        viableStop,
        activeStops,
        approxScore,
        etaToViableStop,
        etaViableToRestaurant,
        etaRestaurantToCustomer,
        etaToRestaurant:               etaToViableStop + etaViableToRestaurant,
        etaToNewCustomer:              etaToViableStop + etaViableToRestaurant + etaRestaurantToCustomer,
        directDriverToRestaurantMeters,
        bridgePenaltyS,
        loadPenalty,
        activeOrders:                  d.activeOrders,
        driverSpeedKmh:                d.speedKmh,
        disconnectPenalties:           d.disconnectPenalties,
        valid:                         true,
        validExisting:                 true,
      };
    })
  );

  // Filtrar nulls (drivers sin viableStop)
  const validEnvelopes = envelopes.filter(Boolean);
  log(`finder order=${orderId}`, `envelopes: ${withRadius.length} candidatos → ${validEnvelopes.length} con viableStop válido`);
  if (validEnvelopes.length === 0) {
    logWarn(`finder order=${orderId}`, 'findCandidates: 0 envelopes válidos tras viableStop');
    return { topDrivers: [], viableDrivers: [] };
  }

  // viableDrivers ordenados por etaToNewCustomer (para logging/debug)
  const viableDrivers = [...validEnvelopes].sort((a, b) => a.etaToNewCustomer - b.etaToNewCustomer);

  // Preferir drivers cercanos al restaurante (o cuyo viableStop esté cerca)
  const preferredNearby = viableDrivers.filter(c =>
    c.directDriverToRestaurantMeters <= nearbyPrefM ||
    (c.viableStop?.distToRestaurant ?? Infinity) <= nearbyPrefM
  );

  // topDrivers: nearby + top K — sin ranking por approxScore
  // El orden aquí no importa porque el simulador evalúa todos
  const seen       = new Set();
  const topDrivers = [];

  for (const c of [...preferredNearby, ...viableDrivers.slice(0, hardTopK)]) {
    if (seen.has(c.driver.id)) continue;
    seen.add(c.driver.id);
    topDrivers.push(c);
  }

  log(`finder order=${orderId}`, `topDrivers final: ${topDrivers.length}`, {
    topDrivers: topDrivers.map(c => ({
      id: c.driver.id,
      etaToNewCustomer: Math.round(c.etaToNewCustomer),
      approxScore: Math.round(c.approxScore),
    })),
  });

  return { topDrivers, viableDrivers };
}
