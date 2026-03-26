// frontend/src/hooks/useRealtimeOrders.js
import { useCallback, useEffect, useRef } from 'react';
import { API_BASE } from '../api/client';

function canNotify() {
  return typeof window !== 'undefined' && 'Notification' in window;
}
function notificationsEnabled() {
  try { return localStorage.getItem('morelivery_notif_enabled') !== '0'; }
  catch { return true; }
}
function shouldNotifyInBackground() {
  if (typeof document === 'undefined') return true;
  return document.visibilityState !== 'visible' || !document.hasFocus();
}

// ── Sonidos ───────────────────────────────────────────────────────────────────
function playUrgentAlert() {
  if (typeof window === 'undefined') return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    const ctx = new Ctx();
    [[0.00, 880], [0.22, 660], [0.44, 440]].forEach(([offset, freq]) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = 'square'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.18);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(ctx.currentTime + offset); osc.stop(ctx.currentTime + offset + 0.2);
    });
    setTimeout(() => ctx.close().catch(() => {}), 800);
  } catch (_) {}
}

function playArrivalChime() {
  if (typeof window === 'undefined') return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    const ctx = new Ctx();
    [[0.00, 1047], [0.18, 1319], [0.36, 1568]].forEach(([offset, freq]) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + offset + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.25);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(ctx.currentTime + offset); osc.stop(ctx.currentTime + offset + 0.3);
    });
    setTimeout(() => ctx.close().catch(() => {}), 800);
  } catch (_) {}
}

function playCallTone() {
  if (typeof window === 'undefined') return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    const ctx = new Ctx();
    // Tono de llamada: dos pulsos con pausa
    [[0.0, 440, 1.0], [1.5, 440, 1.0]].forEach(([offset, freq, dur]) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
      gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + offset + 0.1);
      gain.gain.setValueAtTime(0.3, ctx.currentTime + offset + dur - 0.1);
      gain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + offset + dur);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(ctx.currentTime + offset); osc.stop(ctx.currentTime + offset + dur + 0.05);
    });
    setTimeout(() => ctx.close().catch(() => {}), 3500);
  } catch (_) {}
}

function playOfferPulse() {
  if (typeof window === 'undefined') return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    const ctx = new Ctx();
    const pulse = (offset, freq, duration = 0.11) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = 'triangle'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + offset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + duration);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(ctx.currentTime + offset); osc.stop(ctx.currentTime + offset + duration + 0.02);
    };
    pulse(0.00, 900); pulse(0.16, 1200);
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
    if (group === 'offers' || group === 'order_updates' || group === 'driver' || group === 'kitchen') return 'high';
    return 'normal';
  } catch { return 'normal'; }
}

async function notifyAppFocused() {
  try {
    if (!('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    reg?.active?.postMessage({ type: 'APP_FOCUSED' });
  } catch (_) {}
}

async function notifyRealtime({ title, body, tag, group, url = '/', vibrate, actions, pushType, orderId, driverName }) {
  if (!canNotify() || Notification.permission !== 'granted') return;
  if (!notificationsEnabled()) return;

  const priority = notificationPriority(group || tag);
  const payload  = {
    type: 'SHOW_NOTIFICATION',
    title, body, tag, group: group || tag, url,
    data: { url, ts: Date.now() },
    priority, vibrate, actions, pushType, orderId, driverName,
  };

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg?.active) { reg.active.postMessage(payload); return; }
    }
  } catch (_) {}

  try {
    new Notification(title, {
      body, tag, icon: '/icon-192.png', badge: '/badge.svg',
      renotify: true, requireInteraction: priority === 'high',
      timestamp: Date.now(),
      vibrate: vibrate || (priority === 'high' ? [300, 100, 300] : [180, 80, 180]),
    });
  } catch (_) {}
}

async function notifyCall({ orderId, driverName, url }) {
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg?.active) {
        reg.active.postMessage({ type: 'SHOW_CALL_NOTIFICATION', orderId, driverName, url });
        return;
      }
    }
  } catch (_) {}
}

