// frontend/src/hooks/useRealtimeOrders.js
import { useCallback, useEffect, useRef } from 'react';
import { API_BASE } from '../api/client';

/**
 * SSE listener central — una sola conexión estable por token.
 *
 * CRÍTICO: los callbacks se guardan en refs para que connect() no tenga
 * dependencias cambiantes y NO se recree el SSE en cada render.
 *
 * onOrderUpdate(data)    — order_update / offer_assigned
 * onDriverLocation(data) — driver_location
 * onNewOffer(data)       — new_offer  (push sin esperar poll)
 * onChatMessage(data)    — chat_message
 */
export function useRealtimeOrders(token, onOrderUpdate, onDriverLocation, onNewOffer, onChatMessage) {
  const esRef          = useRef(null);
  const reconnectTimer = useRef(null);
  const mountedRef     = useRef(true);
  const retryCount     = useRef(0);

  // Guardar callbacks en refs para que connect() no dependa de ellos
  // y no se destruya/recree el SSE cuando cambian los callbacks
  const cbUpdate   = useRef(onOrderUpdate);
  const cbLocation = useRef(onDriverLocation);
  const cbOffer    = useRef(onNewOffer);
  const cbChat     = useRef(onChatMessage);

  // Actualizar refs cuando cambian los callbacks (sin re-conectar)
  useEffect(() => { cbUpdate.current   = onOrderUpdate;    }, [onOrderUpdate]);
  useEffect(() => { cbLocation.current = onDriverLocation; }, [onDriverLocation]);
  useEffect(() => { cbOffer.current    = onNewOffer;       }, [onNewOffer]);
  useEffect(() => { cbChat.current     = onChatMessage;    }, [onChatMessage]);

  const connect = useCallback(() => {
    if (!token || !mountedRef.current) return;
    if (esRef.current) { esRef.current.close(); esRef.current = null; }

    const url = `${API_BASE}/events?token=${encodeURIComponent(token)}`;
    console.log(`📡 [SSE] conectando (intento ${retryCount.current + 1})`);
    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener('order_update', (e) => {
      try { cbUpdate.current?.(JSON.parse(e.data)); } catch (_) {}
    });
    es.addEventListener('driver_location', (e) => {
      try { cbLocation.current?.(JSON.parse(e.data)); } catch (_) {}
    });
    es.addEventListener('new_offer', (e) => {
      try {
        const data = JSON.parse(e.data);
        console.log(`[SSE] new_offer received orderId=${data.orderId} secondsLeft=${data.secondsLeft}`);
        cbOffer.current?.(data);
      } catch (_) {}
    });
    es.addEventListener('offer_assigned', (e) => {
      try { cbUpdate.current?.(JSON.parse(e.data)); } catch (_) {}
    });
    es.addEventListener('chat_message', (e) => {
      try { cbChat.current?.(JSON.parse(e.data)); } catch (_) {}
    });
    es.addEventListener('connected', () => {
      retryCount.current = 0;
      console.log('📡 [SSE] conexión establecida');
      clearTimeout(reconnectTimer.current);
    });

    es.onerror = () => {
      es.close();
      esRef.current = null;
      if (!mountedRef.current) return;
      clearTimeout(reconnectTimer.current);
      // Backoff exponencial: 4s, 8s, 16s… máximo 30s
      const delay = Math.min(4000 * Math.pow(2, retryCount.current), 30000);
      retryCount.current++;
      console.warn(`📡 [SSE] error — reintentando en ${delay / 1000}s (intento ${retryCount.current})`);
      reconnectTimer.current = setTimeout(connect, delay);
    };
  }, [token]); // SOLO token como dependencia — no los callbacks

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
