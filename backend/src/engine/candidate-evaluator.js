// backend/src/engine/candidate-evaluator.js
//
// Módulo de evaluación de candidatos para asignación de pedidos.
// Reemplaza route-simulator.js con una implementación que reutiliza
// findOptimalSequence de reroute.js.
//
// Cambios respecto a route-simulator.js:
//   - Usa findOptimalSequence como único secuenciador (consistente con navegación)
//   - Soporta forceFirstStop para viableStop.type === 'driver'
//   - Calcula bridgePenaltyS correctamente para scoreCandidate
//   - Calcula peakVolume con initialVolume desde pedidos ya recogidos

import { query } from '../config/db.js';
import { haversineMeters } from '../utils/geo.js';
import { getParam } from './params.js';
import { scoreCandidate } from './scoring.js';
import { findOptimalSequence } from './reroute.js';
import { ACTIVE_STATUSES } from '../modules/orders/assignment/constants.js';
import { groupPickupStops } from './stop-grouper.js';

// ─── Carga de stops enriquecidos (reutiliza stop-grouper) ─────────────────────

/**
 * Carga los stops activos del driver en formato RerouteStop.
 * Reutiliza groupPickupStops con modo 'reroute'.
 *
 * @param {string} driverId
 * @returns {Promise<Array<RerouteStop>>}
 */
