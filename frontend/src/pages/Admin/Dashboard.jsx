// frontend/src/pages/Admin/Dashboard.jsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useRealtimeOrders } from '../../hooks/useRealtimeOrders';
import { DashboardTabsBar } from '../../features/admin/dashboard/sections';
import { useTick } from '../../features/admin/dashboard/shared';
import PullToRefresh from '../../components/PullToRefresh';
import { apiFetch } from '../../api/client';

// Tabs
import { AssignmentTab } from '../../features/admin/dashboard/sections';
import OrdersTab from '../../features/admin/dashboard/tabs/OrdersTab';
import MetricsTab from '../../features/admin/dashboard/tabs/MetricsTab';
import UsersTab from '../../features/admin/dashboard/tabs/UsersTab';
import EngineTab from '../../features/admin/dashboard/tabs/EngineTab';
import ReportsTab from '../../features/admin/dashboard/tabs/ReportsTab';
import NotesTab from '../../features/admin/dashboard/tabs/NotesTab';
import RatingsTab from '../../features/admin/dashboard/tabs/RatingsTab';
import FeedTab from '../../features/admin/dashboard/tabs/FeedTab';
import SystemTab from '../../features/admin/dashboard/tabs/SystemTab';


export default function AdminDashboard() {
  const { auth } = useAuth();
  const [tab, setTab] = useState('assignment');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [liveData, setLiveData] = useState({ orders: [], drivers: [] });
  const [liveOffers, setLiveOffers] = useState([]);
  const [orderLog, setOrderLog] = useState([]);
  const dashboardTick = useTick(1000);
  const [actionLoading, setActionLoading] = useState('');

  // Datos de cada tab
  const [orders, setOrders] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [users, setUsers] = useState([]);
  const [engineParams, setEngineParams] = useState([]);
  const [reports, setReports] = useState([]);
  const [reportsDone, setReportsDone] = useState([]);
  const [notes, setNotes] = useState([]);
  const [ratings, setRatings] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [metricDays, setMetricDays] = useState(7);
  const [paramMsg, setParamMsg] = useState('');

  // Debounce y cooldown
  const debounceTimer = useRef(null);
  const lastReload = useRef({});

  // Funciones de carga
  const loadAssignment = useCallback(async () => {
    if (!auth.token) return;
    const d = await apiFetch('/admin/assignment-live', {}, auth.token);
    setLiveData(d);
  }, [auth.token]);

  const loadOrders = useCallback(async () => {
    if (!auth.token) return;
    const qs = statusFilter ? `?status=${statusFilter}&limit=200` : '?limit=200';
    const d = await apiFetch(`/admin/orders${qs}`, {}, auth.token);
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
                                              apiFetch('/admin/reports?reviewed=true', {}, auth.token),
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
    assignment: loadAssignment,
    orders: loadOrders,
    metrics: loadMetrics,
    users: loadUsers,
    engine: loadEngine,
    reports: loadReports,
    notes: loadNotes,
    ratings: loadRatings,
    system: () => Promise.resolve(),  // ← devuelve promesa resuelta
    feed: () => Promise.resolve(),
  };

  const debouncedLoad = useCallback((force = false) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    const now = Date.now();
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
  }, [tab, loaders, loading]);

  // Cargar al cambiar de tab
  useEffect(() => {
    debouncedLoad();
  }, [tab, debouncedLoad]);

  // Handlers de acciones
  const handleForceOrderStatus = async (orderId, currentStatus) => {
    const validStatuses = ['created', 'accepted', 'preparing', 'ready', 'on_the_way', 'delivered', 'cancelled'];
    const next = window.prompt(`Estado actual: ${currentStatus}\nNuevo estado (${validStatuses.join(', ')}):`);
    if (!next || !validStatuses.includes(next.trim())) return;
    const note = window.prompt('Nota interna (opcional):') || '';
    setActionLoading(orderId);
    try {
      await apiFetch(`/admin/orders/${orderId}/status`, { method: 'PATCH', body: JSON.stringify({ status: next.trim(), note }) }, auth.token);
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: next.trim() } : o));
      setMsg(`Pedido actualizado a "${next.trim()}"`);
    } catch (e) { setMsg(`Error: ${e.message}`); }
    finally { setActionLoading(''); }
  };

  const handleToggleUserStatus = async (user) => {
    const next = user.status === 'active' ? 'suspended' : 'active';
    const label = next === 'suspended' ? 'suspender' : 'activar';
    if (!window.confirm(`¿${label} a ${user.full_name || user.username}?`)) return;
    setActionLoading(user.id);
    try {
      await apiFetch(`/admin/users/${user.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: next }) }, auth.token);
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, status: next } : u));
      setMsg(`Usuario ${next === 'active' ? 'activado' : 'suspendido'} correctamente`);
    } catch (e) { setMsg(`Error: ${e.message}`); }
    finally { setActionLoading(''); }
  };

  const handleCreateAdmin = async (newUser) => {
    try {
      await apiFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username: newUser.username, password: newUser.password, role: 'admin', displayName: newUser.displayName || undefined }),
      }, auth.token);
      setMsg('Admin creado');
      loadUsers(); // recargar lista
    } catch (e) { setMsg(e.message); }
  };

  const handleSaveEngineParam = async (key, value) => {
    setParamMsg('');
    try {
      const r = await apiFetch(`/admin/engine-params/${key}`, { method: 'PATCH', body: JSON.stringify({ value: Number(value) }) }, auth.token);
      setEngineParams(r.params || []);
      setParamMsg('✓ Guardado');
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

  // SSE
  useRealtimeOrders(
    auth.token,
    (data) => {
      const entry = { ts: Date.now(), type: 'order', orderId: data.orderId?.slice(0,8), extra: data.status || '' };
      setOrderLog(prev => [entry, ...prev].slice(0, 50));
      if (['assignment', 'orders'].includes(tab)) {
        debouncedLoad(); // con debounce y cooldown
      }
    },
    () => {},
                    (data) => {
                      const entry = { ts: Date.now(), type: 'offer', orderId: data.orderId?.slice(0,8), extra: `driver:${(data.driverId||'').slice(0,8)}` };
                      setLiveOffers(prev => [entry, ...prev].slice(0, 50));
                      if (tab === 'assignment') debouncedLoad();
                    },
                    undefined,
                    () => { if (['assignment', 'orders'].includes(tab)) debouncedLoad(); },
  );

  return (
    <PullToRefresh>
    <div
    style={{
      padding: '1rem',
      maxWidth: 1200,
      margin: '0 auto',
      height: '100vh',
      overflowY: 'auto',
      position: 'relative'
    }}
    >
    <div style={{ margin: '-1rem -1rem 1.25rem', padding: '0.75rem 1rem 0.65rem', background: 'var(--promo-gradient)', color: '#fff' }}>
    <div style={{ fontWeight: 800, fontSize: '1.05rem' }}>🛠 Panel de administración</div>
    </div>

    <DashboardTabsBar
    tab={tab}
    onTabChange={setTab}
    onReload={() => debouncedLoad(true)}
    unassignedCount={liveData.orders.filter(o => !o.driver_id).length}
    reportsCount={reports.length}
    feedCount={liveOffers.length + orderLog.length}
    />

    {tab === 'assignment' && <AssignmentTab liveData={liveData} tick={dashboardTick} />}
    {tab === 'orders' && (
      <OrdersTab
      orders={orders}
      statusFilter={statusFilter}
      onStatusFilterChange={setStatusFilter}
      onForceStatus={handleForceOrderStatus}
      actionLoading={actionLoading}
      />
    )}
    {tab === 'metrics' && <MetricsTab metrics={metrics} metricDays={metricDays} onMetricDaysChange={setMetricDays} />}
    {tab === 'users' && (
      <UsersTab
      users={users}
      onToggleUser={handleToggleUserStatus}
      onAdminCreate={handleCreateAdmin}
      actionLoading={actionLoading}
      />
    )}
    {tab === 'engine' && (
      <EngineTab
      params={engineParams}
      onSave={handleSaveEngineParam}
      onReload={loadEngine}
      loading={loading}
      msg={paramMsg}
      actionLoading={actionLoading}
      />
    )}
    {tab === 'reports' && (
      <ReportsTab
      reports={reports}
      reportsDone={reportsDone}
      onReview={handleReviewReport}
      loadingId={actionLoading}
      />
    )}
    {tab === 'notes' && <NotesTab notes={notes} />}
    {tab === 'ratings' && <RatingsTab ratings={ratings} />}
    {tab === 'feed' && (
      <FeedTab
      offers={liveOffers}
      logs={orderLog}
      onClear={() => { setLiveOffers([]); setOrderLog([]); }}
      />
    )}
    {tab === 'system' && <SystemTab onMessage={setMsg} />}
    </div>
    </PullToRefresh>
  );
}

