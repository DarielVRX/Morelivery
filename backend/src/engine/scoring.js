// backend/src/engine/scoring.js
//
// Función de scoring extraída de AssignmentEngine._scoreCandidate.
// Calcula el costo total de asignar un pedido a un driver candidato,
// considerando: ETA, fairness, SLA, proximidad, bridge penalty y penalizaciones
// por desconexión previas.
//
// Un costo menor = mejor candidato.
//
// CAMBIOS respecto a versión anterior:
//   - pickup_bridge_penalty_factor ahora viene de params (antes hardcoded 0.35)
//   - bridgePenaltyS se recibe directamente del simulador (calculado sobre viableStop real)

import { getParam } from './params.js';
import { log } from '../modules/orders/assignment/constants.js';

/**
 * Calcula el score de un candidato para un pedido específico.
 *
 * @param {object} candidate  — resultado de simulateDriverWithOrder()
 *   Campos esperados:
 *     etaToNewCustomer          {number}  ETA total hasta entregar el nuevo pedido (segundos)
 *     activeOrders              {number}  pedidos activos del driver al momento de simular
 *     bridgePenaltyS            {number}  coste de desvío desde viableStop al restaurante (segundos)
 *     directDriverToRestaurantMeters {number} distancia haversine driver→restaurante
 *     driverSpeedKmh            {number}  velocidad del driver en km/h
 *
 * @param {object} customer   — { max_delivery_time_s? }
 * @param {number} driverPenalties — disconnect_penalties del driver (de DB)
 *
 * @returns {{
 *   totalCost: number,
 *   fairnessPenalty: number,
 *   softSlaPenalty: number,
 *   hardSlaPenalty: number,
 *   bridgePenalty: number,
 *   disconnectPenalty: number,
 * }}
 */
export function scoreCandidate(candidate, customer, driverPenalties = 0) {
  const fairnessWeight      = getParam('fairness_penalty_per_order_s',    120);
  const softSlaWeight       = getParam('soft_sla_penalty_factor',            3); // intensificado para compensar umbral hard más alto
  const hardPenalty         = getParam('hard_sla_penalty_s',             1800);
  const bridgeWeight        = getParam('pickup_bridge_penalty_factor',       1);
  const disconnectPenaltyS  = getParam('disconnect_penalty_s',             300);
  const maxDeliverySla      = getParam('max_delivery_time_s',             1800);

  const activeOrders      = candidate.activeOrders ?? 0;
  const fairnessPenalty   = activeOrders * fairnessWeight;
  const disconnectPenalty = driverPenalties * disconnectPenaltyS;

  const maxSla         = customer?.max_delivery_time_s ?? maxDeliverySla;
  const eta            = candidate.etaToNewCustomer ?? Infinity;
  const delay          = Math.max(0, eta - maxSla);
  const softSlaPenalty = delay * softSlaWeight;
  // hardSlaPenalty: solo se activa si el retraso supera 15 min (900s) — evita pánico
  // algorítmico ante retrasos leves que permiten batching rentable.
  const hardSlaPenalty = delay > 900 ? hardPenalty : 0;

  // proximityPenalty eliminada: la distancia ya está capturada en el eta (OSRM/haversine).
  // Penalizarla por separado generaba doble imposición geométrica.
  // La distancia pura permanece en candidate-finder como filtro de descarte (maxRadiusM).

  // bridgePenalty: coste de desvío desde viableStop al restaurante.
  // bridgePenaltyS calculado sobre el punto de inserción real — ortogonal al eta.
  const bridgePenalty = Math.max(0, candidate.bridgePenaltyS ?? 0) * bridgeWeight;

  const totalCost =
    eta +
    fairnessPenalty +
    softSlaPenalty +
    hardSlaPenalty +
    bridgePenalty +
    disconnectPenalty;

  const result = {
    totalCost: Number.isFinite(totalCost) ? totalCost : Infinity,
    fairnessPenalty,
    softSlaPenalty,
    hardSlaPenalty,
    bridgePenalty,
    disconnectPenalty,
  };

  log(`scoring driver=${candidate.driverSpeedKmh ?? '?'}kmh`, 'scoreCandidate', {
    eta:               Math.round(eta),
    fairnessPenalty:   Math.round(fairnessPenalty),
    softSlaPenalty:    Math.round(softSlaPenalty),
    hardSlaPenalty:    Math.round(hardSlaPenalty),
    bridgePenalty:     Math.round(bridgePenalty),
    disconnectPenalty: Math.round(disconnectPenalty),
    totalCost:         Math.round(result.totalCost),
    activeOrders,
    maxSla,
    delay:             Math.round(delay),
  });

  return result;
}
