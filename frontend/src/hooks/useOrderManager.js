// hooks/useOrderManager.js — lógica de pedidos extraída de DriverHome
// Agrupa: loadData, accept/reject offer, changeStatus, doRelease,
//         announceListener, SSE via useRealtimeOrders, alertas de oferta

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api/client';
import { useRealtimeOrders } from './useRealtimeOrders';
import { playOfferAlertSound } from '../utils/audio';
import { getNotifPriorityMode } from '../utils/format';

export function useOrderManager(token, patchUser, userDriver) {
  const [activeOrder,    setActiveOrder]    = useState(null);
  const [availability,   setAvailability]   = useState(false);
  const [pendingOffer,   setPendingOffer]   = useState(null);
  const [offerMinimized, setOfferMinimized] = useState(false);
  const [loadingOffer,   setLoadingOffer]   = useState(false);
  const [loadingStatus,  setLoadingStatus]  = useState('');
  const [releaseNote,    setReleaseNote]    = useState('');
  const [showRelease,    setShowRelease]    = useState(false);
  const [orderExpanded,  setOrderExpanded]  = useState(false);
  const [notifPermission, setNotifPermission] = useState(
    typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission : 'unsupported'
  );
  const [notifPriorityMode, setNotifPriorityMode] = useState(getNotifPriorityMode);

  const loadDataRef            = useRef(null);
  const loadDebounceRef        = useRef(null);
  const tokenRef               = useRef(token);
  const availabilityRef        = useRef(availability);
  const pendingOfferRef        = useRef(pendingOffer);
  const consecutiveTimeouts    = useRef(0);
  const lastOfferAlertRef      = useRef(null);

  useEffect(() => { tokenRef.current = token; }, [token]);
  useEffect(() => { availabilityRef.current = availability; }, [availability]);
  useEffect(() => { pendingOfferRef.current = pendingOffer; }, [pendingOffer]);

  const hasActiveOrder = Boolean(
    activeOrder && !['delivered', 'cancelled'].includes(activeOrder.status)
  );
  const hasActiveOrderRef = useRef(hasActiveOrder);
  useEffect(() => { hasActiveOrderRef.current = hasActiveOrder; }, [hasActiveOrder]);

  // Notificaciones
  useEffect(() => {
    const refresh = () => {
      setNotifPriorityMode(getNotifPriorityMode());
      if ('Notification' in window) setNotifPermission(Notification.permission);
    };
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', refresh);
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('storage', refresh); };
  }, []);

  // Alerta sonora + vibración al llegar nueva oferta
  useEffect(() => {
    if (!pendingOffer?.id) return;
    if (lastOfferAlertRef.current === pendingOffer.id) return;
    lastOfferAlertRef.current = pendingOffer.id;

    playOfferAlertSound();
    const highPriority = notifPriorityMode === 'high' || notifPermission === 'granted';
    if (navigator?.vibrate) {
      navigator.vibrate(highPriority ? [300, 100, 300, 100, 300] : [180, 80, 180]);
    }
  }, [pendingOffer?.id, notifPriorityMode, notifPermission]);

  // Debounced load
  function scheduleLoad() {
    if (loadDebounceRef.current) clearTimeout(loadDebounceRef.current);
    loadDebounceRef.current = setTimeout(() => {
      loadDebounceRef.current = null;
      loadDataRef.current?.();
    }, 800);
  }

  const loadData = useCallback(async () => {
    if (!token) return;
    try {
      const [od, off] = await Promise.all([
        apiFetch('/orders/my?active=1', {}, token),
        apiFetch('/drivers/offers',     {}, token),
      ]);
      const active = (od.orders || [])
        .filter(o => !['delivered', 'cancelled'].includes(o.status))
        .sort((a, b) => new Date(a.accepted_at || a.created_at) - new Date(b.accepted_at || b.created_at))[0] || null;
      setActiveOrder(active);
      const newOffer = (off.offers || []).length > 0 ? off.offers[0] : null;
      setPendingOffer(prev => {
        if (newOffer?.id !== prev?.id) setOfferMinimized(false);
        return newOffer;
      });
    } catch (_) {}
  }, [token]);

  useEffect(() => { loadDataRef.current = loadData; });

  // Carga inicial + perfil de disponibilidad
  useEffect(() => {
    setAvailability(Boolean(userDriver?.is_available));
    loadData();
    if (!token) return;
    apiFetch('/drivers/me', {}, token)
      .then(d => {
        const fresh = Boolean(d?.profile?.is_available);
        setAvailability(fresh);
        patchUser({ driver: { ...(userDriver || {}), is_available: fresh } });
      }).catch(() => {});
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Listener periódico
  const announceListener = useCallback(async () => {
    if (!tokenRef.current) return;
    try { await apiFetch('/drivers/listener', { method: 'POST' }, tokenRef.current); loadDataRef.current?.(); }
    catch (_) {}
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (!availabilityRef.current || pendingOfferRef.current || hasActiveOrderRef.current) return;
      announceListener();
    }, 4000);
    setTimeout(() => {
      if (availabilityRef.current && !pendingOfferRef.current && !hasActiveOrderRef.current)
        announceListener();
    }, 500);
    return () => clearInterval(id);
  }, [announceListener]);

  const [transferBanner, setTransferBanner] = useState(null); // { type, message, orderId }

  const handleNewOffer = useCallback((data) => {
    setPendingOffer(prev => prev ? prev : { id: data.orderId, ...data, seconds_left: data.secondsLeft ?? 60 });
    setTimeout(() => loadDataRef.current?.(), 600);
  }, []);

  const handleTransferEvent = useCallback((data) => {
    setTransferBanner(data);
    // Auto-dismiss después de 8 segundos
    setTimeout(() => setTransferBanner(null), 8_000);
    // Recargar para reflejar el cambio
    setTimeout(() => loadDataRef.current?.(), 800);
  }, []);

  useRealtimeOrders(token, () => scheduleLoad(), () => {}, handleNewOffer, undefined, undefined, undefined, handleTransferEvent);

  // Acciones
  async function toggleAvailability(onError) {
    try {
      const r = await apiFetch('/drivers/availability',
        { method: 'PATCH', body: JSON.stringify({ isAvailable: !availability }) }, token);
      const next = Boolean(r?.profile?.is_available);
      setAvailability(next);
      patchUser({ driver: { ...(userDriver || {}), is_available: next } });
    } catch (e) { onError?.(e.message); }
  }

  async function acceptOffer(onError) {
    if (!pendingOffer) return;
    consecutiveTimeouts.current = 0;
    setLoadingOffer(true);
    try {
      await apiFetch(`/drivers/offers/${pendingOffer.id}/accept`, { method: 'POST' }, token);
      setPendingOffer(null); setOfferMinimized(false); setOrderExpanded(false); loadData();
    } catch (e) { onError?.(e.message); }
    finally { setLoadingOffer(false); }
  }

  async function rejectOffer(onError) {
    if (!pendingOffer) return;
    consecutiveTimeouts.current = 0;
    setLoadingOffer(true);
    try {
      await apiFetch(`/drivers/offers/${pendingOffer.id}/reject`, { method: 'POST' }, token);
      setPendingOffer(null); loadData();
    } catch (e) { onError?.(e.message); }
    finally { setLoadingOffer(false); }
  }

  // GPS grace window: track last time driver was within radius
  const graceTimestampRef = useRef({}); // { 'on_the_way': epochMs, 'delivered': epochMs }
  const GRACE_MS = 3 * 60 * 1000; // 3 min
  const MAX_RADIUS_M = 100;

  function haversineM(lat1, lng1, lat2, lng2) {
    const toRad = x => x * Math.PI / 180;
    const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  async function changeStatus(orderId, status, onError) {
    setLoadingStatus(status);
    try {
      const body = { status };

      // For critical driver transitions, attach GPS + grace flag
      if (['on_the_way', 'delivered'].includes(status)) {
        await new Promise(resolve => {
          if (!navigator.geolocation) { resolve(); return; }
          navigator.geolocation.getCurrentPosition(
            pos => {
              body.lat = pos.coords.latitude;
              body.lng = pos.coords.longitude;

              // Check grace window: if driver was within radius recently, set grace=true
              const order = activeOrder;
              const refLat = status === 'on_the_way' ? order?.restaurant_lat : order?.delivery_lat;
              const refLng = status === 'on_the_way' ? order?.restaurant_lng : order?.delivery_lng;

              if (refLat && refLng) {
                const distM = haversineM(body.lat, body.lng, Number(refLat), Number(refLng));
                if (distM <= MAX_RADIUS_M) {
                  // Within radius now — update grace timestamp
                  graceTimestampRef.current[status] = Date.now();
                } else {
                  // Outside — check if was within radius recently
                  const lastIn = graceTimestampRef.current[status];
                  if (lastIn && Date.now() - lastIn <= GRACE_MS) {
                    body.grace = true;
                  }
                }
              }
              resolve();
            },
            () => resolve(), // GPS error — let backend decide (no coords = graceful degrade)
            { timeout: 3000, maximumAge: 15000 }
          );
        });
      }

      await apiFetch(`/orders/${orderId}/status`,
        { method: 'PATCH', body: JSON.stringify(body) }, token);
      loadData();
    } catch (e) { onError?.(e.message); }
    finally { setLoadingStatus(''); }
  }

  async function doRelease(onError) {
    if (!activeOrder) return;
    try {
      await apiFetch(`/drivers/orders/${activeOrder.id}/release`,
        { method: 'POST', body: JSON.stringify({ note: releaseNote }) }, token);
      setShowRelease(false); setReleaseNote(''); loadData();
    } catch (e) { onError?.(e.message); }
  }

  async function doRebalance(onError) {
    if (!activeOrder || activeOrder.picked_up_at) return;
    try {
      await apiFetch(`/drivers/orders/${activeOrder.id}/rebalance`,
        { method: 'POST' }, token);
      // Refrescar para mostrar badge "En disputa"
      loadData();
    } catch (e) { onError?.(e.message); }
  }

  function handleOfferExpired() {
    setPendingOffer(null); loadData();
    consecutiveTimeouts.current += 1;
    if (consecutiveTimeouts.current >= 3) {
      consecutiveTimeouts.current = 0;
      return 'Se han vencido 3 ofertas seguidas.';
    }
    return null;
  }

  return {
    // Estado
    activeOrder, availability, pendingOffer, offerMinimized, loadingOffer,
    loadingStatus, releaseNote, showRelease, orderExpanded,
    notifPermission, notifPriorityMode, hasActiveOrder,
    transferBanner,
    // Setters de UI
    setOfferMinimized, setOrderExpanded, setShowRelease, setReleaseNote,
    setTransferBanner,
    // Acciones
    loadData, toggleAvailability, acceptOffer, rejectOffer,
    changeStatus, doRelease, doRebalance, handleOfferExpired,
  };
}
