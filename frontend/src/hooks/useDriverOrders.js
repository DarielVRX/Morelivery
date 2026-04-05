import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { apiFetch } from '../api/client';
import { splitOrdersByTerminalStatus } from '../features/orders/status';

const STATUS_WITH_GPS = ['on_the_way', 'delivered'];

export function useDriverOrders(token, { onExternalUpdate, onExternalReconnect, onExternalChat, availability } = {}) {
  const [orders, setOrders] = useState([]);
  const [waitingOrders, setWaitingOrders] = useState([]);
  const [actionMsg, setActionMsg] = useState('');
  const [actionLoading, setActionLoading] = useState(null);
  const [rebalancingId, setRebalancingId] = useState(null);
  const [chatTick, setChatTick] = useState(0);

  const loadDataRef = useRef(null);
  const loadOrdersRef = useRef(null);
  const chatOpenRef = useRef(null);

  const { active, past } = useMemo(() => splitOrdersByTerminalStatus(orders), [orders]);
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

  const loadOrders = useCallback(async () => {
    if (!token) return;
    try {
      const myOrders = await apiFetch('/orders/my', {}, token);
      setOrders(myOrders.orders || []);
    } catch (error) {
      console.warn('[driver-orders] Error cargando pedidos del driver:', error);
    }
  }, [token]);

  const loadWaitingOrders = useCallback(async () => {
    if (!token) return;
    try {
      const qs = availability ? '?available=1' : '';
      const pending = await apiFetch(`/orders/pending-assignment${qs}`, {}, token).catch(() => ({ orders: [] }));
      setWaitingOrders(pending.orders || []);
    } catch (error) {
      console.warn('[driver-orders] Error cargando pedidos en espera:', error);
    }
  }, [token, availability]);

  const loadData = useCallback(async ({ includeWaiting = true } = {}) => {
    await loadOrders();
    if (includeWaiting) await loadWaitingOrders();
  }, [loadOrders, loadWaitingOrders]);

  useEffect(() => {
    loadDataRef.current = loadData;
    loadOrdersRef.current = loadOrders;
  }, [loadData, loadOrders]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Los eventos SSE vienen desde useOrderManager (instancia única).
  // Registramos nuestros handlers en el ref compartido al montar.
  useEffect(() => {
    onExternalUpdate?.(() => loadOrdersRef.current?.());
  }, [onExternalUpdate]);

  useEffect(() => {
    onExternalReconnect?.(() => loadDataRef.current?.());
  }, [onExternalReconnect]);

  useEffect(() => {
    onExternalChat?.((data) => {
      if (data.orderId === chatOpenRef.current) {
        setChatTick((v) => v + 1);
      }
    });
  }, [onExternalChat]);

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

  async function getGpsBody() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve({});
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const body = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          resolve(body);
        },
        () => resolve({}),
        { timeout: 3000, maximumAge: 15000 }
      );
    });
  }

  async function changeStatusWithGps(orderId, status, _order) {
    setActionLoading(orderId);
    try {
      const gps = STATUS_WITH_GPS.includes(status) ? await getGpsBody() : {};
      await apiFetch(`/orders/${orderId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, ...gps }),
      }, token);
      loadOrdersRef.current?.();
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
      loadOrdersRef.current?.();
      setTimeout(() => setActionMsg(''), 5000);
    } catch (error) {
      setActionMsg(error.message || 'Error al solicitar rebalanceo');
    } finally {
      setRebalancingId(null);
    }
  }

  async function doCancelDispute(orderId) {
    setRebalancingId(orderId);
    try {
      await apiFetch(`/drivers/orders/${orderId}/cancel-dispute`, { method: 'POST' }, token);
      setActionMsg('Disputa cancelada. El pedido sigue en tu ruta.');
      loadOrdersRef.current?.();
      setTimeout(() => setActionMsg(''), 4000);
    } catch (error) {
      setActionMsg(error.message || 'Error al cancelar disputa');
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
    loadOrders,
    loadWaitingOrders,
    setActionMsg,
    sendReport,
    changeStatusWithGps,
    doRebalance,
    doCancelDispute,
    acceptDirectly,
    releaseOrder,
    setChatOpen,
  };
}
