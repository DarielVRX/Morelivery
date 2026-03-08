// backend/src/modules/orders/assignment/constants.js
// ─────────────────────────────────────────────────────────────────────────────
// Constantes de configuración del motor de asignación.
// Cambiarlas aquí afecta todo el sistema de asignación.
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_ACTIVE_ORDERS_PER_DRIVER = 4;   // Máx. pedidos activos simultáneos por conductor
export const OFFER_TIMEOUT_SECONDS        = 60;  // Segundos antes de expirar una oferta sin respuesta
export const COOLDOWN_SECONDS             = 300; // Cooldown (s) tras rechazar/expirar/liberar
export const COOLDOWN_DIVISOR             = 5;   // Factor de reducción de cooldown cuando no hay candidatos

// Statuses que cuentan como "activo" para el cálculo de carga del driver
export const ACTIVE_STATUSES = ['assigned','accepted','preparing','ready','on_the_way'];

// ─── Logger ───────────────────────────────────────────────────────────────────
// Centralizado aquí para que todos los módulos emitan el mismo formato.

export function log(orderId, msg, data = {}) {
  const ts     = new Date().toISOString();
  const extras = Object.keys(data).length ? ' ' + JSON.stringify(data) : '';
  console.log(`[assign ${ts}] order=${orderId} ${msg}${extras}`);
}

export function logWarn(orderId, msg, data = {}) {
  const ts     = new Date().toISOString();
  const extras = Object.keys(data).length ? ' ' + JSON.stringify(data) : '';
  console.warn(`[assign ${ts}] order=${orderId} WARN: ${msg}${extras}`);
}

export function logError(context, msg, err) {
  console.error(`[assign] ${context}: ${msg}`, err?.message ?? err);
}
