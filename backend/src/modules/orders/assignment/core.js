// backend/src/modules/orders/assignment/core.js
//
// Lógica central del motor de asignación.
//
// RONDAS Y BATCH:
//   Ronda 1-5:  batch=1  (drivers de 1 en 1)
//   Ronda 6:    batch=5
//   Ronda 7+:   batch=10
//
// WRAPAROUND: los drivers elegibles se ordenan por score de simulación.
// Si en la ronda N ya se ofertó a K drivers, se saltan los primeros K
// y se toman los siguientes batchSize (con wraparound circular).
//
// RONDAS SIMULTÁNEAS (batch>1):
//   - Los drivers con oferta pending NO se cuentan en el batch (skip, no vuelven a cola).
//   - Los advisory locks evitan asignaciones duplicadas.
//   - Si hay menos drivers disponibles que batchSize, se usan todos los disponibles.
//
// CAMBIOS respecto a versión anterior:
//   - simulation_budget_per_tick: cap de simulaciones por ciclo para evitar explosión
//     en horas pico. Si se agota, el pedido se reencola para el próximo ciclo.
//   - _reserveDriverSlot / _releaseDriverSlot: evita que dos pedidos concurrentes
//     asignen el mismo driver simultáneamente (race condition).
//   - max_customer_restaurant_distance_km: cancela pedidos inalcanzables antes de
//     buscar driver — evita pedidos en cola infinita.
//   - _getRetryPriority: cola de reintentos priorizada por antigüedad + urgencia SLA
//     en lugar de FIFO.
//   - triggerPendingAssignments(): trigger inmediato al liberar un driver — no espera
//     al próximo tick del intervalo de mantenimiento.
//   - Score final basado 100% en simulación — se eliminó el scoreCandidate() redundante
//     en este archivo (ya lo llama route-simulator.js internamente).

import { log, logWarn } from './constants.js';
import { getParam } from '../../../engine/params.js';
import {
  getOpenOrder, getPendingOffer, getOfferRound, markPendingDriver,
  getEligibleDrivers, getEligibleIdleDrivers, getQueuedOrders,
} from './queries.js';
import { upsertOffer } from './offer.js';
import { applyOrderCooldownReduction } from './cooldown.js';
import { findCandidates } from '../../../engine/candidate-finder.js';
import { simulateDriverWithOrder } from '../../../engine/route-simulator.js';
import { query } from '../../../config/db.js';
import { haversineMeters } from '../../../utils/geo.js';
import { serializedOffer, hasActiveChain } from './queue.js';

// ─── Budget de simulaciones por ciclo ────────────────────────────────────────
// Compartido entre todos los pedidos del mismo ciclo de asignación.
// Se resetea al inicio de cada llamada a triggerPendingAssignments().
let _simulationBudget = 75; // default hasta el primer triggerPendingAssignments

// ─── Reserved slots por driver ────────────────────────────────────────────────
// Map<driverId, count> — slots reservados mientras se simula un candidato.
// Evita race condition donde dos pedidos concurrentes asignan el mismo driver.
const _reservedSlots = new Map();

function _reserveDriverSlot(driverId) {
  _reservedSlots.set(driverId, (_reservedSlots.get(driverId) ?? 0) + 1);
}

function _releaseDriverSlot(driverId) {
  const current = _reservedSlots.get(driverId) ?? 0;
  if (current <= 1) _reservedSlots.delete(driverId);
  else _reservedSlots.set(driverId, current - 1);
}

function _getReservedSlots(driverId) {
  return _reservedSlots.get(driverId) ?? 0;
}

// ─── Prioridad de reintentos ──────────────────────────────────────────────────

/**
 * Calcula la prioridad de un pedido en la cola de reintentos.
 * Mayor prioridad = número más alto.
 * Combina antigüedad del pedido + urgencia SLA.
 *
 * @param {object} order  — fila de getQueuedOrders()
 * @param {number} nowSec
 * @returns {number}
 */
