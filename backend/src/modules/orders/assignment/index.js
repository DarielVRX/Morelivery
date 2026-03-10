// backend/src/modules/orders/assignment/index.js
// API pública del módulo — los demás módulos solo importan desde aquí.
export { MAX_ACTIVE_ORDERS_PER_DRIVER, OFFER_TIMEOUT_SECONDS, COOLDOWN_SECONDS } from './constants.js';
export { acceptOffer, rejectOffer, releaseOrder, expireTimedOutOffers }           from './events.js';
export { offerNextDrivers }                                                        from './core.js';
export { serializedOffer, hasActiveChain, queueSize }                             from './queue.js';
export { getPendingAssignmentOrders, getFirstAvailableOrderForDriver, getQueuedOrders } from './queries.js';
