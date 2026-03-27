// frontend/src/hooks/useAudio.js
// Sonidos y notificaciones extraídos de useRealtimeOrders

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
    if (['offers','order_updates','driver','kitchen'].includes(group)) return 'high';
    return 'normal';
  } catch { return 'normal'; }
}

// ── Sonidos ───────────────────────────────────────────────────────────────────
function audioCtx(duration = 800) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx();
  setTimeout(() => ctx.close().catch(() => {}), duration);
  return ctx;
}

export function playUrgentAlert() {
  if (typeof window === 'undefined') return;
  const ctx = audioCtx(800);
  if (!ctx) return;
  try {
    [[0.00, 880], [0.22, 660], [0.44, 440]].forEach(([offset, freq]) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'square'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.18);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(ctx.currentTime + offset); osc.stop(ctx.currentTime + offset + 0.2);
    });
  } catch (_) {}
}

export function playArrivalChime() {
  if (typeof window === 'undefined') return;
  const ctx = audioCtx(800);
  if (!ctx) return;
  try {
    [[0.00, 1047], [0.18, 1319], [0.36, 1568]].forEach(([offset, freq]) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + offset + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.25);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(ctx.currentTime + offset); osc.stop(ctx.currentTime + offset + 0.3);
    });
  } catch (_) {}
}

export function playCallTone() {
  if (typeof window === 'undefined') return;
  const ctx = audioCtx(3500);
  if (!ctx) return;
  try {
    [[0.0, 440, 1.0], [1.5, 440, 1.0]].forEach(([offset, freq, dur]) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
      gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + offset + 0.1);
      gain.gain.setValueAtTime(0.3, ctx.currentTime + offset + dur - 0.1);
      gain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + offset + dur);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(ctx.currentTime + offset); osc.stop(ctx.currentTime + offset + dur + 0.05);
    });
  } catch (_) {}
}

export function playOfferPulse() {
  if (typeof window === 'undefined') return;
  const ctx = audioCtx(600);
  if (!ctx) return;
  try {
    const pulse = (offset, freq, duration = 0.11) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'triangle'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + offset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + duration);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(ctx.currentTime + offset); osc.stop(ctx.currentTime + offset + duration + 0.02);
    };
    pulse(0.00, 900); pulse(0.16, 1200);
  } catch (_) {}
}

export function alertOfferAttention(priority = 'high') {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(priority === 'high' ? [300, 100, 300, 100, 300] : [180, 80, 180]);
  }
  playOfferPulse();
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
  const payload  = { type: 'SHOW_NOTIFICATION', title, body, tag, group: group || tag, url,
    data: { url, ts: Date.now() }, priority, vibrate, actions, pushType, orderId, driverName };

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
      vibrate: vibrate || (priority === 'high' ? [300, 100, 300] : [180, 80, 180]),
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
