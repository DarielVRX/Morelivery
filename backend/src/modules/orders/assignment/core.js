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
//   - REEMPLAZADO: simulateDriverWithOrder por evaluateCandidates (candidate-evaluator.js)
//   - no_driver: eliminado de core.js — responsabilidad exclusiva de driver_search_escalation

import { log, logWarn } from './constants.js';
import { getParam } from '../../../engine/params.js';
import {
  getOpenOrder, getPendingOffer, getOfferRound, markPendingDriver,
  getEligibleDrivers, getEligibleIdleDrivers, getQueuedOrders, setCooldownTriggered,
} from './queries.js';
import { upsertOffer } from './offer.js';
import { applyOrderCooldownReduction } from './cooldown.js';
import { findCandidates } from '../../../engine/candidate-finder.js';
import { evaluateCandidates } from '../../../engine/candidate-evaluator.js';
import { query } from '../../../config/db.js';
import { haversineMeters } from '../../../utils/geo.js';
import { serializedOffer, hasActiveChain } from './queue.js';
import { sseHub } from '../../events/hub.js';
import { sendPushToUser } from '../../notifications/pushSubscription.js';

// ─── Helper: notificar offer_sent en tiempo real ──────────────────────────────
// no_driver es responsabilidad exclusiva de driver_search_escalation (tiene cooldown)
async function notifyDriverSearch(orderId, type) {
  try {
    const result = await query(
      `SELECT rest.owner_user_id, o.customer_id
       FROM orders o
       JOIN restaurants rest ON rest.id = o.restaurant_id
       WHERE o.id = $1`,
      [orderId]
    );
    if (result.rowCount === 0) return;
    const { owner_user_id, customer_id } = result.rows[0];
    const payload = { orderId, type };
    sseHub.sendToUser(owner_user_id, 'driver_search_update', payload);
    sseHub.sendToUser(customer_id,   'driver_search_update', payload);
  } catch (e) {
    console.error(`[driver_search] error order=${orderId.slice(0,8)}:`, e.message);
  }
}

// ─── Helper: notificar demora SLA al cliente y restaurante ───────────────────
async function notifySlaDelay(orderId, delaySeconds) {
  try {
    const result = await query(
      `SELECT rest.owner_user_id, o.customer_id
       FROM orders o
       JOIN restaurants rest ON rest.id = o.restaurant_id
       WHERE o.id = $1`,
      [orderId]
    );
    if (result.rowCount === 0) return;
    const { owner_user_id, customer_id } = result.rows[0];

    const delayMins = Math.ceil(delaySeconds / 60);
    const slaWarningThreshold = getParam('sla_delay_warning_threshold_s', 900);

    sseHub.sendToUser(owner_user_id, 'driver_search_update', {
      orderId, type: 'sla_delay_negotiation', delaySec: Math.round(delaySeconds),
    });
    sseHub.sendToUser(customer_id, 'driver_search_update', {
      orderId, type: 'sla_delay_negotiation', delaySec: Math.round(delaySeconds),
    });

    await sendPushToUser(customer_id, {
      title:    'Tu pedido podría llegar tarde',
      body:     `El repartidor disponible llegaría ~${delayMins} min después de lo esperado. ¿Deseas continuar?`,
      tag:      `sla_delay_${orderId}`,
      group:    'customer',
      priority: 'high',
      url:      '/customer',
      pushType: 'sla_delay',
      orderId,
      delaySec: Math.round(delaySeconds),
      actions: [
        { action: 'keep_waiting', title: '⏳ Continuar de todas formas' },
        { action: 'cancel_order', title: '✕ Cancelar pedido'           },
      ],
    }).catch(() => {});

    await query(
      `UPDATE orders
       SET sla_delay_push_sent_at = NOW(),
           sla_delay_seconds      = $2,
           updated_at             = NOW()
       WHERE id = $1`,
      [orderId, Math.round(delaySeconds)]
    ).catch(() => {});

    console.log(`[sla_delay] notificado order=${orderId.slice(0,8)} delay=${Math.round(delaySeconds)}s threshold=${slaWarningThreshold}s`);
  } catch (e) {
    console.error(`[sla_delay] error order=${orderId.slice(0,8)}:`, e.message);
  }
}

let _simulationBudget = 75;

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

function _getRetryPriority(order, nowSec) {
  const createdAt = order.created_at
    ? new Date(order.created_at).getTime() / 1000
    : nowSec;
  const age     = Math.max(0, nowSec - createdAt);
  const maxSla  = getParam('max_delivery_time_s', 1800);
  const urgency = Math.max(0, age - maxSla);
  return age + urgency * 2;
}

