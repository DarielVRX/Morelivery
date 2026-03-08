// backend/src/modules/orders/assignment/events.js
// Eventos del ciclo de vida de una oferta.
import { OFFER_TIMEOUT_SECONDS, COOLDOWN_SECONDS, log, logWarn } from './constants.js';
import {
  assignDriverToOrder, unassignDriverFromOrder,
  acceptPendingOffer, expireCompetingOffers,
  rejectDriverOffer, releaseDriverOffer,
  expireAllPendingForDriver,
  expireTimedOutOffersInDB,
  getOpenOrder,
} from './queries.js';
import { serializedOffer, hasActiveChain } from './queue.js';
import { offerNextDrivers } from './core.js';

// ─── Aceptar ──────────────────────────────────────────────────────────────────
export async function acceptOffer(orderId, driverId) {
  log(`order=${orderId}`, `acceptOffer driver=${driverId}`);
  const assigned = await assignDriverToOrder(orderId, driverId);
  if (!assigned) {
    logWarn(`order=${orderId}`, `acceptOffer: pedido ya tomado driver=${driverId}`);
    return false;
  }
  await acceptPendingOffer(orderId, driverId);
  await expireCompetingOffers(orderId, driverId);
  log(`order=${orderId}`, `ÉXITO asignado a driver=${driverId}`);
  return true;
}

// ─── Rechazar ─────────────────────────────────────────────────────────────────
export async function rejectOffer(orderId, driverId, onOffer) {
  log(`order=${orderId}`, `rejectOffer driver=${driverId}`);
  await rejectDriverOffer(orderId, driverId, COOLDOWN_SECONDS);

  // Liberar otros pedidos que el driver bloqueaba con su pending offer
  const freed = await expireAllPendingForDriver(driverId, orderId);
  for (const fid of freed) {
    if (!hasActiveChain(fid)) {
      log(`order=${fid}`, `despertado por rechazo de driver=${driverId}`);
      serializedOffer(fid, offerNextDrivers, onOffer);
    }
  }

  // Re-encolar este pedido
  serializedOffer(orderId, offerNextDrivers, onOffer);
}

// ─── Liberar ──────────────────────────────────────────────────────────────────
export async function releaseOrder(orderId, driverId, onOffer) {
  log(`order=${orderId}`, `releaseOrder driver=${driverId}`);
  await releaseDriverOffer(orderId, driverId, COOLDOWN_SECONDS);
  await unassignDriverFromOrder(orderId, driverId);

  const freed = await expireAllPendingForDriver(driverId, null);
  for (const fid of freed) {
    if (fid !== orderId && !hasActiveChain(fid)) {
      log(`order=${fid}`, `despertado por liberación de driver=${driverId}`);
      serializedOffer(fid, offerNextDrivers, onOffer);
    }
  }

  serializedOffer(orderId, offerNextDrivers, onOffer);
}

// ─── Expirar timeout ──────────────────────────────────────────────────────────
export async function expireTimedOutOffers(onOffer) {
  const expired = await expireTimedOutOffersInDB(OFFER_TIMEOUT_SECONDS, COOLDOWN_SECONDS);
  if (expired.length === 0) return;

  console.log(
    `[assign] expireTimedOutOffers: ${expired.length} oferta(s) expiradas`,
    expired.map(r => `order=${r.order_id} driver=${r.driver_id}`).join(', ')
  );

  const orderIds = [...new Set(expired.map(r => r.order_id))];
  for (const oid of orderIds) {
    const still = await getOpenOrder(oid);
    if (still && !hasActiveChain(oid)) {
      log(`order=${oid}`, 'oferta expirada → re-encolando');
      serializedOffer(oid, offerNextDrivers, onOffer);
    }
  }
}
