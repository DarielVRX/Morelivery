// frontend/src/hooks/useRealtimeOrders.js
import { useCallback, useEffect, useRef } from 'react';
import { API_BASE } from '../api/client';

function canNotify() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

function notificationsEnabled() {
  try {
    return localStorage.getItem('morelivery_notif_enabled') !== '0';
  } catch {
    return true;
  }
}

function shouldNotifyInBackground() {
  if (typeof document === 'undefined') return true;
  return document.visibilityState !== 'visible' || !document.hasFocus();
}


// Sonido urgente para restaurante — cancelación mientras preparaba
function playUrgentAlert() {
  if (typeof window === 'undefined') return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    const ctx = new Ctx();
    // Tres pulsos descendentes — tono de alerta
    [[0.00, 880], [0.22, 660], [0.44, 440]].forEach(([offset, freq]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.18);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.2);
    });
    setTimeout(() => ctx.close().catch(() => {}), 800);
  } catch (_) {}
}

// Sonido suave para driver_arrival — ding amigable
function playArrivalChime() {
  if (typeof window === 'undefined') return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    const ctx = new Ctx();
    [[0.00, 1047], [0.18, 1319], [0.36, 1568]].forEach(([offset, freq]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + offset + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.25);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.3);
    });
    setTimeout(() => ctx.close().catch(() => {}), 800);
  } catch (_) {}
}
  if (typeof window === 'undefined') return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    const ctx = new Ctx();
    const pulse = (offset, freq, duration = 0.11) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + offset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + duration);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + duration + 0.02);
    };
    pulse(0.00, 900);
    pulse(0.16, 1200);
    setTimeout(() => ctx.close().catch(() => {}), 600);
  } catch (_) {}
}

function alertOfferAttention(priority = 'high') {
  const high = priority === 'high';
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(high ? [300, 100, 300, 100, 300] : [180, 80, 180]);
  }
  playOfferPulse();
}

function notificationPriority(group) {
  try {
    const stored = localStorage.getItem('morelivery_notif_priority');
    if (stored === 'high') return 'high';
    // Priorizar siempre ofertas y updates de pedido aunque el resto sea "normal"
    if (group === 'offers' || group === 'order_updates') return 'high';
    return 'normal';
  } catch { return 'normal'; }
}

// Notificar al SW que la app está activa → limpia badge y contadores
async function notifyAppFocused() {
  try {
    if (!('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    reg?.active?.postMessage({ type: 'APP_FOCUSED' });
  } catch (_) {}
}

// group: clave de agrupación por categoría (ej. 'offers', 'order_updates', 'chat')
// Todos los eventos del mismo group colapsan en una sola notificación en el SW.
async function notifyRealtime({ title, body, tag, group, url = '/' }) {
  if (!canNotify() || Notification.permission !== 'granted') return;
  if (!notificationsEnabled()) return;

  const priority = notificationPriority(group || tag);
  const payload = {
    type: 'SHOW_NOTIFICATION',
    title,
    body,
    tag,
    group: group || tag,   // el SW usa group para agrupar; tag era por pedido individual
    url,
    data: { url, ts: Date.now() },
    priority,
  };

  // Preferir SW para soporte en segundo plano (móvil/PWA)
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg?.active) {
        reg.active.postMessage(payload);
        return;
      }
    }
  } catch (_) {}

  // Fallback foreground
  try {
    const high = priority === 'high';
    if (high && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate([300, 100, 300, 100, 300]);
    }
    new Notification(title, {
      body,
      tag,
      icon: '/icon-192.png',
      badge: '/badge.svg',
      renotify: true,
      requireInteraction: high,
      silent: false,
      timestamp: Date.now(),
      vibrate: high ? [300, 100, 300, 100, 300] : [180, 80, 180],
    });
  } catch (_) {}
}

/**
 * SSE listener central — una sola conexión estable por token.
 */
