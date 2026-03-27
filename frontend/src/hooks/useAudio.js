// frontend/src/hooks/useAudio.js
// Sonidos y notificaciones — patrones diferenciados por evento

// ── Permisos y preferencias ───────────────────────────────────────────────────
export function canNotify() {
  return typeof window !== 'undefined' && 'Notification' in window;
}
export function notificationsEnabled() {
  try { return localStorage.getItem('morelivery_notif_enabled') !== '0'; }
  catch { return true; }
}
export function shouldNotifyInBackground() {
  if (typeof document === 'undefined') return true;
  return document.visibilityState !== 'visible' || !document.hasFocus();
}
export function notificationPriority(group) {
  try {
    const stored = localStorage.getItem('morelivery_notif_priority');
    if (stored === 'high') return 'high';
    if (['offers', 'order_updates', 'driver', 'kitchen'].includes(group)) return 'high';
    return 'normal';
  } catch { return 'normal'; }
}

// ── Patrones de vibración por evento ─────────────────────────────────────────
// Diseñados para ser reconocibles sin mirar la pantalla
export const VIBRATE = {
  // Nueva oferta entrante — urgente, patrón largo y repetitivo
  offer:         [300, 100, 300, 100, 300, 100, 300],
  // Nuevo pedido para restaurante — tres golpes fuertes
  new_order:     [500, 150, 500, 150, 500],
  // Llamada simulada — patrón de teléfono clásico
  call:          [800, 400, 800, 400, 800],
  // Driver llegó al cliente — dos golpes cortos + uno largo (¡llegué!)
  driver_arrived_customer: [150, 80, 150, 80, 400],
  // Driver llegó al restaurante — un golpe + pausa + dos cortos
  driver_arrived_restaurant: [300, 150, 150, 80, 150],
  // Alerta de ETA (se acerca) — suave, tres pulsos cortos
  eta_alert:     [150, 80, 150, 80, 150],
  // Pedido cancelado — un golpe largo
  cancelled:     [600],
  // Transferencia / reasignación — dos golpes medios
  transfer:      [200, 100, 200],
  // Soporte / chat — dos pulsos suaves
  support:       [180, 80, 180],
  // Confirmación genérica — un pulso corto
  confirm:       [100],
  // Normal fallback
  normal:        [200, 100, 200],
};

// ── Helpers de AudioContext ───────────────────────────────────────────────────
function audioCtx(closAfterMs = 800) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  try {
    const ctx = new Ctx();
    setTimeout(() => ctx.close().catch(() => {}), closAfterMs);
    return ctx;
  } catch { return null; }
}

function tone(ctx, { offset = 0, freq, type = 'sine', attack = 0.01, sustain = 0.15, release = 0.25, volume = 0.18 }) {
  try {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type            = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
    gain.gain.exponentialRampToValueAtTime(volume, ctx.currentTime + offset + attack);
    gain.gain.setValueAtTime(volume, ctx.currentTime + offset + sustain);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + sustain + release);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime + offset);
    osc.stop(ctx.currentTime + offset + sustain + release + 0.05);
  } catch (_) {}
}

// ── Sonidos ───────────────────────────────────────────────────────────────────

// Alerta urgente — tres tonos descendentes cuadrados (oferta, cancelación)
export function playUrgentAlert() {
  if (typeof window === 'undefined') return;
  const ctx = audioCtx(900);
  if (!ctx) return;
  [[0.00, 880], [0.22, 660], [0.44, 440]].forEach(([offset, freq]) => {
    tone(ctx, { offset, freq, type: 'square', attack: 0.02, sustain: 0.12, release: 0.06, volume: 0.18 });
  });
}

// Campanilla de llegada — tres tonos ascendentes sinusoidales
export function playArrivalChime() {
  if (typeof window === 'undefined') return;
  const ctx = audioCtx(900);
  if (!ctx) return;
  [[0.00, 1047], [0.18, 1319], [0.36, 1568]].forEach(([offset, freq]) => {
    tone(ctx, { offset, freq, type: 'sine', attack: 0.01, sustain: 0.18, release: 0.07, volume: 0.15 });
  });
}

