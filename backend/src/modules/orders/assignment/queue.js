// backend/src/modules/orders/assignment/queue.js
// Cola serializada por pedido: garantiza 1 ejecución activa por orderId.
import { logError, log } from './constants.js';

const orderQueues = new Map(); // orderId -> Promise

export function serializedOffer(orderId, offerFn, onOffer) {
  const prev = orderQueues.get(orderId) ?? Promise.resolve();
  const next = prev
    .then(() => offerFn(orderId, onOffer))
    .catch(e => logError(`queue order=${orderId}`, 'unhandled', e))
    .finally(() => {
      if (orderQueues.get(orderId) === next) orderQueues.delete(orderId);
    });
  orderQueues.set(orderId, next);
  log(`order=${orderId}`, `serialized (cola=${orderQueues.size})`);
  return next;
}

export function hasActiveChain(orderId) { return orderQueues.has(orderId); }
export function queueSize()             { return orderQueues.size; }
