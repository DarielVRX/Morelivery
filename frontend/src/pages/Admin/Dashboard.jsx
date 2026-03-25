// frontend/src/pages/Admin/Dashboard.jsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useRealtimeOrders } from '../../hooks/useRealtimeOrders';

import { DashboardTabsBar, AssignmentTab } from '../../features/admin/dashboard/sections';
import { useTick, fmt, fmtDate, Th, Td, Badge } from '../../features/admin/dashboard/shared';
import PullToRefresh from '../../components/PullToRefresh';

// ─── Funciones auxiliares para tests del sistema ─────────────────────────────
async function requestNotificationPermissionTest() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  const result = await Notification.requestPermission();
  return result;
}

async function testPushNotification(token) {
  try {
    await apiFetch('/admin/test-push', { method: 'POST' }, token);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function getBatteryStatus() {
  if (!('getBattery' in navigator)) return null;
  try {
    const battery = await navigator.getBattery();
    return {
      level: Math.round(battery.level * 100),
      charging: battery.charging,
      chargingTime: battery.chargingTime,
      dischargingTime: battery.dischargingTime,
    };
  } catch {
    return null;
  }
}

function getNetworkInfo() {
  if (!('connection' in navigator)) return null;
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  return {
    type: conn.type,
    effectiveType: conn.effectiveType,
    downlink: conn.downlink,
    rtt: conn.rtt,
    saveData: conn.saveData,
  };
}

async function testClipboard() {
  if (!navigator.clipboard?.writeText) return 'unsupported';
  try {
    await navigator.clipboard.writeText('Morelivery test');
    // Leer para verificar permiso de lectura (si aplica)
    const read = await navigator.clipboard.readText().catch(() => null);
    return read !== null ? 'read+write' : 'write-only';
  } catch (e) {
    if (e.name === 'NotAllowedError') return 'denied';
    return 'error';
  }
}

// ─── MAIN DASHBOARD ──────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const { auth } = useAuth();
  const [tab, setTab]           = useState('assignment');
  const [orders, setOrders]     = useState([]);
  const [metrics, setMetrics]   = useState(null);
  const [users, setUsers]       = useState([]);
  const [liveData, setLiveData] = useState({ orders:[], drivers:[] });
  const [statusFilter, setStatusFilter] = useState('');
  const [metricDays, setMetricDays]     = useState(7);
  const [loading, setLoading]   = useState(false);
  const [msg, setMsg]           = useState('');
  const [liveOffers, setLiveOffers] = useState([]);
  const [orderLog, setOrderLog]     = useState([]);
  const [actionLoading, setActionLoading] = useState(''); // id de la entidad en operación
  const dashboardTick = useTick(1000);

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

  // ── Sistema ────────────────────────────────────────────────────────────────
  const [systemStatus, setSystemStatus] = useState({
    sseConnected: 0,
    sseByRole: {},
    swActive: false,
    pushSubscribed: false,
    geolocation: 'unknown',
    persistentStorage: 'unknown',
    wakeLock: 'unsupported',
    clipboard: 'unknown',
    battery: null,
    network: null,
    testPushResult: null,
  });
  const [systemLoading, setSystemLoading] = useState(false);

  async function refreshSystemStatus() {
    if (!auth.token) return;
    setSystemLoading(true);
    try {
      // 1. SSE status
      try {
        const sse = await apiFetch('/admin/sse-status', {}, auth.token);
        setSystemStatus(prev => ({ ...prev, sseConnected: sse.connected, sseByRole: sse.byRole }));
      } catch (e) { console.warn(e); }

      // 2. Service Worker
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        setSystemStatus(prev => ({ ...prev, swActive: !!reg?.active }));
      }

      // 3. Push subscription
      if ('serviceWorker' in navigator && 'PushManager' in window) {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        setSystemStatus(prev => ({ ...prev, pushSubscribed: !!sub }));
      }

      // 4. Geolocation
      if ('geolocation' in navigator && navigator.permissions?.query) {
        const perm = await navigator.permissions.query({ name: 'geolocation' });
        setSystemStatus(prev => ({ ...prev, geolocation: perm.state }));
      }

      // 5. Persistent storage
      if (navigator.storage?.persisted) {
        const persisted = await navigator.storage.persisted();
        setSystemStatus(prev => ({ ...prev, persistentStorage: persisted ? 'granted' : 'denied' }));
      }

      // 6. Wake Lock
      setSystemStatus(prev => ({ ...prev, wakeLock: 'wakeLock' in navigator ? 'supported' : 'unsupported' }));

      // 7. Clipboard
      const clipStatus = await testClipboard();
      setSystemStatus(prev => ({ ...prev, clipboard: clipStatus }));

      // 8. Battery
      const battery = await getBatteryStatus();
      setSystemStatus(prev => ({ ...prev, battery }));

      // 9. Network
      setSystemStatus(prev => ({ ...prev, network: getNetworkInfo() }));
    } catch (e) {
      setMsg(`Error al actualizar estado del sistema: ${e.message}`);
    } finally {
      setSystemLoading(false);
    }
  }

  async function handleTestPush() {
    setSystemStatus(prev => ({ ...prev, testPushResult: null }));
    const result = await testPushNotification(auth.token);
    setSystemStatus(prev => ({ ...prev, testPushResult: result }));
    if (result.ok) {
      setMsg('Notificación de prueba enviada (si el navegador lo permite)');
    } else {
      setMsg(`Error al enviar notificación: ${result.error}`);
    }
    setTimeout(() => setSystemStatus(prev => ({ ...prev, testPushResult: null })), 5000);
  }

  async function handleToggleWakeLock() {
    if (!('wakeLock' in navigator)) {
      setMsg('Wake Lock no soportado en este navegador');
      return;
    }
    try {
      // Usar la misma lógica que en usePermissions
      if (window.wakeLockSentinel) {
        await window.wakeLockSentinel.release();
        window.wakeLockSentinel = null;
        setSystemStatus(prev => ({ ...prev, wakeLock: 'released' }));
      } else {
        const lock = await navigator.wakeLock.request('screen');
        window.wakeLockSentinel = lock;
        setSystemStatus(prev => ({ ...prev, wakeLock: 'active' }));
        lock.addEventListener('release', () => {
          window.wakeLockSentinel = null;
          setSystemStatus(prev => ({ ...prev, wakeLock: 'supported' }));
        });
      }
    } catch (e) {
      setMsg(`Wake Lock error: ${e.message}`);
    }
  }

  // ── Carga de datos según tab ──────────────────────────────────────────────
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
      } else if (tab === 'system') {
        await refreshSystemStatus();
      }
    } catch (e) {
      setMsg(e.message);
    } finally {
      setLoading(false);
    }
  }, [auth.token, tab, statusFilter, metricDays]);

  useEffect(() => { load(); }, [load]);

  const reloadTimerRef = useRef(null);
  const scheduleReload = useCallback(() => {
    clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = setTimeout(() => {
      load();
      reloadTimerRef.current = null;
    }, 250);
  }, [load]);

  useEffect(() => () => clearTimeout(reloadTimerRef.current), []);

  // SSE: recibir eventos de ofertas y pedidos en tiempo real
  useRealtimeOrders(
    auth.token,
    (data) => {
      const entry = { ts: Date.now(), type:'order', orderId: data.orderId?.slice(0,8), extra: data.status || data.action || '' };
      setOrderLog(prev => [entry, ...prev].slice(0, 50));
      if (['assignment', 'orders'].includes(tab)) scheduleReload();
    },
    () => {},
                    (data) => {
                      const entry = { ts: Date.now(), type:'offer', orderId: data.orderId?.slice(0,8), extra: `driver:${(data.driverId||'').slice(0,8)}` };
                      setLiveOffers(prev => [entry, ...prev].slice(0, 50));
                      if (tab === 'assignment') scheduleReload();
                    },
                    undefined,
                    () => { if (['assignment', 'orders'].includes(tab)) load(); },
  );

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

  return (
    <PullToRefresh>
    <div style={{ padding:'1rem', maxWidth:1200, margin:'0 auto' }}>
    {/* Encabezado */}
    <div style={{ margin:'-1rem -1rem 1.25rem', padding:'0.75rem 1rem 0.65rem', background:'var(--promo-gradient)', color:'#fff' }}>
    <div style={{ fontWeight:800, fontSize:'1.05rem' }}>🛠 Panel de administración</div>
    <div style={{ fontSize:'0.75rem', opacity:0.8, marginTop:'0.1rem' }}>Vista completa del sistema</div>
    </div>

    <DashboardTabsBar
    tab={tab}
    onTabChange={setTab}
    onReload={load}
    unassignedCount={liveData.orders.filter((order) => !order.driver_id).length}
    reportsCount={reports.length}
    feedCount={liveOffers.length + orderLog.length}
    />

    {msg && <p className="flash flash-error" style={{ marginBottom:'0.75rem' }}>{msg}</p>}
    {loading && <div style={{ color:'var(--text-tertiary)', fontSize:'0.85rem', marginBottom:'0.5rem' }}>Cargando…</div>}

    {tab === 'assignment' && <AssignmentTab liveData={liveData} tick={dashboardTick} />}

    {/* ── TAB: PEDIDOS ── */}
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
        <Td>{o.pending_offers > 0 ? <span style={{color:'var(--warn)',fontWeight:700}}>⏳{o.pending_offers}</span> : 0}</Td>
        <Td>{o.rejected_offers > 0 ? <span style={{color:'var(--danger)'}}>{o.rejected_offers}</span> : 0}</Td>
        <Td>{o.expired_offers > 0 ? <span style={{color:'var(--text-tertiary)'}}>{o.expired_offers}</span> : 0}</Td>
        <Td>
        <button
        disabled={actionLoading === o.id || ['delivered','cancelled'].includes(o.status)}
        onClick={() => handleForceOrderStatus(o.id, o.status)}
        style={{
          padding:'0.2rem 0.5rem', fontSize:'0.72rem', fontWeight:700, borderRadius:6, cursor:'pointer',
          border:'1px solid var(--warn-border)', background:'var(--warn-bg)', color:'var(--warn)',
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

    {/* ── TAB: MÉTRICAS ── */}
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

    {/* ── TAB: USUARIOS ── */}
    {tab === 'users' && (
      <div>
      <div style={{ border:'1px solid var(--border)', borderRadius:8, padding:'1rem', marginBottom:'1.25rem', background:'var(--bg-raised)' }}>
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
      <thead>
      <tr><Th>Usuario</Th><Th>Nombre</Th><Th>Rol</Th><Th>Estado</Th><Th>Creado</Th><Th>Acción</Th></tr>
      </thead>
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
          border:`1px solid ${u.status==='active'?'var(--danger-border)':'var(--success-border)'}`,
                       background: u.status==='active'?'var(--danger-bg)':'var(--success-bg)',
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

    {/* ── TAB: MOTOR ── */}
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
          background: paramMsg.startsWith('✓') ? 'var(--success-bg)' : 'var(--danger-bg)',
                    border: `1px solid ${paramMsg.startsWith('✓') ? 'var(--success-border)' : 'var(--danger-border)'}`,
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
              <tr key={p.key} style={{ background: isModified ? 'rgba(217,119,6,0.1)' : undefined }}>
              <Td>
              <code style={{ fontSize:'0.75rem', color:'var(--text-primary)', background:'var(--bg-sunken)',
                padding:'0.1rem 0.35rem', borderRadius:4 }}>{p.key}</code>
                </Td>
                <Td style={{ maxWidth:280, color:'var(--text-secondary)', fontSize:'0.75rem' }}>{p.description || '—'}</Td>
                <Td>
                {isEditing ? (
                  <input
                  type="number" step="any"
                  value={paramEditing[p.key]}
                  onChange={e => setParamEditing(prev => ({ ...prev, [p.key]: e.target.value }))}
                  style={{ width:90, padding:'0.2rem 0.4rem', border:'1px solid #60a5fa',
                    borderRadius:4, fontSize:'0.82rem' }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') saveEngineParam(p.key, paramEditing[p.key]);
                      if (e.key === 'Escape') setParamEditing(prev => { const n={...prev}; delete n[p.key]; return n; });
                    }}
                    autoFocus
                    />
                ) : (
                  <span style={{ fontWeight: isModified ? 700 : 400,
                    color: isModified ? 'var(--warn)' : 'var(--text-primary)', fontSize:'0.85rem' }}>
                    {p.value}
                    </span>
                )}
                </Td>
                <Td style={{ color:'var(--text-tertiary)', fontSize:'0.82rem' }}>{p.default ?? '—'}</Td>
                <Td>
                {isEditing ? (
                  <div style={{ display:'flex', gap:'0.3rem' }}>
                  <button
                  disabled={paramSaving === p.key}
                  onClick={() => saveEngineParam(p.key, paramEditing[p.key])}
                  style={{ padding:'0.2rem 0.55rem', background:'var(--success)', color:'#fff',
                    border:'none', borderRadius:4, cursor:'pointer', fontSize:'0.75rem',
                    opacity: paramSaving === p.key ? 0.6 : 1 }}>
                    {paramSaving === p.key ? '…' : 'Guardar'}
                    </button>
                    <button
                    onClick={() => setParamEditing(prev => { const n={...prev}; delete n[p.key]; return n; })}
                    style={{ padding:'0.2rem 0.55rem', background:'var(--bg-raised)',
                      border:'1px solid var(--border)', borderRadius:4, cursor:'pointer', fontSize:'0.75rem' }}>
                      Cancelar
                      </button>
                      </div>
                ) : (
                  <button
                  onClick={() => setParamEditing(prev => ({ ...prev, [p.key]: String(p.value) }))}
                  style={{ padding:'0.2rem 0.55rem', background:'var(--bg-raised)', color:'var(--text-primary)',
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
            style={{ padding:'0.2rem 0.55rem', background:'var(--bg-raised)', border:'1px solid var(--border)',
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

    {/* ── TAB: REPORTES ── */}
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

    {/* ── TAB: NOTAS DE CANCELACIÓN / LIBERACIÓN ── */}
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
          <thead>
          <tr><Th>Pedido</Th><Th>Estado</Th><Th>Tienda</Th><Th>Driver</Th><Th>Nota driver</Th><Th>Nota tienda</Th><Th>Fecha</Th></tr>
          </thead>
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

    {/* ── TAB: RATINGS ── */}
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
          <thead>
          <tr>
          <Th>Pedido</Th><Th>Tienda</Th><Th>Cliente</Th><Th>Driver</Th>
          <Th>Cli→Tienda</Th><Th>Cli→Driver</Th>
          <Th>Tienda→Driver</Th><Th>Driver→Tienda</Th>
          <Th>Comentario</Th><Th>Fecha</Th>
          </tr>
          </thead>
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

    {/* ── TAB: FEED EN VIVO ── */}
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
          background: e._t === 'offer' ? 'rgba(37,99,235,0.1)' : 'rgba(22,163,74,0.1)', display:'flex', gap:'0.75rem' }}>
          <span style={{ color:'var(--text-tertiary)', fontFamily:'monospace' }}>{new Date(e.ts).toLocaleTimeString('es-MX')}</span>
          <span style={{ color: e._t==='offer'?'#60a5fa':'#4ade80', fontWeight:700 }}>{e._t==='offer'?'📤 OFERTA':'📦 PEDIDO'}</span>
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

    {/* ── TAB: SISTEMA ── */}
    {tab === 'system' && (
      <div>
      <div style={{ marginBottom:'1rem', display:'flex', gap:'1rem', alignItems:'center', flexWrap:'wrap' }}>
      <button
      onClick={refreshSystemStatus}
      disabled={systemLoading}
      style={{ padding:'0.4rem 0.8rem', border:'1px solid var(--border)', borderRadius:8, cursor:'pointer', fontSize:'0.85rem' }}
      >
      {systemLoading ? 'Actualizando…' : '↻ Actualizar estado'}
      </button>
      <button
      onClick={handleTestPush}
      style={{ padding:'0.4rem 0.8rem', background:'var(--brand)', color:'white', border:'none', borderRadius:8, cursor:'pointer', fontSize:'0.85rem' }}
      >
      📢 Probar notificación push
      </button>
      <button
      onClick={handleToggleWakeLock}
      style={{ padding:'0.4rem 0.8rem', border:'1px solid var(--border)', borderRadius:8, cursor:'pointer', fontSize:'0.85rem' }}
      >
      {systemStatus.wakeLock === 'active' ? '🔓 Liberar Wake Lock' : '🔒 Activar Wake Lock'}
      </button>
      </div>

      {systemStatus.testPushResult && (
        <div className={`flash ${systemStatus.testPushResult.ok ? 'flash-ok' : 'flash-error'}`} style={{ marginBottom:'1rem' }}>
        {systemStatus.testPushResult.ok ? '✅ Notificación enviada (revisa el centro de notificaciones)' : `❌ Error: ${systemStatus.testPushResult.error}`}
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:'1rem' }}>
      {/* SSE */}
      <div className="card" style={{ padding:'0.8rem', border:'1px solid var(--border)', borderRadius:8 }}>
      <div style={{ fontWeight:700, marginBottom:'0.5rem' }}>📡 SSE</div>
      <div>Conectados: <strong>{systemStatus.sseConnected}</strong></div>
      <div>Por rol: {Object.entries(systemStatus.sseByRole).map(([r,c]) => `${r}:${c}`).join(', ')}</div>
      </div>

      {/* Service Worker */}
      <div className="card" style={{ padding:'0.8rem', border:'1px solid var(--border)', borderRadius:8 }}>
      <div style={{ fontWeight:700, marginBottom:'0.5rem' }}>⚙️ Service Worker</div>
      <div>Estado: {systemStatus.swActive ? '✅ Activo' : '❌ Inactivo'}</div>
      <div style={{ fontSize:'0.75rem', marginTop:'0.3rem', color:'var(--text-tertiary)' }}>
      {systemStatus.swActive ? 'Registrado correctamente' : 'No registrado o no soportado'}
      </div>
      </div>

      {/* Push Subscription */}
      <div className="card" style={{ padding:'0.8rem', border:'1px solid var(--border)', borderRadius:8 }}>
      <div style={{ fontWeight:700, marginBottom:'0.5rem' }}>🔔 Push</div>
      <div>Suscripción: {systemStatus.pushSubscribed ? '✅ Activa' : '❌ No suscrita'}</div>
      {!systemStatus.pushSubscribed && (
        <div style={{ fontSize:'0.7rem', marginTop:'0.3rem', color:'var(--warn)' }}>
        La suscripción push puede requerir permisos de notificaciones.
        </div>
      )}
      </div>

      {/* Geolocation */}
      <div className="card" style={{ padding:'0.8rem', border:'1px solid var(--border)', borderRadius:8 }}>
      <div style={{ fontWeight:700, marginBottom:'0.5rem' }}>📍 Geolocalización</div>
      <div>Estado: <strong>{systemStatus.geolocation}</strong></div>
      <div style={{ fontSize:'0.75rem', marginTop:'0.3rem', color:'var(--text-tertiary)' }}>
      {systemStatus.geolocation === 'granted' ? 'Permiso concedido' : systemStatus.geolocation === 'denied' ? 'Permiso denegado' : 'No se ha solicitado'}
      </div>
      </div>

      {/* Persistent Storage */}
      <div className="card" style={{ padding:'0.8rem', border:'1px solid var(--border)', borderRadius:8 }}>
      <div style={{ fontWeight:700, marginBottom:'0.5rem' }}>💾 Almacenamiento persistente</div>
      <div>Estado: <strong>{systemStatus.persistentStorage === 'granted' ? '✅ Activo' : '❌ No activado'}</strong></div>
      <div style={{ fontSize:'0.75rem', marginTop:'0.3rem', color:'var(--text-tertiary)' }}>
      {systemStatus.persistentStorage === 'granted' ? 'Los datos no serán eliminados por el sistema' : 'Actívalo para evitar que el navegador borre la caché'}
      </div>
      </div>

      {/* Wake Lock */}
      <div className="card" style={{ padding:'0.8rem', border:'1px solid var(--border)', borderRadius:8 }}>
      <div style={{ fontWeight:700, marginBottom:'0.5rem' }}>🔋 Wake Lock</div>
      <div>Soporte: {systemStatus.wakeLock === 'unsupported' ? '❌ No soportado' : '✅ Soportado'}</div>
      {systemStatus.wakeLock !== 'unsupported' && (
        <div>Estado actual: {systemStatus.wakeLock === 'active' ? '🟢 Activo' : systemStatus.wakeLock === 'released' ? '⚪ Liberado' : '⚪ Inactivo'}</div>
      )}
      </div>

      {/* Clipboard */}
      <div className="card" style={{ padding:'0.8rem', border:'1px solid var(--border)', borderRadius:8 }}>
      <div style={{ fontWeight:700, marginBottom:'0.5rem' }}>📋 Clipboard</div>
      <div>Permiso: <strong>{systemStatus.clipboard}</strong></div>
      <div style={{ fontSize:'0.75rem', marginTop:'0.3rem', color:'var(--text-tertiary)' }}>
      {systemStatus.clipboard === 'granted' ? 'Lectura/escritura permitida' : 'Puede requerir interacción del usuario'}
      </div>
      </div>

      {/* Battery */}
      <div className="card" style={{ padding:'0.8rem', border:'1px solid var(--border)', borderRadius:8 }}>
      <div style={{ fontWeight:700, marginBottom:'0.5rem' }}>🔋 Batería</div>
      {systemStatus.battery ? (
        <>
        <div>Nivel: {systemStatus.battery.level}%</div>
        <div>Cargando: {systemStatus.battery.charging ? 'Sí' : 'No'}</div>
        {systemStatus.battery.chargingTime !== Infinity && <div>Tiempo de carga: {Math.round(systemStatus.battery.chargingTime / 60)} min</div>}
        {systemStatus.battery.dischargingTime !== Infinity && <div>Autonomía: {Math.round(systemStatus.battery.dischargingTime / 60)} min</div>}
        </>
      ) : (
        <div>No disponible</div>
      )}
      </div>

      {/* Network */}
      <div className="card" style={{ padding:'0.8rem', border:'1px solid var(--border)', borderRadius:8 }}>
      <div style={{ fontWeight:700, marginBottom:'0.5rem' }}>🌐 Red</div>
      {systemStatus.network ? (
        <>
        <div>Tipo: {systemStatus.network.type || systemStatus.network.effectiveType || 'desconocido'}</div>
        <div>Velocidad: {systemStatus.network.downlink ? `${systemStatus.network.downlink} Mbps` : '—'}</div>
        <div>RTT: {systemStatus.network.rtt ? `${systemStatus.network.rtt} ms` : '—'}</div>
        <div>Modo ahorro: {systemStatus.network.saveData ? 'Activado' : 'Desactivado'}</div>
        </>
      ) : (
        <div>No disponible</div>
      )}
      </div>
      </div>
      </div>
    )}
    </div>
    </PullToRefresh>
  );
}
