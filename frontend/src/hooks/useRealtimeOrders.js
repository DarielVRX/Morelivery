// frontend/src/hooks/useRealtimeOrders.js
import { useCallback, useEffect, useRef } from 'react';
import { API_BASE } from '../api/client';

function canNotify() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

function shouldNotifyInBackground() {
  if (typeof document === 'undefined') return true;
  return document.visibilityState !== 'visible' || !document.hasFocus();
}

function notificationPriority() {
  try { return localStorage.getItem('morelivery_notif_priority') === 'high' ? 'high' : 'normal'; }
  catch { return 'normal'; }
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

  const payload = {
    type: 'SHOW_NOTIFICATION',
    title,
    body,
    tag,
    group: group || tag,   // el SW usa group para agrupar; tag era por pedido individual
    url,
    data: { url, ts: Date.now() },
    priority: notificationPriority(),
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
    const high = notificationPriority() === 'high';
    new Notification(title, { body, tag, renotify: true, requireInteraction: high });
  } catch (_) {}
}

/**
 * SSE listener central — una sola conexión estable por token.
 */
export function useRealtimeOrders(token, onOrderUpdate, onDriverLocation, onNewOffer, onChatMessage, onReconnect) {
  const esRef          = useRef(null);
  const reconnectTimer = useRef(null);
  const mountedRef     = useRef(true);
  const retryCount     = useRef(0);

  const cbUpdate   = useRef(onOrderUpdate);
  const cbLocation = useRef(onDriverLocation);
  const cbOffer    = useRef(onNewOffer);
  const cbChat     = useRef(onChatMessage);
  const cbReconnect = useRef(onReconnect);

  useEffect(() => { cbUpdate.current    = onOrderUpdate;    }, [onOrderUpdate]);
  useEffect(() => { cbLocation.current  = onDriverLocation; }, [onDriverLocation]);
  useEffect(() => { cbOffer.current     = onNewOffer;       }, [onNewOffer]);
  useEffect(() => { cbChat.current      = onChatMessage;    }, [onChatMessage]);
  useEffect(() => { cbReconnect.current = onReconnect;      }, [onReconnect]);

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

    es.addEventListener('chat_message', (e) => {
      try {
        const data = JSON.parse(e.data);
        cbChat.current?.(data);
        if (shouldNotifyInBackground()) {
          notifyRealtime({
            title: `Mensaje de ${data.senderName || 'soporte'}`,
            body:  data.text || 'Tienes un nuevo mensaje.',
            tag:   'chat',          // tag fijo = todos los chats en una notif
            group: 'chat',
            url:   '/customer/pedidos',
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
