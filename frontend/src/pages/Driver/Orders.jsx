import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { DriverActiveOrderCard, DriverAvailableOrderCard, DriverPastOrderCard } from '../../features/driver/orders/components';
import { useRealtimeOrders } from '../../hooks/useRealtimeOrders';
import { haversineMeters } from '../../utils/geo';

var STATUS_LABELS = {
  created:'Recibido', assigned:'Asignado', accepted:'Aceptado',
  preparing:'En preparación', ready:'Listo para retiro',
  on_the_way:'En camino', delivered:'Entregado',
  cancelled:'Cancelado', pending_driver:'Sin conductor',
};
var STATUS_COLOR = {
  created:'#f59e0b', assigned:'#3b82f6', accepted:'#8b5cf6',
  preparing:'#f97316', ready:'#16a34a', on_the_way:'#0891b2',
  delivered:'#16a34a', cancelled:'#dc2626', pending_driver:'#ef4444',
};

export default function DriverOrders() {
  const { auth } = useAuth();
  const [orders, setOrders]         = useState([]);
  const [waitingOrders, setWaiting] = useState([]); // pedidos sin ofertar
  const [tab, setTab]               = useState('active');
  const [reportingId, setReportingId] = useState(null);
  const [reportText, setReportText]   = useState('');
  const [reportMsg, setReportMsg]     = useState('');
  const loadDataRef = useRef(null);

  async function loadData() {
    if (!auth.token) return;
    try {
      const [myOrders, pending] = await Promise.all([
        apiFetch('/orders/my', {}, auth.token),
        apiFetch('/orders/pending-assignment', {}, auth.token).catch(() => ({ orders: [] })),
      ]);
      setOrders(myOrders.orders || []);
      setWaiting(pending.orders || []);
    } catch (_) {}
  }

  async function sendReport(orderId) {
    if (!reportText.trim()) return;
    try {
      await apiFetch(`/orders/${orderId}/report`, {
        method:'POST', body: JSON.stringify({ text: reportText, reason: 'driver_report' })
      }, auth.token);
      setReportingId(null); setReportText(''); setReportMsg('Reporte enviado');
      setTimeout(() => setReportMsg(''), 3000);
    } catch (e) { setReportMsg(e.message); }
  }

  useEffect(() => { loadDataRef.current = loadData; });
  useEffect(() => { loadData(); }, [auth.token]);
  // Polling 5s fallback
  useEffect(() => {
    if (!auth.token) return;
    const id = setInterval(() => loadDataRef.current?.(), 5000);
    return () => clearInterval(id);
  }, [auth.token]);
  // Estado para forzar recarga del chat
  const [chatTick, setChatTick] = useState(0);

  useRealtimeOrders(
    auth.token,
    () => loadDataRef.current?.(),
                    () => {},
                    undefined,
                    (data) => {
                      if (data.orderId === chatOpen) setChatTick(t => t + 1);
                    },
  );

  const active = useMemo(() => orders.filter(o => !['delivered','cancelled'].includes(o.status)), [orders]);
  const past   = useMemo(() => orders.filter(o =>  ['delivered','cancelled'].includes(o.status)), [orders]);
  // Mismo criterio que DriverHome: pedido activo con accepted_at más antiguo
  const activeOrderId = useMemo(() => {
    if (active.length === 0) return null;
    return [...active].sort((a,b) =>
      new Date(a.accepted_at||a.created_at) - new Date(b.accepted_at||b.created_at)
    )[0]?.id ?? null;
  }, [active]);

  // Pedidos sin ofertar: excluir los que ya son activos de este driver
  const activeIds = useMemo(() => new Set(active.map(o => o.id)), [active]);
  // Mostrar todos los pedidos sin driver excepto los que ya son activos de este driver.
  // El cooldown propio no bloquea — se puede aceptar directamente desde aquí.
  const unoffered = useMemo(() => waitingOrders.filter(o => !activeIds.has(o.id)), [waitingOrders, activeIds]);

  const [actionMsg, setActionMsg] = useState('');
  const [actionLoading, setActionLoading] = useState(null);
  const [releaseNote, setReleaseNote]     = useState('');
  const [releasingId, setReleasingId]     = useState(null);
  const [expanded, setExpanded]            = useState(null);
  const [rebalancingId, setRebalancingId] = useState(null);
  const [chatOpen, setChatOpen]           = useState(null);

  // Grace window ref: tracks last time driver was ≤100m from each reference point
  const graceRef = useRef({});
  const MAX_RADIUS_M = 100;
  const GRACE_MS = 3 * 60 * 1000;

  async function getGpsBody(status, order) {
    return new Promise(resolve => {
      if (!navigator.geolocation) { resolve({}); return; }
      navigator.geolocation.getCurrentPosition(
        pos => {
          const body = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          const refLat = status === 'on_the_way' ? order?.restaurant_lat : order?.delivery_lat;
          const refLng = status === 'on_the_way' ? order?.restaurant_lng : order?.delivery_lng;
          if (refLat && refLng) {
            const distM = haversineMeters(body.lat, body.lng, Number(refLat), Number(refLng));
            if (distM <= MAX_RADIUS_M) {
              graceRef.current[status] = Date.now();
            } else {
              const lastIn = graceRef.current[status];
              if (lastIn && Date.now() - lastIn <= GRACE_MS) body.grace = true;
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
      const gps = ['on_the_way','delivered'].includes(status) ? await getGpsBody(status, order) : {};
      await apiFetch(`/orders/${orderId}/status`, { method:'PATCH', body: JSON.stringify({ status, ...gps }) }, auth.token);
      loadData();
    } catch(e) { setActionMsg(e.message); }
    finally { setActionLoading(null); }
  }

  async function doRebalance(orderId) {
    setRebalancingId(orderId);
    try {
      await apiFetch(`/drivers/orders/${orderId}/rebalance`, { method: 'POST' }, auth.token);
      setActionMsg('Pedido en disputa — si alguien lo toma se te notifica.');
      loadData();
      setTimeout(() => setActionMsg(''), 5000);
    } catch (e) { setActionMsg(e.message || 'Error al solicitar rebalanceo'); }
    finally { setRebalancingId(null); }
  }

  async function acceptDirectly(orderId) {
    setActionLoading(orderId);
    try {
      await apiFetch(`/drivers/orders/${orderId}/claim`, { method:'POST' }, auth.token);
      setActionMsg('Pedido aceptado ✓');
      loadData();
      setTimeout(() => setActionMsg(''), 3000);
    } catch (e) { setActionMsg(e.message || 'Error al aceptar'); }
    finally { setActionLoading(null); }
  }

  async function releaseOrder(orderId) {
    if (!releaseNote.trim()) { setActionMsg('Escribe una nota antes de liberar'); return; }
    setActionLoading(orderId);
    try {
      await apiFetch(`/drivers/orders/${orderId}/release`, {
        method:'POST', body: JSON.stringify({ note: releaseNote.trim() })
      }, auth.token);
      setReleasingId(null); setReleaseNote('');
      setActionMsg('Pedido liberado');
      loadData();
      setTimeout(() => setActionMsg(''), 3000);
    } catch (e) { setActionMsg(e.message); }
    finally { setActionLoading(null); }
  }


  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      {/* ── Encabezado fijo ─────────────────────────────────────────── */}
      <div style={{
        flexShrink:0, background:'var(--bg-card)', borderBottom:'2px solid var(--border)',
        padding:'0.65rem 1rem 0', zIndex:30,
        boxShadow:'0 1px 4px rgba(0,0,0,0.04)'
      }}>
        <div style={{ fontWeight:800, fontSize:'1rem', color:'var(--brand)', letterSpacing:'-0.01em', marginBottom:'0.4rem' }}>
          Mis pedidos
        </div>
        <div style={{ display:'flex', gap:0, borderTop:'1px solid var(--border-light)' }}>
          {[
            ['active', 'Activos'],
            ['waiting', unoffered.length > 0 ? `En espera (${unoffered.length})` : 'En espera'],
            ['past',   'Historial'],
          ].map(([val, label]) => (
            <button key={val} onClick={() => setTab(val)}
              style={{
                flex:1, background:'none', border:'none', cursor:'pointer',
                padding:'0.4rem 0.3rem', fontSize:'0.72rem', fontWeight: tab===val ? 800 : 500,
                color: tab===val ? 'var(--brand)' : 'var(--gray-500)',
                borderBottom: tab===val ? '2px solid var(--brand)' : '2px solid transparent',
                marginBottom:'-1px', transition:'color 0.15s'
              }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Contenido scrolleable ─────────────────────────────────── */}
      <div style={{ flex:1, overflowY:'auto', padding:'0.75rem 1rem', paddingBottom:'calc(var(--nav-h-mobile) + 2.5rem)' }}>

      {reportMsg  && <p className="flash flash-ok"    style={{ marginBottom:'0.5rem' }}>{reportMsg}</p>}
      {actionMsg  && <p className="flash flash-ok"    style={{ marginBottom:'0.5rem' }}>{actionMsg}</p>}
      {/* ── En espera (sin oferta activa) ─────────────────────────────── */}
      {tab === 'waiting' && (
        <div style={{ marginBottom:'1.25rem' }}>
          <p style={{ fontSize:'0.8rem', fontWeight:700, color:'var(--text-tertiary)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'0.5rem' }}>
            Buscando conductor ({unoffered.length})
          </p>
          <ul style={{ listStyle:'none', padding:0 }}>
            {unoffered.map(order => (
              <DriverAvailableOrderCard
                key={order.id}
                order={order}
                actionLoading={actionLoading}
                onAccept={() => acceptDirectly(order.id)}
              />
            ))}
          </ul>
        </div>
      )}

      <div style={{ display:'flex', gap:'0.4rem', marginBottom:'1rem' }}>
      </div>

      {tab === 'active' && (
        active.length === 0
          ? <p style={{ color:'var(--text-secondary)', fontSize:'0.9rem' }}>Sin pedidos activos.</p>
          : (
            <ul className="orders-tab-panel" style={{ listStyle:'none', padding:0 }}>
              {active.map(order => {
                const color = STATUS_COLOR[order.status] || '#9ca3af';
                const isActive = order.id === activeOrderId;
                const DRIVER_ST = { assigned:'Asignado', on_the_way:'En camino', preparing:'En tienda', ready:'Listo retiro' };
                return (
                  <DriverActiveOrderCard
                    key={order.id}
                    order={order}
                    color={color}
                    isActive={isActive}
                    isExpanded={expanded === order.id}
                    statusLabel={DRIVER_ST[order.status] || STATUS_LABELS[order.status]}
                    actionLoading={actionLoading}
                    rebalancingId={rebalancingId}
                    releasingId={releasingId}
                    releaseNote={releaseNote}
                    onToggleExpand={() => setExpanded(expanded === order.id ? null : order.id)}
                    onChangeStatus={(status) => changeStatusWithGps(order.id, status, order)}
                    onRebalance={() => doRebalance(order.id)}
                    onStartRelease={() => setReleasingId(order.id)}
                    onReleaseNoteChange={setReleaseNote}
                    onConfirmRelease={() => releaseOrder(order.id)}
                    onCancelRelease={() => { setReleasingId(null); setReleaseNote(''); }}
                    chatOpen={chatOpen}
                    onToggleChat={() => setChatOpen(chatOpen === order.id ? null : order.id)}
                    authToken={auth.token}
                    chatTick={chatTick}
                  />
                );
              })}
            </ul>
          )
      )}

      {tab === 'past' && (
        past.length === 0
          ? <p style={{ color:'var(--text-secondary)', fontSize:'0.9rem' }}>Sin pedidos anteriores.</p>
          : (
            <ul className="orders-tab-panel reverse" style={{ listStyle:'none', padding:0 }}>
              {past.slice(0, 50).map(order => {
                const color = STATUS_COLOR[order.status] || '#9ca3af';
                const historyKey = 'h_' + order.id;
                return (
                  <DriverPastOrderCard
                    key={order.id}
                    order={order}
                    color={color}
                    isExpanded={expanded === historyKey}
                    isChatOpen={chatOpen === historyKey}
                    statusLabel={STATUS_LABELS[order.status]}
                    reportingId={reportingId}
                    reportText={reportText}
                    onToggleExpand={() => setExpanded(expanded === historyKey ? null : historyKey)}
                    onToggleChat={() => setChatOpen(chatOpen === historyKey ? null : historyKey)}
                    authToken={auth.token}
                    chatTick={chatTick}
                    onStartReport={() => setReportingId(order.id)}
                    onReportTextChange={setReportText}
                    onSendReport={() => sendReport(order.id)}
                    onCancelReport={() => { setReportingId(null); setReportText(''); }}
                  />
                );
              })}
            </ul>
          )
      )}

      </div>
    </div>
  );
}
