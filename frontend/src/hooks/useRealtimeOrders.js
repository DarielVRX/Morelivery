// frontend/src/hooks/useRealtimeOrders.js
import { useCallback, useEffect, useRef } from 'react';
import { API_BASE } from '../api/client';

export function useRealtimeOrders(token, onOrderUpdate, onDriverLocation, onNewOffer, onChatMessage) {
  const esRef          = useRef(null);
  const reconnectTimer = useRef(null);
  const mountedRef     = useRef(true);
  const retryCount     = useRef(0); // <-- Nuevo: para rastrear intentos fallidos

  const connect = useCallback(() => {
    if (!token || !mountedRef.current) return;
    if (esRef.current) { esRef.current.close(); esRef.current = null; }

    const url = `${API_BASE}/events?token=${encodeURIComponent(token)}`;
    const es  = new EventSource(url);
    esRef.current = es;

    // ... (tus event listeners de order_update, chat, etc. se mantienen igual)

    es.addEventListener('connected', () => {
      retryCount.current = 0; // <-- Resetear contador al conectar con éxito
      clearTimeout(reconnectTimer.current);
    });

    es.onerror = () => {
      es.close();
      esRef.current = null;
      if (!mountedRef.current) return;

      clearTimeout(reconnectTimer.current);

      // Backoff exponencial: 5s, 10s, 20s... hasta un máximo de 30s
      const delay = Math.min(5000 * Math.pow(2, retryCount.current), 30000);
      retryCount.current++;

      console.warn(`SSE Error. Reintentando en ${delay / 1000}s... (Intento ${retryCount.current})`);
      reconnectTimer.current = setTimeout(connect, delay);
    };
  }, [token, onOrderUpdate, onDriverLocation, onNewOffer, onChatMessage]); // Añade las dependencias aquí

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
