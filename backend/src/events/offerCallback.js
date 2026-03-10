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

function _onOffer(driverId, orderId, data) {
  try {
    sseHub.notifyNewOffer(driverId, orderId, data);
  } catch (_) {}
}

export const offerCb = _onOffer;
