// backend/src/modules/orders/assignment/listener.js
//
// Driver-pull: cuando un driver hace ping, el backend le ofrece
// EL PRIMER pedido disponible para él (sin cooldown).
//
// El driver frontend llama POST /drivers/ping cada 3 segundos mientras
// esté disponible y tenga capacidad. Esto implementa el modelo pull:
// los drivers jalan pedidos de la cola en lugar de esperar un push.
//
// GPS: no se requiere ubicación para ser elegible — si el driver no tiene
// coordenadas, sigue participando en la asignación normalmente.

import { log, logWarn } from './constants.js';
import { getDriverProfile, getFirstAvailableOrderForDriver } from './queries.js';
import { serializedOffer, hasActiveChain } from './queue.js';
import { offerNextDrivers } from './core.js';
import { expireTimedOutOffers } from './events.js';

/**
 * offerOrdersToDriver — llamado en cada ping del driver.
 *
 * Flujo:
 *   1. Verificar que el driver existe y está disponible (is_available=true).
 *      GPS no es requisito — el driver puede estar disponible sin coordenadas.
 *   2. Expirar ofertas que superaron el timeout.
 *   3. Buscar el primer pedido que este driver puede recibir (sin cooldown,
 *      sin oferta activa en el pedido, bajo el límite de capacidad).
 *   4. Si hay un pedido, encolar la oferta de forma serializada.
 *
 * @param {string}   driverId  UUID del driver
 * @param {Function} onOffer   Callback para enviar la oferta vía SSE
 * @returns {number}           1 si se encoló una oferta, 0 si no
 */
export async function offerOrdersToDriver(driverId, onOffer) {
  console.log(`[assign] offerOrdersToDriver: driver=${driverId}`);

  // 1. Verificar perfil — GPS no requerido para elegibilidad
  const profile = await getDriverProfile(driverId);
  if (!profile) {
    logWarn(`driver=${driverId}`, 'sin perfil de driver — skip');
    return 0;
  }
  if (!profile.is_available) {
    logWarn(`driver=${driverId}`, 'no disponible — skip');
    return 0;
  }

  // Capacidad: el driver ya tiene el máximo de pedidos activos
  // (getDriverProfile devuelve active_count; la comprobación final
  //  se hace en la query, pero podemos hacer un short-circuit aquí)
  // No bloqueamos aquí para no duplicar la lógica — la query ya lo filtra.

  // 2. Limpiar timeouts pendientes antes de buscar
  await expireTimedOutOffers(onOffer);

  // 3. Buscar el primer pedido disponible para ESTE driver
  //    La query ya excluye drivers sin capacidad, con cooldown, etc.
  const order = await getFirstAvailableOrderForDriver(driverId);
  if (!order) {
    log(`driver=${driverId}`, 'sin pedidos disponibles sin cooldown');
    return 0;
  }

  // 4. Si ya hay cadena activa para ese pedido, no duplicar
  if (hasActiveChain(order.id)) {
    log(`order=${order.id}`, `ya tiene cadena activa — driver=${driverId} esperará siguiente ping`);
    return 0;
  }

  log(`driver=${driverId}`, `ofertando order=${order.id} (has_candidates=${order.has_candidates})`);
  serializedOffer(order.id, offerNextDrivers, onOffer);
  return 1;
}