// ── Speech desde SW message ───────────────────────────────────────────────────
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'SPEAK') {
      try {
        const utt  = new SpeechSynthesisUtterance(event.data.text);
        utt.lang   = 'es-MX';
        utt.rate   = 0.95;
        window.speechSynthesis?.speak(utt);
      } catch (_) {}
    }
    if (event.data?.type === 'VIBRATE_EXECUTE') {
      navigator.vibrate?.(event.data.pattern || [200]);
    }
  });
}

// ── Hook principal ────────────────────────────────────────────────────────────
export function useRealtimeOrders(
  token,
  onOrderUpdate, onDriverLocation, onNewOffer,
  onChatMessage, onReconnect, onKitchenEvent,
  onTransferEvent, onSupportMessage,
  onNewOrder,      // nuevo: pedido nuevo para restaurante
  onEtaAlert,      // nuevo: ETA alert
  onDriverArrived, // nuevo: driver arrived
  onSimulatedCall, // nuevo: llamada simulada
) {
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
  const cbSupport   = useRef(onSupportMessage);
  const cbNewOrder  = useRef(onNewOrder);
  const cbEta       = useRef(onEtaAlert);
  const cbArrived   = useRef(onDriverArrived);
  const cbCall      = useRef(onSimulatedCall);

  useEffect(() => { cbUpdate.current   = onOrderUpdate;    }, [onOrderUpdate]);
  useEffect(() => { cbLocation.current = onDriverLocation; }, [onDriverLocation]);
  useEffect(() => { cbOffer.current    = onNewOffer;       }, [onNewOffer]);
  useEffect(() => { cbChat.current     = onChatMessage;    }, [onChatMessage]);
  useEffect(() => { cbReconnect.current= onReconnect;      }, [onReconnect]);
  useEffect(() => { cbKitchen.current  = onKitchenEvent;   }, [onKitchenEvent]);
  useEffect(() => { cbTransfer.current = onTransferEvent;  }, [onTransferEvent]);
  useEffect(() => { cbSupport.current  = onSupportMessage; }, [onSupportMessage]);
  useEffect(() => { cbNewOrder.current = onNewOrder;       }, [onNewOrder]);
  useEffect(() => { cbEta.current      = onEtaAlert;       }, [onEtaAlert]);
  useEffect(() => { cbArrived.current  = onDriverArrived;  }, [onDriverArrived]);
  useEffect(() => { cbCall.current     = onSimulatedCall;  }, [onSimulatedCall]);

  useEffect(() => {
    if (!token || !canNotify()) return;
    if (Notification.permission !== 'default') return;
    const request = () => {
      if (Notification.permission === 'default') Notification.requestPermission().catch(() => {});
      window.removeEventListener('pointerdown', request);
      window.removeEventListener('keydown', request);
    };
    window.addEventListener('pointerdown', request, { once: true });
    window.addEventListener('keydown',     request, { once: true });
    return () => {
      window.removeEventListener('pointerdown', request);
      window.removeEventListener('keydown', request);
    };
  }, [token]);

  const connect = useCallback(() => {
    if (!token || !mountedRef.current) return;
    if (esRef.current) { esRef.current.close(); esRef.current = null; }

    const url = `${API_BASE}/api/events?token=${encodeURIComponent(token)}`;
    const es  = new EventSource(url);
    esRef.current = es;

    es.addEventListener('order_update', (e) => {
      try {
        const data = JSON.parse(e.data);
        cbUpdate.current?.(data);
        if (shouldNotifyInBackground()) {
          notifyRealtime({
            title: 'Actualización de pedido',
            body:  data?.status ? `Estado: ${data.status}` : 'Tu pedido fue actualizado',
            tag: 'order_updates', group: 'order_updates', url: '/customer/pedidos',
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
        cbOffer.current?.(data);
        const now = Date.now();
        const sameOffer = String(lastOfferPulse.current.id) === String(data?.orderId);
        const tooSoon   = now - (lastOfferPulse.current.at || 0) < 4000;
        if (!sameOffer || !tooSoon) {
          alertOfferAttention(notificationPriority('offers'));
          lastOfferPulse.current = { id: data?.orderId || null, at: now };
        }
        if (shouldNotifyInBackground()) {
          notifyRealtime({
            title: '🛵 Nueva oferta', body: 'Tienes un pedido por aceptar.',
            tag: 'offers', group: 'driver', url: '/driver',
            vibrate: [300,100,300,100,300,100,300],
            pushType: 'new_offer',
            actions: [{ action: 'accept', title: '✓ Aceptar' }, { action: 'reject', title: '✕ Rechazar' }],
          });
        }
      } catch (_) {}
    });

    // ── Pedido nuevo — evento dedicado para restaurante ────────────────────
    es.addEventListener('new_order', (e) => {
      try {
        const data = JSON.parse(e.data);
        cbNewOrder.current?.(data);
        playUrgentAlert();
        if (navigator?.vibrate) navigator.vibrate([500, 150, 500, 150, 500]);
        if (shouldNotifyInBackground()) {
          notifyRealtime({
            title: '🆕 Nuevo pedido', body: `Pedido recibido — confirma para preparar`,
            tag: `new_order_${data.orderId}`, group: 'kitchen', url: '/restaurant/pedidos',
            vibrate: [500,150,500,150,500],
            pushType: 'new_order', orderId: data.orderId,
            actions: [{ action: 'confirm', title: '✓ Confirmar' }],
          });
        }
      } catch (_) {}
    });

    // ── ETA alert ─────────────────────────────────────────────────────────
    es.addEventListener('driver_eta_alert', (e) => {
      try {
        const data = JSON.parse(e.data);
        cbEta.current?.(data);
        playArrivalChime();
        if (shouldNotifyInBackground()) {
          notifyRealtime({
            title: '🛵 Tu repartidor se acerca',
            body:  data.message || `Llegará en aprox. ${data.etaMins} min`,
            tag: `eta_${data.orderId}`, group: 'customer', url: '/customer/pedidos',
            vibrate: [150,80,150],
            pushType: 'driver_eta_alert', orderId: data.orderId,
            actions: [{ action: 'message', title: '💬 Mensaje' }],
          });
        }
      } catch (_) {}
    });

    // ── Driver arrived ─────────────────────────────────────────────────────
    es.addEventListener('driver_arrived', (e) => {
      try {
        const data = JSON.parse(e.data);
        cbArrived.current?.(data);
        playArrivalChime();
        if (navigator?.vibrate) navigator.vibrate([300,100,100,100,300]);
        if (shouldNotifyInBackground()) {
          notifyRealtime({
            title: '📍 Tu repartidor llegó',
            body:  data.message || 'El conductor está afuera',
            tag: `arrived_${data.orderId}`, group: 'customer', url: '/customer/pedidos',
            vibrate: [300,100,100,100,300],
            pushType: 'driver_arrived', orderId: data.orderId,
            actions: [{ action: 'message', title: '💬 Mensaje' }],
          });
        }
      } catch (_) {}
    });

    // ── Llamada simulada ───────────────────────────────────────────────────
    es.addEventListener('simulated_call', (e) => {
      try {
        const data = JSON.parse(e.data);
        cbCall.current?.(data);
        playCallTone();
        if (navigator?.vibrate) navigator.vibrate([500,300,500,300,500,300,500,300,500]);
        notifyCall({ orderId: data.orderId, driverName: data.driverName, url: '/' });
      } catch (_) {}
    });

    es.addEventListener('offer_cancelled',  (e) => { try { cbUpdate.current?.(JSON.parse(e.data)); } catch (_) {} });
    es.addEventListener('offer_assigned',   (e) => { try { cbUpdate.current?.(JSON.parse(e.data)); } catch (_) {} });

    es.addEventListener('kitchen_auto_ready', (e) => {
      try {
        const data = JSON.parse(e.data);
        cbKitchen.current?.({ type: 'kitchen_auto_ready', ...data });
        if (shouldNotifyInBackground()) {
          notifyRealtime({ title: 'Pedido marcado como listo', body: data.message || '',
            tag: 'kitchen', group: 'kitchen', url: '/restaurant/pedidos' });
        }
      } catch (_) {}
    });

    es.addEventListener('prep_estimate_updated', (e) => {
      try {
        const data = JSON.parse(e.data);
        cbKitchen.current?.({ type: 'prep_estimate_updated', ...data });
      } catch (_) {}
    });

    es.addEventListener('order_transferred_away', (e) => {
      try {
        const data = JSON.parse(e.data);
        cbTransfer.current?.({ type: 'order_transferred_away', ...data });
        cbUpdate.current?.(data);
        if (navigator?.vibrate) navigator.vibrate([200,100,200]);
        if (shouldNotifyInBackground()) {
          notifyRealtime({ title: 'Pedido reasignado', body: 'Un pedido fue transferido a otro conductor',
            tag: 'driver', group: 'driver', url: '/driver', vibrate: [200,100,200],
            pushType: 'reassigned' });
        }
      } catch (_) {}
    });

    es.addEventListener('order_transferred_in', (e) => {
      try {
        const data = JSON.parse(e.data);
        cbTransfer.current?.({ type: 'order_transferred_in', ...data });
        cbUpdate.current?.(data);
        if (shouldNotifyInBackground()) {
          notifyRealtime({ title: 'Nuevo pedido asignado', body: 'Se te asignó un pedido transferido',
            tag: 'offers', group: 'driver', url: '/driver' });
        }
      } catch (_) {}
    });

    es.addEventListener('chat_message', (e) => {
      try {
        const data = JSON.parse(e.data);
        cbChat.current?.(data);
        if (shouldNotifyInBackground()) {
          notifyRealtime({ title: `Mensaje de ${data.senderName || 'soporte'}`,
            body: data.text || 'Tienes un nuevo mensaje',
            tag: 'chat', group: 'chat', url: '/customer/pedidos' });
        }
      } catch (_) {}
    });

    es.addEventListener('support_message', (e) => {
      try {
        const data = JSON.parse(e.data);
        cbSupport.current?.(data);
        if (shouldNotifyInBackground()) {
          notifyRealtime({ title: '🛟 Soporte', body: data.text || 'Nuevo mensaje de soporte',
            tag: 'support', group: 'support', url: '/profile' });
        }
      } catch (_) {}
    });

    es.addEventListener('driver_arrival', (e) => {
      try {
        const data = JSON.parse(e.data);
        cbKitchen.current?.({ type: 'driver_arrival', ...data });
        playArrivalChime();
        if (shouldNotifyInBackground()) {
          notifyRealtime({ title: '🛵 Conductor llegó', body: `${data.driverName || 'El conductor'} recogió el pedido`,
            tag: 'kitchen', group: 'kitchen', url: '/restaurant' });
        }
      } catch (_) {}
    });

    es.addEventListener('order_cancelled_preparing', (e) => {
      try {
        const data = JSON.parse(e.data);
        cbKitchen.current?.({ type: 'order_cancelled_preparing', ...data });
        playUrgentAlert();
        if (navigator?.vibrate) navigator.vibrate([500,200,500,200,500]);
        if (shouldNotifyInBackground()) {
          notifyRealtime({ title: '⚠️ Pedido cancelado', body: 'El cliente canceló mientras estabas preparando',
            tag: 'kitchen_cancel', group: 'kitchen', url: '/restaurant', priority: 'high' });
        }
      } catch (_) {}
    });

    es.addEventListener('orders_blocked', (e) => {
      try {
        const data = JSON.parse(e.data);
        window.dispatchEvent(new CustomEvent('sse_orders_blocked', { detail: data }));
      } catch (_) {}
    });

    es.addEventListener('connected', () => {
      retryCount.current = 0;
      clearTimeout(reconnectTimer.current);
      cbReconnect.current?.();
    });

    es.onerror = () => {
      es.close(); esRef.current = null;
      if (!mountedRef.current) return;
      clearTimeout(reconnectTimer.current);
      const delay = Math.min(4000 * Math.pow(2, retryCount.current), 30000);
      retryCount.current++;
      reconnectTimer.current = setTimeout(connect, delay);
    };
  }, [token]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    function onVisible() {
      if (document.hidden || !mountedRef.current) return;
      notifyAppFocused();
      const state = esRef.current?.readyState;
      if (state !== 1) { clearTimeout(reconnectTimer.current); retryCount.current = 0; connect(); }
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
