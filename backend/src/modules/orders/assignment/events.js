// backend/src/modules/orders/assignment/events.js
// ─────────────────────────────────────────────────────────────────────────────
// Eventos del ciclo de vida de una oferta.
//
// Cada función maneja un evento externo y sus efectos secundarios:
//   - acceptOffer:   Driver acepta → asignar pedido, expirar competidores
//   - rejectOffer:   Driver rechaza → cooldown, despertar pedidos huérfanos
//   - releaseOrder:  Driver libera un pedido ya asignado → volver a ofrecer
//   - expireTimedOutOffers: Ticker periódico → expirar ofertas sin respuesta
//
// Todas las rutas que re-enquelan pedidos pasan por serializedOffer de queue.js.
// ─────────────────────────────────────────────────────────────────────────────

import { OFFER_TIMEOUT_SECONDS, COOLDOWN_SECONDS, REBALANCE_COOLDOWN_SECONDS, REBALANCE_DISPUTE_TIMEOUT_S, SESSION_REBALANCE_LIMIT, log, logWarn } from './constants.js';
import {
  assignDriverToOrder, unassignDriverFromOrder,
  acceptPendingOffer, expireCompetingOffers,
  rejectDriverOffer, releaseDriverOffer,
  expireAllPendingForDriver,
  expireTimedOutOffersInDB,
  getOpenOrder, getQueuedOrders,
} from './queries.js';
import { query } from '../../../config/db.js';
import { serializedOffer, hasActiveChain } from './queue.js';
import { offerNextDrivers } from './core.js';

// ─── Aceptar ──────────────────────────────────────────────────────────────────

/**
 * El driver acepta la oferta.
 * Usa FOR UPDATE SKIP LOCKED → si otro driver aceptó antes, devuelve false.
 *
 * @returns {boolean}  true si la asignación fue exitosa
 */
export async function acceptOffer(orderId, driverId) {
  log(orderId, `✅ ACEPTAR — driver=${driverId.slice(0,8)}`);

  const assigned = await assignDriverToOrder(orderId, driverId);
  if (!assigned) {
    logWarn(orderId, `⚠️  ACEPTAR: pedido ya tomado por otro — driver=${driverId.slice(0,8)}`);
    return false;
  }

  await acceptPendingOffer(orderId, driverId);
  await expireCompetingOffers(orderId, driverId);

  log(orderId, `🎉 ASIGNADO → driver=${driverId.slice(0,8)}`);
  return true;
}

// ─── Rechazar ─────────────────────────────────────────────────────────────────

/**
 * El driver rechaza la oferta.
 * 1. Aplica cooldown al driver para este pedido.
 * 2. Expira las otras ofertas pending del driver → despierta esos pedidos.
 * 3. Re-encola este pedido para buscar otro driver.
 */
export async function rejectOffer(orderId, driverId, onOffer) {
  log(orderId, `rejectOffer driver=${driverId} cooldown=${COOLDOWN_SECONDS}s`);

  await rejectDriverOffer(orderId, driverId, COOLDOWN_SECONDS);

  // Liberar otros pedidos que el driver tenía bloqueados con pending offer
  const freedOrderIds = await expireAllPendingForDriver(driverId, orderId);
  for (const freeOrderId of freedOrderIds) {
    if (!hasActiveChain(freeOrderId)) {
      log(freeOrderId, `despertado — driver=${driverId} liberó al rechazar ${orderId}`);
      serializedOffer(freeOrderId, offerNextDrivers, onOffer);
    }
  }

  // Re-enqueue del pedido rechazado
  serializedOffer(orderId, offerNextDrivers, onOffer);
}

// ─── Liberar ──────────────────────────────────────────────────────────────────

/**
 * El driver se retracta de un pedido ya asignado.
 * 1. Aplica cooldown al driver para este pedido.
 * 2. Desasigna el driver del pedido → vuelve a created/pending_driver.
 * 3. Libera otros pedidos bloqueados.
 * 4. Re-encola el pedido liberado.
 */
export async function releaseOrder(orderId, driverId, onOffer) {
  log(orderId, `releaseOrder driver=${driverId} cooldown=${COOLDOWN_SECONDS}s`);

  await releaseDriverOffer(orderId, driverId, COOLDOWN_SECONDS);
  await unassignDriverFromOrder(orderId, driverId);

  // Liberar otros pedidos bloqueados por el driver
  const freedOrderIds = await expireAllPendingForDriver(driverId, null);
  for (const freeOrderId of freedOrderIds) {
    if (freeOrderId !== orderId && !hasActiveChain(freeOrderId)) {
      log(freeOrderId, `despertado — driver=${driverId} liberó al soltar ${orderId}`);
      serializedOffer(freeOrderId, offerNextDrivers, onOffer);
    }
  }

  serializedOffer(orderId, offerNextDrivers, onOffer);
}

// ─── Expirar ofertas con timeout ──────────────────────────────────────────────

/**
 * Ticker periódico (llamado desde el intervalo del servidor).
 * Expira todas las ofertas pending que llevan más de OFFER_TIMEOUT_SECONDS
 * sin respuesta del driver, y re-encola esos pedidos.
 */