export function useRealtimeOrders(token, onOrderUpdate, onDriverLocation, onNewOffer, onChatMessage, onReconnect, onKitchenEvent, onTransferEvent) {
  const esRef          = useRef(null);
  const reconnectTimer = useRef(null);
  const mountedRef     = useRef(true);
  const retryCount     = useRef(0);
  const lastOfferPulse = useRef({ id: null, at: 0 });

  const cbUpdate    = useRef(onOrderUpdate);
  const cbLocation  = useRef(onDriverLocation);
  const cbOffer     = useRef(onNewOffer);
  const cbChat      = useRef(onChatMessage);
  const cbReconnect = useRef(onReconnect);
  const cbKitchen   = useRef(onKitchenEvent);
  const cbTransfer  = useRef(onTransferEvent);

  useEffect(() => { cbUpdate.current    = onOrderUpdate;    }, [onOrderUpdate]);
  useEffect(() => { cbLocation.current  = onDriverLocation; }, [onDriverLocation]);
  useEffect(() => { cbOffer.current     = onNewOffer;       }, [onNewOffer]);
  useEffect(() => { cbChat.current      = onChatMessage;    }, [onChatMessage]);
  useEffect(() => { cbReconnect.current = onReconnect;      }, [onReconnect]);
  useEffect(() => { cbKitchen.current   = onKitchenEvent;   }, [onKitchenEvent]);
  useEffect(() => { cbTransfer.current  = onTransferEvent;  }, [onTransferEvent]);

  // Pedir permiso una vez cuando hay sesión activa
  useEffect(() => {
    if (!token || !canNotify()) return;
    if (Notification.permission !== 'default') return;

    const request = () => {
      if (Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
      window.removeEventListener('pointerdown', request);
      window.removeEventListener('keydown', request);
    };

    // Solicitar tras interacción real del usuario (más confiable en móvil)
    window.addEventListener('pointerdown', request, { once: true });
    window.addEventListener('keydown', request, { once: true });

    return () => {
      window.removeEventListener('pointerdown', request);
      window.removeEventListener('keydown', request);
    };
  }, [token]);

  const connect = useCallback(() => {
    if (!token || !mountedRef.current) return;
    if (esRef.current) { esRef.current.close(); esRef.current = null; }

    const url = `${API_BASE}/api/events?token=${encodeURIComponent(token)}`;
    console.log(`📡 [SSE] conectando (intento ${retryCount.current + 1})`);
    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener('order_update', (e) => {
      try {
        const data = JSON.parse(e.data);
        cbUpdate.current?.(data);
        if (shouldNotifyInBackground()) {
          const status = data?.status ? `Estado: ${data.status}` : 'Tu pedido fue actualizado';
          notifyRealtime({
            title: 'Actualización de pedido',
            body:  status,
            tag:   'order_updates',        // tag fijo = agrupa todos los updates
            group: 'order_updates',
            url:   '/customer/pedidos',
          });
        }
      } catch (_) {}
    });

    es.addEventListener('driver_location', (e) => {
      try { cbLocation.current?.(JSON.parse(e.data)); } catch (_) {}
    });

    es.addEventListener('new_offer', (e) => {
      try {
        const data = JSON.parse(e.data);
        console.log(`[SSE] new_offer received orderId=${data.orderId} secondsLeft=${data.secondsLeft}`);
        cbOffer.current?.(data);

        // Alerta local inmediata por evento SSE (no depende de render en Home)
        const now = Date.now();
        const sameOffer = lastOfferPulse.current.id && String(lastOfferPulse.current.id) === String(data?.orderId);
        const tooSoon = now - (lastOfferPulse.current.at || 0) < 4000;
        if (!sameOffer || !tooSoon) {
          const priority = notificationPriority('offers');
          alertOfferAttention(priority);
          lastOfferPulse.current = { id: data?.orderId || null, at: now };
        }

        notifyRealtime({
          title: 'Nueva oferta disponible',
          body:  'Tienes un pedido por aceptar.',
          tag:   'offers',          // tag fijo = todas las ofertas colapsan en una notif
          group: 'offers',
          url:   '/driver',
        });
      } catch (_) {}
    });

    es.addEventListener('offer_cancelled', (e) => {
      try { cbUpdate.current?.(JSON.parse(e.data)); } catch (_) {}
    });

    es.addEventListener('offer_assigned', (e) => {
      try { cbUpdate.current?.(JSON.parse(e.data)); } catch (_) {}
    });

    // ── Eventos del motor de cocina ──────────────────────────────────────────
    // kitchen_auto_ready: el sistema marcó automáticamente un pedido como listo
    es.addEventListener('kitchen_auto_ready', (e) => {
      try {
        const data = JSON.parse(e.data);
        cbKitchen.current?.({ type: 'kitchen_auto_ready', ...data });
        if (shouldNotifyInBackground()) {
          notifyRealtime({
            title: 'Pedido marcado como listo',
            body:  data.message || 'Un pedido fue marcado automáticamente como listo.',
            tag:   'kitchen',
            group: 'kitchen',
            url:   '/restaurant/pedidos',
          });
        }
      } catch (_) {}
    });

    // prep_estimate_updated: el sistema ajustó el estimado de preparación
    es.addEventListener('prep_estimate_updated', (e) => {
      try {
        const data = JSON.parse(e.data);
        cbKitchen.current?.({ type: 'prep_estimate_updated', ...data });
        if (shouldNotifyInBackground()) {
          notifyRealtime({
            title: 'Estimado de preparación ajustado',
            body:  data.message || 'Tu tiempo estimado de preparación fue actualizado.',
            tag:   'kitchen',
            group: 'kitchen',
            url:   '/restaurant/pedidos',
          });
        }
      } catch (_) {}
    });

    // ── Eventos de rebalanceo (driver) ───────────────────────────────────────
    es.addEventListener('order_transferred_away', (e) => {
      try {
        const data = JSON.parse(e.data);
        cbTransfer.current?.({ type: 'order_transferred_away', ...data });
        cbUpdate.current?.(data);
      } catch (_) {}
    });

    es.addEventListener('order_transferred_in', (e) => {
      try {
        const data = JSON.parse(e.data);
        cbTransfer.current?.({ type: 'order_transferred_in', ...data });
        cbUpdate.current?.(data);
        if (shouldNotifyInBackground()) {
          notifyRealtime({
            title: 'Nuevo pedido asignado',
            body:  'Se te asignó un pedido transferido.',
            tag:   'offers',
            group: 'offers',
            url:   '/driver',
          });
        }
      } catch (_) {}
    });

    es.addEventListener('chat_message', (e) => {
      try {
        const data = JSON.parse(e.data);
        cbChat.current?.(data);
        if (shouldNotifyInBackground()) {
          notifyRealtime({
            title: `Mensaje de ${data.senderName || 'soporte'}`,
            body:  data.text || 'Tienes un nuevo mensaje.',
            tag:   'chat',
            group: 'chat',
            url:   '/customer/pedidos',
          });
        }
      } catch (_) {}
    });

    // ── Eventos específicos de restaurante ───────────────────────────────────
    // driver_arrival: el driver recogió el pedido (= marcó on_the_way)
    es.addEventListener('driver_arrival', (e) => {
      try {
        const data = JSON.parse(e.data);
        cbKitchen.current?.({ type: 'driver_arrival', ...data });
        playArrivalChime();
        if (shouldNotifyInBackground()) {
          notifyRealtime({
            title: '🛵 Conductor llegó',
            body:  `${data.driverName || 'El conductor'} recogió el pedido`,
            tag:   'kitchen',
            group: 'kitchen',
            url:   '/restaurant',
          });
        }
      } catch (_) {}
    });

    // order_cancelled_preparing: cliente canceló mientras el restaurante ya preparaba
    es.addEventListener('order_cancelled_preparing', (e) => {
      try {
        const data = JSON.parse(e.data);
        cbKitchen.current?.({ type: 'order_cancelled_preparing', ...data });
        playUrgentAlert();
        if ('vibrate' in navigator) navigator.vibrate([500, 200, 500, 200, 500]);
        if (shouldNotifyInBackground()) {
          notifyRealtime({
            title: '⚠️ Pedido cancelado',
            body:  'El cliente canceló mientras estabas preparando',
            tag:   'kitchen_cancel',
            group: 'kitchen',
            url:   '/restaurant',
            priority: 'high',
          });
        }
      } catch (_) {}
    });

    es.addEventListener('connected', () => {
      retryCount.current = 0;
      console.log('📡 [SSE] conexión establecida');
      clearTimeout(reconnectTimer.current);
      cbReconnect.current?.();
    });

    es.onerror = () => {
      es.close();
      esRef.current = null;
      if (!mountedRef.current) return;
      clearTimeout(reconnectTimer.current);
      const delay = Math.min(4000 * Math.pow(2, retryCount.current), 30000);
      retryCount.current++;
      console.warn(`📡 [SSE] error — reintentando en ${delay / 1000}s (intento ${retryCount.current})`);
      reconnectTimer.current = setTimeout(connect, delay);
    };
  }, [token]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    // Reconectar si iOS/Android pausó el JS y el SSE quedó muerto al volver al foco
    function onVisible() {
      if (document.hidden || !mountedRef.current) return;
      notifyAppFocused(); // limpiar badge del ícono de la app
      const state = esRef.current?.readyState;
      // 1 = OPEN — si no está abierto, reconectar
      if (state !== 1) {
        console.warn('[SSE] tab visible pero SSE no activo (state=' + state + ') — reconectando');
        clearTimeout(reconnectTimer.current);
        retryCount.current = 0; // reset backoff al volver manual
        connect();
      }
    }
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      mountedRef.current = false;
      clearTimeout(reconnectTimer.current);
      esRef.current?.close();
      esRef.current = null;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [connect]);
}
