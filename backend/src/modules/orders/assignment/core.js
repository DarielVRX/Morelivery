// backend/src/modules/orders/assignment/core.js
//
// Lógica central del motor de asignación.
//
// RONDAS Y BATCH:
//   Ronda 1-5:  batch=1  (drivers de 1 en 1)
//   Ronda 6:    batch=5
//   Ronda 7+:   batch=10
//
// WRAPAROUND: los drivers elegibles se ordenan por driver_number.
// Si en la ronda N ya se ofertó a K drivers, se saltan los primeros K
// y se toman los siguientes batchSize (con wraparound circular).
//
// RONDAS SIMULTÁNEAS (batch>1):
//   - Los drivers con oferta pending NO se cuentan en el batch (skip, no vuelven a cola).
//   - Los advisory locks evitan asignaciones duplicadas.
//   - Si hay menos drivers disponibles que batchSize, se usan todos los disponibles.
//
// DRIVERS CON OFERTA PENDING (inactivos): se saltan sin incrementar ronda.

import { OFFER_TIMEOUT_SECONDS, log, logWarn } from './constants.js';
import {
  getOpenOrder, getPendingOffer, getOfferRound, markPendingDriver,
  getEligibleDrivers, getEligibleIdleDrivers,
} from './queries.js';
import { upsertOffer } from './offer.js';

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

  // ── 3. Calcular ronda y batchSize ─────────────────────────────────────────
  const pastCount = await getOfferRound(orderId);
  const round     = pastCount + 1;
  const batchSize = round <= 5 ? 1 : round === 6 ? 5 : 10;
  log(`order=${orderId}`, `ronda=${round} batch=${batchSize}`);

  // ── 4. Obtener drivers elegibles (sin cooldown, sin haber aceptado) ────────
  // Para batch=1 solo queremos drivers IDLE (sin pending en otro pedido).
  // Para batch>1 tomamos todos los elegibles — los que tengan pending serán
  // descartados por el advisory lock en upsertOffer (sin contar como ronda).
  const eligible = batchSize === 1
    ? await getEligibleIdleDrivers(orderId)
    : await getEligibleDrivers(orderId);

  log(`order=${orderId}`, `elegibles: ${eligible.length}`, {
    drivers: eligible.map(d => d.user_id),
  });

  if (eligible.length === 0) {
    log(`order=${orderId}`, 'sin candidatos elegibles → pending_driver');
    await markPendingDriver(orderId);
    return 0;
  }

  // ── 5. Wraparound circular ────────────────────────────────────────────────
  // Cuántos drivers hemos "visitado" ya en rondas anteriores.
  // Determinamos el offset como pastCount % eligible.length.
  const offset    = eligible.length > 0 ? pastCount % eligible.length : 0;
  const totalElg  = eligible.length;
  // Tomar batchSize drivers empezando en offset (circular)
  const realBatch = Math.min(batchSize, totalElg);
  const batch     = [];
  for (let i = 0; i < realBatch; i++) {
    batch.push(eligible[(offset + i) % totalElg]);
  }

  log(`order=${orderId}`, `batch final: ${batch.length}`, {
    drivers: batch.map(d => d.user_id),
    offset,
    realBatch,
  });

  // ── 6. Enviar ofertas ─────────────────────────────────────────────────────
  let sent = 0;
  for (const row of batch) {
    const ok = await upsertOffer(orderId, row.user_id, onOffer);
    if (ok) sent++;
  }

  if (sent === 0) {
    // Todos los drivers del batch tenían pending offer (advisory lock los saltó)
    log(`order=${orderId}`, 'batch completo en pending — pending_driver');
    await markPendingDriver(orderId);
  }

  return sent;
}
