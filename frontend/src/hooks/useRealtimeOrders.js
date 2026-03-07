// frontend/src/hooks/useRealtimeOrders.js
import { useCallback, useEffect, useRef } from 'react';
import { API_BASE } from '../api/client';

/**
 * SSE listener central.
 * onOrderUpdate(data)    — order_update
 * onDriverLocation(data) — driver_location
 * onNewOffer(data)       — new_offer  (driver: oferta entrante sin esperar poll)
 * onChatMessage(data)    — chat_message
 */
export function useRealtimeOrders(token, onOrderUpdate, onDriverLocation, onNewOffer, onChatMessage) {
  const esRef          = useRef(null);
  const reconnectTimer = useRef(null);
  const mountedRef     = useRef(true);

  const connect = useCallback(() => {
    if (!token || !mountedRef.current) return;
    if (esRef.current) { esRef.current.close(); esRef.current = null; }

    const url = `${API_BASE}/events?token=${encodeURIComponent(token)}`;
    const es  = new EventSource(url);
    esRef.current = es;

    es.addEventListener('order_update', (e) => {
      try { onOrderUpdate?.(JSON.parse(e.data)); } catch (_) {}
    });
    es.addEventListener('driver_location', (e) => {
      try { onDriverLocation?.(JSON.parse(e.data)); } catch (_) {}
    });
    es.addEventListener('new_offer', (e) => {
      try { onNewOffer?.(JSON.parse(e.data)); } catch (_) {}
    });
    es.addEventListener('offer_assigned', (e) => {
      // admin: oferta asignada a driver
      try { onOrderUpdate?.(JSON.parse(e.data)); } catch (_) {}
    });
    es.addEventListener('chat_message', (e) => {
      try { onChatMessage?.(JSON.parse(e.data)); } catch (_) {}
    });
    es.addEventListener('connected', () => {
      clearTimeout(reconnectTimer.current);
    });
    es.onerror = () => {
      es.close(); esRef.current = null;
      if (!mountedRef.current) return;
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = setTimeout(connect, 4000);
    };
  }, [token]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      clearTimeout(reconnectTimer.current);
      esRef.current?.close();
      esRef.current = null;
    };
  }, [connect]);
}
