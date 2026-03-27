// frontend/src/hooks/useRealtimeOrders.js
import { useCallback, useEffect, useRef } from 'react';
import { API_BASE } from '../api/client';
import {
  canNotify, shouldNotifyInBackground, notificationPriority, notifyAppFocused,
  notifyRealtime, notifyCall,
  playUrgentAlert, playArrivalChime, playCallTone, alertOfferAttention,
} from './useAudio';

export function useRealtimeOrders(
  token,
  onOrderUpdate, onDriverLocation, onNewOffer,
  onChatMessage, onReconnect, onKitchenEvent,
  onTransferEvent, onSupportMessage,
  onNewOrder, onEtaAlert, onDriverArrived, onSimulatedCall,
) {
  const esRef          = useRef(null);
  const reconnectTimer = useRef(null);
  const mountedRef     = useRef(true);
  const retryCount     = useRef(0);
  const lastOfferPulse = useRef({ id: null, at: 0 });

  // Stable refs for all callbacks — avoids stale closures in EventSource handlers
  const cb = useRef({});
  useEffect(() => {
    cb.current = {
      update: onOrderUpdate, location: onDriverLocation, offer: onNewOffer,
      chat: onChatMessage, reconnect: onReconnect, kitchen: onKitchenEvent,
      transfer: onTransferEvent, support: onSupportMessage,
      newOrder: onNewOrder, eta: onEtaAlert, arrived: onDriverArrived, call: onSimulatedCall,
    };
  });

  // Request notification permission on first user interaction
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

    const es = new EventSource(`${API_BASE}/api/events?token=${encodeURIComponent(token)}`);
    esRef.current = es;

    const on = (event, handler) => es.addEventListener(event, (e) => {
      try { handler(JSON.parse(e.data)); } catch (_) {}
    });

    on('order_update', (data) => {
      cb.current.update?.(data);
      if (shouldNotifyInBackground()) {
        notifyRealtime({ title: 'Actualización de pedido',
          body: data?.status ? `Estado: ${data.status}` : 'Tu pedido fue actualizado',
          tag: 'order_updates', group: 'order_updates', url: '/customer/pedidos' });
      }
    });

    on('driver_location', (data) => cb.current.location?.(data));

    on('new_offer', (data) => {
      cb.current.offer?.(data);
      const now = Date.now();
      const sameOffer = String(lastOfferPulse.current.id) === String(data?.orderId);
      const tooSoon   = now - (lastOfferPulse.current.at || 0) < 4000;
      if (!sameOffer || !tooSoon) {
        alertOfferAttention(notificationPriority('offers'));
        lastOfferPulse.current = { id: data?.orderId || null, at: now };
      }
      if (shouldNotifyInBackground()) {
        notifyRealtime({ title: '🛵 Nueva oferta', body: 'Tienes un pedido por aceptar.',
          tag: 'offers', group: 'driver', url: '/driver',
          vibrate: [300,100,300,100,300,100,300], pushType: 'new_offer',
          actions: [{ action: 'accept', title: '✓ Aceptar' }, { action: 'reject', title: '✕ Rechazar' }] });
      }
    });

    on('new_order', (data) => {
      cb.current.newOrder?.(data);
      playUrgentAlert();
      navigator?.vibrate?.([500, 150, 500, 150, 500]);
      if (shouldNotifyInBackground()) {
        notifyRealtime({ title: '🆕 Nuevo pedido', body: 'Pedido recibido — confirma para preparar',
          tag: `new_order_${data.orderId}`, group: 'kitchen', url: '/restaurant/pedidos',
          vibrate: [500,150,500,150,500], pushType: 'new_order', orderId: data.orderId,
          actions: [{ action: 'confirm', title: '✓ Confirmar' }] });
      }
    });

    on('driver_eta_alert', (data) => {
      cb.current.eta?.(data);
      playArrivalChime();
      if (shouldNotifyInBackground()) {
        notifyRealtime({ title: '🛵 Tu repartidor se acerca',
          body: data.message || `Llegará en aprox. ${data.etaMins} min`,
          tag: `eta_${data.orderId}`, group: 'customer', url: '/customer/pedidos',
          vibrate: [150,80,150], pushType: 'driver_eta_alert', orderId: data.orderId,
          actions: [{ action: 'message', title: '💬 Mensaje' }] });
      }
    });

    on('driver_arrived', (data) => {
      cb.current.arrived?.(data);
      playArrivalChime();
      navigator?.vibrate?.([300,100,100,100,300]);
      if (shouldNotifyInBackground()) {
        notifyRealtime({ title: '📍 Tu repartidor llegó', body: data.message || 'El conductor está afuera',
          tag: `arrived_${data.orderId}`, group: 'customer', url: '/customer/pedidos',
          vibrate: [300,100,100,100,300], pushType: 'driver_arrived', orderId: data.orderId,
          actions: [{ action: 'message', title: '💬 Mensaje' }] });
      }
    });

    on('simulated_call', (data) => {
      cb.current.call?.(data);
      playCallTone();
      navigator?.vibrate?.([500,300,500,300,500,300,500,300,500]);
      notifyCall({ orderId: data.orderId, driverName: data.driverName, url: '/' });
    });

    on('offer_cancelled',  (data) => cb.current.update?.(data));
    on('offer_assigned',   (data) => cb.current.update?.(data));

    on('kitchen_auto_ready', (data) => {
      cb.current.kitchen?.({ type: 'kitchen_auto_ready', ...data });
      if (shouldNotifyInBackground()) {
        notifyRealtime({ title: 'Pedido marcado como listo', body: data.message || '',
          tag: 'kitchen', group: 'kitchen', url: '/restaurant/pedidos' });
      }
    });

    on('prep_estimate_updated', (data) => cb.current.kitchen?.({ type: 'prep_estimate_updated', ...data }));

    on('order_transferred_away', (data) => {
      cb.current.transfer?.({ type: 'order_transferred_away', ...data });
      cb.current.update?.(data);
      navigator?.vibrate?.([200,100,200]);
      if (shouldNotifyInBackground()) {
        notifyRealtime({ title: 'Pedido reasignado', body: 'Un pedido fue transferido a otro conductor',
          tag: 'driver', group: 'driver', url: '/driver', vibrate: [200,100,200], pushType: 'reassigned' });
      }
    });

    on('order_transferred_in', (data) => {
      cb.current.transfer?.({ type: 'order_transferred_in', ...data });
      cb.current.update?.(data);
      if (shouldNotifyInBackground()) {
        notifyRealtime({ title: 'Nuevo pedido asignado', body: 'Se te asignó un pedido transferido',
          tag: 'offers', group: 'driver', url: '/driver' });
      }
    });

    on('chat_message', (data) => {
      cb.current.chat?.(data);
      if (shouldNotifyInBackground()) {
        notifyRealtime({ title: `Mensaje de ${data.senderName || 'soporte'}`,
          body: data.text || 'Tienes un nuevo mensaje',
          tag: 'chat', group: 'chat', url: '/customer/pedidos' });
      }
    });

    on('support_message', (data) => {
      cb.current.support?.(data);
      if (shouldNotifyInBackground()) {
        notifyRealtime({ title: '🛟 Soporte', body: data.text || 'Nuevo mensaje de soporte',
          tag: 'support', group: 'support', url: '/profile' });
      }
    });

    on('driver_arrival', (data) => {
      cb.current.kitchen?.({ type: 'driver_arrival', ...data });
      playArrivalChime();
      if (shouldNotifyInBackground()) {
        notifyRealtime({ title: '🛵 Conductor llegó',
          body: `${data.driverName || 'El conductor'} recogió el pedido`,
          tag: 'kitchen', group: 'kitchen', url: '/restaurant' });
      }
    });

    on('order_cancelled_preparing', (data) => {
      cb.current.kitchen?.({ type: 'order_cancelled_preparing', ...data });
      playUrgentAlert();
      navigator?.vibrate?.([500,200,500,200,500]);
      if (shouldNotifyInBackground()) {
        notifyRealtime({ title: '⚠️ Pedido cancelado',
          body: 'El cliente canceló mientras estabas preparando',
          tag: 'kitchen_cancel', group: 'kitchen', url: '/restaurant', priority: 'high' });
      }
    });

    on('orders_blocked', (data) => {
      window.dispatchEvent(new CustomEvent('sse_orders_blocked', { detail: data }));
    });

    es.addEventListener('connected', () => {
      retryCount.current = 0;
      clearTimeout(reconnectTimer.current);
      cb.current.reconnect?.();
    });

    es.onerror = () => {
      es.close(); esRef.current = null;
      if (!mountedRef.current) return;
      clearTimeout(reconnectTimer.current);
      const delay = Math.min(4000 * Math.pow(2, retryCount.current), 30000);
      retryCount.current++;
      reconnectTimer.current = setTimeout(connect, delay);
    };
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    mountedRef.current = true;
    connect();

    function onVisible() {
      if (document.hidden || !mountedRef.current) return;
      notifyAppFocused();
      if (esRef.current?.readyState !== 1) {
        clearTimeout(reconnectTimer.current); retryCount.current = 0; connect();
      }
    }
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      mountedRef.current = false;
      clearTimeout(reconnectTimer.current);
      esRef.current?.close(); esRef.current = null;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [connect]);
}
