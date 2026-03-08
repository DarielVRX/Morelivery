// backend/src/modules/orders/assignment/cooldown.js
// ─────────────────────────────────────────────────────────────────────────────
// Lógica de reducción de cooldown.
//
// PROBLEMA QUE RESUELVE:
//   Cuando no hay candidatos para un pedido (todos los drivers disponibles
//   están en cooldown para ese pedido específico), en lugar de esperar el
//   cooldown completo, lo reducimos por COOLDOWN_DIVISOR para que el pedido
//   se reactive antes.
//
// GUARD DE IDEMPOTENCIA:
//   La query SQL tiene AND updated_at < NOW() - INTERVAL '1 second'
//   para evitar aplicar la reducción dos veces en el mismo tick.
// ─────────────────────────────────────────────────────────────────────────────

import { COOLDOWN_DIVISOR, log, logWarn } from './constants.js';
import { getNearestCooldownDriver, reduceCooldown, setCooldownTriggered } from './queries.js';

/**
 * Intenta reducir el cooldown del driver más próximo a vencer para este pedido.
 *
 * @returns {{ driver_id: string, newWaitSecs: number } | null}
 *   null si no hay cooldown que reducir (ningún driver en cooldown, o la
 *   reducción fue rechazada por el guard de idempotencia).
 */
export async function applyOrderCooldownReduction(orderId) {
  const nearest = await getNearestCooldownDriver(orderId);

  if (!nearest) {
    // No hay drivers en cooldown para este pedido.
    // Caso típico: todos tienen una oferta pending en OTRO pedido.
    // El pedido quedará huérfano hasta que un reject/expire lo despierte.
    logWarn(orderId, 'applyOrderCooldownReduction: sin cooldowns activos para reducir');
    return null;
  }

  const { driver_id, secs_remaining } = nearest;
  const newWaitSecs = secs_remaining / COOLDOWN_DIVISOR;

  const applied = await reduceCooldown(orderId, driver_id, newWaitSecs);

  if (!applied) {
    log(orderId, 'cooldown reduction: guard de idempotencia activado — ya fue reducido recientemente', { driver_id });
    return null;
  }

  log(orderId, 'cooldown reduction aplicado', {
    driver_id,
    secs_remaining:  Math.round(secs_remaining),
    new_wait_secs:   Math.round(newWaitSecs * 10) / 10,
    immediate:       newWaitSecs < 1,
  });

  return { driver_id, newWaitSecs };
}

/**
 * Marca el pedido como "cooldown triggered" la primera vez que se reduce un cooldown.
 * El flag evita que se marque múltiples veces y sirve como signal de diagnóstico.
 *
 * @param {string}  orderId
 * @param {boolean} currentValue  El valor actual del flag en DB
 */
export async function ensureCooldownFlagSet(orderId, currentValue) {
  if (currentValue) return; // Ya está marcado
  await setCooldownTriggered(orderId, true);
  log(orderId, 'offer_cooldown_triggered = true');
}

/**
 * Resetea el flag cuando el pedido vuelve a tener candidatos (nueva ronda).
 */
export async function resetCooldownFlag(orderId, currentValue) {
  if (!currentValue) return; // Ya está en false
  await setCooldownTriggered(orderId, false);
  log(orderId, 'offer_cooldown_triggered reset a false — nueva oferta en progreso');
}
