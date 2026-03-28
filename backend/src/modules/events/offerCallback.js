// backend/modules/events/offerCallback.js
//
// Callback SSE compartido para el motor de asignación.
// Se inicializa una sola vez en server.js y se importa donde haga falta,
// evitando el import circular entre drivers/routes → assignment → events/hub.
//
// Uso:
//   import { offerCb, initOfferCallback } from '../events/offerCallback.js';
//   initOfferCallback(sseHub);   // llamar una vez al arrancar
//   serializedOffer(orderId, offerNextDrivers, offerCb);

import { sseHub } from './hub.js';
import { sendPushToUser } from '../notifications/pushSubscription.js'; // ← NUEVO

function _onOffer(driverId, orderId, data) {
  try {
    sseHub.notifyNewOffer(driverId, orderId, data);
  } catch (_) {}

  // Push VAPID — fallback para cuando la app está en background/cerrada
  sendPushToUser(driverId, {
    title:    '📦 Nueva entrega disponible',
    body:     data?.restaurantName
                ? `Pedido en ${data.restaurantName}`
                : 'Hay un pedido nuevo cerca de ti',
    tag:      `new_offer_${orderId}`,
    group:    'new_offer',
    priority: 'high',
    url:      '/driver',
    vibrate:  [300, 100, 300, 100, 300],
    pushType: 'new_offer',
    orderId:  data?.orderId ?? orderId,
  }).catch(e => console.warn('[push] new_offer driver:', e.message));
}

export const offerCb = _onOffer;
