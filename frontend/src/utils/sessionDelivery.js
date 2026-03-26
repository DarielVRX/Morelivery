/**
 * sessionDelivery.js
 * Persiste la dirección de entrega del cliente durante la sesión del navegador.
 * - Usa sessionStorage: vive mientras el tab está abierto.
 * - Se comparte entre RestaurantPage, Payments y cualquier otra página del customer.
 * - NO reemplaza pendingOrder (que guarda el borrador del pedido completo).
 */

const KEY = 'morelivery_delivery_pos';

/**
 * @typedef {{ lat: number, lng: number, label: string }} DeliveryPos
 */

/** Lee la posición guardada. Devuelve null si no hay nada. */
export function readSessionDelivery() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p?.lat || !p?.lng) return null;
    return p;
  } catch {
    return null;
  }
}

/** Guarda la posición. Pasar null para borrar. */
export function saveSessionDelivery(pos) {
  try {
    if (!pos) {
      sessionStorage.removeItem(KEY);
    } else {
      sessionStorage.setItem(KEY, JSON.stringify({ lat: pos.lat, lng: pos.lng, label: pos.label || '' }));
    }
  } catch {}
}

/** Borra la posición guardada. */
export function clearSessionDelivery() {
  try { sessionStorage.removeItem(KEY); } catch {}
}
