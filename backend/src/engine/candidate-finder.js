// backend/src/engine/candidate-finder.js
//
// AssignmentCandidateFinder adaptado para producción.
// En lugar de iterar sobre world.drivers en memoria, consulta la DB
// para obtener drivers elegibles y construye el sobre de candidatos
// usando OSRM real (con caché).
//
// Diferencias respecto al simulador:
//   - No usa world.drivers — consulta driver_profiles + orders en DB
//   - getSpeedKmh: usa vehicle_type de la DB (bike=20, moto=35, car=40)
//   - El filtro de capacidad usa MAX del param, no driver.max_orders
//   - disconnect_penalties viene de driver_profiles.disconnect_penalties
//   - No hay _reservedSlots — el FOR UPDATE SKIP LOCKED de PG lo maneja

import { query } from '../config/db.js';
import { haversineMeters } from '../utils/geo.js';
import { etaEstimator } from './eta.js';
import { getParam } from './params.js';
import { shortId } from '../utils/geo.js';
import { ACTIVE_STATUSES } from '../modules/orders/assignment/constants.js';

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
 * - Sin cooldown activo para ESTE pedido (no en order_driver_offers expirado/rechazado con wait_until > NOW)
 * - Con posición GPS registrada
 *
 * @param {string} orderId
 * @returns {Promise<Array>}
 */
async function loadCandidateDrivers(orderId) {
  const maxActive = getParam('max_active_orders_per_driver', 4);
  const maxPenalties = getParam('disconnect_penalty_max', 3);

  const r = await query(
    `SELECT
       dp.user_id          AS id,
       dp.driver_number,
       dp.vehicle_type,
       dp.disconnect_penalties,
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
       -- Bajo el límite de capacidad
       AND (
         SELECT COUNT(*) FROM orders o
         WHERE o.driver_id = dp.user_id AND o.status = ANY($1::text[])
       ) < $2
       -- Sin cooldown activo para este pedido
       AND NOT EXISTS (
         SELECT 1 FROM order_driver_offers od
         WHERE od.order_id = $3
           AND od.driver_id = dp.user_id
           AND od.status IN ('rejected','released','expired')
           AND od.wait_until > NOW()
       )
       -- No aceptó ya este pedido
       AND NOT EXISTS (
         SELECT 1 FROM order_driver_offers od
         WHERE od.order_id = $3
           AND od.driver_id = dp.user_id
           AND od.status = 'accepted'
       )
       -- Penalizaciones bajo el máximo
       AND dp.disconnect_penalties < $4`,
    [ACTIVE_STATUSES, maxActive, orderId, maxPenalties]
  );

  return r.rows.map(row => ({
    id:                  row.id,
    driverNumber:        row.driver_number,
    vehicleType:         row.vehicle_type,
    speedKmh:            speedKmhByVehicle(row.vehicle_type),
    disconnectPenalties: row.disconnect_penalties ?? 0,
    pos:                 { lat: Number(row.lat), lng: Number(row.lng) },
    activeOrders:        row.active_orders ?? 0,
  }));
}

/**
 * Construye el envelope de candidatos para un pedido.
 * Para cada driver calcula ETAs relevantes y una aproximación del score
 * que luego RouteInsertionSimulator afina.
 *
 * @param {string} orderId
 * @param {{ lat: number, lng: number }} restaurantPos
 * @param {{ lat: number, lng: number }} customerPos
 * @returns {Promise<{ topDrivers: Array, viableDrivers: Array }>}
 */
export async function findCandidates(orderId, restaurantPos, customerPos) {
  const maxRadiusM   = getParam('max_pickup_radius_km', 5) * 1000;
  const hardTopK     = Math.max(1, getParam('assignment_hard_top_k', 5));
  const nearbyPrefM  = Math.max(25, getParam('nearby_driver_preference_m', 250));

  const drivers = await loadCandidateDrivers(orderId);

  if (drivers.length === 0) return { topDrivers: [], viableDrivers: [] };

  // Filtrar por radio y calcular ETAs en paralelo
  const withRadius = drivers.filter(d =>
    haversineMeters(d.pos, restaurantPos) < maxRadiusM
  );

  if (withRadius.length === 0) return { topDrivers: [], viableDrivers: [] };

  const envelopes = await Promise.all(
    withRadius.map(async d => {
      const driverObj = { speed_kmh: d.speedKmh };
      const [etaDriverToRestaurant, etaRestaurantToCustomer] = await Promise.all([
        etaEstimator.estimate(d.pos, restaurantPos, driverObj),
        etaEstimator.estimate(restaurantPos, customerPos, driverObj),
      ]);

      const directDriverToRestaurantMeters = haversineMeters(d.pos, restaurantPos);
      const speedMs = Math.max(1, (d.speedKmh * 1000) / 3600);

      // bridgePenaltyS: coste de desvío desde posición actual al restaurante
      // (simplificado sin stops intermedios — el simulador completo lo hace en RouteInsertionSimulator)
      const bridgePenaltyS = directDriverToRestaurantMeters / speedMs;
      const loadPenalty    = d.activeOrders * getParam('fairness_penalty_per_order_s', 120);

      const approxScore =
        etaDriverToRestaurant +
        etaRestaurantToCustomer +
        loadPenalty +
        bridgePenaltyS * 0.35;

      return {
        driver:                       d,
        approxScore,
        etaToRestaurant:              etaDriverToRestaurant,
        etaRestaurantToCustomer,
        etaToNewCustomer:             etaDriverToRestaurant + etaRestaurantToCustomer,
        directDriverToRestaurantMeters,
        bridgePenaltyS,
        loadPenalty,
        activeOrders:                 d.activeOrders,
        driverSpeedKmh:               d.speedKmh,
        disconnectPenalties:          d.disconnectPenalties,
        valid:                        true,
        validExisting:                true,
      };
    })
  );

  // Ordenar por approxScore
  const viableDrivers = [...envelopes].sort((a, b) => a.approxScore - b.approxScore);

  // Preferir drivers cercanos al restaurante
  const preferredNearby = viableDrivers.filter(c =>
    c.directDriverToRestaurantMeters <= nearbyPrefM
  );

  // Construir topDrivers combinando nearby + top K
  const seen = new Set();
  const topDrivers = [];
  for (const c of [...preferredNearby, ...viableDrivers.slice(0, hardTopK)]) {
    if (seen.has(c.driver.id)) continue;
    seen.add(c.driver.id);
    topDrivers.push(c);
  }

  return { topDrivers, viableDrivers };
}
