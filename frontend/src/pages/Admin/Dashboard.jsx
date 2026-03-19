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
    borderBottom:'2px solid var(--border)', background:'var(--bg-sunken)', fontSize:'0.75rem', color:'var(--text-secondary)' }}>{children}</th>;
}
function Td({ children, style={} }) {
  return <td style={{ padding:'0.4rem 0.65rem', borderBottom:'1px solid var(--border-light)', fontSize:'0.8rem', verticalAlign:'middle', color:'var(--text-primary)', ...style }}>{children}</td>;
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
  const MAX_ACTIVE = 4; // debe coincidir con assignment/constants.js
  const classified = drivers.map(d => {
    const isActive           = d.active_orders > 0;
    const hasPending         = d.pending_offer_order_id != null;
    const cooldownHere       = (d.cooldowns || []).find(cd => cd.order_id === orderId);
    const hasCapacity        = d.active_orders < MAX_ACTIVE;
    const isOfferingThisOrder= d.pending_offer_order_id === orderId;
    const availableForOrder  = d.is_available && hasCapacity && !cooldownHere && !isOfferingThisOrder;

    let priority;
    // 1. Tiene oferta activa de ESTE pedido
    if (isOfferingThisOrder)                           priority = 0;
    // 2. Disponible para recibir este pedido (activo/disponible con espacio, sin cooldown aqui)
    else if (availableForOrder && !hasPending)         priority = 1;
    else if (availableForOrder && hasPending)          priority = 2; // disponible pero con otra oferta
    // 3. Tiene pending offer en OTRO pedido (ocupado en oferta diferente)
    else if (hasPending && !isOfferingThisOrder && !cooldownHere) priority = 3;
    // 4. Tiene cooldown para ESTE pedido
    else if (cooldownHere)                             priority = 4;
    // 5. Sin disponibilidad (offline)
    else                                               priority = 5;

    return { ...d, isActive, hasPending, cooldownHere, isOfferingThisOrder, hasCapacity, priority };
  }).sort((a, b) => a.priority - b.priority);

  return (
    <div style={{ marginTop:'0.5rem' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ fontSize:'0.75rem', background:'#f1f5f9', border:'1px solid #e2e8f0', borderRadius:6,
          cursor:'pointer', padding:'0.25rem 0.65rem', fontWeight:600, display:'flex',
          alignItems:'center', gap:'0.35rem', marginTop:'0.25rem', color:'var(--text-primary)' }}>
        <span style={{ fontSize:'0.6rem' }}>{open ? '▲' : '▼'}</span>
        {open ? 'Ocultar drivers' : `👥 Drivers — ${classified.filter(d=>d.priority===0).length} con oferta, ${classified.filter(d=>d.priority<=2).length} elegibles`}
      </button>
      {open && (
        <div style={{ marginTop:'0.4rem', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
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
                const secsR = d.cooldownHere ? Math.max(0, Math.round((new Date(d.cooldownHere.wait_until) - Date.now()) / 1000)) : null;
                let sitLabel, sitColor, rowBg;
                if (d.isOfferingThisOrder) {
                  sitLabel = '📤 Oferta activa'; sitColor = '#2563eb'; rowBg = '#eff6ff';
                } else if (d.priority === 1) {
                  sitLabel = `✅ Disponible (${d.active_orders}/${MAX_ACTIVE})`; sitColor = '#16a34a'; rowBg = '#f0fdf4';
                } else if (d.priority === 2) {
                  sitLabel = `⚡ Disponible + otra oferta`; sitColor = '#0d9488'; rowBg = '#f0fdfa';
                } else if (d.hasPending && !d.isOfferingThisOrder && !d.cooldownHere) {
                  sitLabel = '⏸ Oferta en otro pedido'; sitColor = '#f59e0b'; rowBg = undefined;
                } else if (d.cooldownHere) {
                  sitLabel = `🕐 Cooldown ${fmtSecs(secsR)}`; sitColor = '#dc2626'; rowBg = '#fff7f7';
                } else if (!d.is_available) {
                  sitLabel = '🔴 Offline'; sitColor = '#9ca3af'; rowBg = undefined;
                } else if (!d.hasCapacity) {
                  sitLabel = `🚴 Saturado (${d.active_orders}/${MAX_ACTIVE})`; sitColor = '#6b7280'; rowBg = undefined;
                } else {
                  sitLabel = '—'; sitColor = '#9ca3af'; rowBg = undefined;
                }
                return (
                  <tr key={d.id} style={{ background: rowBg }}>
                    <Td>{d.driver_number || '—'}</Td>
                    <Td><span style={{ fontWeight: d.priority <= 1 ? 700 : 400 }}>{d.full_name?.split('_')[0] || '—'}</span></Td>
                    <Td>
                      {d.is_available
                        ? <span style={{ color:'#16a34a', fontWeight:600, fontSize:'0.72rem' }}>● Disp.</span>
                        : <span style={{ color:'#9ca3af', fontSize:'0.72rem' }}>○ No</span>
                      }
                    </Td>
                    <Td style={{ textAlign:'center' }}>{d.active_orders}</Td>
                    <Td>{(d.last_lat && d.last_lng) ? <span style={{ color:'#16a34a', fontSize:'0.7rem' }}>✓</span> : <span style={{ color:'#9ca3af', fontSize:'0.7rem' }}>—</span>}</Td>
                    <Td style={{ color:sitColor, fontWeight: d.priority<=1 ? 700 : 400 }}>
                      {sitLabel}
                      {d.cooldownHere && <CooldownBadge waitUntil={d.cooldownHere.wait_until} />}
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
          <span style={{ fontFamily:'monospace', fontSize:'0.72rem', color:'var(--text-secondary)' }}>
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
        <Td>{fmt(order.total_cents)}</Td>
        <Td>
          <span style={{ fontSize:'0.72rem', color:'var(--text-secondary)' }}>{expanded ? '▲' : '▼'}</span>
        </Td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} style={{ padding:'0.75rem 1rem', background:'#f8fafc', borderBottom:'2px solid #e5e7eb' }}>
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
    <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:7, padding:'0.4rem 0.6rem' }}>
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
  const [actionLoading, setActionLoading] = useState(''); // id de la entidad en operación

  // ── Engine params ─────────────────────────────────────────────────────────
  const [engineParams, setEngineParams]   = useState([]);
  const [paramEditing, setParamEditing]   = useState({});
  const [paramSaving,  setParamSaving]    = useState('');
  const [paramMsg,     setParamMsg]       = useState('');

  // ── Reports / Notes / Ratings ─────────────────────────────────────────────
  const [reports,       setReports]       = useState([]);
  const [reportsDone,   setReportsDone]   = useState([]);
  const [notes,         setNotes]         = useState([]);
  const [ratings,       setRatings]       = useState([]);
  const [reviewLoading, setReviewLoading] = useState('');

  async function loadEngineParams() {
    try {
      const r = await apiFetch('/admin/engine-params', {}, auth.token);
      setEngineParams(r.params || []);
    } catch (e) { setParamMsg(e.message); }
  }

  async function saveEngineParam(key, value) {
    setParamSaving(key);
    setParamMsg('');
    try {
      const r = await apiFetch(`/admin/engine-params/${key}`, {
        method: 'PATCH', body: JSON.stringify({ value: Number(value) }),
      }, auth.token);
      setEngineParams(r.params || []);
      setParamEditing(prev => { const n = { ...prev }; delete n[key]; return n; });
      setParamMsg('✓ Guardado');
      setTimeout(() => setParamMsg(''), 2500);
    } catch (e) { setParamMsg(e.message); }
    finally { setParamSaving(''); }
  }

  async function handlePenaltyEdit(driverId, current) {
    const val = window.prompt(`Penalizaciones actuales: ${current}\nNuevo valor (0-10):`, String(current));
    if (val === null) return;
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0 || n > 10) { setMsg('Valor inválido'); return; }
    try {
      await apiFetch(`/admin/drivers/${driverId}/penalties`, {
        method: 'PATCH', body: JSON.stringify({ disconnect_penalties: n }),
      }, auth.token);
      setLiveData(prev => ({
        ...prev,
        drivers: prev.drivers.map(d => d.id === driverId ? { ...d, disconnect_penalties: n } : d),
      }));
    } catch (e) { setMsg(e.message); }
  }

  // Registro nuevo admin
  const [newUser, setNewUser] = useState({ username:'', password:'', displayName:'' });

  // ── Suspender / Activar usuario ──────────────────────────────────────────
  async function handleToggleUserStatus(user) {
    const next = user.status === 'active' ? 'suspended' : 'active';
    const label = next === 'suspended' ? 'suspender' : 'activar';
    if (!window.confirm(`¿${label} a ${user.full_name || user.username}?`)) return;
    setActionLoading(user.id);
    try {
      await apiFetch(`/admin/users/${user.id}/status`, {
        method: 'PATCH', body: JSON.stringify({ status: next }),
      }, auth.token);
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, status: next } : u));
      setMsg(`Usuario ${next === 'active' ? 'activado' : 'suspendido'} correctamente`);
    } catch (e) { setMsg(`Error: ${e.message}`); }
    finally { setActionLoading(''); }
  }

  // ── Forzar estado de pedido ──────────────────────────────────────────────
  async function handleForceOrderStatus(orderId, currentStatus) {
    const validStatuses = ['created','accepted','preparing','ready','on_the_way','delivered','cancelled'];
    const next = window.prompt(
      `Estado actual: ${currentStatus}\nNuevo estado (${validStatuses.join(', ')}):`
    );
    if (!next || !validStatuses.includes(next.trim())) return;
    const note = window.prompt('Nota interna (opcional):') || '';
    setActionLoading(orderId);
    try {
      await apiFetch(`/admin/orders/${orderId}/status`, {
        method: 'PATCH', body: JSON.stringify({ status: next.trim(), note }),
      }, auth.token);
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: next.trim() } : o));
      setMsg(`Pedido actualizado a "${next.trim()}"`);
    } catch (e) { setMsg(`Error: ${e.message}`); }
    finally { setActionLoading(''); }
  }

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
      } else if (tab === 'engine') {
        await loadEngineParams();
      } else if (tab === 'reports') {
        const [pending, done] = await Promise.all([
          apiFetch('/admin/reports?reviewed=false', {}, auth.token),
          apiFetch('/admin/reports?reviewed=true', {}, auth.token),
        ]);
        setReports(pending.reports || []);
        setReportsDone(done.reports || []);
      } else if (tab === 'notes') {
        const d = await apiFetch('/admin/order-notes', {}, auth.token);
        setNotes(d.notes || []);
      } else if (tab === 'ratings') {
        const d = await apiFetch('/admin/ratings', {}, auth.token);
        setRatings(d.ratings || []);
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
      <div style={{ margin:'-1rem -1rem 1.25rem', padding:'0.75rem 1rem 0.65rem', background:'var(--promo-gradient)', color:'#fff' }}>
        <div style={{ fontWeight:800, fontSize:'1.05rem' }}>🛠 Panel de administración</div>
        <div style={{ fontSize:'0.75rem', opacity:0.8, marginTop:'0.1rem' }}>Vista completa del sistema</div>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:'0.25rem', marginBottom:'1.25rem', borderBottom:'1px solid var(--border)', paddingBottom:'0.5rem', flexWrap:'wrap' }}>
        {tabBtn('assignment', `🛵 Asignaciones${liveData.orders.filter(o=>!o.driver_id).length ? ` (${liveData.orders.filter(o=>!o.driver_id).length})` : ''}`)}
        {tabBtn('orders', '📦 Pedidos')}
        {tabBtn('metrics', '📊 Métricas')}
        {tabBtn('users', '👥 Usuarios')}
        {tabBtn('engine', '⚙️ Motor')}
        {tabBtn('reports', `🚨 Reportes${reports.length > 0 ? ` (${reports.length})` : ''}`)}
        {tabBtn('notes', '📝 Notas')}
        {tabBtn('ratings', '⭐ Ratings')}
        {tabBtn('feed', `📡 Feed${liveOffers.length + orderLog.length > 0 ? ` (${liveOffers.length + orderLog.length})` : ''}`)}
        <button onClick={load} style={{ marginLeft:'auto', padding:'0.4rem 0.75rem', border:'1px solid var(--border)', borderRadius:8, cursor:'pointer', fontSize:'0.8rem', background:'var(--bg-card)' }}>
          ↻ Actualizar
        </button>
      </div>

      {msg && <p className="flash flash-error" style={{ marginBottom:'0.75rem' }}>{msg}</p>}
      {loading && <div style={{ color:'var(--text-tertiary)', fontSize:'0.85rem', marginBottom:'0.5rem' }}>Cargando…</div>}

      {/* ── TAB: ASIGNACIONES ─────────────────────────────────────────── */}
      {tab === 'assignment' && (
        <div>
          {/* Resumen rápido */}
          <div style={{ display:'flex', gap:'0.75rem', flexWrap:'wrap', marginBottom:'1.25rem' }}>
            {[
              { label:'Pedidos activos', value:liveData.orders.length, color:'#60a5fa' },
              { label:'Sin driver', value:liveData.orders.filter(o=>!o.driver_id).length, color:'#ef4444' },
              { label:'Con oferta', value:liveData.orders.filter(o=>o.pending_driver_id&&!o.driver_id).length, color:'#f59e0b' },
              { label:'Drivers disponibles', value:liveData.drivers.filter(d=>d.is_available).length, color:'#16a34a' },
              { label:'Drivers en entrega', value:liveData.drivers.filter(d=>d.active_orders>0).length, color:'#8b5cf6' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ border:'1px solid var(--border)', borderRadius:8, padding:'0.6rem 1rem', flex:'1 1 130px', minWidth:130 }}>
                <div style={{ fontSize:'0.72rem', color:'var(--text-secondary)' }}>{label}</div>
                <div style={{ fontSize:'1.5rem', fontWeight:800, color, lineHeight:1.2 }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Tabla de pedidos activos */}
          {liveData.orders.length === 0 ? (
            <div style={{ textAlign:'center', padding:'3rem', color:'var(--text-tertiary)' }}>No hay pedidos activos.</div>
          ) : (
            <div style={{ overflowX:'auto', border:'1px solid var(--border)', borderRadius:10 }}>
              <table style={{ width:'100%', borderCollapse:'collapse', minWidth:800 }}>
                <thead>
                  <tr>
                    <Th>ID</Th>
                    <Th>Estado</Th>
                    <Th>Tienda</Th>
                    <Th>Abierta</Th>
                    <Th>Hora</Th>
                    <Th>Total</Th>
                    <Th></Th>
                  </tr>
                </thead>
                <tbody>
                  {liveData.orders.filter(o => !o.driver_id).map(order => (
                    <OrderRow key={order.id} order={order} drivers={liveData.drivers} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Estado global de todos los drivers */}
          <div style={{ marginTop:'1.5rem', border:'1px solid var(--border)', borderRadius:10, overflow:'hidden' }}>
            <div style={{ padding:'0.65rem 1rem', background:'#f9fafb', fontWeight:700, fontSize:'0.875rem', borderBottom:'1px solid #e5e7eb' }}>
              👥 Estado de todos los drivers
            </div>
            {liveData.drivers.length === 0 ? (
              <div style={{ padding:'1rem', color:'var(--text-tertiary)', fontSize:'0.85rem' }}>Sin drivers registrados.</div>
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
                                  <span style={{ fontSize:'0.75rem', color:'#60a5fa', fontWeight:600 }}>
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
                              ? <span style={{ color:'#16a34a', fontSize:'0.75rem', fontWeight:600 }}>✓ {Number(d.last_lat).toFixed(3)},{Number(d.last_lng).toFixed(3)}</span>
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
                                      <span style={{ fontSize:'0.68rem', color:'var(--text-secondary)' }}>{cd.order_id.slice(0,6)}</span>
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
          <div style={{ overflowX:'auto', border:'1px solid var(--border)', borderRadius:10 }}>
            <table style={{ width:'100%', borderCollapse:'collapse', minWidth:600 }}>
              <thead>
                <tr>
                  <Th>ID</Th><Th>Estado</Th><Th>Tienda</Th><Th>Cliente</Th>
                  <Th>Driver</Th><Th>Total</Th><Th>Creado</Th>
                  <Th>Pend.</Th><Th>Rech.</Th><Th>Exp.</Th><Th>Acción</Th>
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
                    <Td>
                      <button
                        disabled={actionLoading === o.id || ['delivered','cancelled'].includes(o.status)}
                        onClick={() => handleForceOrderStatus(o.id, o.status)}
                        style={{
                          padding:'0.2rem 0.5rem', fontSize:'0.72rem', fontWeight:700, borderRadius:6, cursor:'pointer',
                          border:'1px solid #fde68a', background:'#fffbeb', color:'#92400e',
                          opacity: ['delivered','cancelled'].includes(o.status) ? 0.35 : 1,
                        }}>
                        {actionLoading === o.id ? '…' : '✏️ Estado'}
                      </button>
                    </Td>
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
              { label:'Pedidos', value:metrics.summary?.total_orders, color:'#60a5fa' },
              { label:'Entregados', value:metrics.summary?.delivered, color:'#16a34a' },
              { label:'Cancelados', value:metrics.summary?.cancelled, color:'#dc2626' },
              { label:'Activos', value:metrics.summary?.active, color:'#f59e0b' },
              { label:'Ticket prom.', value:fmt(metrics.summary?.avg_ticket_cents), color:'#8b5cf6' },
              { label:'Ingresos', value:fmt(metrics.summary?.revenue_cents), color:'#0d9488' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ border:'1px solid var(--border)', borderRadius:8, padding:'0.6rem 1rem' }}>
                <div style={{ fontSize:'0.72rem', color:'var(--text-secondary)' }}>{label}</div>
                <div style={{ fontSize:'1.3rem', fontWeight:800, color }}>{value ?? '—'}</div>
              </div>
            ))}
          </div>
          {metrics.timings && (
            <div style={{ border:'1px solid var(--border)', borderRadius:8, padding:'0.75rem 1rem', marginBottom:'1rem' }}>
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
                  <div key={k}><span style={{ color:'var(--text-secondary)' }}>{k}:</span> <strong>{v != null ? `${v}m` : '—'}</strong></div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TAB: USUARIOS ───────────────────────────────────────────── */}
      {tab === 'users' && (
        <div>
          <div style={{ border:'1px solid var(--border)', borderRadius:8, padding:'1rem', marginBottom:'1.25rem', background:'#f9fafb' }}>
            <div style={{ fontWeight:700, marginBottom:'0.75rem', fontSize:'0.875rem' }}>Crear cuenta admin</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr auto', gap:'0.5rem', alignItems:'end', flexWrap:'wrap' }}>
              {[['Usuario','username','username'],['Nombre','displayName','text'],['Contraseña','password','password']].map(([label,key,type]) => (
                <label key={key} style={{ fontSize:'0.8rem' }}>
                  {label}
                  <input type={type} value={newUser[key]} onChange={e => setNewUser(p=>({...p,[key]:e.target.value}))}
                    style={{ display:'block', width:'100%', marginTop:2, padding:'0.4rem 0.6rem', border:'1px solid var(--border)', borderRadius:6, fontSize:'0.85rem' }} />
                </label>
              ))}
              <button onClick={createAdmin} style={{ padding:'0.45rem 1rem', background:'var(--brand)', color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontWeight:700, fontSize:'0.85rem' }}>Crear</button>
            </div>
          </div>
          <div style={{ overflowX:'auto', border:'1px solid var(--border)', borderRadius:10 }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead><tr><Th>Usuario</Th><Th>Nombre</Th><Th>Rol</Th><Th>Estado</Th><Th>Creado</Th><Th>Acción</Th></tr></thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <Td><span style={{ fontFamily:'monospace', fontSize:'0.78rem' }}>{u.username}</span></Td>
                    <Td>{u.full_name}</Td>
                    <Td><Badge status={u.role} label={u.role} /></Td>
                    <Td><Badge status={u.status==='active'?'ready':'cancelled'} label={u.status} /></Td>
                    <Td>{fmtDate(u.created_at)}</Td>
                    <Td>
                      <button
                        disabled={actionLoading === u.id || u.role === 'admin'}
                        onClick={() => handleToggleUserStatus(u)}
                        style={{
                          padding:'0.2rem 0.55rem', fontSize:'0.72rem', fontWeight:700, borderRadius:6, cursor:'pointer',
                          border:`1px solid ${u.status==='active'?'#fca5a5':'#86efac'}`,
                          background: u.status==='active'?'#fef2f2':'#f0fdf4',
                          color: u.status==='active'?'#dc2626':'#16a34a',
                          opacity: u.role==='admin' ? 0.4 : 1,
                        }}>
                        {actionLoading === u.id ? '…' : u.status==='active' ? 'Suspender' : 'Activar'}
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB: MOTOR ──────────────────────────────────────────────────── */}
      {tab === 'engine' && (
        <div>
          <div style={{ marginBottom:'1rem', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div>
              <div style={{ fontWeight:700, fontSize:'0.95rem', color:'var(--text-primary)' }}>⚙️ Parámetros del motor de asignación</div>
              <div style={{ fontSize:'0.75rem', color:'var(--text-tertiary)', marginTop:'0.1rem' }}>
                Los cambios se aplican en el siguiente tick (~60s). Los valores por defecto están en gris.
              </div>
            </div>
            <button onClick={loadEngineParams}
              style={{ padding:'0.35rem 0.75rem', border:'1px solid var(--border)', borderRadius:8, cursor:'pointer', fontSize:'0.78rem', background:'var(--bg-card)' }}>
              ↻ Recargar
            </button>
          </div>

          {paramMsg && (
            <div style={{
              padding:'0.45rem 0.75rem', borderRadius:6, marginBottom:'0.75rem', fontSize:'0.82rem',
              background: paramMsg.startsWith('✓') ? '#f0fdf4' : '#fef2f2',
              border: `1px solid ${paramMsg.startsWith('✓') ? '#16a34a' : '#dc2626'}`,
              color: paramMsg.startsWith('✓') ? '#15803d' : '#dc2626',
            }}>{paramMsg}</div>
          )}

          {engineParams.length === 0
            ? <div style={{ color:'var(--text-tertiary)', fontSize:'0.85rem', padding:'2rem 0' }}>Cargando parámetros…</div>
            : (
              <div style={{ border:'1px solid var(--border)', borderRadius:10, overflow:'hidden' }}>
                <table style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead>
                    <tr>
                      <Th>Parámetro</Th>
                      <Th>Descripción</Th>
                      <Th>Valor actual</Th>
                      <Th>Default</Th>
                      <Th>Acción</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {engineParams.map(p => {
                      const isEditing  = paramEditing[p.key] !== undefined;
                      const isDirty    = isEditing && paramEditing[p.key] !== String(p.value);
                      const isModified = p.value !== p.default;
                      return (
                        <tr key={p.key} style={{ background: isModified ? '#fffbeb' : undefined }}>
                          <Td>
                            <code style={{ fontSize:'0.75rem', color:'var(--text-primary)', background:'#f3f4f6',
                              padding:'0.1rem 0.35rem', borderRadius:4 }}>{p.key}</code>
                          </Td>
                          <Td style={{ maxWidth:280, color:'var(--text-secondary)', fontSize:'0.75rem' }}>{p.description || '—'}</Td>
                          <Td>
                            {isEditing ? (
                              <input
                                type="number" step="any"
                                value={paramEditing[p.key]}
                                onChange={e => setParamEditing(prev => ({ ...prev, [p.key]: e.target.value }))}
                                style={{ width:90, padding:'0.2rem 0.4rem', border:'1px solid #3b82f6',
                                  borderRadius:4, fontSize:'0.82rem' }}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') saveEngineParam(p.key, paramEditing[p.key]);
                                  if (e.key === 'Escape') setParamEditing(prev => { const n={...prev}; delete n[p.key]; return n; });
                                }}
                                autoFocus
                              />
                            ) : (
                              <span style={{ fontWeight: isModified ? 700 : 400,
                                color: isModified ? '#b45309' : '#374151', fontSize:'0.85rem' }}>
                                {p.value}
                              </span>
                            )}
                          </Td>
                          <Td style={{ color:'#9ca3af', fontSize:'0.82rem' }}>{p.default ?? '—'}</Td>
                          <Td>
                            {isEditing ? (
                              <div style={{ display:'flex', gap:'0.3rem' }}>
                                <button
                                  disabled={paramSaving === p.key}
                                  onClick={() => saveEngineParam(p.key, paramEditing[p.key])}
                                  style={{ padding:'0.2rem 0.55rem', background:'#16a34a', color:'#fff',
                                    border:'none', borderRadius:4, cursor:'pointer', fontSize:'0.75rem',
                                    opacity: paramSaving === p.key ? 0.6 : 1 }}>
                                  {paramSaving === p.key ? '…' : 'Guardar'}
                                </button>
                                <button
                                  onClick={() => setParamEditing(prev => { const n={...prev}; delete n[p.key]; return n; })}
                                  style={{ padding:'0.2rem 0.55rem', background:'#f3f4f6',
                                    border:'1px solid var(--border)', borderRadius:4, cursor:'pointer', fontSize:'0.75rem' }}>
                                  Cancelar
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setParamEditing(prev => ({ ...prev, [p.key]: String(p.value) }))}
                                style={{ padding:'0.2rem 0.55rem', background:'#f3f4f6', color:'var(--text-primary)',
                                  border:'1px solid var(--border)', borderRadius:4, cursor:'pointer', fontSize:'0.75rem' }}>
                                Editar
                              </button>
                            )}
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          }

          {/* ── Panel de penalizaciones de drivers ─────────────────────────── */}
          <div style={{ marginTop:'1.5rem' }}>
            <div style={{ fontWeight:700, fontSize:'0.9rem', marginBottom:'0.6rem', color:'var(--text-primary)' }}>
              🚦 Penalizaciones de drivers por desconexión
            </div>
            {liveData.drivers.length === 0
              ? <div style={{ color:'var(--text-tertiary)', fontSize:'0.82rem' }}>Sin datos. Carga la pestaña Asignaciones primero.</div>
              : (
                <div style={{ border:'1px solid var(--border)', borderRadius:10, overflow:'hidden' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse' }}>
                    <thead>
                      <tr><Th>#</Th><Th>Driver</Th><Th>Penalizaciones</Th><Th>Acción</Th></tr>
                    </thead>
                    <tbody>
                      {liveData.drivers.map(d => (
                        <tr key={d.id}>
                          <Td>{d.driver_number || '—'}</Td>
                          <Td style={{ fontWeight:500 }}>{d.full_name || '—'}</Td>
                          <Td>
                            <span style={{
                              fontWeight:700, fontSize:'0.85rem',
                              color: (d.disconnect_penalties||0) >= 3 ? '#dc2626'
                                   : (d.disconnect_penalties||0) > 0 ? '#f59e0b' : '#16a34a',
                            }}>
                              {d.disconnect_penalties ?? 0}
                            </span>
                          </Td>
                          <Td>
                            <button
                              onClick={() => handlePenaltyEdit(d.id, d.disconnect_penalties ?? 0)}
                              style={{ padding:'0.2rem 0.55rem', background:'#f3f4f6', border:'1px solid var(--border)',
                                borderRadius:4, cursor:'pointer', fontSize:'0.75rem' }}>
                              Ajustar
                            </button>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            }
          </div>
        </div>
      )}

      {/* ── TAB: REPORTES ───────────────────────────────────────────── */}
      {tab === 'reports' && (
        <div>
          <div style={{ marginBottom:'1rem' }}>
            <div style={{ fontWeight:700, fontSize:'0.95rem', color:'var(--text-primary)', marginBottom:'0.5rem' }}>
              Pendientes de revisión ({reports.length})
            </div>
            {reports.length === 0
              ? <p style={{ color:'var(--text-tertiary)', fontSize:'0.875rem' }}>Sin reportes pendientes 🎉</p>
              : reports.map(r => (
                <div key={r.id} className="card" style={{ marginBottom:'0.5rem', borderLeft:'3px solid var(--danger)' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:'0.5rem', marginBottom:'0.4rem' }}>
                    <div>
                      <span style={{ fontSize:'0.72rem', fontWeight:700, color:'var(--danger)',
                        background:'var(--danger-bg)', border:'1px solid var(--danger-border)',
                        borderRadius:6, padding:'1px 6px', marginRight:'0.5rem' }}>
                        {r.reporter_role}
                      </span>
                      <span style={{ fontSize:'0.78rem', color:'var(--text-secondary)' }}>
                        {r.reporter_name} · {r.restaurant_name}
                      </span>
                    </div>
                    <span style={{ fontSize:'0.72rem', color:'var(--text-tertiary)', flexShrink:0 }}>
                      {new Date(r.created_at).toLocaleString('es-MX', { dateStyle:'short', timeStyle:'short' })}
                    </span>
                  </div>
                  <div style={{ fontSize:'0.85rem', color:'var(--text-primary)', marginBottom:'0.5rem', lineHeight:1.5 }}>
                    {r.text}
                  </div>
                  <div style={{ display:'flex', gap:'0.5rem', alignItems:'center' }}>
                    <span style={{ fontSize:'0.72rem', color:'var(--text-tertiary)' }}>
                      Pedido: <code style={{ fontSize:'0.72rem' }}>{r.order_id?.slice(0,8)}</code> · Estado: {r.order_status}
                    </span>
                    <button className="btn-sm btn-primary"
                      style={{ marginLeft:'auto', fontSize:'0.75rem' }}
                      disabled={reviewLoading === r.id}
                      onClick={async () => {
                        setReviewLoading(r.id);
                        try {
                          await apiFetch(`/admin/reports/${r.id}/review`, { method:'PATCH' }, auth.token);
                          setReports(prev => prev.filter(x => x.id !== r.id));
                          setReportsDone(prev => [{ ...r, reviewed: true }, ...prev]);
                        } catch(e) { setMsg(e.message); }
                        finally { setReviewLoading(''); }
                      }}>
                      {reviewLoading === r.id ? '…' : '✓ Revisado'}
                    </button>
                  </div>
                </div>
              ))
            }
          </div>
          {reportsDone.length > 0 && (
            <details>
              <summary style={{ fontSize:'0.85rem', color:'var(--text-tertiary)', cursor:'pointer', marginBottom:'0.5rem' }}>
                Revisados ({reportsDone.length})
              </summary>
              {reportsDone.map(r => (
                <div key={r.id} className="card" style={{ marginBottom:'0.4rem', opacity:0.6, borderLeft:'3px solid var(--success)' }}>
                  <div style={{ fontSize:'0.78rem', color:'var(--text-secondary)', marginBottom:'0.2rem' }}>
                    <span style={{ fontWeight:700 }}>{r.reporter_role}</span> · {r.reporter_name} · {r.restaurant_name}
                  </div>
                  <div style={{ fontSize:'0.82rem', color:'var(--text-primary)' }}>{r.text}</div>
                </div>
              ))}
            </details>
          )}
        </div>
      )}

      {/* ── TAB: NOTAS DE CANCELACIÓN / LIBERACIÓN ──────────────────── */}
      {tab === 'notes' && (
        <div>
          <div style={{ fontWeight:700, fontSize:'0.95rem', color:'var(--text-primary)', marginBottom:'1rem' }}>
            Notas de cancelación y liberación ({notes.length})
          </div>
          {notes.length === 0
            ? <p style={{ color:'var(--text-tertiary)', fontSize:'0.875rem' }}>Sin notas registradas</p>
            : (
              <div style={{ overflowX:'auto', border:'1px solid var(--border)', borderRadius:10 }}>
                <table style={{ width:'100%', borderCollapse:'collapse', minWidth:640 }}>
                  <thead><tr>
                    <Th>Pedido</Th><Th>Estado</Th><Th>Tienda</Th><Th>Driver</Th>
                    <Th>Nota driver</Th><Th>Nota tienda</Th><Th>Fecha</Th>
                  </tr></thead>
                  <tbody>
                    {notes.map(n => (
                      <tr key={n.id}>
                        <Td><code style={{ fontSize:'0.72rem' }}>{n.id?.slice(0,8)}</code></Td>
                        <Td><Badge status={n.status} /></Td>
                        <Td>{n.restaurant_name}</Td>
                        <Td>{n.driver_name || '—'}</Td>
                        <Td style={{ maxWidth:200 }}>
                          {n.driver_note
                            ? <span style={{ fontSize:'0.78rem', color:'var(--text-primary)' }}>{n.driver_note}</span>
                            : <span style={{ color:'var(--text-tertiary)' }}>—</span>}
                        </Td>
                        <Td style={{ maxWidth:200 }}>
                          {n.restaurant_note
                            ? <span style={{ fontSize:'0.78rem', color:'var(--text-primary)' }}>{n.restaurant_note}</span>
                            : <span style={{ color:'var(--text-tertiary)' }}>—</span>}
                        </Td>
                        <Td>{new Date(n.updated_at).toLocaleString('es-MX', { dateStyle:'short', timeStyle:'short' })}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </div>
      )}

      {/* ── TAB: RATINGS ────────────────────────────────────────────── */}
      {tab === 'ratings' && (
        <div>
          <div style={{ fontWeight:700, fontSize:'0.95rem', color:'var(--text-primary)', marginBottom:'1rem' }}>
            Calificaciones ({ratings.length})
          </div>
          {ratings.length === 0
            ? <p style={{ color:'var(--text-tertiary)', fontSize:'0.875rem' }}>Sin calificaciones aún</p>
            : (
              <div style={{ overflowX:'auto', border:'1px solid var(--border)', borderRadius:10 }}>
                <table style={{ width:'100%', borderCollapse:'collapse', minWidth:780 }}>
                  <thead><tr>
                    <Th>Pedido</Th><Th>Tienda</Th><Th>Cliente</Th><Th>Driver</Th>
                    <Th>Cli→Tienda</Th><Th>Cli→Driver</Th>
                    <Th>Tienda→Driver</Th><Th>Driver→Tienda</Th>
                    <Th>Comentario</Th><Th>Fecha</Th>
                  </tr></thead>
                  <tbody>
                    {ratings.map(r => {
                      const star = n => n ? '★'.repeat(n) + '☆'.repeat(5-n) : '—';
                      const starColor = n => !n ? 'var(--text-tertiary)' : n >= 4 ? 'var(--success)' : n >= 3 ? 'var(--warn)' : 'var(--danger)';
                      return (
                        <tr key={r.id}>
                          <Td><code style={{ fontSize:'0.72rem' }}>{r.order_id?.slice(0,8)}</code></Td>
                          <Td style={{ fontSize:'0.78rem' }}>{r.restaurant_name}</Td>
                          <Td style={{ fontSize:'0.78rem' }}>{r.customer_name?.split('@')[0]}</Td>
                          <Td style={{ fontSize:'0.78rem' }}>{r.driver_name?.split('@')[0] || '—'}</Td>
                          <Td><span style={{ color: starColor(r.restaurant_stars), fontSize:'0.75rem', letterSpacing:-1 }}>{star(r.restaurant_stars > 0 ? r.restaurant_stars : null)}</span></Td>
                          <Td><span style={{ color: starColor(r.driver_stars), fontSize:'0.75rem', letterSpacing:-1 }}>{star(r.driver_stars)}</span></Td>
                          <Td><span style={{ color: starColor(r.restaurant_rates_driver), fontSize:'0.75rem', letterSpacing:-1 }}>{star(r.restaurant_rates_driver)}</span></Td>
                          <Td><span style={{ color: starColor(r.driver_rates_restaurant), fontSize:'0.75rem', letterSpacing:-1 }}>{star(r.driver_rates_restaurant)}</span></Td>
                          <Td style={{ maxWidth:160, fontSize:'0.75rem', color:'var(--text-secondary)' }}>
                            {r.comment || r.driver_comment || r.restaurant_comment || '—'}
                          </Td>
                          <Td>{new Date(r.created_at).toLocaleDateString('es-MX')}</Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          }
        </div>
      )}

      {/* ── TAB: FEED EN VIVO ───────────────────────────────────────── */}
      {tab === 'feed' && (
        <div>
          <div style={{ display:'flex', gap:'0.5rem', marginBottom:'0.75rem' }}>
            <button onClick={() => { setLiveOffers([]); setOrderLog([]); }}
              style={{ padding:'0.3rem 0.65rem', border:'1px solid var(--border)', borderRadius:8, cursor:'pointer', fontSize:'0.78rem', background:'var(--bg-card)' }}>
              Limpiar feed
            </button>
          </div>
          <div style={{ border:'1px solid var(--border)', borderRadius:10, overflow:'hidden', maxHeight:500, overflowY:'auto' }}>
            {[...liveOffers.map(e=>({...e,_t:'offer'})), ...orderLog.map(e=>({...e,_t:'log'}))]
              .sort((a,b) => b.ts - a.ts)
              .map((e, i) => (
                <div key={i} style={{ padding:'0.4rem 0.875rem', borderBottom:'1px solid var(--border-light)', fontSize:'0.78rem',
                  background: e._t === 'offer' ? '#eff6ff' : '#f0fdf4', display:'flex', gap:'0.75rem' }}>
                  <span style={{ color:'#9ca3af', fontFamily:'monospace' }}>{new Date(e.ts).toLocaleTimeString('es-MX')}</span>
                  <span style={{ color: e._t==='offer'?'#3b82f6':'#16a34a', fontWeight:700 }}>{e._t==='offer'?'📤 OFERTA':'📦 PEDIDO'}</span>
                  <span style={{ color:'var(--text-primary)' }}>{e.orderId}</span>
                  <span style={{ color:'var(--text-secondary)' }}>{e.extra}</span>
                </div>
              ))
            }
            {liveOffers.length + orderLog.length === 0 && (
              <div style={{ padding:'2rem', textAlign:'center', color:'var(--text-tertiary)', fontSize:'0.85rem' }}>
                Esperando eventos SSE…
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
