// backend/src/modules/orders/assignment/listener.js
// Evento: un driver se habilita o hace ping.
// Prioriza pedidos con candidatos disponibles gracias a getQueuedOrders().
import { log, logWarn } from './constants.js';
import { getDriverProfile, getQueuedOrders } from './queries.js';
import { serializedOffer, hasActiveChain } from './queue.js';
import { offerNextDrivers } from './core.js';
import { expireTimedOutOffers } from './events.js';

export async function offerOrdersToDriver(driverId, onOffer) {
  console.log(`[assign] offerOrdersToDriver: driver=${driverId}`);

  const profile = await getDriverProfile(driverId);
  if (!profile?.is_available) {
    logWarn(`driver=${driverId}`, 'no disponible o sin perfil — skip');
    return 0;
  }

  // Limpiar timeouts pendientes
  await expireTimedOutOffers(onOffer);

  // Cola global priorizada: pedidos con candidatos primero, luego sin candidatos
  const queue = await getQueuedOrders(driverId);
  console.log(`[assign] offerOrdersToDriver driver=${driverId}: ${queue.length} pedido(s) en cola`);

  let enqueued = 0;
  for (const row of queue) {
    if (hasActiveChain(row.id)) {
      log(`order=${row.id}`, 'ya tiene cadena activa — skip');
      continue;
    }
    serializedOffer(row.id, offerNextDrivers, onOffer);
    enqueued++;
  }
  return enqueued;
}
