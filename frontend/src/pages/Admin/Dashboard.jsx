// frontend/src/pages/Admin/Dashboard.jsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useRealtimeOrders } from '../../hooks/useRealtimeOrders';

/* ── helpers ── */
function fmt(cents)  { return cents != null ? `$${(cents/100).toFixed(2)}` : '—'; }
function fmtTs(iso)  {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('es-MX', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
}
function secsSince(iso) {
  if (!iso) return null;
  return Math.max(0, Math.round((Date.now() - new Date(iso)) / 1000));
}
function secsLeft(iso, total = 60) {
  if (!iso) return null;
  const elapsed = secsSince(iso);
  return Math.max(0, total - elapsed);
}
function fmtSecs(s) {
  if (s == null) return '—';
  if (s >= 60) return `${Math.floor(s/60)}m ${s%60}s`;
  return `${s}s`;
}

const STATUS_LABEL = {
  created:'Recibido', assigned:'Asignado', accepted:'Aceptado',
  preparing:'Preparando', ready:'Listo p/ retiro', on_the_way:'En camino',
  delivered:'Entregado', cancelled:'Cancelado', pending_driver:'Sin driver',
};
const STATUS_COLOR = {
  created:'#f59e0b', assigned:'#3b82f6', accepted:'#8b5cf6',
  preparing:'#f97316', ready:'#10b981', on_the_way:'#06b6d4',
  delivered:'#16a34a', cancelled:'#dc2626', pending_driver:'#ef4444',
};

function Badge({ status, label }) {
  const c = STATUS_COLOR[status] || '#9ca3af';
  return (
    <span style={{ background:`${c}22`, color:c, border:`1px solid ${c}55`,
      borderRadius:10, padding:'0.1rem 0.5rem', fontSize:'0.72rem', fontWeight:700, whiteSpace:'nowrap' }}>
      {label || STATUS_LABEL[status] || status}
    </span>
  );
}

function Th({ children }) {
  return <th style={{ padding:'0.4rem 0.65rem', textAlign:'left', whiteSpace:'nowrap', fontWeight:700,
    borderBottom:'2px solid #e5e7eb', background:'#f9fafb', fontSize:'0.75rem', color:'#374151' }}>{children}</th>;
}
function Td({ children, style={} }) {
  return <td style={{ padding:'0.4rem 0.65rem', borderBottom:'1px solid #f3f4f6', fontSize:'0.8rem', verticalAlign:'middle', ...style }}>{children}</td>;
}

// ── Tiempo real: ticker que re-renderiza cada segundo ─────────────────────────
function useTick(interval = 1000) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), interval);
    return () => clearInterval(id);
  }, [interval]);
  return tick;
}

// ── Barra de progreso de oferta ───────────────────────────────────────────────
function OfferBar({ startedAt, total = 60 }) {
  const tick = useTick();
  if (!startedAt) return null;
  const left = secsLeft(startedAt, total);
  const pct  = (left / total) * 100;
  const color = pct > 50 ? '#16a34a' : pct > 25 ? '#f59e0b' : '#dc2626';
  return (
    <div style={{ display:'flex', alignItems:'center', gap:'0.4rem', minWidth:120 }}>
      <div style={{ flex:1, height:6, background:'#e5e7eb', borderRadius:3, overflow:'hidden' }}>
        <div style={{ width:`${pct}%`, height:'100%', background:color, borderRadius:3, transition:'width 1s linear' }} />
      </div>
      <span style={{ fontSize:'0.72rem', fontWeight:700, color, minWidth:28, textAlign:'right' }}>{left}s</span>
    </div>
  );
}

// ── Cooldown countdown ────────────────────────────────────────────────────────
function CooldownBadge({ waitUntil }) {
  const tick = useTick();
  const secsR = Math.max(0, Math.round((new Date(waitUntil) - Date.now()) / 1000));
  const color = secsR > 60 ? '#dc2626' : secsR > 20 ? '#f59e0b' : '#9ca3af';
  return (
    <span style={{ background:`${color}22`, color, border:`1px solid ${color}55`,
      borderRadius:10, padding:'0.1rem 0.5rem', fontSize:'0.72rem', fontWeight:700 }}>
      ⏳ {fmtSecs(secsR)}
    </span>
  );
}

