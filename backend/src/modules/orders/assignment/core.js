// backend/src/modules/orders/assignment/core.js
// ─────────────────────────────────────────────────────────────────────────────
// Núcleo del motor de asignación: offerNextDrivers.
//
// Esta función contiene la máquina de estados central:
//   1. Verificar que el pedido sigue sin driver.
//   2. Verificar que no hay oferta pending activa.
//   3. Diagnosticar drivers disponibles (logging).
//   4. Calcular ronda y batchSize.
//   5. Buscar candidatos.
//   6. Si no hay candidatos → intentar reducción de cooldown.
//   7. Si hay candidatos → enviar ofertas (upsertOffer por cada uno).
//
// REGLA CRÍTICA:
//   Esta función NO debe llamarse directamente desde fuera del módulo.
//   Todos los callers externos deben usar serializedOffer() de queue.js.
//   Esto garantiza que para un orderId dado solo hay una ejecución activa.
// ─────────────────────────────────────────────────────────────────────────────

import { MAX_ACTIVE_ORDERS_PER_DRIVER, ACTIVE_STATUSES, log, logWarn } from './constants.js';
import {
  getOpenOrder, getPendingOffer, getDriverDiagnostics, getOfferRoundCount,
  queryCandidates, anyDriverAvailable, markPendingDriver,
} from './queries.js';
import { applyOrderCooldownReduction, ensureCooldownFlagSet, resetCooldownFlag } from './cooldown.js';
import { upsertOffer } from './offer.js';

/**
 * Intenta enviar oferta(s) para el pedido dado.
 * Solo debe llamarse desde serializedOffer() — nunca directamente.
 *
 * @param {string}        orderId
 * @param {Function|null} onOffer  Callback SSE
 * @returns {number}  Cantidad de ofertas enviadas (0 si no se envió ninguna)
 */
export async function offerNextDrivers(orderId, onOffer) {
  log(orderId, 'offerNextDrivers: inicio');

  // ── 1. Verificar pedido ───────────────────────────────────────────────────
  const orderRow = await getOpenOrder(orderId);
  if (!orderRow) {
    log(orderId, 'pedido no encontrado o ya asignado — abort');
    return 0;
  }
  const cooldownTriggered = orderRow.offer_cooldown_triggered;

  // ── 2. Verificar oferta pending ───────────────────────────────────────────
  const existingOffer = await getPendingOffer(orderId);
  if (existingOffer) {
    log(orderId, 'ya tiene oferta pending — abort', { driver_id: existingOffer.driver_id });
    return 0;
  }

  // ── 3. Diagnóstico de drivers ─────────────────────────────────────────────
  const allDrivers = await getDriverDiagnostics(orderId);
  log(orderId, `drivers disponibles: ${allDrivers.length}`);
  for (const d of allDrivers) {
    log(orderId, `  driver=${d.user_id}`, {
      activos:         `${d.active_count}/${MAX_ACTIVE_ORDERS_PER_DRIVER}`,
      has_pending:     d.has_pending_offer,
      estado_oferta:   d.offer_status_for_order ?? 'ninguna',
      cooldown_secs:   d.cooldown_secs_remaining ?? 0,
    });
  }

  // ── 4. Ronda y batchSize ──────────────────────────────────────────────────
  const pastOffers = await getOfferRoundCount(orderId);
  const round      = pastOffers + 1;
  const batchSize  = round <= 5 ? 1 : round <= 10 ? 5 : 10;
  log(orderId, `ronda=${round} batchSize=${batchSize} cooldownTriggered=${cooldownTriggered}`);

  // ── 5. Buscar candidatos ──────────────────────────────────────────────────
  let candidates = await queryCandidates(orderId, batchSize);
  log(orderId, `candidatos: ${candidates.length}`, { drivers: candidates.map(r => r.user_id) });

  // ── 6. Sin candidatos ─────────────────────────────────────────────────────
  if (candidates.length === 0) {
    const hasDrivers = await anyDriverAvailable();
    if (!hasDrivers) {
      logWarn(orderId, 'sin drivers disponibles en el sistema → pending_driver');
      await markPendingDriver(orderId);
      return 0;
    }

    // Intentar reducción de cooldown
    log(orderId, 'sin candidatos → intentando reducción de cooldown');
    const reduced = await applyOrderCooldownReduction(orderId);

    if (!reduced) {
      // Todos los drivers disponibles tienen pending offer en otro pedido.
      // El pedido quedará huérfano hasta el próximo reject/expire.
      logWarn(orderId, 'sin cooldown que reducir — pedido huérfano, esperando wake-up (reject/expire de otro pedido)');
      await markPendingDriver(orderId);
      return 0;
    }

    // Marcar el flag la primera vez
    await ensureCooldownFlagSet(orderId, cooldownTriggered);

    if (reduced.newWaitSecs < 1) {
      // El driver quedó elegible de inmediato → reintentar candidatos
      candidates = await queryCandidates(orderId, 1);
      log(orderId, `candidatos tras reducción inmediata: ${candidates.length}`, { drivers: candidates.map(r => r.user_id) });
      if (candidates.length === 0) {
        log(orderId, 'sin candidatos tras reducción inmediata → pending_driver');
        await markPendingDriver(orderId);
        return 0;
      }
      // Hay candidatos → continuar al bloque de envío abajo
    } else {
      log(orderId, `cooldown reducido a ${Math.round(reduced.newWaitSecs)}s — reintento en el próximo expire tick`);
      await markPendingDriver(orderId);
      return 0;
    }
  }

  // ── 7. Resetear flag y enviar ofertas ─────────────────────────────────────
  await resetCooldownFlag(orderId, cooldownTriggered);

  for (const row of candidates) {
    log(orderId, `enviando oferta a driver=${row.user_id}`);
    await upsertOffer(orderId, row.user_id, onOffer);
  }

  return candidates.length;
}
