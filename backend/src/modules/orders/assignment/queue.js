// backend/src/modules/orders/assignment/queue.js
// ─────────────────────────────────────────────────────────────────────────────
// Cola serializada por pedido.
//
// PROBLEMA QUE RESUELVE:
//   Sin serialización, múltiples eventos concurrentes (expiración, rechazo,
//   listener) pueden llamar a offerNextDrivers para el mismo pedido al mismo
//   tiempo → race conditions, ofertas duplicadas, estados inconsistentes.
//
// CÓMO FUNCIONA:
//   Para cada orderId mantenemos una Promise que representa la ejecución actual.
//   Cada nueva llamada se encadena al final de la anterior con .then().
//   Esto garantiza que para un orderId dado solo hay UNA ejecución activa.
//
// REGLA CRÍTICA:
//   Todos los puntos de entrada al sistema (expireTimedOutOffers, rejectOffer,
//   releaseOrder, offerOrdersToDriver) deben llamar a serializedOffer().
//   NUNCA llamar a offerNextDrivers() directamente desde fuera de este módulo.
// ─────────────────────────────────────────────────────────────────────────────

import { log, logError } from './constants.js';

// orderId → Promise (la ejecución actualmente encadenada para ese pedido)
const orderQueues = new Map();

/**
 * Encola una llamada a offerNextDrivers para el orderId dado.
 * Si ya hay una ejecución activa para ese pedido, la nueva se encadena al final.
 *
 * @param {string}   orderId   UUID del pedido
 * @param {Function} offerFn   La función offerNextDrivers importada del núcleo
 * @param {Function} onOffer   Callback SSE (driverId, orderId, payload) => void
 */
export function serializedOffer(orderId, offerFn, onOffer) {
  const prev = orderQueues.get(orderId) ?? Promise.resolve();

  const next = prev
    .then(() => offerFn(orderId, onOffer))
    .catch(e => logError(`serializedOffer order=${orderId}`, 'unhandled error', e))
    .finally(() => {
      // Solo limpiar si nadie más se encadenó mientras tanto
      if (orderQueues.get(orderId) === next) {
        orderQueues.delete(orderId);
      }
    });

  orderQueues.set(orderId, next);
  log(orderId, `queued (active chains=${orderQueues.size})`);
  return next;
}

/** Comprueba si hay una cadena activa en memoria para este pedido */
export function hasActiveChain(orderId) {
  return orderQueues.has(orderId);
}

/** Tamaño actual de la cola (útil para diagnóstico) */
export function queueSize() {
  return orderQueues.size;
}