async function loadDriverStopsForEvaluation(driverId) {
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

// ─── Cálculo de volumen máximo en mochila ─────────────────────────────────────

/**
 * Calcula el volumen máximo alcanzado durante la secuencia.
 *
 * @param {RerouteStop[]} sequence
 * @param {number} initialVolume - volumen ya ocupado por pedidos recogidos
 * @returns {number}
 */
function calculatePeakVolume(sequence, initialVolume = 0) {
  let currentVolume = initialVolume;
  let peakVolume = currentVolume;

  for (const stop of sequence) {
    if (stop.type === 'pickup') {
      currentVolume += stop.volumeLiters;
      if (currentVolume > peakVolume) peakVolume = currentVolume;
    } else if (stop.type === 'delivery') {
      currentVolume = Math.max(0, currentVolume - stop.volumeLiters);
    }
  }

  return peakVolume;
}

// ─── Evaluación principal ─────────────────────────────────────────────────────

/**
 * Evalúa múltiples candidatos en paralelo.
 *
 * @param {Array} candidates - topDrivers de findCandidates (cada uno con driver, viableStop, etc.)
 * @param {Object} order - { id, estimated_volume_liters }
 * @param {{lat,lng}} restaurantPos
 * @param {{lat,lng}} customerPos
 * @param {number} nowSec
 * @returns {Promise<Array>} - Evaluated candidates con:
 *   { driverId, totalCost, valid, validExisting, slaBreaches, newOrderDelay,
 *     bagOverflowPct, etaToNewCustomer, bridgeComponent, fairnessComponent, disconnectComponent }
 */
export async function evaluateCandidates(candidates, order, restaurantPos, customerPos, nowSec) {
  const maxSla = getParam('max_delivery_time_s', 1800);
  const newOrderVolume = Number(order.estimated_volume_liters) || 0;

  const evaluated = await Promise.all(
    candidates.map(async (candidate) => {
      const driver = candidate.driver;
      const driverObj = { speed_kmh: driver.speedKmh };
      const speedMs = Math.max(1, (driver.speedKmh * 1000) / 3600);

      // 1. Cargar stops actuales del driver
      const existingStops = await loadDriverStopsForEvaluation(driver.id);

      // 2. Calcular initialVolume (pedidos ya recogidos)
      const initialVolume = existingStops
        .filter(s => s.type === 'delivery' && s.pickedUpAtSec !== null)
        .reduce((sum, s) => sum + s.volumeLiters, 0);

      // 3. Crear stops del nuevo pedido
      // SLA deadline corre desde created_at — el cliente espera desde que hizo el pedido
      const orderCreatedAtSec = order.created_at
        ? new Date(order.created_at).getTime() / 1000
        : nowSec;
      const newOrderSlaDeadline = orderCreatedAtSec + maxSla;

      const newPickupStop = {
        type: 'pickup',
        orderId: order.id,
        pairOrderId: order.id,
        pos: restaurantPos,
        pickedUpAtSec: null,
        slaDeadlineSec: newOrderSlaDeadline,
        kitchenReadyAtSec: nowSec,
        volumeLiters: newOrderVolume,
      };

      const newDeliveryStop = {
        type: 'delivery',
        orderId: order.id,
        pairOrderId: order.id,
        pos: customerPos,
        pickedUpAtSec: null,
        slaDeadlineSec: newOrderSlaDeadline,
        kitchenReadyAtSec: nowSec,
        volumeLiters: newOrderVolume,
      };

      // 4. Combinar stops
      const allStops = [...existingStops, newPickupStop, newDeliveryStop];

      // 5. Secuencia normal (sin forzar)
      const normalResult = findOptimalSequence(
        allStops, driver.pos, driverObj, nowSec
      );

      let bestSequence = normalResult.sequence;
      let bestStopsWithEta = normalResult.stopsWithEta;
      let bestSlaBreaches = normalResult.slaBreaches;

      // 6. Si viableStop.type === 'driver', evaluar alternativa con forceFirstStop
      if (candidate.viableStop?.type === 'driver') {
        const stopsWithoutNew = [...existingStops];
        let sequenceWithoutNew = [];
        
        if (stopsWithoutNew.length > 0) {
          const resultWithoutNew = findOptimalSequence(
            stopsWithoutNew, driver.pos, driverObj, nowSec
          );
          sequenceWithoutNew = resultWithoutNew.sequence;
        }

        if (sequenceWithoutNew.length > 0) {
          const firstStop = sequenceWithoutNew[0];
          
          let matchedStop = null;
          for (const stop of allStops) {
            if (stop.type === firstStop.type && stop.orderId === firstStop.orderId) {
              matchedStop = stop;
              break;
            }
          }

          if (matchedStop) {
            const forcedResult = findOptimalSequence(
              allStops, driver.pos, driverObj, nowSec, matchedStop
            );

            const normalEta = normalResult.stopsWithEta.find(
              s => s.type === 'delivery' && s.orderId === order.id
            )?.etaFromNowSec ?? Infinity;

            const forcedEta = forcedResult.stopsWithEta.find(
              s => s.type === 'delivery' && s.orderId === order.id
            )?.etaFromNowSec ?? Infinity;

            if (forcedEta < normalEta) {
              bestSequence = forcedResult.sequence;
              bestStopsWithEta = forcedResult.stopsWithEta;
              bestSlaBreaches = forcedResult.slaBreaches;
            }
          }
        }
      }

      // 7. Extraer etaToNewCustomer
      const newDeliveryEta = bestStopsWithEta.find(
        s => s.type === 'delivery' && s.orderId === order.id
      );
      const etaToNewCustomer = newDeliveryEta?.etaFromNowSec ?? Infinity;

      // 8. Calcular peakVolume
      const peakVolume = calculatePeakVolume(bestSequence, initialVolume);

      // 9. Verificar SLA
      const delay = Math.max(0, etaToNewCustomer - maxSla);
      const valid = Number.isFinite(etaToNewCustomer) && delay === 0;
      const existingBreaches = bestSlaBreaches.filter(id => id !== order.id);
      const validExisting = existingBreaches.length === 0;

      // 10. Calcular bagOverflowPct
      const bagCapacityLiters = Number(driver.bagCapacityLiters) || getParam('default_bag_capacity_liters', 60);
      const bagOverflowPct = bagCapacityLiters > 0
        ? Math.round((peakVolume / bagCapacityLiters) * 100)
        : 0;

      // 11. Calcular bridgePenaltyS para scoreCandidate
      let bridgePenaltyS = 0;
      if (candidate.viableStop) {
        const viableStopPos = candidate.viableStop.pos;
        const distToRestaurant = haversineMeters(viableStopPos, restaurantPos);
        bridgePenaltyS = distToRestaurant / speedMs;
      } else {
        const directDist = haversineMeters(driver.pos, restaurantPos);
        bridgePenaltyS = directDist / speedMs;
      }

      // 12. Llamar a scoreCandidate
      const simResult = {
        etaToNewCustomer,
        activeOrders: driver.activeOrders ?? 0,
        bridgePenaltyS,
        directDriverToRestaurantMeters: candidate.directDriverToRestaurantMeters ?? haversineMeters(driver.pos, restaurantPos),
        driverSpeedKmh: driver.speedKmh ?? 30,
      };

      const { totalCost, ...scoreParts } = scoreCandidate(
        simResult,
        { max_delivery_time_s: null },
        driver.disconnectPenalties ?? 0
      );

      return {
        driverId: driver.id,
        totalCost,
        valid: valid && validExisting,
        validExisting,
        slaBreaches: existingBreaches,
        newOrderDelay: delay,
        bagOverflowPct,
        etaToNewCustomer,
        ...scoreParts,
      };
    })
  );

  return evaluated;
}