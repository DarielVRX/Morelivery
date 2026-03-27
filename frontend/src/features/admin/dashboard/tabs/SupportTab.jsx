// frontend/src/features/admin/dashboard/tabs/SupportTab.jsx
// Panel de soporte en el admin dashboard.
// Reutiliza SupportChat que ya existe — el admin ve TODOS los tickets abiertos.
// Agrega push al admin cuando llega un mensaje nuevo via SSE support_message.

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, API_BASE  } from '../../../../api/client';
import { useAuth } from '../../../../contexts/AuthContext';
import SupportChat from '../../../support/SupportChat';

export default function SupportTab({ token }) {
  // refreshTick se incrementa cuando llega un nuevo mensaje via SSE
  // para que SupportChat recargue sin necesitar polling
  const [refreshTick, setRefreshTick] = useState(0);
  const [unread,      setUnread]      = useState(0);
  const esRef         = useRef(null);
  const mountedRef    = useRef(true);

  // SSE listener dedicado para support_message
  const connect = useCallback(() => {
    if (!token || !mountedRef.current) return;
    if (esRef.current) { esRef.current.close(); esRef.current = null; }

    // Reusar la conexión SSE global si está disponible
    // En su defecto, abrir una conexión propia solo para este tab
    const url = `${API_BASE}/api/events?token=${encodeURIComponent(token)}`;
    const es  = new EventSource(url);
    esRef.current = es;

    es.addEventListener('support_message', () => {
      setRefreshTick(t => t + 1);
      setUnread(u => u + 1);
    });

    es.onerror = () => {
      es.close(); esRef.current = null;
      if (mountedRef.current) setTimeout(connect, 5000);
    };
  }, [token]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      esRef.current?.close();
    };
  }, [connect]);

  // Limpiar contador al enfocar el tab
  useEffect(() => {
    setUnread(0);
  }, []);

  // Enviar push al admin cuando responde a un ticket
  // (ya está implementado en el backend via SSE — este hook solo maneja el frontend)

  return (
    <div style={{
      height: 'calc(100vh - 200px)',
      display: 'flex',
      flexDirection: 'column',
      border: '1px solid var(--border)',
      borderRadius: 10,
      overflow: 'hidden',
    }}>
      <SupportChat refreshTick={refreshTick} />
    </div>
  );
}
