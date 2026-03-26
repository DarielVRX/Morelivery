/**
 * sessionDelivery.js
 * Persiste la dirección de entrega del cliente en localStorage.
 *
 * - Scoped por userId extraído del JWT: cada usuario tiene su propia clave.
 * - Usa localStorage → persiste mientras el token exista (no se borra al cerrar el tab).
 * - Se limpia automáticamente al llamar clearSessionDelivery (logout).
 * - NO reemplaza pendingOrder (que maneja el borrador temporal del pedido).
 *
 * @typedef {{ lat: number, lng: number, label: string }} DeliveryPos
 */

const KEY_PREFIX = 'morelivery_delivery_pos';

/** Extrae userId del JWT sin librería externa. Devuelve null si falla. */
function userIdFromToken(token) {
  try {
    if (!token) return null;
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const decoded = JSON.parse(json);
    return decoded.userId || decoded.sub || null;
  } catch {
    return null;
  }
}

function storageKey(token) {
  const uid = userIdFromToken(token);
  return uid ? `${KEY_PREFIX}_${uid}` : KEY_PREFIX;
}

/**
 * Lee la posición guardada para el token dado.
 * @param {string|null} token  JWT del usuario autenticado
 * @returns {DeliveryPos|null}
 */
export function readSessionDelivery(token) {
  try {
    const raw = localStorage.getItem(storageKey(token));
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!Number.isFinite(p?.lat) || !Number.isFinite(p?.lng)) return null;
    return { lat: p.lat, lng: p.lng, label: p.label || '' };
  } catch {
    return null;
  }
}

/**
 * Guarda la posición para el token dado.
 * @param {DeliveryPos} pos
 * @param {string|null} token
 */
export function saveSessionDelivery(pos, token) {
  try {
    if (!Number.isFinite(pos?.lat) || !Number.isFinite(pos?.lng)) return;
    localStorage.setItem(
      storageKey(token),
      JSON.stringify({ lat: pos.lat, lng: pos.lng, label: pos.label || '' })
    );
  } catch {}
}

/**
 * Limpia la posición guardada. Llamar en logout.
 * @param {string|null} token
 */
export function clearSessionDelivery(token) {
  try {
    localStorage.removeItem(storageKey(token));
  } catch {}
}
