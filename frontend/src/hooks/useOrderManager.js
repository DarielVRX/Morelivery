// hooks/useOrderManager.js — lógica de pedidos extraída de DriverHome
// Agrupa: loadData, accept/reject offer, changeStatus, doRelease, doRebalance, doCancelDispute,
//         SSE via useRealtimeOrders, alertas de oferta

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api/client';
import { useRealtimeOrders } from './useRealtimeOrders';
import { playOfferAlertSound } from '../utils/audio';
import { haversineMeters } from '../utils/geo';
import { getNotifPriorityMode } from '../utils/format';

export function useOrderManager(token, patchUser, userDriver) {
  const [activeOrder,    setActiveOrder]    = useState(null);
  const [activeOrders,   setActiveOrders]   = useState([]);
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
  const myPositionRef          = useRef(null);
  const loadDebounceRef        = useRef(null);
  const consecutiveTimeouts    = useRef(0);
  const lastOfferAlertRef      = useRef(null);

  // Registradores para que useDriverOrders (DriverOrders panel) reciba eventos SSE
  const ordersUpdateListenerRef    = useRef(null);
  const ordersReconnectListenerRef = useRef(null);
  const ordersChatListenerRef      = useRef(null);

  const registerOrdersUpdate    = useCallback((fn) => { ordersUpdateListenerRef.current    = fn; }, []);
  const registerOrdersReconnect = useCallback((fn) => { ordersReconnectListenerRef.current = fn; }, []);
  const registerOrdersChat      = useCallback((fn) => { ordersChatListenerRef.current      = fn; }, []);

  const hasActiveOrder = Boolean(
    activeOrder && !['delivered', 'cancelled'].includes(activeOrder.status)
  );

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
      const orders = (od.orders || []).filter(o => !['delivered', 'cancelled'].includes(o.status));
      setActiveOrders(orders);
      // Stop más próximo: si hay posición GPS, mostrar el pedido cuyo próximo stop esté más cerca
      const active = (() => {
        if (!orders.length) return null;
        if (orders.length === 1) return orders[0];
        const pos = myPositionRef.current;
        if (!pos) {
          return orders.sort((a, b) => new Date(a.accepted_at || a.created_at) - new Date(b.accepted_at || b.created_at))[0];
        }
        return orders.reduce((best, o) => {
          const isOTW = o.status === 'on_the_way';
          const sLat = isOTW ? Number(o.customer_lat)    : Number(o.restaurant_lat);
          const sLng = isOTW ? Number(o.customer_lng)    : Number(o.restaurant_lng);
          if (!sLat || !sLng) return best;
          const dist = haversineMeters(pos.lat, pos.lng, sLat, sLng);
          const bLat = best._nextStopLat;
          const bLng = best._nextStopLng;
          const bestDist = (bLat && bLng) ? haversineMeters(pos.lat, pos.lng, bLat, bLng) : Infinity;
          if (dist < bestDist) { o._nextStopLat = sLat; o._nextStopLng = sLng; return o; }
          return best;
        }, orders[0]);
      })();
      setActiveOrder(active);
      if (!active) setRouteBagPct(null);
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

  const [transferBanner, setTransferBanner] = useState(null);
  const [routeBagPct,    setRouteBagPct]    = useState(null);

  const handleNewOffer = useCallback((data) => {
    setPendingOffer(prev => prev ? prev : { id: data.orderId, ...data, seconds_left: data.secondsLeft ?? 60 });
    setTimeout(() => loadDataRef.current?.(), 600);
  }, []);

  const handleTransferEvent = useCallback((data) => {
    setTransferBanner(data);
    setTimeout(() => setTransferBanner(null), 8_000);
    setTimeout(() => loadDataRef.current?.(), 800);
  }, []);

  const handleOrderUpdate = useCallback(() => {
    scheduleLoad();
    ordersUpdateListenerRef.current?.();
  }, []);

  const handleReconnect = useCallback(() => {
    loadDataRef.current?.();
    ordersReconnectListenerRef.current?.();
  }, []);

  const handleChatMessage = useCallback((data) => {
    ordersChatListenerRef.current?.(data);
  }, []);

  useRealtimeOrders(
    token,
    handleOrderUpdate,
    () => {},
                    handleNewOffer,
                    handleChatMessage,
                    handleReconnect,
                    undefined,
                    handleTransferEvent,
                    undefined,
  );

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

  const handleAcceptOffer = async (setMsg) => {
    if (!pendingOffer) return;
    const bagPct = pendingOffer.bagOverflowPct ?? null;
    await acceptOffer(setMsg);
    if (bagPct !== null) setRouteBagPct(bagPct);
  };

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

    const graceTimestampRef = useRef({});
    const GRACE_MS = 3 * 60 * 1000;
    const MAX_RADIUS_M = 100;

    async function changeStatus(orderId, status, onError) {
      setLoadingStatus(status);
      try {
        const body = { status };

        if (['on_the_way', 'delivered'].includes(status)) {
          await new Promise(resolve => {
            if (!navigator.geolocation) { resolve(); return; }
            navigator.geolocation.getCurrentPosition(
              pos => {
                body.lat = pos.coords.latitude;
                body.lng = pos.coords.longitude;

                const order = activeOrder;
                const refLat = status === 'on_the_way' ? order?.restaurant_lat : order?.delivery_lat;
                const refLng = status === 'on_the_way' ? order?.restaurant_lng : order?.delivery_lng;

                if (refLat && refLng) {
                  const distM = haversineMeters(body.lat, body.lng, Number(refLat), Number(refLng));
                  if (distM <= MAX_RADIUS_M) {
                    graceTimestampRef.current[status] = Date.now();
                  } else {
                    const lastIn = graceTimestampRef.current[status];
                    if (lastIn && Date.now() - lastIn <= GRACE_MS) {
                      body.grace = true;
                    }
                  }
                }
                resolve();
              },
              () => resolve(),
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
      if (releaseNote.trim().length < 10) {
        onError?.('El motivo debe tener al menos 10 caracteres');
        return;
      }
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
        loadData();
      } catch (e) { onError?.(e.message); }
    }

    async function doCancelDispute(onError) {
      if (!activeOrder || !activeOrder.is_disputed) return;
      try {
        await apiFetch(`/drivers/orders/${activeOrder.id}/cancel-dispute`,
                       { method: 'POST' }, token);
        loadData();
      } catch (e) { onError?.(e.message); }
    }

    function handleOfferExpired() {
      setPendingOffer(null); setRouteBagPct(null); loadData();
      consecutiveTimeouts.current += 1;
      if (consecutiveTimeouts.current >= 3) {
        consecutiveTimeouts.current = 0;
        return 'Se han vencido 3 ofertas seguidas.';
      }
      return null;
    }

    return {
      // Estado
      activeOrder, activeOrders, availability, pendingOffer, offerMinimized, loadingOffer,
      loadingStatus, releaseNote, showRelease, orderExpanded,
      notifPermission, notifPriorityMode, hasActiveOrder,
      transferBanner,
      // Setters de UI
      setMyPosition: (pos) => { myPositionRef.current = pos; },
      setOfferMinimized, setOrderExpanded, setShowRelease, setReleaseNote,
      setTransferBanner,
      // Estado de ruta
      routeBagPct,
      // Acciones
      loadData, toggleAvailability, acceptOffer: handleAcceptOffer, rejectOffer,
      changeStatus, doRelease, doRebalance, doCancelDispute, handleOfferExpired,
      // Registradores SSE para DriverOrders
      registerOrdersUpdate, registerOrdersReconnect, registerOrdersChat,
    };
}