export async function triggerPendingAssignments(onOffer) {
  try {
    const nowSec = Date.now() / 1000;
    const queued = await getQueuedOrders();

    const sorted = queued
      .filter(o => o.has_candidates && !hasActiveChain(o.id))
      .sort((a, b) => _getRetryPriority(b, nowSec) - _getRetryPriority(a, nowSec));

    _simulationBudget = getParam('simulation_budget_per_tick', 75);

    log('triggerPending', `ciclo: ${sorted.length} pedidos en cola, budget=${_simulationBudget}`, {
      orders: sorted.map(o => ({ id: o.id, priority: Math.round(_getRetryPriority(o, nowSec)) })),
    });

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

export async function offerNextDrivers(orderId, onOffer) {
  log(`order=${orderId}`, 'offerNextDrivers: inicio');

  const orderRow = await getOpenOrder(orderId);
  if (!orderRow) {
    log(`order=${orderId}`, 'pedido no encontrado o ya asignado — abort');
    return 0;
  }

  const existing = await getPendingOffer(orderId);
  if (existing) {
    log(`order=${orderId}`, `ya tiene oferta pending driver=${existing.driver_id} — abort`);
    return 0;
  }

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
         SET status = 'cancelled', cancelled_at = 'distance_limit', updated_at = NOW()
         WHERE id = $1`,
        [orderId]
      );
      log(`order=${orderId}`, `cancelado — distancia restaurante→cliente ${distKm.toFixed(2)}km > ${maxDistKm}km`);
      return 0;
    }
  }

  const pastCount = await getOfferRound(orderId);
  const round     = pastCount + 1;
  const batchSize = round <= 5 ? 1 : round === 6 ? 5 : 10;
  log(`order=${orderId}`, `ronda=${round} batch=${batchSize}`);

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

  let scoredEligible = eligible.map(d => ({ ...d, bagOverflowPct: 0 }));
  let slaDelayCandidate = null; // declarar en scope externo — se usa después del try/catch
  let scoreMap = new Map();     // declarar en scope externo — se usa en el loop del batch

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

          for (const c of cappedDrivers) _reserveDriverSlot(c.driver.id);
          _simulationBudget -= cappedDrivers.length;

          let scored;
          try {
            scored = await evaluateCandidates(cappedDrivers, orderForSim, restaurantPos, customerPos, nowSec);
          } finally {
            for (const c of cappedDrivers) _releaseDriverSlot(c.driver.id);
          }

          scoreMap = new Map(scored.map(s => [s.driverId, s]));

          const allInvalid = scored.length > 0 && scored.every(s => !s.valid);
          if (allInvalid) {
            const best = scored.reduce((a, b) =>
              (a.totalCost ?? Infinity) <= (b.totalCost ?? Infinity) ? a : b
            );
            slaDelayCandidate = best;
            logWarn(`order=${orderId}`, `todos los candidatos con SLA comprometido — mejor candidato driver=${best.driverId} delay=${Math.round(best.newOrderDelay)}s`);
          }

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

  let sent = 0;
  for (const row of batch) {
    // Guard anti-spam: no enviar oferta si el driver ya tiene una pendiente de otro pedido
    const existingOffer = await query(
      `SELECT 1 FROM order_driver_offers
       WHERE driver_id = $1
         AND status = 'pending'
         AND order_id != $2
       LIMIT 1`,
      [row.user_id, orderId]
    );
    if (existingOffer.rowCount > 0) {
      log(`order=${orderId}`, `driver=${row.user_id.slice(0,8)} ya tiene oferta pending — skip`);
      continue;
    }

    const routeStops = scoreMap.get(row.user_id)?.stopsWithEta ?? null;
    const ok = await upsertOffer(orderId, row.user_id, onOffer, row.bagOverflowPct ?? 0, routeStops);
    if (ok) sent++;
  }

  if (sent === 0) {
    log(`order=${orderId}`, 'batch completo en pending — pending_driver');
    await markPendingDriver(orderId);
  } else {
    if (orderRow.offer_cooldown_triggered) {
      await setCooldownTriggered(orderId, false);
    }
    if (slaDelayCandidate) {
      notifySlaDelay(orderId, slaDelayCandidate.newOrderDelay);
    } else {
      notifyDriverSearch(orderId, 'offer_sent');
    }
  }

  return sent;
}