function _getRetryPriority(order, nowSec) {
  const createdAt = order.created_at
    ? new Date(order.created_at).getTime() / 1000
    : nowSec;
  const age       = Math.max(0, nowSec - createdAt);

  const maxSla    = getParam('max_delivery_time_s', 1800);
  const elapsed   = age;
  const urgency   = Math.max(0, elapsed - maxSla);

  return age + urgency * 2;
}

// ─── Trigger inmediato al liberar driver ──────────────────────────────────────

/**
 * Dispara asignación inmediata para pedidos en cola cuando un driver queda libre.
 * Se llama desde: delivery completado, rebalanceo (driver pierde pedido),
 * cancelación de pedido.
 *
 * A diferencia del intervalo de mantenimiento, este trigger es síncrono
 * con el evento de liberación — reduce el tiempo de pedidos sin driver.
 *
 * @param {Function} onOffer
 */
export async function triggerPendingAssignments(onOffer) {
  try {
    const nowSec  = Date.now() / 1000;
    const queued  = await getQueuedOrders();

    // Ordenar por prioridad descendente
    const sorted = queued
      .filter(o => o.has_candidates && !hasActiveChain(o.id))
      .sort((a, b) => _getRetryPriority(b, nowSec) - _getRetryPriority(a, nowSec));

    // Resetear budget para este ciclo — una sola vez antes del loop
    _simulationBudget = getParam('simulation_budget_per_tick', 75);

    log('triggerPending', `ciclo: ${sorted.length} pedidos en cola, budget=${_simulationBudget}`, {
      orders: sorted.map(o => ({ id: o.id, priority: Math.round(_getRetryPriority(o, nowSec)) })),
    });

    // Procesar en SERIE: cada pedido espera al anterior antes de consumir budget.
    // Evita que dos pedidos concurrentes lean el mismo budget=75 y ambos lo agoten.
    // El orden de prioridad (antigüedad + urgencia SLA) se respeta gracias al sort previo.
    for (const order of sorted) {
      if (_simulationBudget <= 0) {
        log('triggerPending', `budget agotado — quedan ${sorted.length - sorted.indexOf(order)} pedidos sin procesar`);
        break;
      }
      await serializedOffer(order.id, offerNextDrivers, onOffer);
    }
  } catch (e) {
    logWarn('triggerPending', `error disparando asignaciones pendientes: ${e.message}`);
  }
}

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Intenta enviar oferta(s) para el pedido dado.
 * Solo debe llamarse desde serializedOffer().
 */
