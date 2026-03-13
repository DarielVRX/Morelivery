// backend/src/modules/orders/assignment/constants.js
export const MAX_ACTIVE_ORDERS_PER_DRIVER = 4;
export const OFFER_TIMEOUT_SECONDS        = 60;   // segundos para expirar una oferta sin respuesta
export const COOLDOWN_SECONDS             = 300;  // cooldown por driver tras rechazar/expirar
export const COOLDOWN_DIVISOR             = 5;    // divisor para reducción de cooldown cuando no hay candidatos

// Statuses que cuentan como pedido "activo" para el límite de carga del driver
export const ACTIVE_STATUSES = ['assigned','accepted','preparing','ready','on_the_way'];

export function log(ctx, msg, data = {}) {
  const ts = new Date().toISOString();
  const x  = Object.keys(data).length ? ' ' + JSON.stringify(data) : '';
  console.log(`[assign ${ts}] ${ctx} ${msg}${x}`);
}
export function logWarn(ctx, msg, data = {}) {
  const ts = new Date().toISOString();
  const x  = Object.keys(data).length ? ' ' + JSON.stringify(data) : '';
  console.warn(`[assign ${ts}] ${ctx} WARN: ${msg}${x}`);
}
export function logError(ctx, msg, err) {
  console.error(`[assign] ${ctx}: ${msg}`, err?.message ?? err);
}
