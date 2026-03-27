// frontend/src/features/admin/dashboard/tabs/SupportTab.jsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE } from '../../../../api/client';
import SupportChat from '../../../support/SupportChat';

export default function SupportTab({ token }) {
  const [refreshTick, setRefreshTick] = useState(0);
  const [unread,      setUnread]      = useState(0);
  const esRef      = useRef(null);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!token || !mountedRef.current) return;
    if (esRef.current) { esRef.current.close(); esRef.current = null; }

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

  useEffect(() => { setUnread(0); }, []);

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