export async function offerNextDrivers(orderId, onOffer) {
  log(`order=${orderId}`, 'offerNextDrivers: inicio');

  // ── 1. Verificar que el pedido sigue abierto ──────────────────────────────
  const orderRow = await getOpenOrder(orderId);
  if (!orderRow) {
    log(`order=${orderId}`, 'pedido no encontrado o ya asignado — abort');
    return 0;
  }

  // ── 2. Verificar que no hay oferta pending activa ─────────────────────────
  const existing = await getPendingOffer(orderId);
  if (existing) {
    log(`order=${orderId}`, `ya tiene oferta pending driver=${existing.driver_id} — abort`);
    return 0;
  }

  // ── 3. Verificar distancia máxima restaurante→cliente ────────────────────
  // Cancela pedidos inalcanzables antes de buscar driver — evita cola infinita.
  const maxDistKm = getParam('max_customer_restaurant_distance_km', 8);
  if (maxDistKm > 0 &&
      Number.isFinite(orderRow.restaurant_lat) &&
      Number.isFinite(orderRow.delivery_lat)) {
    const distKm = haversineMeters(
      { lat: Number(orderRow.restaurant_lat), lng: Number(orderRow.restaurant_lng) },
      { lat: Number(orderRow.delivery_lat),   lng: Number(orderRow.delivery_lng) }
    ) / 1000;

    if (distKm > maxDistKm) {
      await query(
        `UPDATE orders
         SET status = 'cancelled', cancelled_by = 'distance_limit', updated_at = NOW()
         WHERE id = $1`,
        [orderId]
      );
      log(`order=${orderId}`, `cancelado — distancia restaurante→cliente ${distKm.toFixed(2)}km > ${maxDistKm}km`);
      return 0;
    }
  }

  // ── 4. Calcular ronda y batchSize ─────────────────────────────────────────
  const pastCount = await getOfferRound(orderId);
  const round     = pastCount + 1;
  const batchSize = round <= 5 ? 1 : round === 6 ? 5 : 10;
  log(`order=${orderId}`, `ronda=${round} batch=${batchSize}`);

  // ── 5. Obtener drivers elegibles ──────────────────────────────────────────
  const eligible = batchSize === 1
    ? await getEligibleIdleDrivers(orderId)
    : await getEligibleDrivers(orderId);

  log(`order=${orderId}`, `elegibles: ${eligible.length}`, {
    drivers: eligible.map(d => d.user_id),
  });

  if (eligible.length === 0) {
    log(`order=${orderId}`, 'sin candidatos elegibles → intentar reducción de cooldown');

    const reduced = await applyOrderCooldownReduction(orderId, orderRow.offer_cooldown_triggered);

    if (!reduced) {
      logWarn(`order=${orderId}`, 'sin cooldown que reducir → pending_driver');
      await markPendingDriver(orderId);
      return 0;
    }

    if (reduced.newWaitSecs >= 1) {
      log(`order=${orderId}`, `cooldown reducido a ${Math.round(reduced.newWaitSecs)}s → pending_driver`);
      await markPendingDriver(orderId);
      return 0;
    }

    const immediateEligible = batchSize === 1
      ? await getEligibleIdleDrivers(orderId)
      : await getEligibleDrivers(orderId);

    if (immediateEligible.length === 0) {
      log(`order=${orderId}`, 'sin candidatos tras reducción inmediata → pending_driver');
      await markPendingDriver(orderId);
      return 0;
    }

    eligible.push(...immediateEligible);
  }

  // ── 6. Simulación + Scoring ───────────────────────────────────────────────
  // El score final viene 100% de simulateDriverWithOrder() via scoreCandidate().
  // No hay scoring ad-hoc en este archivo.
  let scoredEligible = eligible.map(d => ({ ...d, bagOverflowPct: 0 })); // fallback sin simulación

  try {
    const coordsRow = await query(
      `SELECT restaurant_lat, restaurant_lng,
              COALESCE(o.delivery_lat, cu.lat) AS cust_lat,
              COALESCE(o.delivery_lng, cu.lng) AS cust_lng,
              o.estimated_volume_liters
       FROM orders o
       JOIN users cu ON cu.id = o.customer_id
       WHERE o.id = $1`,
      [orderId]
    );

    if (coordsRow.rowCount > 0) {
      const coord = coordsRow.rows[0];
      const restaurantPos = {
        lat: Number(coord.restaurant_lat),
        lng: Number(coord.restaurant_lng),
      };
      const customerPos = {
        lat: Number(coord.cust_lat),
        lng: Number(coord.cust_lng),
      };

      if (Number.isFinite(restaurantPos.lat) && Number.isFinite(customerPos.lat)) {

        // ── Verificar budget disponible ───────────────────────────────────
        if (_simulationBudget <= 0) {
          log(`order=${orderId}`, 'budget de simulaciones agotado — reencolar para próximo ciclo');
          await markPendingDriver(orderId);
          return 0;
        }

        const { topDrivers } = await findCandidates(orderId, restaurantPos, customerPos);
        log(`order=${orderId}`, `findCandidates: ${topDrivers.length} topDrivers`, {
          topDrivers: topDrivers.map(c => ({ id: c.driver.id, etaToNewCustomer: Math.round(c.etaToNewCustomer) })),
        });

        if (topDrivers.length === 0) {
          logWarn(`order=${orderId}`, 'findCandidates retornó 0 topDrivers — fallback a scoredEligible sin simulación');
        }

        if (topDrivers.length > 0) {
          const nowSec = Date.now() / 1000;
          const orderForSim = {
            id: orderId,
            estimated_volume_liters: Number(coord.estimated_volume_liters) || 0,
          };

          // Aplicar budget y reserved slots
          const maxActive = getParam('max_active_orders_per_driver', 4);
          const cappedDrivers = topDrivers
            .filter(c => {
              const reserved = _getReservedSlots(c.driver.id);
              return (c.driver.activeOrders + reserved) < maxActive;
            })
            .slice(0, Math.min(_simulationBudget, topDrivers.length));

          if (cappedDrivers.length === 0) {
            logWarn(`order=${orderId}`, 'todos los candidatos están reservados o en slot máximo', {
              topDriversCount: topDrivers.length,
              reservedSlots: topDrivers.map(c => ({
                id: c.driver.id,
                activeOrders: c.driver.activeOrders,
                reserved: _getReservedSlots(c.driver.id),
                maxActive,
              })),
            });
            await markPendingDriver(orderId);
            return 0;
          }

          // Reservar slots durante la simulación
          for (const c of cappedDrivers) _reserveDriverSlot(c.driver.id);
          _simulationBudget -= cappedDrivers.length;

          let scored;
          try {
            scored = await Promise.all(
              cappedDrivers.map(async (env) => {
                try {
                  const result = await simulateDriverWithOrder(
                    env, orderForSim, restaurantPos, customerPos, nowSec
                  );
                  log(`order=${orderId}`, `sim driver=${env.driver.id}: totalCost=${Math.round(result.totalCost)} valid=${result.valid} eta=${Math.round(result.etaToNewCustomer)}`);
                  // totalCost ya viene de scoreCandidate() dentro del simulador
                  return {
                    driverId:       env.driver.id,
                    totalCost:      result.totalCost,
                    bagOverflowPct: result.bagOverflowPct ?? 0,
                  };
                } catch {
                  return { driverId: env.driver.id, totalCost: Infinity, bagOverflowPct: 0 };
                }
              })
            );
          } finally {
            // Liberar slots siempre, incluso si hay error
            for (const c of cappedDrivers) _releaseDriverSlot(c.driver.id);
          }

          const scoreMap = new Map(scored.map(s => [s.driverId, s]));

          // Ordenar eligible por score de simulación
          scoredEligible = [...eligible]
            .map(d => ({
              ...d,
              bagOverflowPct: scoreMap.get(d.user_id)?.bagOverflowPct ?? 0,
            }))
            .sort((a, b) => {
              const sA = scoreMap.get(a.user_id)?.totalCost ?? Infinity;
              const sB = scoreMap.get(b.user_id)?.totalCost ?? Infinity;
              return sA - sB;
            });

          log(`order=${orderId}`, `simulación aplicada — ${cappedDrivers.length} candidatos`);
        }
      }
    }
  } catch (e) {
    log(`order=${orderId}`, `scoring fallback a driver_number: ${e.message}`);
  }

  // ── 7. Wraparound circular sobre lista ordenada por score ─────────────────
  const offset    = scoredEligible.length > 0 ? pastCount % scoredEligible.length : 0;
  const totalElg  = scoredEligible.length;
  const realBatch = Math.min(batchSize, totalElg);
  const batch     = [];
  for (let i = 0; i < realBatch; i++) {
    batch.push(scoredEligible[(offset + i) % totalElg]);
  }

  log(`order=${orderId}`, `batch final: ${batch.length}`, {
    drivers: batch.map(d => d.user_id),
    offset,
    realBatch,
    scoredEligibleCount: scoredEligible.length,
  });

  // ── 8. Enviar ofertas ─────────────────────────────────────────────────────
  let sent = 0;
  for (const row of batch) {
    const ok = await upsertOffer(orderId, row.user_id, onOffer, row.bagOverflowPct ?? 0);
    if (ok) sent++;
  }

  if (sent === 0) {
    log(`order=${orderId}`, 'batch completo en pending — pending_driver');
    await markPendingDriver(orderId);
  }

  return sent;
}
