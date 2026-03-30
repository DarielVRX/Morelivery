// frontend/src/hooks/useRealtimeOrders.js
import { useCallback, useEffect, useRef } from 'react';
import { API_BASE } from '../api/client';
import {
  canNotify, notificationPriority,
  notifyAppFocused, notifyRealtime, notifyCall,
  alertOfferAttention, alertNewOrder,
  alertDriverArrivedCustomer, alertDriverArrivedRestaurant,
  alertEta, alertCall,
  playUrgentAlert, playArrivalChime, VIBRATE,
} from './useAudio';

export function useRealtimeOrders(
  token,
  onOrderUpdate, onDriverLocation, onNewOffer,
  onChatMessage, onReconnect, onKitchenEvent,
  onTransferEvent, onSupportMessage,
  onNewOrder, onEtaAlert, onDriverArrived, onSimulatedCall,
  onRouteUpdate,
) {
  const esRef          = useRef(null);
  const reconnectTimer = useRef(null);
  const mountedRef     = useRef(true);
  const retryCount     = useRef(0);
  const lastOfferPulse = useRef({ id: null, at: 0 });

  // Stable refs — evita closures stale en handlers de EventSource
  const cb = useRef({});
  useEffect(() => {
    cb.current = {
      update: onOrderUpdate, location: onDriverLocation, offer: onNewOffer,
      chat: onChatMessage, reconnect: onReconnect, kitchen: onKitchenEvent,
      transfer: onTransferEvent, support: onSupportMessage,
      newOrder: onNewOrder, eta: onEtaAlert, arrived: onDriverArrived, call: onSimulatedCall,
      routeUpdate: onRouteUpdate,
    };
  });

  // Solicitar permiso de notificaciones en primera interacción
  useEffect(() => {
    if (!token || !canNotify()) return;
    if (Notification.permission !== 'default') return;
    const request = () => {
      if (Notification.permission === 'default') Notification.requestPermission().catch(() => {});
      window.removeEventListener('pointerdown', request);
      window.removeEventListener('keydown',     request);
    };
    window.addEventListener('pointerdown', request, { once: true });
    window.addEventListener('keydown',     request, { once: true });
    return () => {
      window.removeEventListener('pointerdown', request);
      window.removeEventListener('keydown',     request);
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
      if (document.visibilityState !== 'visible') {
        notifyRealtime({
          title: 'Actualización de pedido',
          body:  data?.status ? `Estado: ${data.status}` : 'Tu pedido fue actualizado',
          tag: 'order_updates', group: 'order_updates', url: '/customer/pedidos',
          vibrate: VIBRATE.normal,
        });
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
      if (document.visibilityState !== 'visible') {
        notifyRealtime({
          title: 'Nueva oferta de pedido',
          body: data?.restaurantName
            ? `Pedido de ${data.restaurantName}`
            : 'Tienes un pedido por aceptar',
          tag: data?.orderId ? `offer_${data.orderId}` : 'offers',
          group: 'driver', url: '/driver',
          vibrate: VIBRATE.offer, pushType: 'new_offer',
          orderId: data?.orderId,
          actions: [{ action: 'accept', title: 'Aceptar' }, { action: 'reject', title: 'Rechazar' }],
        });
      }
    });

    on('new_order', (data) => {
      cb.current.newOrder?.(data);
      alertNewOrder();
      if (document.visibilityState !== 'visible') {
        notifyRealtime({
          title: 'Nuevo pedido', body: 'Pedido recibido — confirma para preparar',
          tag: `new_order_${data.orderId}`, group: 'kitchen', url: '/restaurant/pedidos',
          vibrate: VIBRATE.new_order, pushType: 'new_order', orderId: data.orderId,
          actions: [{ action: 'confirm', title: '✓ Confirmar' }],
        });
      }
    });

    on('driver_eta_alert', (data) => {
      cb.current.eta?.(data);
      alertEta();
      if (document.visibilityState !== 'visible') {
        notifyRealtime({
          title: 'Tu repartidor se acerca',
          body:  data.message || `Llegará en aprox. ${data.etaMins} min`,
          tag: `eta_${data.orderId}`, group: 'customer', url: '/customer/pedidos',
          vibrate: VIBRATE.eta_alert, pushType: 'driver_eta_alert', orderId: data.orderId,
          actions: [{ action: 'message', title: '💬 Mensaje' }],
        });
      }
    });

    on('driver_arrived', (data) => {
      cb.current.arrived?.(data);
      // Diferenciar: si el target es restaurante o cliente
      if (data.target === 'pickup') {
        alertDriverArrivedRestaurant();
      } else {
        alertDriverArrivedCustomer();
      }
      if (document.visibilityState !== 'visible') {
        const isPickup = data.target === 'pickup';
        notifyRealtime({
          title: isPickup ? '🛵 Conductor llegó a recoger' : '📍 Tu repartidor llegó',
          body:  data.message || (isPickup ? 'El conductor está en el restaurante' : 'El conductor está afuera'),
          tag: `arrived_${data.orderId}`, group: isPickup ? 'kitchen' : 'customer',
          url: isPickup ? '/restaurant/pedidos' : '/customer/pedidos',
          vibrate: isPickup ? VIBRATE.driver_arrived_restaurant : VIBRATE.driver_arrived_customer,
          pushType: 'driver_arrived', orderId: data.orderId,
          actions: [{ action: 'message', title: '💬 Mensaje' }],
        });
      }
    });

    on('simulated_call', (data) => {
      cb.current.call?.(data);
      alertCall();
      notifyCall({ orderId: data.orderId, driverName: data.driverName, url: '/' });
    });

    on('offer_cancelled', (data) => cb.current.update?.(data));
    on('offer_assigned',  (data) => cb.current.update?.(data));

    on('kitchen_auto_ready', (data) => {
      cb.current.kitchen?.({ type: 'kitchen_auto_ready', ...data });
      if (document.visibilityState !== 'visible') {
        notifyRealtime({
          title: 'Pedido listo para recoger', body: data.message || '',
          tag: 'kitchen', group: 'kitchen', url: '/restaurant/pedidos',
          vibrate: VIBRATE.confirm,
        });
      }
    });

    on('prep_estimate_updated', (data) => cb.current.kitchen?.({ type: 'prep_estimate_updated', ...data }));

    on('order_transferred_away', (data) => {
      cb.current.transfer?.({ type: 'order_transferred_away', ...data });
      cb.current.update?.(data);
      navigator?.vibrate?.(VIBRATE.transfer);
      if (document.visibilityState !== 'visible') {
        notifyRealtime({
          title: 'Pedido reasignado', body: 'Un pedido fue transferido a otro conductor',
          tag: 'driver', group: 'driver', url: '/driver',
          vibrate: VIBRATE.transfer, pushType: 'reassigned',
        });
      }
    });

    on('order_transferred_in', (data) => {
      cb.current.transfer?.({ type: 'order_transferred_in', ...data });
      cb.current.update?.(data);
      if (document.visibilityState !== 'visible') {
        notifyRealtime({
          title: 'Nuevo pedido asignado', body: 'Se te asignó un pedido transferido',
          tag: 'offers', group: 'driver', url: '/driver',
          vibrate: VIBRATE.offer,
        });
      }
    });

    // Secuencia óptima de stops calculada por el motor de ruteo del backend.
    // No genera notificación — actualiza la navegación del driver en tiempo real.
    on('route_update', (data) => {
      cb.current.routeUpdate?.(data);
    });

    on('chat_message', (data) => {
      cb.current.chat?.(data);
      if (document.visibilityState !== 'visible') {
        notifyRealtime({
          title: `Mensaje de ${data.senderName || 'soporte'}`,
          body: data.text || 'Tienes un nuevo mensaje',
          tag: 'chat', group: 'chat', url: '/customer/pedidos',
          vibrate: VIBRATE.support,
        });
      }
    });

    on('support_message', (data) => {
      cb.current.support?.(data);
      if (document.visibilityState !== 'visible') {
        notifyRealtime({
          title: 'Soporte', body: data.text || 'Nuevo mensaje de soporte',
          tag: 'support', group: 'support', url: '/profile',
          vibrate: VIBRATE.support,
        });
      }
    });

    on('driver_arrival', (data) => {
      cb.current.kitchen?.({ type: 'driver_arrival', ...data });
      alertDriverArrivedRestaurant();
      if (document.visibilityState !== 'visible') {
        notifyRealtime({
          title: 'Conductor llegó', body: `${data.driverName || 'El conductor'} recogió el pedido`,
          tag: 'kitchen', group: 'kitchen', url: '/restaurant',
          vibrate: VIBRATE.driver_arrived_restaurant,
        });
      }
    });

    on('order_cancelled_preparing', (data) => {
      cb.current.kitchen?.({ type: 'order_cancelled_preparing', ...data });
      playUrgentAlert();
      navigator?.vibrate?.(VIBRATE.cancelled);
      if (document.visibilityState !== 'visible') {
        notifyRealtime({
          title: 'Pedido cancelado',
          body: 'El cliente canceló mientras estabas preparando',
          tag: 'kitchen_cancel', group: 'kitchen', url: '/restaurant',
          vibrate: VIBRATE.cancelled, priority: 'high',
        });
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