export async function expireTimedOutOffers(onOffer) {
  const expired = await expireTimedOutOffersInDB(OFFER_TIMEOUT_SECONDS, COOLDOWN_SECONDS);

  if (expired.length > 0) {
    console.log(
      `[assign] expireTimedOutOffers: ${expired.length} oferta(s) expiradas:`,
      expired.map(r => `order=${r.order_id} driver=${r.driver_id}`).join(', ')
    );
  }

  const orderIds = [...new Set(expired.map(r => r.order_id))];
  for (const orderId of orderIds) {
    const still = await getOpenOrder(orderId);
    if (still) {
      if (hasActiveChain(orderId)) {
        log(orderId, 'oferta expirada — ya tiene cadena activa, skip re-encola');
      } else {
        log(orderId, 'oferta expirada — re-encolando');
        serializedOffer(orderId, offerNextDrivers, onOffer);
      }
    } else {
      log(orderId, 'oferta expirada — pedido ya no necesita driver, skip');
    }
  }

  // Barrer pedidos huérfanos (pending_driver sin oferta activa ni cadena en memoria).
  // Cubre el caso de un driver que se conecta vía SSE sin cambiar disponibilidad,
  // o pedidos que quedaron varados entre ticks.
  try {
    const orphans = await getQueuedOrders();
    for (const ord of orphans) {
      if (ord.has_candidates && !hasActiveChain(ord.id)) {
        serializedOffer(ord.id, offerNextDrivers, onOffer);
      }
    }
  } catch (e) {
    logWarn('ticker', `error barriendo pedidos huérfanos: ${e.message}`);
  }
}

// ─── Rebalanceo manual ────────────────────────────────────────────────────────

/**
 * El driver solicita rebalanceo manual de un pedido aún no recogido.
 *
 * - El pedido queda marcado como `is_disputed = true` con un timeout.
 * - El rebalancer lo oferta a otros drivers usando criterio de assignment inicial
 *   (sin minGain ni maxRouteEta — solo ETA al restaurante como en el assignment).
 * - Si nadie lo toma antes de `disputed_until`, la disputa se cancela automáticamente
 *   (el pedido sigue en la ruta del driver original).
 * - El driver queda en cooldown largo para ese pedido.
 * - Se incrementan contadores de sesión e histórico.
 *
 * @returns {{ ok: boolean, reason?: string }}
 */
export async function requestRebalance(orderId, driverId) {
  log(orderId, `requestRebalance driver=${driverId.slice(0,8)}`);

  // 1. Verificar que el pedido existe, está asignado a este driver y no fue recogido
  const orderRow = await query(
    `SELECT id, status, picked_up_at, is_disputed
     FROM orders
     WHERE id = $1 AND driver_id = $2
       AND status IN ('assigned','accepted','preparing','ready')
       AND picked_up_at IS NULL`,
    [orderId, driverId]
  );
  if (orderRow.rowCount === 0) {
    return { ok: false, reason: 'Pedido no disponible para rebalanceo (ya recogido o no asignado a ti)' };
  }
  if (orderRow.rows[0].is_disputed) {
    return { ok: false, reason: 'Este pedido ya está en disputa' };
  }

  // 2. Verificar límite de sesión
  const profileRow = await query(
    `SELECT session_rebalances FROM driver_profiles WHERE user_id = $1`,
    [driverId]
  );
  const sessionCount = profileRow.rows[0]?.session_rebalances ?? 0;
  if (sessionCount >= SESSION_REBALANCE_LIMIT) {
    return { ok: false, reason: `Límite de rebalanceos por sesión alcanzado (${SESSION_REBALANCE_LIMIT})` };
  }

  // 3. Marcar pedido como en disputa
  const disputedUntil = new Date(Date.now() + REBALANCE_DISPUTE_TIMEOUT_S * 1000);
  await query(
    `UPDATE orders
     SET is_disputed = true,
         disputed_until = $1,
         disputed_by = $2,
         updated_at = NOW()
     WHERE id = $3`,
    [disputedUntil, driverId, orderId]
  );

  // 4. Cooldown largo para el driver en este pedido (registro en order_driver_offers)
  await query(
    `INSERT INTO order_driver_offers(order_id, driver_id, status, wait_until)
     VALUES ($1, $2, 'released', NOW() + ($3 * INTERVAL '1 second'))
     ON CONFLICT (order_id, driver_id)
     DO UPDATE SET status='released',
                   wait_until = NOW() + ($3 * INTERVAL '1 second'),
                   updated_at = NOW()`,
    [orderId, driverId, REBALANCE_COOLDOWN_SECONDS]
  );

  // 5. Incrementar contadores sesión + histórico
  await query(
    `UPDATE driver_profiles
     SET session_rebalances = session_rebalances + 1,
         total_rebalances   = total_rebalances + 1
     WHERE user_id = $1`,
    [driverId]
  );

  log(orderId, `en disputa hasta ${disputedUntil.toISOString()} — cooldown driver=${driverId.slice(0,8)} ${REBALANCE_COOLDOWN_SECONDS}s`);
  return { ok: true };
}

/**
 * Ticker periódico: cancela disputas que expiraron sin ser tomadas.
 * El pedido vuelve a su ruta normal (is_disputed = false, driver_id no cambia).
 */
export async function expireDisputedOrders() {
  const r = await query(
    `UPDATE orders
     SET is_disputed    = false,
         disputed_until = NULL,
         disputed_by    = NULL,
         updated_at     = NOW()
     WHERE is_disputed = true
       AND disputed_until < NOW()
       AND driver_id IS NOT NULL
     RETURNING id, driver_id`,
    []
  );

  if (r.rowCount > 0) {
    log('ticker', `${r.rowCount} disputa(s) expiradas sin tomador — pedidos vuelven a ruta original`);
  }

  return r.rows; // [{id, driver_id}]
}
