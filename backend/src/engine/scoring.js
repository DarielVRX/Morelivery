// backend/src/engine/scoring.js
//
// Función de scoring extraída de AssignmentEngine._scoreCandidate.
// Calcula el costo total de asignar un pedido a un driver candidato,
// considerando: ETA, fairness, SLA, proximidad, bridge penalty y penalizaciones
// por desconexión previas.
//
// Un costo menor = mejor candidato.

import { getParam } from './params.js';

/**
 * Calcula el score de un candidato para un pedido específico.
 *
 * @param {object} candidate  — resultado de CandidateFinder.find()
 * @param {object} customer   — { max_delivery_time_s? }
 * @param {number} driverPenalties — disconnect_penalties del driver (de DB)
 * @returns {{ totalCost: number, fairnessPenalty, softSlaPenalty, hardSlaPenalty, proximityPenalty, bridgePenalty, disconnectPenalty }}
 */
export function scoreCandidate(candidate, customer, driverPenalties = 0) {
  const fairnessWeight     = getParam('fairness_penalty_per_order_s', 120);
  const softSlaWeight      = getParam('soft_sla_penalty_factor', 2);
  const hardPenalty        = getParam('hard_sla_penalty_s', 3000);
  const proximityWeight    = getParam('pickup_proximity_penalty_factor', 0.35);
  const disconnectPenaltyS = getParam('disconnect_penalty_s', 300);
  const maxDeliverySla     = getParam('max_delivery_time_s', 1800);

  const activeOrders    = candidate.activeOrders ?? 0;
  const fairnessPenalty = activeOrders * fairnessWeight;
  const disconnectPenalty = driverPenalties * disconnectPenaltyS;

  const maxSla       = customer?.max_delivery_time_s ?? maxDeliverySla;
  const eta          = candidate.etaToNewCustomer ?? Infinity;
  const delay        = Math.max(0, eta - maxSla);
  const softSlaPenalty = delay * softSlaWeight;
  const hardSlaPenalty = delay > 0 ? hardPenalty : 0;

  // proximityPenalty: coste de que el driver esté lejos del restaurante
  const speedMs = Math.max(1, ((candidate.driverSpeedKmh ?? 30) * 1000) / 3600);
  const directMeters = candidate.directDriverToRestaurantMeters ?? 0;
  const proximityPenalty = Math.max(0, directMeters) * proximityWeight / speedMs;

  // bridgePenalty: coste extra de desvío que el driver tiene que hacer
  const bridgePenalty = Math.max(0, candidate.bridgePenaltyS ?? 0);

  const totalCost =
    eta +
    fairnessPenalty +
    softSlaPenalty +
    hardSlaPenalty +
    proximityPenalty +
    bridgePenalty +
    disconnectPenalty;

  return {
    totalCost: Number.isFinite(totalCost) ? totalCost : Infinity,
    fairnessPenalty,
    softSlaPenalty,
    hardSlaPenalty,
    proximityPenalty,
    bridgePenalty,
    disconnectPenalty,
  };
}
