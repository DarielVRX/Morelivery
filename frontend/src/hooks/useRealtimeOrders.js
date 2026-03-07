// frontend/src/hooks/useRealtimeOrders.js
import { useCallback, useEffect, useRef } from 'react';
import { API_BASE } from '../api/client';

/**
 * SSE listener central.
 * onOrderUpdate(data)    — order_update / offer_assigned (admin)
 * onDriverLocation(data) — driver_location
 * onNewOffer(data)       — new_offer  (driver: oferta entrante sin esperar poll)
 * onChatMessage(data)    — chat_message
 */
export function useRealtimeOrders(token, onOrderUpdate, onDriverLocation, onNewOffer, onChatMessage) {
  const esRef          = useRef(null);
  const reconnectTimer = useRef(null);
  const mountedRef     = useRef(true);
  const retryCount     = useRef(0);

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
      // admin: oferta asignada a driver — reutiliza el mismo callback
      try { onOrderUpdate?.(JSON.parse(e.data)); } catch (_) {}
    });
    es.addEventListener('chat_message', (e) => {
      try { onChatMessage?.(JSON.parse(e.data)); } catch (_) {}
    });
    es.addEventListener('connected', () => {
      retryCount.current = 0;
      clearTimeout(reconnectTimer.current);
    });

    es.onerror = () => {
      es.close();
      esRef.current = null;
      if (!mountedRef.current) return;

      clearTimeout(reconnectTimer.current);

      // Backoff exponencial: 5s, 10s, 20s… hasta máximo 30s
      const delay = Math.min(5000 * Math.pow(2, retryCount.current), 30000);
      retryCount.current++;

      console.warn(`SSE Error. Reintentando en ${delay / 1000}s... (Intento ${retryCount.current})`);
      reconnectTimer.current = setTimeout(connect, delay);
    };
  }, [token]); // solo token como dependencia — los callbacks se llaman por referencia

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
