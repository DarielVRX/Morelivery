// src/utils/pendingOrder.js
// Draft de pedido en sessionStorage — se escribe al elegir ubicación,
// se lee en RestaurantPage, se confirma al pagar, se borra al salir sin pagar.
// TTL de 5 minutos: si el usuario regresa dentro de ese tiempo, retoma el draft.

const KEY     = 'morelivery_pending_order';
const TIMER   = 'morelivery_pending_timer';
const TTL_MS  = 5 * 60 * 1000; // 5 minutos

export function savePendingOrder(data) {
  try {
    sessionStorage.setItem(KEY,   JSON.stringify({ ...data, savedAt: Date.now() }));
    sessionStorage.removeItem(TIMER); // reset expiry timer
  } catch (_) {}
}

export function readPendingOrder() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    // Check if expired via timer key (set on page hide)
    const expireAt = sessionStorage.getItem(TIMER);
    if (expireAt && Date.now() > Number(expireAt)) {
      clearPendingOrder();
      return null;
    }
    return data;
  } catch (_) { return null; }
}

export function clearPendingOrder() {
  try {
    sessionStorage.removeItem(KEY);
    sessionStorage.removeItem(TIMER);
  } catch (_) {}
}

// Call on visibilitychange/pagehide — sets the expiry timestamp
export function schedulePendingOrderExpiry() {
  try {
    if (!sessionStorage.getItem(KEY)) return;
    sessionStorage.setItem(TIMER, String(Date.now() + TTL_MS));
  } catch (_) {}
}

// Call on page focus/visibilitychange visible — cancels the expiry
export function cancelPendingOrderExpiry() {
  try {
    sessionStorage.removeItem(TIMER);
  } catch (_) {}
}
