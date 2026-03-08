// backend/src/modules/orders/assignment/index.js
// ─────────────────────────────────────────────────────────────────────────────
// Punto de entrada público del módulo de asignación.
//
// Estructura del módulo:
//   index.js      ← este archivo (API pública)
//   constants.js  ← constantes de config + logger
//   queries.js    ← todas las queries SQL (sin lógica de negocio)
//   queue.js      ← cola serializada por pedido (anti-race-condition)
//   offer.js      ← upsertOffer: advisory lock + SSE
//   cooldown.js   ← reducción de cooldown cuando no hay candidatos
//   core.js       ← offerNextDrivers: máquina de estados central
//   events.js     ← acceptOffer, rejectOffer, releaseOrder, expireTimedOutOffers
//   listener.js   ← offerOrdersToDriver (cuando un driver conecta)
//
// Los archivos externos (orders_routes.js, drivers_routes.js) solo importan
// desde aquí. Nunca importar directamente de los módulos internos.
// ─────────────────────────────────────────────────────────────────────────────

export { MAX_ACTIVE_ORDERS_PER_DRIVER, OFFER_TIMEOUT_SECONDS, COOLDOWN_SECONDS } from './constants.js';

export { acceptOffer, rejectOffer, releaseOrder, expireTimedOutOffers } from './events.js';
export { offerOrdersToDriver }                                          from './listener.js';

// offerNextDrivers se expone por si se necesita desde el scheduler de bootstrap,
// pero siempre debe llamarse a través de serializedOffer en producción.
export { offerNextDrivers }                                             from './core.js';
export { serializedOffer, hasActiveChain, queueSize }                  from './queue.js';
