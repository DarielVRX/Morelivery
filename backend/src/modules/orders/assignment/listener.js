// backend/src/modules/orders/assignment/listener.js
//
// Driver-pull: cuando un driver hace ping, el backend le ofrece
// EL PRIMER pedido disponible para él (sin cooldown).
//
// Principio: en lugar de que la cola empuje pedidos a drivers,
// los drivers "jalan" pedidos de la cola cuando están listos.
// Esto evita que un driver reciba múltiples ofertas simultáneas
// y que pedidos compitan por el mismo driver en paralelo.

import { log, logWarn } from './constants.js';
import { getDriverProfile, getFirstAvailableOrderForDriver } from './queries.js';
import { serializedOffer, hasActiveChain } from './queue.js';
import { offerNextDrivers } from './core.js';
import { expireTimedOutOffers } from './events.js';

/**
 * El driver hace ping. Le ofrecemos el primer pedido disponible para él.
 * "Disponible" = sin cooldown para este driver, sin pending offer activa,
 *                pedido aún sin driver asignado.
 * Prioridad: pedidos con más candidatos disponibles (más urgentes) primero,
 *            luego por created_at ASC.
 */
export async function offerOrdersToDriver(driverId, onOffer) {
  console.log(`[assign] offerOrdersToDriver: driver=${driverId}`);

  const profile = await getDriverProfile(driverId);
  if (!profile?.is_available) {
    logWarn(`driver=${driverId}`, 'no disponible o sin perfil — skip');
    return 0;
  }

  // Limpiar timeouts pendientes antes de buscar
  await expireTimedOutOffers(onOffer);

  // Buscar el primer pedido disponible para ESTE driver específico
  const order = await getFirstAvailableOrderForDriver(driverId);
  if (!order) {
    log(`driver=${driverId}`, 'sin pedidos disponibles sin cooldown');
    return 0;
  }

  // Si ya hay cadena activa para ese pedido, no encolar de nuevo
  if (hasActiveChain(order.id)) {
    log(`order=${order.id}`, `ya tiene cadena activa — driver=${driverId} esperará siguiente ping`);
    return 0;
  }

  log(`driver=${driverId}`, `ofertando order=${order.id} (prioridad has_candidates=${order.has_candidates})`);
  serializedOffer(order.id, offerNextDrivers, onOffer);
  return 1;
}
