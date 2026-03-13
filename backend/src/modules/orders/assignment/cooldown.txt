// backend/src/modules/orders/assignment/cooldown.js
//
// Reducción de cooldown cuando un pedido no tiene candidatos elegibles.
//
// CUÁNDO SE ACTIVA:
//   offerNextDrivers detecta eligible.length === 0, pero hay drivers disponibles
//   con cooldown activo para este pedido. En ese caso reducimos el cooldown del
//   driver más próximo a vencer (÷ COOLDOWN_DIVISOR) para acelerar la reasignación.
//
// IDEMPOTENCIA:
//   La query SQL tiene AND updated_at < NOW() - INTERVAL '1 second' para evitar
//   aplicar la reducción dos veces en el mismo tick del servidor.
//
// FLAG PERMANENTE:
//   offer_cooldown_triggered se marca TRUE la primera vez que se reduce un cooldown
//   para este pedido. NUNCA se resetea — es un flag de diagnóstico permanente
//   que indica "este pedido alguna vez agotó candidatos".

import { COOLDOWN_DIVISOR, log, logWarn } from './constants.js';
import { getNearestCooldownDriver, reduceCooldown, setCooldownTriggered } from './queries.js';

/**
 * Intenta reducir el cooldown del driver más próximo a vencer para este pedido.
 *
 * @param {string} orderId
 * @param {boolean} alreadyTriggered  Si el flag ya está marcado (no marcar dos veces)
 * @returns {{ driver_id: string, newWaitSecs: number } | null}
 */
export async function applyOrderCooldownReduction(orderId, alreadyTriggered = false) {
  const nearest = await getNearestCooldownDriver(orderId);

  if (!nearest) {
    logWarn(orderId, 'applyOrderCooldownReduction: sin cooldowns activos para reducir');
    return null;
  }

  const { driver_id, secs_remaining } = nearest;
  const newWaitSecs = secs_remaining / COOLDOWN_DIVISOR;

  const applied = await reduceCooldown(orderId, driver_id, newWaitSecs);

  if (!applied) {
    log(orderId, 'cooldown reduction: guard de idempotencia — ya fue reducido recientemente', { driver_id });
    return null;
  }

  log(orderId, 'cooldown reduction aplicado', {
    driver_id,
    secs_remaining:  Math.round(secs_remaining),
    new_wait_secs:   Math.round(newWaitSecs * 10) / 10,
    immediate:       newWaitSecs < 1,
  });

  // Marcar el flag la primera vez — permanente, no resetear
  if (!alreadyTriggered) {
    await setCooldownTriggered(orderId);
  }

  return { driver_id, newWaitSecs };
}
