// frontend/src/pages/Admin/Dashboard.jsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useRealtimeOrders } from '../../hooks/useRealtimeOrders';
import { useTick } from '../../features/admin/dashboard/shared';
import { apiFetch } from '../../api/client';

import { AssignmentTab } from '../../features/admin/dashboard/sections';
import AdminMap         from '../../features/admin/dashboard/AdminMap';
import OrdersTab        from '../../features/admin/dashboard/tabs/OrdersTab';
import MetricsTab       from '../../features/admin/dashboard/tabs/MetricsTab';
import UsersTab         from '../../features/admin/dashboard/tabs/UsersTab';
import EngineTab        from '../../features/admin/dashboard/tabs/EngineTab';
import ReportsTab       from '../../features/admin/dashboard/tabs/ReportsTab';
import NotesTab         from '../../features/admin/dashboard/tabs/NotesTab';
import RatingsTab       from '../../features/admin/dashboard/tabs/RatingsTab';
import FeedTab          from '../../features/admin/dashboard/tabs/FeedTab';
import SystemTab        from '../../features/admin/dashboard/tabs/SystemTab';
import EmergencyTab     from '../../features/admin/dashboard/tabs/EmergencyTab';
import SupportTab       from '../../features/admin/dashboard/tabs/SupportTab';

// ── Sidebar nav groups ───────────────────────────────────────────────────────
const NAV_GROUPS = [
  {
    label: 'EN VIVO',
    items: [
      { key: 'map',        label: '🗺 Mapa' },
      { key: 'assignment', label: '🛵 Pedidos live' },
      { key: 'support',    label: '💬 Soporte' },
    ],
  },
  {
    label: 'ANÁLISIS',
    items: [
      { key: 'metrics',  label: '📊 Métricas' },
      { key: 'ratings',  label: '⭐ Ratings' },
      { key: 'reports',  label: '🚩 Reportes', badge: 'reportsCount' },
      { key: 'notes',    label: '📝 Notas' },
    ],
  },
  {
    label: 'PLATAFORMA',
    items: [
      { key: 'users',   label: '👥 Usuarios' },
      { key: 'orders',  label: '📋 Pedidos' },
      { key: 'engine',  label: '⚙️ Motor' },
    ],
  },
  {
    label: 'OPERACIONES',
    items: [
      { key: 'emergency', label: '🏪 Operaciones' },
    ],
  },
];

const HIDDEN_TABS = ['feed', 'system']; // accessible but not shown in main nav

// ── Force-status modal ───────────────────────────────────────────────────────
const VALID_STATUSES = ['created','accepted','preparing','ready','on_the_way','delivered','cancelled'];

