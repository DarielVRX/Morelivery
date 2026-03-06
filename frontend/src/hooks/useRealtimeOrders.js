// frontend/src/hooks/useRealtimeOrders.js
import { useCallback, useEffect, useRef } from 'react';
import { API_BASE } from '../api/client';

/**
 * Abre una conexi\u00f3n SSE y llama onOrderUpdate / onDriverLocation cuando llegan eventos.
 * Se reconecta autom\u00e1ticamente si se cae la conexi\u00f3n.
 *
 * @param {string|null} token  \u2014 JWT del usuario autenticado
 * @param {function} onOrderUpdate   \u2014 fn({ orderId, status, action? })
 * @param {function} onDriverLocation \u2014 fn({ orderId, driverId, lat, lng })
 */
export function useRealtimeOrders(token, onOrderUpdate, onDriverLocation) {
  const esRef = useRef(null);
  const reconnectTimer = useRef(null);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!token || !mountedRef.current) return;
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const url = `${API_BASE}/events?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener('order_update', (e) => {
      try { onOrderUpdate?.(JSON.parse(e.data)); } catch (_) {}
    });

    es.addEventListener('driver_location', (e) => {
      try { onDriverLocation?.(JSON.parse(e.data)); } catch (_) {}
    });

    es.addEventListener('connected', () => {
      clearTimeout(reconnectTimer.current);
    });

    es.onerror = () => {
      es.close();
      esRef.current = null;
      if (!mountedRef.current) return;
      // Reconectar tras 4 segundos
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
