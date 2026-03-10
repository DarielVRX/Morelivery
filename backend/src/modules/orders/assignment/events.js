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

import { OFFER_TIMEOUT_SECONDS, COOLDOWN_SECONDS, log, logWarn } from './constants.js';
import {
  assignDriverToOrder, unassignDriverFromOrder,
  acceptPendingOffer, expireCompetingOffers,
  rejectDriverOffer, releaseDriverOffer,
  expireAllPendingForDriver,
  expireTimedOutOffersInDB,
  getOpenOrder, getQueuedOrders,
} from './queries.js';
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
  if (expired.length === 0) return;

  console.log(
    `[assign] expireTimedOutOffers: ${expired.length} oferta(s) expiradas:`,
    expired.map(r => `order=${r.order_id} driver=${r.driver_id}`).join(', ')
  );

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
      if (!hasActiveChain(ord.id)) {
        serializedOffer(ord.id, offerNextDrivers, onOffer);
      }
    }
  } catch (e) {
    logWarn('ticker', `error barriendo pedidos huérfanos: ${e.message}`);
  }
}
