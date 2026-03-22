import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { apiFetch } from '../api/client';
import { useRealtimeOrders } from './useRealtimeOrders';
import { haversineMeters } from '../utils/geo';

const ACTIVE_ORDER_STATUSES = ['delivered', 'cancelled'];
const STATUS_WITH_GPS = ['on_the_way', 'delivered'];
const MAX_RADIUS_M = 100;
const GRACE_MS = 3 * 60 * 1000;

export function useDriverOrders(token) {
  const [orders, setOrders] = useState([]);
  const [waitingOrders, setWaitingOrders] = useState([]);
  const [actionMsg, setActionMsg] = useState('');
  const [actionLoading, setActionLoading] = useState(null);
  const [rebalancingId, setRebalancingId] = useState(null);
  const [chatTick, setChatTick] = useState(0);

  const loadDataRef = useRef(null);
  const chatOpenRef = useRef(null);
  const graceRef = useRef({});

  const active = useMemo(
    () => orders.filter((order) => !ACTIVE_ORDER_STATUSES.includes(order.status)),
    [orders]
  );
  const past = useMemo(
    () => orders.filter((order) => ACTIVE_ORDER_STATUSES.includes(order.status)),
    [orders]
  );
  const activeIds = useMemo(() => new Set(active.map((order) => order.id)), [active]);
  const unoffered = useMemo(
    () => waitingOrders.filter((order) => !activeIds.has(order.id)),
    [waitingOrders, activeIds]
  );
  const activeOrderId = useMemo(() => {
    if (active.length === 0) return null;
    return [...active].sort(
      (a, b) => new Date(a.accepted_at || a.created_at) - new Date(b.accepted_at || b.created_at)
    )[0]?.id ?? null;
  }, [active]);

  const loadData = useCallback(async () => {
    if (!token) return;
    try {
      const [myOrders, pending] = await Promise.all([
        apiFetch('/orders/my', {}, token),
        apiFetch('/orders/pending-assignment', {}, token).catch(() => ({ orders: [] })),
      ]);
      setOrders(myOrders.orders || []);
      setWaitingOrders(pending.orders || []);
    } catch (_) {}
  }, [token]);

  useEffect(() => {
    loadDataRef.current = loadData;
  }, [loadData]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!token) return;
    const id = setInterval(() => loadDataRef.current?.(), 5000);
    return () => clearInterval(id);
  }, [token]);

  useRealtimeOrders(
    token,
    () => loadDataRef.current?.(),
    () => {},
    undefined,
    (data) => {
      if (data.orderId === chatOpenRef.current) {
        setChatTick((value) => value + 1);
      }
    },
  );

  const setChatOpen = useCallback((valueOrUpdater) => {
    const nextValue = typeof valueOrUpdater === 'function'
      ? valueOrUpdater(chatOpenRef.current)
      : valueOrUpdater;
    chatOpenRef.current = nextValue;
    return nextValue;
  }, []);

  async function sendReport(orderId, reportText, onSuccess) {
    if (!reportText.trim()) return;
    try {
      await apiFetch(`/orders/${orderId}/report`, {
        method: 'POST',
        body: JSON.stringify({ text: reportText, reason: 'driver_report' }),
      }, token);
      onSuccess?.();
    } catch (error) {
      setActionMsg(error.message);
    }
  }

  async function getGpsBody(status, order) {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve({});
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const body = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          const refLat = status === 'on_the_way' ? order?.restaurant_lat : order?.delivery_lat;
          const refLng = status === 'on_the_way' ? order?.restaurant_lng : order?.delivery_lng;
          if (refLat && refLng) {
            const distM = haversineMeters(body.lat, body.lng, Number(refLat), Number(refLng));
            if (distM <= MAX_RADIUS_M) {
              graceRef.current[status] = Date.now();
            } else {
              const lastIn = graceRef.current[status];
              if (lastIn && Date.now() - lastIn <= GRACE_MS) {
                body.grace = true;
              }
            }
          }
          resolve(body);
        },
        () => resolve({}),
        { timeout: 3000, maximumAge: 15000 }
      );
    });
  }

  async function changeStatusWithGps(orderId, status, order) {
    setActionLoading(orderId);
    try {
      const gps = STATUS_WITH_GPS.includes(status) ? await getGpsBody(status, order) : {};
      await apiFetch(`/orders/${orderId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, ...gps }),
      }, token);
      loadDataRef.current?.();
    } catch (error) {
      setActionMsg(error.message);
    } finally {
      setActionLoading(null);
    }
  }

  async function doRebalance(orderId) {
    setRebalancingId(orderId);
    try {
      await apiFetch(`/drivers/orders/${orderId}/rebalance`, { method: 'POST' }, token);
      setActionMsg('Pedido en disputa — si alguien lo toma se te notifica.');
      loadDataRef.current?.();
      setTimeout(() => setActionMsg(''), 5000);
    } catch (error) {
      setActionMsg(error.message || 'Error al solicitar rebalanceo');
    } finally {
      setRebalancingId(null);
    }
  }

  async function acceptDirectly(orderId) {
    setActionLoading(orderId);
    try {
      await apiFetch(`/drivers/orders/${orderId}/claim`, { method: 'POST' }, token);
      setActionMsg('Pedido aceptado ✓');
      loadDataRef.current?.();
      setTimeout(() => setActionMsg(''), 3000);
    } catch (error) {
      setActionMsg(error.message || 'Error al aceptar');
    } finally {
      setActionLoading(null);
    }
  }

  async function releaseOrder(orderId, releaseNote, onSuccess) {
    if (!releaseNote.trim()) {
      setActionMsg('Escribe una nota antes de liberar');
      return;
    }
    setActionLoading(orderId);
    try {
      await apiFetch(`/drivers/orders/${orderId}/release`, {
        method: 'POST',
        body: JSON.stringify({ note: releaseNote.trim() }),
      }, token);
      onSuccess?.();
      setActionMsg('Pedido liberado');
      loadDataRef.current?.();
      setTimeout(() => setActionMsg(''), 3000);
    } catch (error) {
      setActionMsg(error.message);
    } finally {
      setActionLoading(null);
    }
  }

  return {
    orders,
    waitingOrders,
    active,
    past,
    unoffered,
    activeOrderId,
    actionMsg,
    actionLoading,
    rebalancingId,
    chatTick,
    loadData,
    setActionMsg,
    sendReport,
    changeStatusWithGps,
    doRebalance,
    acceptDirectly,
    releaseOrder,
    setChatOpen,
  };
}