// Tono de llamada — dos pulsos largos estilo teléfono
export function playCallTone() {
  if (typeof window === 'undefined') return;
  const ctx = audioCtx(3500);
  if (!ctx) return;
  [[0.0, 440, 1.0], [1.5, 440, 1.0]].forEach(([offset, freq, dur]) => {
    try {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type            = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
      gain.gain.linearRampToValueAtTime(0.28, ctx.currentTime + offset + 0.1);
      gain.gain.setValueAtTime(0.28, ctx.currentTime + offset + dur - 0.1);
      gain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + offset + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + dur + 0.05);
    } catch (_) {}
  });
}

// Pulso de oferta — dos tonos triangulares ascendentes rápidos
export function playOfferPulse() {
  if (typeof window === 'undefined') return;
  const ctx = audioCtx(600);
  if (!ctx) return;
  [[0.00, 900, 0.11], [0.16, 1200, 0.11]].forEach(([offset, freq, sustain]) => {
    tone(ctx, { offset, freq, type: 'triangle', attack: 0.015, sustain, release: 0.02, volume: 0.22 });
  });
}

// Chime de ETA — un tono suave ascendente (aviso sin urgencia)
export function playEtaChime() {
  if (typeof window === 'undefined') return;
  const ctx = audioCtx(600);
  if (!ctx) return;
  tone(ctx, { offset: 0, freq: 880, type: 'sine', attack: 0.02, sustain: 0.2, release: 0.15, volume: 0.12 });
  tone(ctx, { offset: 0.25, freq: 1100, type: 'sine', attack: 0.02, sustain: 0.18, release: 0.12, volume: 0.10 });
}

// ── Vibración + sonido combinados ─────────────────────────────────────────────

export function alertOfferAttention(priority = 'high') {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(VIBRATE.offer);
  }
  playOfferPulse();
}

export function alertNewOrder() {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(VIBRATE.new_order);
  }
  playUrgentAlert();
}

export function alertDriverArrivedCustomer() {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(VIBRATE.driver_arrived_customer);
  }
  playArrivalChime();
}

export function alertDriverArrivedRestaurant() {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(VIBRATE.driver_arrived_restaurant);
  }
  playArrivalChime();
}

export function alertEta() {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(VIBRATE.eta_alert);
  }
  playEtaChime();
}

export function alertCall() {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(VIBRATE.call);
  }
  playCallTone();
}

// ── Notificaciones ────────────────────────────────────────────────────────────
export async function notifyAppFocused() {
  try {
    if (!('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    reg?.active?.postMessage({ type: 'APP_FOCUSED' });
  } catch (_) {}
}

export async function notifyRealtime({ title, body, tag, group, url = '/', vibrate, actions, pushType, orderId, driverName }) {
  if (!canNotify() || Notification.permission !== 'granted') return;
  if (!notificationsEnabled()) return;

  const priority = notificationPriority(group || tag);
  const payload  = {
    type: 'SHOW_NOTIFICATION', title, body, tag, group: group || tag, url,
    data: { url, ts: Date.now() }, priority, vibrate, actions, pushType, orderId, driverName,
  };

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg?.active) { reg.active.postMessage(payload); return; }
    }
  } catch (_) {}

  try {
    new Notification(title, {
      body, tag, icon: '/icon-192.png', badge: '/badge.svg', renotify: true,
      requireInteraction: priority === 'high', timestamp: Date.now(),
      vibrate: vibrate || (priority === 'high' ? VIBRATE.normal : [180, 80, 180]),
    });
  } catch (_) {}
}

export async function notifyCall({ orderId, driverName, url }) {
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      reg?.active?.postMessage({ type: 'SHOW_CALL_NOTIFICATION', orderId, driverName, url });
    }
  } catch (_) {}
}

// ── SW message listener (speech + vibrate) ────────────────────────────────────
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'SPEAK') {
      try {
        const utt = new SpeechSynthesisUtterance(event.data.text);
        utt.lang = 'es-MX'; utt.rate = 0.95;
        window.speechSynthesis?.speak(utt);
      } catch (_) {}
    }
    if (event.data?.type === 'VIBRATE_EXECUTE') {
      navigator.vibrate?.(event.data.pattern || [200]);
    }
  });
}