function ForceStatusModal({ order, onConfirm, onClose }) {
  const [status, setStatus] = useState('');
  const [note,   setNote]   = useState('');
  if (!order) return null;
  return (
    <div style={{ position:'fixed', inset:0, zIndex:9000, background:'rgba(0,0,0,0.5)',
      display:'flex', alignItems:'center', justifyContent:'center', padding:'1rem' }}>
      <div style={{ background:'var(--bg-card)', borderRadius:12, padding:'1.5rem',
        width:'100%', maxWidth:420, boxShadow:'0 8px 32px rgba(0,0,0,0.2)' }}>
        <div style={{ fontWeight:800, marginBottom:8 }}>Forzar estado</div>
        <div style={{ fontSize:'0.82rem', color:'var(--text-tertiary)', marginBottom:16 }}>
          Pedido {order.id?.slice(0,8)} · Estado actual: <strong>{order.status}</strong>
        </div>
        <label style={{ fontSize:'0.82rem', fontWeight:600 }}>
          Nuevo estado
          <select value={status} onChange={e => setStatus(e.target.value)}
            style={{ display:'block', width:'100%', marginTop:4, marginBottom:12, boxSizing:'border-box' }}>
            <option value="">— seleccionar —</option>
            {VALID_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label style={{ fontSize:'0.82rem', fontWeight:600 }}>
          Nota interna (opcional)
          <input value={note} onChange={e => setNote(e.target.value)}
            style={{ display:'block', width:'100%', marginTop:4, marginBottom:16, boxSizing:'border-box' }} />
        </label>
        <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
          <button onClick={onClose}
            style={{ padding:'0.4rem 1rem', borderRadius:8, border:'1px solid var(--border)', background:'var(--bg-raised)', cursor:'pointer' }}>
            Cancelar
          </button>
          <button disabled={!status} onClick={() => { if (status) onConfirm(order.id, status, note); }}
            style={{ padding:'0.4rem 1rem', borderRadius:8, border:'none',
              background: status ? 'var(--brand)' : 'var(--border)', color:'#fff', cursor: status ? 'pointer' : 'default', fontWeight:700 }}>
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const { auth } = useAuth();
  const navigate         = useNavigate();
  const [tab,           setTab]           = useState('map');
  const [loading,       setLoading]       = useState(false);
  const [msg,           setMsg]           = useState('');
  const [liveData,      setLiveData]      = useState({ orders: [], drivers: [] });
  const [liveOffers,    setLiveOffers]    = useState([]);
  const [orderLog,      setOrderLog]      = useState([]);
  const dashboardTick   = useTick(1000);
  const [actionLoading, setActionLoading] = useState('');
  const [forceStatusOrder, setForceStatusOrder] = useState(null);

  // Platform pause
  const [paused,        setPaused]        = useState(false);
  const [pauseLoading,  setPauseLoading]  = useState(false);

  // Fin de día
  const [finDiaLoading, setFinDiaLoading] = useState(false);

  // Mobile: sidebar open state
  const [sidebarOpen, setSidebarOpen]   = useState(false);

  // Tab data
  const [orders,       setOrders]       = useState([]);
  const [metrics,      setMetrics]      = useState(null);
  const [users,        setUsers]        = useState([]);
  const [engineParams, setEngineParams] = useState([]);
  const [reports,      setReports]      = useState([]);
  const [reportsDone,  setReportsDone]  = useState([]);
  const [notes,        setNotes]        = useState([]);
  const [ratings,      setRatings]      = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [metricDays,   setMetricDays]   = useState(7);
  const [paramMsg,     setParamMsg]     = useState('');

  const debounceTimer = useRef(null);
  const lastReload    = useRef({});

  // Load platform pause status on mount
  useEffect(() => {
    if (!auth.token) return;
    apiFetch('/admin/platform/status', {}, auth.token)
      .then(d => setPaused(Boolean(d.paused)))
      .catch(() => {});
  }, [auth.token]);

  const loadAssignment = useCallback(async () => {
    if (!auth.token) return;
    const d = await apiFetch('/admin/assignment-live', {}, auth.token);
    setLiveData(d);
  }, [auth.token]);

  const loadOrders = useCallback(async () => {
    if (!auth.token) return;
    const qs = statusFilter ? `?status=${statusFilter}&limit=200` : '?limit=200';
    const d  = await apiFetch(`/admin/orders${qs}`, {}, auth.token);
    setOrders(d.orders || []);
  }, [auth.token, statusFilter]);

  const loadMetrics = useCallback(async () => {
    if (!auth.token) return;
    const d = await apiFetch(`/admin/metrics?days=${metricDays}`, {}, auth.token);
    setMetrics(d);
  }, [auth.token, metricDays]);

  const loadUsers = useCallback(async () => {
    if (!auth.token) return;
    const d = await apiFetch('/admin/users', {}, auth.token);
    setUsers(d.users || []);
  }, [auth.token]);

  const loadEngine = useCallback(async () => {
    if (!auth.token) return;
    const d = await apiFetch('/admin/engine-params', {}, auth.token);
    setEngineParams(d.params || []);
  }, [auth.token]);

  const loadReports = useCallback(async () => {
    if (!auth.token) return;
    const [pending, done] = await Promise.all([
      apiFetch('/admin/reports?reviewed=false', {}, auth.token),
      apiFetch('/admin/reports?reviewed=true',  {}, auth.token),
    ]);
    setReports(pending.reports || []);
    setReportsDone(done.reports || []);
  }, [auth.token]);

  const loadNotes = useCallback(async () => {
    if (!auth.token) return;
    const d = await apiFetch('/admin/order-notes', {}, auth.token);
    setNotes(d.notes || []);
  }, [auth.token]);

  const loadRatings = useCallback(async () => {
    if (!auth.token) return;
    const d = await apiFetch('/admin/ratings', {}, auth.token);
    setRatings(d.ratings || []);
  }, [auth.token]);

  const loaders = {
    map:        () => Promise.resolve(),
    assignment: loadAssignment,
    orders:     loadOrders,
    metrics:    loadMetrics,
    users:      loadUsers,
    engine:     loadEngine,
    reports:    loadReports,
    notes:      loadNotes,
    ratings:    loadRatings,
    system:     () => Promise.resolve(),
    feed:       () => Promise.resolve(),
    emergency:  () => Promise.resolve(),
    support:    () => Promise.resolve(),
  };

  const debouncedLoad = useCallback((force = false) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    const now  = Date.now();
    const last = lastReload.current[tab] || 0;
    if (!force && now - last < 2000) return;
    if (!force && loading) return;
    debounceTimer.current = setTimeout(() => {
      const fn = loaders[tab];
      if (fn) {
        setLoading(true);
        lastReload.current[tab] = Date.now();
        Promise.resolve(fn()).catch(e => setMsg(e.message)).finally(() => setLoading(false));
      }
      debounceTimer.current = null;
    }, 300);
  }, [tab, loaders, loading]); // eslint-disable-line

  useEffect(() => { debouncedLoad(); }, [tab, debouncedLoad]); // eslint-disable-line

  // Auto-refresh assignment every 15s
  useEffect(() => {
    if (tab !== 'assignment') return;
    const id = setInterval(() => loadAssignment().catch(() => {}), 15000);
    return () => clearInterval(id);
  }, [tab, loadAssignment]);

  async function handleTogglePause() {
    setPauseLoading(true);
    try {
      const next = !paused;
      await apiFetch('/admin/platform/pause', { method: 'PATCH', body: JSON.stringify({ paused: next }) }, auth.token);
      setPaused(next);
      setMsg(next ? 'Plataforma pausada — no se aceptarán nuevos pedidos' : 'Plataforma reactivada');
    } catch (e) { setMsg(e.message); }
    finally { setPauseLoading(false); }
  }

  async function handleFinDia() {
    if (!window.confirm('¿Marcar fin de día? Esto te pondrá como no disponible como driver.')) return;
    setFinDiaLoading(true);
    try {
      await apiFetch('/drivers/availability', { method: 'PATCH', body: JSON.stringify({ isAvailable: false }) }, auth.token);
      setMsg('Fin de día registrado. Driver marcado como no disponible.');
    } catch (e) { setMsg(e.message); }
    finally { setFinDiaLoading(false); }
  }

  const handleForceOrderStatus = async (orderId, newStatus, note) => {
    setForceStatusOrder(null);
    setActionLoading(orderId);
    try {
      await apiFetch(`/admin/orders/${orderId}/status`,
        { method: 'PATCH', body: JSON.stringify({ status: newStatus, note: note || '' }) }, auth.token);
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o));
      setMsg(`Pedido actualizado a "${newStatus}"`);
    } catch (e) { setMsg(`Error: ${e.message}`); }
    finally { setActionLoading(''); }
  };

  const handleToggleUserStatus = async (user) => {
    const next  = user.status === 'active' ? 'suspended' : 'active';
    const label = next === 'suspended' ? 'suspender' : 'activar';
    if (!window.confirm(`¿${label} a ${user.full_name || user.username}?`)) return;
    setActionLoading(user.id);
    try {
      await apiFetch(`/admin/users/${user.id}/status`,
        { method: 'PATCH', body: JSON.stringify({ status: next }) }, auth.token);
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, status: next } : u));
      setMsg(`Usuario ${next === 'active' ? 'activado' : 'suspendido'}`);
    } catch (e) { setMsg(`Error: ${e.message}`); }
    finally { setActionLoading(''); }
  };

  const handleCreateAdmin = async (newUser) => {
    try {
      await apiFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          username: newUser.username, password: newUser.password,
          role: 'admin', displayName: newUser.displayName || undefined,
        }),
      }, auth.token);
      setMsg('Admin creado');
      loadUsers();
    } catch (e) { setMsg(e.message); }
  };

  const handleSaveEngineParam = async (key, value) => {
    setParamMsg('');
    try {
      const r = await apiFetch(`/admin/engine-params/${key}`,
        { method: 'PATCH', body: JSON.stringify({ value: Number(value) }) }, auth.token);
      setEngineParams(r.params || []);
      setParamMsg('Guardado');
      setTimeout(() => setParamMsg(''), 2500);
    } catch (e) { setParamMsg(e.message); }
  };

  const handleReviewReport = async (reportId) => {
    try {
      await apiFetch(`/admin/reports/${reportId}/review`, { method: 'PATCH' }, auth.token);
      setReports(prev => prev.filter(r => r.id !== reportId));
      const done = await apiFetch('/admin/reports?reviewed=true', {}, auth.token);
      setReportsDone(done.reports || []);
    } catch (e) { setMsg(e.message); }
  };

  useRealtimeOrders(
    auth.token,
    (data) => {
      const entry = { ts: Date.now(), type: 'order', orderId: data.orderId?.slice(0,8), extra: data.status || '' };
      setOrderLog(prev => [entry, ...prev].slice(0, 50));
      if (['assignment','orders'].includes(tab)) debouncedLoad();
    },
    () => {},
    (data) => {
      const entry = { ts: Date.now(), type: 'offer', orderId: data.orderId?.slice(0,8), extra: `driver:${(data.driverId||'').slice(0,8)}` };
      setLiveOffers(prev => [entry, ...prev].slice(0, 50));
      if (tab === 'assignment') debouncedLoad();
    },
    undefined,
    () => { if (['assignment','orders'].includes(tab)) debouncedLoad(); },
  );

  function changeTab(key) {
    setTab(key);
    setSidebarOpen(false);
  }

  const feedCount = liveOffers.length + orderLog.length;
  const unassignedCount = liveData.orders.filter(o => !o.driver_id).length;

  // ── Layout ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100vh', overflow:'hidden' }}>

      {/* ── Header ── */}
      <header style={{
        display:'flex', alignItems:'center', gap:8,
        padding:'0.5rem 1rem', flexShrink:0,
        background:'var(--promo-gradient)', color:'#fff',
        boxShadow:'0 1px 8px rgba(0,0,0,0.18)',
      }}>
        {/* Mobile menu toggle */}
        <button onClick={() => setSidebarOpen(o => !o)} style={{
          background:'rgba(255,255,255,0.15)', border:'none', borderRadius:6,
          color:'#fff', padding:'0.35rem 0.5rem', cursor:'pointer', fontSize:'1.1rem',
          display:'block',
        }}>☰</button>

        <span style={{ fontWeight:800, fontSize:'0.95rem', flex:1 }}>
          Panel admin
        </span>

        {/* Pause toggle */}
        <button
          disabled={pauseLoading}
          onClick={handleTogglePause}
          style={{
            padding:'0.3rem 0.75rem', borderRadius:8, fontWeight:700, fontSize:'0.78rem',
            border: '1.5px solid rgba(255,255,255,0.4)', cursor:'pointer',
            background: paused ? '#dc2626' : 'rgba(255,255,255,0.15)',
            color:'#fff',
          }}
          title={paused ? 'Plataforma pausada — click para reanudar' : 'Pausar plataforma'}
        >
          {pauseLoading ? '…' : paused ? '▶ Reanudar' : '⏸ Pausar'}
        </button>

        {/* Modo Driver */}
        <button
          onClick={() => navigate('/driver')}
          style={{
            padding:'0.3rem 0.75rem', borderRadius:8, fontWeight:700, fontSize:'0.78rem',
            border:'1.5px solid rgba(255,255,255,0.4)', cursor:'pointer',
            background:'rgba(255,255,255,0.15)', color:'#fff',
          }}
          title="Cambiar a vista de driver"
        >
          🏍 Modo Driver
        </button>

        {/* Fin de día */}
        <button
          disabled={finDiaLoading}
          onClick={handleFinDia}
          style={{
            padding:'0.3rem 0.75rem', borderRadius:8, fontWeight:700, fontSize:'0.78rem',
            border:'1.5px solid rgba(255,255,255,0.4)', cursor:'pointer',
            background:'rgba(255,255,255,0.1)', color:'#fff',
          }}
          title="Marcar fin de jornada como driver"
        >
          {finDiaLoading ? '…' : '🌙 Fin de día'}
        </button>
      </header>

      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>

        {/* ── Sidebar ── */}
        <aside style={{
          width: sidebarOpen ? 210 : 0,
          flexShrink: 0,
          overflow: 'hidden',
          transition: 'width 0.18s ease',
          borderRight: '1px solid var(--border)',
          background: 'var(--bg-card)',
          display: 'flex', flexDirection: 'column',
          overflowY: 'auto',
        }}>
          <div style={{ minWidth: 210 }}>
            {NAV_GROUPS.map(group => (
              <div key={group.label} style={{ marginBottom: 4 }}>
                <div style={{
                  fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.08em',
                  color: 'var(--text-tertiary)', padding: '0.6rem 0.75rem 0.2rem',
                }}>
                  {group.label}
                </div>
                {group.items.map(item => {
                  const isActive = tab === item.key;
                  let badge = null;
                  if (item.badge === 'reportsCount' && reports.length > 0) badge = reports.length;
                  if (item.key === 'assignment' && unassignedCount > 0) badge = unassignedCount;
                  return (
                    <button key={item.key} onClick={() => changeTab(item.key)} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      width: '100%', padding: '0.5rem 0.75rem',
                      background: isActive ? 'var(--brand-light)' : 'transparent',
                      color: isActive ? 'var(--brand)' : 'var(--text-secondary)',
                      border: 'none', cursor: 'pointer', textAlign: 'left',
                      fontWeight: isActive ? 700 : 400, fontSize: '0.85rem',
                      borderRadius: 6, margin: '1px 4px', width: 'calc(100% - 8px)',
                    }}>
                      <span style={{ flex:1 }}>{item.label}</span>
                      {badge != null && (
                        <span style={{
                          fontSize: '0.68rem', fontWeight: 800, borderRadius: 999,
                          padding: '1px 6px', background: 'var(--brand)', color: '#fff',
                        }}>{badge}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}

            {/* Collapsed: herramientas */}
            <div style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 4 }}>
              <div style={{
                fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.08em',
                color: 'var(--text-tertiary)', padding: '0.4rem 0.75rem 0.2rem',
              }}>
                HERRAMIENTAS
              </div>
              {['feed','system'].map(key => (
                <button key={key} onClick={() => changeTab(key)} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  width: 'calc(100% - 8px)', padding: '0.4rem 0.75rem',
                  background: tab === key ? 'var(--brand-light)' : 'transparent',
                  color: tab === key ? 'var(--brand)' : 'var(--text-tertiary)',
                  border: 'none', cursor: 'pointer', textAlign: 'left',
                  fontWeight: tab === key ? 700 : 400, fontSize: '0.78rem',
                  borderRadius: 6, margin: '1px 4px',
                }}>
                  {key === 'feed'
                    ? `📡 Feed${feedCount > 0 ? ` (${feedCount})` : ''}`
                    : '🔧 Sistema'}
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* ── Content ── */}
        <main style={{ flex:1, overflow:'hidden', display:'flex', flexDirection:'column', minWidth:0 }}>

          {/* Tab header row (when sidebar closed) */}
          {!sidebarOpen && (
            <div style={{
              display:'flex', alignItems:'center', gap:6, padding:'0.4rem 0.75rem',
              borderBottom:'1px solid var(--border)', background:'var(--bg-card)', flexShrink:0,
              overflowX:'auto',
            }}>
              {/* Quick-access buttons for common tabs */}
              {[
                { key:'map',        label:'🗺 Mapa' },
                { key:'assignment', label:`🛵 Live${unassignedCount ? ` (${unassignedCount})` : ''}` },
                { key:'orders',     label:'Pedidos' },
                { key:'metrics',    label:'Métricas' },
                { key:'users',      label:'Usuarios' },
                { key:'emergency',  label:'Operaciones' },
                { key:'reports',    label:`Reportes${reports.length > 0 ? ` (${reports.length})` : ''}` },
              ].map(({ key, label }) => (
                <button key={key} onClick={() => setTab(key)} style={{
                  padding:'0.3rem 0.7rem', border:'none', cursor:'pointer', borderRadius:6,
                  fontWeight: tab === key ? 700 : 400, fontSize:'0.8rem', whiteSpace:'nowrap',
                  background: tab === key ? 'var(--brand)' : 'transparent',
                  color: tab === key ? '#fff' : 'var(--text-secondary)',
                }}>
                  {label}
                </button>
              ))}
              <button onClick={() => debouncedLoad(true)} style={{
                marginLeft:'auto', padding:'0.3rem 0.6rem', border:'1px solid var(--border)',
                borderRadius:6, cursor:'pointer', fontSize:'0.78rem',
                background:'var(--bg-card)', flexShrink:0,
              }}>↻</button>
            </div>
          )}

          <div style={{ flex:1, overflow:'auto', padding: tab === 'map' ? 0 : '0.75rem 1rem' }}>
            {tab === 'map'        && <AdminMap token={auth.token} />}
            {tab === 'assignment' && <AssignmentTab liveData={liveData} tick={dashboardTick} />}
            {tab === 'orders'     && (
              <OrdersTab
                orders={orders} statusFilter={statusFilter}
                onStatusFilterChange={setStatusFilter}
                onForceStatus={(orderId, currentStatus) => {
                  const order = orders.find(o => o.id === orderId) || { id: orderId, status: currentStatus };
                  setForceStatusOrder(order);
                }}
                actionLoading={actionLoading}
              />
            )}
            {tab === 'metrics'   && <MetricsTab metrics={metrics} metricDays={metricDays} onMetricDaysChange={setMetricDays} />}
            {tab === 'users'     && (
              <UsersTab users={users} onToggleUser={handleToggleUserStatus}
                onAdminCreate={handleCreateAdmin} actionLoading={actionLoading} />
            )}
            {tab === 'engine'    && (
              <EngineTab params={engineParams} onSave={handleSaveEngineParam}
                onReload={loadEngine} loading={loading} msg={paramMsg} actionLoading={actionLoading} />
            )}
            {tab === 'reports'   && (
              <ReportsTab reports={reports} reportsDone={reportsDone}
                onReview={handleReviewReport} loadingId={actionLoading} />
            )}
            {tab === 'notes'     && <NotesTab notes={notes} />}
            {tab === 'ratings'   && <RatingsTab ratings={ratings} />}
            {tab === 'feed'      && (
              <FeedTab offers={liveOffers} logs={orderLog}
                onClear={() => { setLiveOffers([]); setOrderLog([]); }} />
            )}
            {tab === 'system'    && <SystemTab onMessage={setMsg} />}
            {tab === 'emergency' && <EmergencyTab token={auth.token} />}
            {tab === 'support'   && <SupportTab   token={auth.token} />}
          </div>
        </main>
      </div>

      {/* Force status modal */}
      {forceStatusOrder && (
        <ForceStatusModal
          order={forceStatusOrder}
          onConfirm={handleForceOrderStatus}
          onClose={() => setForceStatusOrder(null)}
        />
      )}

      {/* Toast message */}
      {msg && (
        <div style={{
          position:'fixed', bottom:'1rem', left:'50%', transform:'translateX(-50%)',
          background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:8,
          padding:'0.5rem 1rem', fontSize:'0.82rem', boxShadow:'0 4px 16px rgba(0,0,0,0.12)',
          zIndex:9000, maxWidth:360,
        }}>
          {msg}
          <button onClick={() => setMsg('')} style={{
            background:'none', border:'none', cursor:'pointer',
            marginLeft:'0.5rem', color:'var(--text-tertiary)', fontSize:'0.8rem',
          }}>✕</button>
        </div>
      )}
    </div>
  );
}