// ── Panel de drivers colapsable por pedido ────────────────────────────────────
function DriversPanel({ drivers, orderId }) {
  const [open, setOpen] = useState(false);
  const tick = useTick();

  // Clasificar drivers según el pedido
  const classified = drivers.map(d => {
    const isActive  = d.active_orders > 0;
    const hasPending = d.pending_offer_order_id != null;
    const cooldown  = (d.cooldowns || []).find(cd => cd.order_id === orderId);
    const otherCooldown = (d.cooldowns || []).find(cd => cd.order_id !== orderId);
    const isOfferingThisOrder = d.pending_offer_order_id === orderId;

    let priority;
    if (isActive && !d.is_available)   priority = 0; // activo sin disponibilidad
    else if (isActive)                 priority = 1; // activo disponible
    else if (d.is_available && !cooldown && !hasPending) priority = 2; // disponible libre
    else if (hasPending && !isOfferingThisOrder)         priority = 3; // ocupado en otro pedido
    else if (cooldown)                                   priority = 4; // cooldown en este pedido
    else if (!d.is_available)                            priority = 5; // no disponible
    else                                                 priority = 6;

    return { ...d, isActive, hasPending, cooldown, isOfferingThisOrder, priority };
  }).sort((a, b) => a.priority - b.priority);

  return (
    <div style={{ marginTop:'0.5rem' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ fontSize:'0.75rem', color:'var(--brand)', background:'none', border:'none', cursor:'pointer',
          padding:'0.15rem 0', fontWeight:600, display:'flex', alignItems:'center', gap:'0.3rem' }}>
        <span>{open ? '▲' : '▼'}</span>
        {open ? 'Ocultar' : 'Ver estado de drivers'} ({classified.length})
      </button>
      {open && (
        <div style={{ marginTop:'0.4rem', border:'1px solid #e5e7eb', borderRadius:8, overflow:'hidden' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', tableLayout:'auto' }}>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>Driver</Th>
                <Th>Estado</Th>
                <Th>Activos</Th>
                <Th>GPS</Th>
                <Th>Situación</Th>
              </tr>
            </thead>
            <tbody>
              {classified.map(d => {
                const secsR = d.cooldown ? Math.max(0, Math.round((new Date(d.cooldown.wait_until) - Date.now()) / 1000)) : null;
                let sitLabel, sitColor;
                if (d.isOfferingThisOrder) {
                  sitLabel = '📤 Oferta enviada'; sitColor = '#3b82f6';
                } else if (d.isActive && !d.is_available) {
                  sitLabel = '🚴 En entrega (no disponible)'; sitColor = '#6b7280';
                } else if (d.isActive) {
                  sitLabel = '🚴 En entrega (disponible)'; sitColor = '#8b5cf6';
                } else if (d.is_available && !d.cooldown && !d.hasPending) {
                  sitLabel = '✅ Disponible y libre'; sitColor = '#16a34a';
                } else if (d.hasPending && !d.isOfferingThisOrder) {
                  sitLabel = '⏸ Con oferta en otro pedido'; sitColor = '#f59e0b';
                } else if (d.cooldown) {
                  sitLabel = `🕐 Cooldown ${fmtSecs(secsR)}`; sitColor = '#dc2626';
                } else if (!d.is_available) {
                  sitLabel = '🔴 No disponible'; sitColor = '#9ca3af';
                } else {
                  sitLabel = '—'; sitColor = '#9ca3af';
                }
                return (
                  <tr key={d.id} style={{ background: d.isOfferingThisOrder ? '#eff6ff' : undefined }}>
                    <Td>{d.driver_number || '—'}</Td>
                    <Td><span style={{ fontWeight: d.isOfferingThisOrder ? 700 : 400 }}>{d.full_name?.split('_')[0] || '—'}</span></Td>
                    <Td>
                      {d.is_available
                        ? <span style={{ color:'#16a34a', fontWeight:600, fontSize:'0.72rem' }}>● Disponible</span>
                        : <span style={{ color:'#9ca3af', fontSize:'0.72rem' }}>○ No disp.</span>
                      }
                    </Td>
                    <Td>{d.active_orders > 0 ? <span style={{ fontWeight:700, color:'#8b5cf6' }}>{d.active_orders}</span> : '0'}</Td>
                    <Td>{(d.last_lat && d.last_lng) ? <span style={{ color:'#16a34a', fontSize:'0.7rem' }}>✓</span> : <span style={{ color:'#9ca3af', fontSize:'0.7rem' }}>—</span>}</Td>
                    <Td style={{ color:sitColor, fontWeight:d.isOfferingThisOrder?700:400 }}>
                      {sitLabel}
                      {d.cooldown && <CooldownBadge waitUntil={d.cooldown.wait_until} />}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Fila de pedido en la tabla de asignación ──────────────────────────────────
function OrderRow({ order, drivers }) {
  const tick = useTick();
  const [expanded, setExpanded] = useState(false);

  const offerSecsLeft = order.offer_started_at ? secsLeft(order.offer_started_at, 60) : null;
  const ageMin = Math.floor(secsSince(order.created_at) / 60);

  return (
    <>
      <tr
        style={{ cursor:'pointer', background: expanded ? '#f0f9ff' : undefined }}
        onClick={() => setExpanded(e => !e)}
      >
        <Td>
          <span style={{ fontFamily:'monospace', fontSize:'0.72rem', color:'#6b7280' }}>
            {order.id.slice(0,8)}
          </span>
        </Td>
        <Td>
          <Badge status={order.status} />
          {order.status === 'pending_driver' && (
            <span style={{ fontSize:'0.68rem', color:'#dc2626', marginLeft:4 }}>
              (ronda {order.round})
            </span>
          )}
        </Td>
        <Td>{order.restaurant_name}</Td>
        <Td>
          <span style={{ fontSize:'0.72rem', color: order.restaurant_open ? '#16a34a' : '#dc2626', fontWeight:600 }}>
            {order.restaurant_open ? '● Abierta' : '○ Cerrada'}
          </span>
        </Td>
        <Td>
          <span style={{ fontSize:'0.75rem' }}>{fmtTs(order.created_at)}</span>
          <span style={{ fontSize:'0.68rem', color:'#9ca3af', marginLeft:4 }}>({ageMin}m)</span>
        </Td>
        <Td>
          {order.driver_id
            ? <span style={{ fontWeight:600, fontSize:'0.8rem' }}>{order.driver_name?.split('_')[0]}</span>
            : order.pending_driver_name
              ? <span style={{ color:'#3b82f6', fontSize:'0.8rem' }}>📤 {order.pending_driver_name?.split('_')[0]}</span>
              : <span style={{ color:'#9ca3af', fontSize:'0.75rem' }}>—</span>
          }
        </Td>
        <Td>
          {order.offer_started_at && !order.driver_id
            ? <OfferBar startedAt={order.offer_started_at} total={60} />
            : '—'
          }
        </Td>
        <Td>{fmt(order.total_cents)}</Td>
        <Td>
          <span style={{ fontSize:'0.72rem', color:'#6b7280' }}>{expanded ? '▲' : '▼'}</span>
        </Td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={9} style={{ padding:'0.75rem 1rem', background:'#f8fafc', borderBottom:'2px solid #e5e7eb' }}>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap:'0.5rem', marginBottom:'0.75rem' }}>
              <Detail label="Hora de creación"     value={fmtDate(order.created_at)} />
              <Detail label="Última actualización" value={fmtDate(order.updated_at)} />
              <Detail label="Cliente"              value={order.customer_name} />
              <Detail label="Tienda"               value={order.restaurant_name} />
              <Detail label="Estado pedido"        value={STATUS_LABEL[order.status] || order.status} />
              <Detail label="Tienda abierta"       value={order.restaurant_open ? 'Sí' : 'No'} color={order.restaurant_open ? '#16a34a' : '#dc2626'} />
              <Detail label="Driver asignado"      value={order.driver_name?.split('_')[0] || '—'} />
              <Detail label="Driver disponible"    value={order.driver_id ? (order.driver_available ? 'Sí' : 'No') : '—'} />
              <Detail label="Vehículo"             value={order.vehicle_type || '—'} />
              <Detail label="Ofertando a"          value={order.pending_driver_name?.split('_')[0] || '—'} color="#3b82f6" />
              <Detail label="Oferta iniciada"      value={order.offer_started_at ? fmtTs(order.offer_started_at) : '—'} />
              <Detail label="Ronda"                value={order.driver_id ? '—' : String(order.round)} />
              <Detail label="Rechazos"             value={String(order.rejected_count)} color={order.rejected_count > 0 ? '#dc2626' : undefined} />
              <Detail label="Expiradas"            value={String(order.expired_count)} color={order.expired_count > 0 ? '#f59e0b' : undefined} />
              <Detail label="Total"                value={fmt(order.total_cents)} />
              <Detail label="Pago"                 value={order.payment_method || 'cash'} />
              <Detail label="Servicio (tienda)"    value={fmt(order.service_fee_cents)} />
              <Detail label="Envío"                value={fmt(order.delivery_fee_cents)} />
              <Detail label="Propina"              value={fmt(order.tip_cents)} />
            </div>
            {/* Estado de drivers para este pedido */}
            <DriversPanel drivers={drivers} orderId={order.id} />
          </td>
        </tr>
      )}
    </>
  );
}

function Detail({ label, value, color }) {
  return (
    <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:7, padding:'0.4rem 0.6rem' }}>
      <div style={{ fontSize:'0.68rem', color:'#9ca3af', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.03em' }}>{label}</div>
      <div style={{ fontSize:'0.82rem', fontWeight:700, color: color || '#1f2937', marginTop:'0.1rem' }}>{value || '—'}</div>
    </div>
  );
}

// ─── MAIN DASHBOARD ──────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const { auth } = useAuth();
  const [tab, setTab]           = useState('assignment');
  const [orders, setOrders]     = useState([]);
  const [metrics, setMetrics]   = useState(null);
  const [users, setUsers]       = useState([]);
  const [liveData, setLiveData] = useState({ orders:[], drivers:[] });
  const [offerStats, setOfferStats] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [metricDays, setMetricDays]     = useState(7);
  const [loading, setLoading]   = useState(false);
  const [msg, setMsg]           = useState('');
  const [liveOffers, setLiveOffers] = useState([]);
  const [orderLog, setOrderLog]     = useState([]);

  // Registro nuevo admin
  const [newUser, setNewUser] = useState({ username:'', password:'', displayName:'' });

  const load = useCallback(async () => {
    if (!auth.token) return;
    setLoading(true); setMsg('');
    try {
      if (tab === 'assignment') {
        const d = await apiFetch('/admin/assignment-live', {}, auth.token);
        setLiveData({ orders: d.orders || [], drivers: d.drivers || [] });
      } else if (tab === 'orders') {
        const qs = statusFilter ? `?status=${statusFilter}&limit=200` : '?limit=200';
        const d = await apiFetch(`/admin/orders${qs}`, {}, auth.token);
        setOrders(d.orders || []);
      } else if (tab === 'metrics') {
        const d = await apiFetch(`/admin/metrics?days=${metricDays}`, {}, auth.token);
        setMetrics(d);
      } else if (tab === 'users') {
        const d = await apiFetch('/admin/users', {}, auth.token);
        setUsers(d.users || []);
      }
    } catch (e) {
      setMsg(e.message);
    } finally {
      setLoading(false);
    }
  }, [auth.token, tab, statusFilter, metricDays]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh del panel de asignación cada 5s
  useEffect(() => {
    if (tab !== 'assignment') return;
    const id = setInterval(() => load(), 5000);
    return () => clearInterval(id);
  }, [tab, load]);

  // SSE: recibir eventos de ofertas y pedidos en tiempo real
  useRealtimeOrders(
    auth.token,
    (data) => {
      const entry = { ts: Date.now(), type:'order', orderId: data.orderId?.slice(0,8), extra: data.status || data.action || '' };
      setOrderLog(prev => [entry, ...prev].slice(0, 50));
      if (tab === 'assignment') load();
    },
    () => {},
    (data) => {
      const entry = { ts: Date.now(), type:'offer', orderId: data.orderId?.slice(0,8), extra: `driver:${(data.driverId||'').slice(0,8)}` };
      setLiveOffers(prev => [entry, ...prev].slice(0, 50));
    },
  );

  // ── Admin user registration ──────────────────────────────────────────────
  async function createAdmin() {
    if (!newUser.username || !newUser.password) { setMsg('Username y password requeridos'); return; }
    try {
      await apiFetch('/auth/register', {
        method:'POST',
        body: JSON.stringify({ username: newUser.username, password: newUser.password, role:'admin', displayName: newUser.displayName || undefined }),
      });
      setMsg('Admin creado');
      setNewUser({ username:'', password:'', displayName:'' });
    } catch (e) { setMsg(e.message); }
  }

  // ── Tabs UI ──────────────────────────────────────────────────────────────
  const tabBtn = (key, label) => (
    <button
      key={key}
      onClick={() => setTab(key)}
      style={{
        padding:'0.4rem 0.875rem', border:'none', cursor:'pointer', borderRadius:8,
        fontWeight: tab===key ? 700 : 400, fontSize:'0.85rem',
        background: tab===key ? 'var(--brand)' : 'transparent',
        color: tab===key ? '#fff' : 'var(--gray-600)',
      }}>
      {label}
    </button>
  );

  return (
    <div style={{ padding:'1rem', maxWidth:1200, margin:'0 auto' }}>
      {/* Encabezado */}
      <div style={{ margin:'-1rem -1rem 1.25rem', padding:'0.75rem 1rem 0.65rem', background:'linear-gradient(135deg,#374151 0%,#1f2937 100%)', color:'#fff' }}>
        <div style={{ fontWeight:800, fontSize:'1.05rem' }}>🛠 Panel de administración</div>
        <div style={{ fontSize:'0.75rem', opacity:0.8, marginTop:'0.1rem' }}>Vista completa del sistema</div>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:'0.25rem', marginBottom:'1.25rem', borderBottom:'1px solid var(--gray-200)', paddingBottom:'0.5rem', flexWrap:'wrap' }}>
        {tabBtn('assignment', `🛵 Asignaciones${liveData.orders.filter(o=>!o.driver_id).length ? ` (${liveData.orders.filter(o=>!o.driver_id).length})` : ''}`)}
        {tabBtn('orders', '📦 Pedidos')}
        {tabBtn('metrics', '📊 Métricas')}
        {tabBtn('users', '👥 Usuarios')}
        {tabBtn('feed', `📡 Feed${liveOffers.length + orderLog.length > 0 ? ` (${liveOffers.length + orderLog.length})` : ''}`)}
        <button onClick={load} style={{ marginLeft:'auto', padding:'0.4rem 0.75rem', border:'1px solid var(--gray-200)', borderRadius:8, cursor:'pointer', fontSize:'0.8rem', background:'#fff' }}>
          ↻ Actualizar
        </button>
      </div>

      {msg && <p className="flash flash-error" style={{ marginBottom:'0.75rem' }}>{msg}</p>}
      {loading && <div style={{ color:'var(--gray-400)', fontSize:'0.85rem', marginBottom:'0.5rem' }}>Cargando…</div>}

      {/* ── TAB: ASIGNACIONES ─────────────────────────────────────────── */}
      {tab === 'assignment' && (
        <div>
          {/* Resumen rápido */}
          <div style={{ display:'flex', gap:'0.75rem', flexWrap:'wrap', marginBottom:'1.25rem' }}>
            {[
              { label:'Pedidos activos', value:liveData.orders.length, color:'#3b82f6' },
              { label:'Sin driver', value:liveData.orders.filter(o=>!o.driver_id).length, color:'#ef4444' },
              { label:'Con oferta', value:liveData.orders.filter(o=>o.pending_driver_id&&!o.driver_id).length, color:'#f59e0b' },
              { label:'Drivers disponibles', value:liveData.drivers.filter(d=>d.is_available).length, color:'#16a34a' },
              { label:'Drivers en entrega', value:liveData.drivers.filter(d=>d.active_orders>0).length, color:'#8b5cf6' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ border:'1px solid #e5e7eb', borderRadius:8, padding:'0.6rem 1rem', flex:'1 1 130px', minWidth:130 }}>
                <div style={{ fontSize:'0.72rem', color:'#6b7280' }}>{label}</div>
                <div style={{ fontSize:'1.5rem', fontWeight:800, color, lineHeight:1.2 }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Tabla de pedidos activos */}
          {liveData.orders.length === 0 ? (
            <div style={{ textAlign:'center', padding:'3rem', color:'var(--gray-400)' }}>No hay pedidos activos.</div>
          ) : (
            <div style={{ overflowX:'auto', border:'1px solid #e5e7eb', borderRadius:10 }}>
              <table style={{ width:'100%', borderCollapse:'collapse', minWidth:800 }}>
                <thead>
                  <tr>
                    <Th>ID</Th>
                    <Th>Estado</Th>
                    <Th>Tienda</Th>
                    <Th>Tienda</Th>
                    <Th>Hora</Th>
                    <Th>Driver</Th>
                    <Th>Contador oferta</Th>
                    <Th>Total</Th>
                    <Th></Th>
                  </tr>
                </thead>
                <tbody>
                  {liveData.orders.map(order => (
                    <OrderRow key={order.id} order={order} drivers={liveData.drivers} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Estado global de todos los drivers */}
          <div style={{ marginTop:'1.5rem', border:'1px solid #e5e7eb', borderRadius:10, overflow:'hidden' }}>
            <div style={{ padding:'0.65rem 1rem', background:'#f9fafb', fontWeight:700, fontSize:'0.875rem', borderBottom:'1px solid #e5e7eb' }}>
              👥 Estado de todos los drivers
            </div>
            {liveData.drivers.length === 0 ? (
              <div style={{ padding:'1rem', color:'var(--gray-400)', fontSize:'0.85rem' }}>Sin drivers registrados.</div>
            ) : (
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead>
                    <tr>
                      <Th>#</Th>
                      <Th>Driver</Th>
                      <Th>Disponible</Th>
                      <Th>Pedidos activos</Th>
                      <Th>Oferta activa</Th>
                      <Th>GPS</Th>
                      <Th>Cooldowns</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...liveData.drivers].sort((a, b) => {
                      // Orden: activos primero, luego disponibles, luego pending sin cooldown, luego con cooldown
                      const score = d => {
                        if (d.active_orders > 0) return 0;
                        if (d.is_available && !d.pending_offer_order_id && !(d.cooldowns||[]).length) return 1;
                        if (d.is_available && d.pending_offer_order_id) return 2;
                        if ((d.cooldowns||[]).length > 0) return 3;
                        return 4;
                      };
                      return score(a) - score(b);
                    }).map(d => {
                      const tick = 0; // fuerza re-render desde useTick en padre
                      const cooldowns = d.cooldowns || [];
                      return (
                        <tr key={d.id}>
                          <Td>{d.driver_number || '—'}</Td>
                          <Td><span style={{ fontWeight:600 }}>{d.full_name?.split('_')[0] || '—'}</span></Td>
                          <Td>
                            {d.is_available
                              ? <span style={{ color:'#16a34a', fontWeight:700, fontSize:'0.75rem' }}>● Sí</span>
                              : <span style={{ color:'#9ca3af', fontSize:'0.75rem' }}>○ No</span>
                            }
                          </Td>
                          <Td>
                            {d.active_orders > 0
                              ? <Badge status="on_the_way" label={`${d.active_orders} en entrega`} />
                              : <span style={{ color:'#9ca3af', fontSize:'0.75rem' }}>0</span>
                            }
                          </Td>
                          <Td>
                            {d.pending_offer_order_id
                              ? (
                                <div>
                                  <span style={{ fontSize:'0.75rem', color:'#3b82f6', fontWeight:600 }}>
                                    {d.pending_offer_order_id.slice(0,8)}
                                  </span>
                                  {d.pending_offer_started_at && (
                                    <div style={{ marginTop:2 }}>
                                      <OfferBar startedAt={d.pending_offer_started_at} total={60} />
                                    </div>
                                  )}
                                </div>
                              )
                              : <span style={{ color:'#9ca3af', fontSize:'0.75rem' }}>—</span>
                            }
                          </Td>
                          <Td>
                            {(d.last_lat && d.last_lng)
                              ? <span style={{ color:'#16a34a', fontSize:'0.75rem', fontWeight:600 }}>✓ {d.last_lat?.toFixed(3)},{d.last_lng?.toFixed(3)}</span>
                              : <span style={{ color:'#9ca3af', fontSize:'0.72rem' }}>Sin GPS</span>
                            }
                          </Td>
                          <Td>
                            {cooldowns.length === 0
                              ? <span style={{ color:'#9ca3af', fontSize:'0.72rem' }}>—</span>
                              : (
                                <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
                                  {cooldowns.map((cd, i) => (
                                    <div key={i} style={{ display:'flex', alignItems:'center', gap:4 }}>
                                      <span style={{ fontSize:'0.68rem', color:'#6b7280' }}>{cd.order_id.slice(0,6)}</span>
                                      <CooldownBadge waitUntil={cd.wait_until} />
                                    </div>
                                  ))}
                                </div>
                              )
                            }
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB: PEDIDOS ─────────────────────────────────────────────── */}
      {tab === 'orders' && (
        <div>
          <div style={{ display:'flex', gap:'0.5rem', marginBottom:'1rem', flexWrap:'wrap' }}>
            {['','created','pending_driver','assigned','accepted','preparing','ready','on_the_way','delivered','cancelled'].map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                style={{ padding:'0.3rem 0.65rem', border:`1px solid ${statusFilter===s ? 'var(--brand)' : '#e5e7eb'}`,
                  borderRadius:8, cursor:'pointer', fontSize:'0.78rem',
                  background: statusFilter===s ? 'var(--brand-light)' : '#fff',
                  color: statusFilter===s ? 'var(--brand)' : 'var(--gray-600)', fontWeight: statusFilter===s ? 700 : 400 }}>
                {s || 'Todos'}
              </button>
            ))}
          </div>
          <div style={{ overflowX:'auto', border:'1px solid #e5e7eb', borderRadius:10 }}>
            <table style={{ width:'100%', borderCollapse:'collapse', minWidth:600 }}>
              <thead>
                <tr>
                  <Th>ID</Th><Th>Estado</Th><Th>Tienda</Th><Th>Cliente</Th>
                  <Th>Driver</Th><Th>Total</Th><Th>Creado</Th>
                  <Th>Pend.</Th><Th>Rech.</Th><Th>Exp.</Th>
                </tr>
              </thead>
              <tbody>
                {orders.map(o => (
                  <tr key={o.id}>
                    <Td><span style={{ fontFamily:'monospace', fontSize:'0.72rem' }}>{o.id.slice(0,8)}</span></Td>
                    <Td><Badge status={o.status} /></Td>
                    <Td>{o.restaurant_name}</Td>
                    <Td>{o.customer_name?.split('_')[0]}</Td>
                    <Td>{o.driver_name?.split('_')[0] || '—'}</Td>
                    <Td>{fmt(o.total_cents)}</Td>
                    <Td>{fmtDate(o.created_at)}</Td>
                    <Td>{o.pending_offers > 0 ? <span style={{color:'#f59e0b',fontWeight:700}}>⏳{o.pending_offers}</span> : 0}</Td>
                    <Td>{o.rejected_offers > 0 ? <span style={{color:'#dc2626'}}>{o.rejected_offers}</span> : 0}</Td>
                    <Td>{o.expired_offers > 0 ? <span style={{color:'#9ca3af'}}>{o.expired_offers}</span> : 0}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB: MÉTRICAS ───────────────────────────────────────────── */}
      {tab === 'metrics' && metrics && (
        <div>
          <div style={{ display:'flex', gap:'0.5rem', marginBottom:'1rem' }}>
            {[7,14,30,90].map(d => (
              <button key={d} onClick={() => setMetricDays(d)}
                style={{ padding:'0.3rem 0.65rem', border:`1px solid ${metricDays===d?'var(--brand)':'#e5e7eb'}`,
                  borderRadius:8, cursor:'pointer', fontSize:'0.78rem', fontWeight:metricDays===d?700:400,
                  background: metricDays===d ? 'var(--brand-light)' : '#fff',
                  color: metricDays===d ? 'var(--brand)' : 'var(--gray-600)' }}>
                {d}d
              </button>
            ))}
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))', gap:'0.6rem', marginBottom:'1.25rem' }}>
            {[
              { label:'Pedidos', value:metrics.summary?.total_orders, color:'#3b82f6' },
              { label:'Entregados', value:metrics.summary?.delivered, color:'#16a34a' },
              { label:'Cancelados', value:metrics.summary?.cancelled, color:'#dc2626' },
              { label:'Activos', value:metrics.summary?.active, color:'#f59e0b' },
              { label:'Ticket prom.', value:fmt(metrics.summary?.avg_ticket_cents), color:'#8b5cf6' },
              { label:'Ingresos', value:fmt(metrics.summary?.revenue_cents), color:'#0d9488' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ border:'1px solid #e5e7eb', borderRadius:8, padding:'0.6rem 1rem' }}>
                <div style={{ fontSize:'0.72rem', color:'#6b7280' }}>{label}</div>
                <div style={{ fontSize:'1.3rem', fontWeight:800, color }}>{value ?? '—'}</div>
              </div>
            ))}
          </div>
          {metrics.timings && (
            <div style={{ border:'1px solid #e5e7eb', borderRadius:8, padding:'0.75rem 1rem', marginBottom:'1rem' }}>
              <div style={{ fontWeight:700, fontSize:'0.875rem', marginBottom:'0.5rem' }}>⏱ Tiempos promedio</div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))', gap:'0.5rem', fontSize:'0.8rem' }}>
                {[
                  ['Asignación', metrics.timings.avg_min_to_accept],
                  ['Preparación', metrics.timings.avg_min_to_prepare],
                  ['Listo para retiro', metrics.timings.avg_min_to_ready],
                  ['Retiro', metrics.timings.avg_min_to_pickup],
                  ['Entrega', metrics.timings.avg_min_to_deliver],
                  ['Total', metrics.timings.avg_total_min],
                ].map(([k, v]) => (
                  <div key={k}><span style={{ color:'#6b7280' }}>{k}:</span> <strong>{v != null ? `${v}m` : '—'}</strong></div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TAB: USUARIOS ───────────────────────────────────────────── */}
      {tab === 'users' && (
        <div>
          <div style={{ border:'1px solid #e5e7eb', borderRadius:8, padding:'1rem', marginBottom:'1.25rem', background:'#f9fafb' }}>
            <div style={{ fontWeight:700, marginBottom:'0.75rem', fontSize:'0.875rem' }}>Crear cuenta admin</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr auto', gap:'0.5rem', alignItems:'end', flexWrap:'wrap' }}>
              {[['Usuario','username','username'],['Nombre','displayName','text'],['Contraseña','password','password']].map(([label,key,type]) => (
                <label key={key} style={{ fontSize:'0.8rem' }}>
                  {label}
                  <input type={type} value={newUser[key]} onChange={e => setNewUser(p=>({...p,[key]:e.target.value}))}
                    style={{ display:'block', width:'100%', marginTop:2, padding:'0.4rem 0.6rem', border:'1px solid #e5e7eb', borderRadius:6, fontSize:'0.85rem' }} />
                </label>
              ))}
              <button onClick={createAdmin} style={{ padding:'0.45rem 1rem', background:'var(--brand)', color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontWeight:700, fontSize:'0.85rem' }}>Crear</button>
            </div>
          </div>
          <div style={{ overflowX:'auto', border:'1px solid #e5e7eb', borderRadius:10 }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead><tr><Th>Usuario</Th><Th>Nombre</Th><Th>Rol</Th><Th>Estado</Th><Th>Creado</Th></tr></thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <Td><span style={{ fontFamily:'monospace', fontSize:'0.78rem' }}>{u.username}</span></Td>
                    <Td>{u.full_name}</Td>
                    <Td><Badge status={u.role} label={u.role} /></Td>
                    <Td><Badge status={u.status==='active'?'ready':'cancelled'} label={u.status} /></Td>
                    <Td>{fmtDate(u.created_at)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB: FEED EN VIVO ───────────────────────────────────────── */}
      {tab === 'feed' && (
        <div>
          <div style={{ display:'flex', gap:'0.5rem', marginBottom:'0.75rem' }}>
            <button onClick={() => { setLiveOffers([]); setOrderLog([]); }}
              style={{ padding:'0.3rem 0.65rem', border:'1px solid #e5e7eb', borderRadius:8, cursor:'pointer', fontSize:'0.78rem', background:'#fff' }}>
              Limpiar feed
            </button>
          </div>
          <div style={{ border:'1px solid #e5e7eb', borderRadius:10, overflow:'hidden', maxHeight:500, overflowY:'auto' }}>
            {[...liveOffers.map(e=>({...e,_t:'offer'})), ...orderLog.map(e=>({...e,_t:'log'}))]
              .sort((a,b) => b.ts - a.ts)
              .map((e, i) => (
                <div key={i} style={{ padding:'0.4rem 0.875rem', borderBottom:'1px solid #f3f4f6', fontSize:'0.78rem',
                  background: e._t === 'offer' ? '#eff6ff' : '#f0fdf4', display:'flex', gap:'0.75rem' }}>
                  <span style={{ color:'#9ca3af', fontFamily:'monospace' }}>{new Date(e.ts).toLocaleTimeString('es-MX')}</span>
                  <span style={{ color: e._t==='offer'?'#3b82f6':'#16a34a', fontWeight:700 }}>{e._t==='offer'?'📤 OFERTA':'📦 PEDIDO'}</span>
                  <span style={{ color:'#374151' }}>{e.orderId}</span>
                  <span style={{ color:'#6b7280' }}>{e.extra}</span>
                </div>
              ))
            }
            {liveOffers.length + orderLog.length === 0 && (
              <div style={{ padding:'2rem', textAlign:'center', color:'var(--gray-400)', fontSize:'0.85rem' }}>
                Esperando eventos SSE…
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
