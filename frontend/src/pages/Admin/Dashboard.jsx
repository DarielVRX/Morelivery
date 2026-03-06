import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';

/* ── helpers ── */
function fmt(cents) { return cents != null ? `$${(cents/100).toFixed(2)}` : '—'; }
function fmtDate(iso) { return iso ? new Date(iso).toLocaleString('es',{dateStyle:'short',timeStyle:'short'}) : '—'; }
function fmtMin(m) { return m != null ? `${m}m` : '—'; }
function elapsed(a, b) {
  if (!a || !b) return null;
  return Math.round((new Date(b) - new Date(a)) / 60000);
}

const STATUS_LABELS = {
  created:'Recibido', assigned:'Asignado', accepted:'Aceptado',
  preparing:'Preparando', ready:'Listo', on_the_way:'En camino',
  delivered:'Entregado', cancelled:'Cancelado', pending_driver:'Sin driver',
};
const STATUS_COLOR = {
  created:'#f59e0b', assigned:'#3b82f6', accepted:'#8b5cf6',
  preparing:'#f97316', ready:'#10b981', on_the_way:'#06b6d4',
  delivered:'#16a34a', cancelled:'#dc2626', pending_driver:'#ef4444',
};

function Badge({ status }) {
  const c = STATUS_COLOR[status] || '#9ca3af';
  return (
    <span style={{ background:`${c}22`, color:c, border:`1px solid ${c}55`,
      borderRadius:12, padding:'0.1rem 0.55rem', fontSize:'0.72rem', fontWeight:700, whiteSpace:'nowrap' }}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

function Card({ label, value, sub, color='#2563eb' }) {
  return (
    <div style={{ border:'1px solid #e5e7eb', borderRadius:8, padding:'0.7rem 1rem', flex:'1 1 110px', minWidth:110 }}>
      <div style={{ fontSize:'0.75rem', color:'#6b7280' }}>{label}</div>
      <div style={{ fontSize:'1.35rem', fontWeight:800, color, lineHeight:1.2 }}>{value ?? '—'}</div>
      {sub && <div style={{ fontSize:'0.72rem', color:'#9ca3af' }}>{sub}</div>}
    </div>
  );
}

function Collapsible({ title, defaultOpen=true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ border:'1px solid #e5e7eb', borderRadius:8, overflow:'hidden', marginBottom:'1rem' }}>
      <div onClick={() => setOpen(o=>!o)} style={{ padding:'0.65rem 1rem', background:'#f9fafb',
        cursor:'pointer', display:'flex', justifyContent:'space-between', fontWeight:700, fontSize:'0.9rem' }}>
        {title} <span>{open?'▲':'▼'}</span>
      </div>
      {open && <div style={{ padding:'1rem', overflowX:'auto' }}>{children}</div>}
    </div>
  );
}

function Th({ children }) {
  return <th style={{ padding:'0.4rem 0.65rem', textAlign:'left', whiteSpace:'nowrap', fontWeight:700, borderBottom:'2px solid #e5e7eb', background:'#f9fafb', fontSize:'0.78rem' }}>{children}</th>;
}
function Td({ children, style }) {
  return <td style={{ padding:'0.4rem 0.65rem', borderBottom:'1px solid #f3f4f6', fontSize:'0.8rem', ...style }}>{children}</td>;
}

export default function AdminDashboard() {
  const { auth } = useAuth();
  const [tab, setTab]               = useState('orders');
  const [orders, setOrders]         = useState([]);
  const [metrics, setMetrics]       = useState(null);
  const [users, setUsers]           = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [metricDays, setMetricDays] = useState(7);
  const [loading, setLoading]       = useState(false);
  const [msg, setMsg]               = useState('');

  // Registro nuevo admin
  const [newUser, setNewUser] = useState({ username:'', password:'', displayName:'' });

  const load = useCallback(async () => {
    if (!auth.token) return;
    setLoading(true); setMsg('');
    try {
      if (tab === 'orders') {
        const qs = statusFilter ? `?status=${statusFilter}&limit=200` : '?limit=200';
        const d = await apiFetch(`/admin/orders${qs}`, {}, auth.token);
        setOrders(d.orders);
      } else if (tab === 'metrics') {
        const d = await apiFetch(`/admin/metrics?days=${metricDays}`, {}, auth.token);
        setMetrics(d);
      } else if (tab === 'users') {
        const d = await apiFetch('/admin/users', {}, auth.token);
        setUsers(d.users);
      }
    } catch(e) { setMsg(e.message); }
    finally { setLoading(false); }
  }, [auth.token, tab, statusFilter, metricDays]);

  useEffect(() => { load(); }, [load]);

  async function toggleUserStatus(userId, current) {
    const next = current === 'active' ? 'suspended' : 'active';
    try { await apiFetch(`/admin/users/${userId}/status`, { method:'PATCH', body:JSON.stringify({status:next}) }, auth.token); load(); }
    catch(e) { setMsg(e.message); }
  }

  async function overrideStatus(orderId, status) {
    const note = window.prompt('Nota del admin (opcional):') || null;
    try { await apiFetch(`/admin/orders/${orderId}/status`, { method:'PATCH', body:JSON.stringify({status,note}) }, auth.token); load(); }
    catch(e) { setMsg(e.message); }
  }

  async function registerAdmin() {
    if (!newUser.username || !newUser.password) return setMsg('Usuario y contraseña requeridos');
    try {
      await apiFetch('/admin/register', { method:'POST', body:JSON.stringify({ ...newUser, role:'admin' }) }, auth.token);
      setMsg(`✅ Admin "${newUser.username}" creado`);
      setNewUser({ username:'', password:'', displayName:'' });
    } catch(e) { setMsg(e.message); }
  }

  const activeOrders = useMemo(() => orders.filter(o => !['delivered','cancelled'].includes(o.status)), [orders]);

  const tabBtn = (t, label) => (
    <button key={t} onClick={() => setTab(t)} style={{ padding:'0.45rem 0.9rem', borderRadius:6, border:'none', cursor:'pointer', fontWeight:600, fontSize:'0.82rem',
      background: tab===t ? '#2563eb' : '#f3f4f6', color: tab===t ? '#fff' : '#374151' }}>
      {label}
    </button>
  );

  return (
    <section className="role-panel">
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:'0.5rem', marginBottom:'1rem' }}>
        <h2 style={{ margin:0 }}>Panel de administración</h2>
        <button onClick={load} style={{ fontSize:'0.82rem' }}>🔄 Actualizar</button>
      </div>

      <div style={{ display:'flex', gap:'0.4rem', flexWrap:'wrap', marginBottom:'1.25rem' }}>
        {tabBtn('orders',   `📋 Pedidos${activeOrders.length ? ` (${activeOrders.length} activos)` : ''}`)}
        {tabBtn('metrics',  '📊 Métricas')}
        {tabBtn('users',    '👥 Usuarios')}
        {tabBtn('register', '➕ Nuevo admin')}
      </div>

      {msg  && <p style={{ color: msg.startsWith('✅') ? '#16a34a' : '#dc2626', marginBottom:'0.75rem', fontSize:'0.875rem' }}>{msg}</p>}
      {loading && <p style={{ color:'#9ca3af', fontSize:'0.875rem' }}>Cargando…</p>}

      {/* ════ PEDIDOS ════ */}
      {tab === 'orders' && (
        <>
          <div style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap', marginBottom:'0.75rem', alignItems:'center' }}>
            <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}
              style={{ padding:'0.35rem 0.5rem', borderRadius:6, border:'1px solid #e5e7eb', fontSize:'0.82rem' }}>
              <option value=''>Todos los estados</option>
              {Object.entries(STATUS_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}
            </select>
            <span style={{ fontSize:'0.8rem', color:'#9ca3af' }}>{orders.length} pedidos</span>
          </div>

          {orders.length === 0
            ? <p style={{ color:'#888' }}>Sin pedidos.</p>
            : (
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <thead><tr>
                  <Th>Estado</Th><Th>Restaurante</Th><Th>Cliente</Th>
                  <Th>Driver</Th><Th>Total</Th><Th>Ofertas</Th>
                  <Th>Tiempos</Th><Th>Creado</Th><Th>⚙</Th>
                </tr></thead>
                <tbody>
                  {orders.map(o => (
                    <tr key={o.id}>
                      <Td><Badge status={o.status}/></Td>
                      <Td style={{maxWidth:130,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{o.restaurant_name}</Td>
                      <Td style={{maxWidth:110,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{o.customer_name}</Td>
                      <Td>
                        {o.driver_name || <span style={{color:'#f59e0b',fontSize:'0.75rem'}}>Sin asignar</span>}
                        {o.driver_available != null && (
                          <div style={{ fontSize:'0.68rem', color: o.driver_available?'#16a34a':'#9ca3af' }}>
                            {o.driver_available?'● disp.':'● no disp.'}
                          </div>
                        )}
                      </Td>
                      <Td>{fmt(o.total_cents)}</Td>
                      <Td>
                        <span title="pendientes" style={{color:'#f59e0b'}}>⏳{o.pending_offers} </span>
                        <span title="rechazos"   style={{color:'#dc2626'}}>✗{o.rejected_offers} </span>
                        <span title="expiradas"  style={{color:'#9ca3af'}}>⌛{o.expired_offers}</span>
                      </Td>
                      <Td style={{fontSize:'0.72rem',lineHeight:1.6}}>
                        {elapsed(o.created_at, o.accepted_at)   != null && <div>✔ {elapsed(o.created_at, o.accepted_at)}m aceptar</div>}
                        {elapsed(o.accepted_at, o.preparing_at) != null && <div>🍳 {elapsed(o.accepted_at, o.preparing_at)}m preparar</div>}
                        {elapsed(o.preparing_at, o.ready_at)    != null && <div>✅ {elapsed(o.preparing_at, o.ready_at)}m listo</div>}
                        {elapsed(o.ready_at, o.picked_up_at)    != null && <div>🛵 {elapsed(o.ready_at, o.picked_up_at)}m retiro</div>}
                        {elapsed(o.picked_up_at, o.delivered_at)!= null && <div>📦 {elapsed(o.picked_up_at, o.delivered_at)}m entrega</div>}
                        {elapsed(o.created_at, o.delivered_at ?? (o.cancelled_at || null)) != null && (
                          <div style={{fontWeight:700}}>⏱ {elapsed(o.created_at, o.delivered_at || o.cancelled_at)}m total</div>
                        )}
                      </Td>
                      <Td style={{whiteSpace:'nowrap'}}>{fmtDate(o.created_at)}</Td>
                      <Td>
                        <select defaultValue='' onChange={e=>{ if(e.target.value){ overrideStatus(o.id,e.target.value); e.target.value=''; } }}
                          style={{ fontSize:'0.72rem', padding:'0.15rem 0.3rem', borderRadius:4, border:'1px solid #e5e7eb' }}>
                          <option value=''>Cambiar</option>
                          {Object.entries(STATUS_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}
                        </select>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </>
      )}

      {/* ════ MÉTRICAS ════ */}
      {tab === 'metrics' && (
        <>
          <div style={{ display:'flex', gap:'0.4rem', alignItems:'center', marginBottom:'1rem', flexWrap:'wrap' }}>
            <span style={{ fontWeight:600, fontSize:'0.875rem' }}>Período:</span>
            {[1,7,14,30].map(d=>(
              <button key={d} onClick={()=>setMetricDays(d)} style={{ padding:'0.3rem 0.7rem', borderRadius:6, border:'1px solid #e5e7eb', cursor:'pointer', fontWeight:600, fontSize:'0.82rem',
                background:metricDays===d?'#2563eb':'#f9fafb', color:metricDays===d?'#fff':'#374151' }}>{d}d</button>
            ))}
          </div>

          {metrics && (
            <>
              <Collapsible title="📦 Resumen">
                <div style={{ display:'flex', flexWrap:'wrap', gap:'0.6rem' }}>
                  <Card label="Pedidos totales"  value={metrics.summary.total_orders}              color="#2563eb"/>
                  <Card label="Entregados"        value={metrics.summary.delivered}                 color="#16a34a"/>
                  <Card label="Cancelados"        value={metrics.summary.cancelled}                 color="#dc2626"/>
                  <Card label="Activos ahora"     value={metrics.summary.active}                    color="#f59e0b"/>
                  <Card label="Ticket promedio"   value={fmt(metrics.summary.avg_ticket_cents)}     color="#7c3aed"/>
                  <Card label="Ingresos"          value={fmt(metrics.summary.revenue_cents)}        color="#059669" sub="pedidos entregados"/>
                </div>
              </Collapsible>

              <Collapsible title="⏱ Tiempos promedio (pedidos entregados)">
                <div style={{ display:'flex', flexWrap:'wrap', gap:'0.6rem' }}>
                  <Card label="Hasta aceptar"  value={fmtMin(metrics.timings.avg_min_to_accept)}   color="#f59e0b"/>
                  <Card label="Hasta preparar" value={fmtMin(metrics.timings.avg_min_to_prepare)}  color="#f97316"/>
                  <Card label="Hasta listo"    value={fmtMin(metrics.timings.avg_min_to_ready)}    color="#10b981"/>
                  <Card label="Hasta retiro"   value={fmtMin(metrics.timings.avg_min_to_pickup)}   color="#06b6d4"/>
                  <Card label="Hasta entrega"  value={fmtMin(metrics.timings.avg_min_to_deliver)}  color="#8b5cf6"/>
                  <Card label="Total"          value={fmtMin(metrics.timings.avg_total_min)}       color="#2563eb" sub="creación → entrega"/>
                </div>
              </Collapsible>

              <Collapsible title="🍽 Por restaurante">
                <table style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead><tr><Th>Restaurante</Th><Th>Pedidos</Th><Th>Entregados</Th><Th>Cancelados</Th><Th>Ticket prom.</Th><Th>Ingresos</Th><Th>T.total prom.</Th></tr></thead>
                  <tbody>
                    {metrics.byRestaurant.map(r=>(
                      <tr key={r.id}>
                        <Td style={{fontWeight:600}}>{r.name}</Td>
                        <Td>{r.total_orders}</Td>
                        <Td style={{color:'#16a34a'}}>{r.delivered}</Td>
                        <Td style={{color:'#dc2626'}}>{r.cancelled}</Td>
                        <Td>{fmt(r.avg_ticket_cents)}</Td>
                        <Td style={{fontWeight:700}}>{fmt(r.revenue_cents)}</Td>
                        <Td>{fmtMin(r.avg_total_min)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Collapsible>

              <Collapsible title="🛵 Por driver">
                <table style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead><tr><Th>Driver</Th><Th>Disponible</Th><Th>Entregados</Th><Th>Cancelados</Th><Th>T.entrega prom.</Th><Th>Rechazos</Th><Th>Expiradas</Th></tr></thead>
                  <tbody>
                    {metrics.byDriver.map(d=>(
                      <tr key={d.id}>
                        <Td style={{fontWeight:600}}>{d.name}</Td>
                        <Td><span style={{color:d.is_available?'#16a34a':'#9ca3af',fontSize:'0.75rem'}}>{d.is_available?'● Sí':'● No'}</span></Td>
                        <Td style={{color:'#16a34a'}}>{d.delivered}</Td>
                        <Td style={{color:'#dc2626'}}>{d.cancelled}</Td>
                        <Td>{fmtMin(d.avg_delivery_min)}</Td>
                        <Td style={{color:'#f59e0b'}}>{d.total_rejections}</Td>
                        <Td style={{color:'#9ca3af'}}>{d.total_expirations}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Collapsible>

              <Collapsible title="👤 Por cliente (top 50)">
                <table style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead><tr><Th>Cliente</Th><Th>Pedidos</Th><Th>Entregados</Th><Th>Cancelados</Th><Th>Total gastado</Th></tr></thead>
                  <tbody>
                    {metrics.byCustomer.map(c=>(
                      <tr key={c.id}>
                        <Td style={{fontWeight:600}}>{c.name}</Td>
                        <Td>{c.total_orders}</Td>
                        <Td style={{color:'#16a34a'}}>{c.delivered}</Td>
                        <Td style={{color:'#dc2626'}}>{c.cancelled}</Td>
                        <Td style={{fontWeight:700}}>{fmt(c.total_spent_cents)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Collapsible>

              <Collapsible title="⏰ Distribución por hora del día" defaultOpen={false}>
                <div style={{ display:'flex', alignItems:'flex-end', gap:2, height:80, paddingBottom:4 }}>
                  {Array.from({length:24},(_,h)=>{
                    const row = metrics.byHour.find(r=>r.hour===h);
                    const count = row?.orders || 0;
                    const max = Math.max(...metrics.byHour.map(r=>r.orders),1);
                    return (
                      <div key={h} style={{ display:'flex', flexDirection:'column', alignItems:'center', flex:'0 0 auto', width:22 }}>
                        <div title={`${h}:00 — ${count} pedidos`}
                          style={{ width:16, background:'#2563eb', borderRadius:'2px 2px 0 0',
                            height: count>0 ? Math.max((count/max)*60,3) : 0, transition:'height 0.3s' }}/>
                        <div style={{ fontSize:'0.58rem', color:'#9ca3af', marginTop:1 }}>{h}</div>
                      </div>
                    );
                  })}
                </div>
              </Collapsible>
            </>
          )}
        </>
      )}

      {/* ════ USUARIOS ════ */}
      {tab === 'users' && (
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead><tr>
            <Th>Nombre</Th><Th>Rol</Th><Th>Estado</Th><Th>Info</Th><Th>Registrado</Th><Th>Acción</Th>
          </tr></thead>
          <tbody>
            {users.map(u=>(
              <tr key={u.id} style={{ opacity: u.status==='suspended' ? 0.55 : 1 }}>
                <Td style={{fontWeight:600}}>{u.full_name}</Td>
                <Td><span style={{ background:'#f3f4f6', borderRadius:4, padding:'0.1rem 0.4rem', fontSize:'0.72rem' }}>{u.role}</span></Td>
                <Td><span style={{ color: u.status==='active'?'#16a34a':'#dc2626', fontWeight:700, fontSize:'0.75rem' }}>{u.status==='active'?'● Activo':'● Suspendido'}</span></Td>
                <Td style={{color:'#6b7280',fontSize:'0.75rem'}}>
                  {u.role==='driver'     && `${u.vehicle_type||'—'} · ${u.is_available?'disponible':'no disp.'}${u.is_verified?' · ✓':''}`}
                  {u.role==='restaurant' && `${u.restaurant_name||'—'} · ${u.restaurant_is_open?'abierto':'cerrado'}`}
                </Td>
                <Td style={{whiteSpace:'nowrap'}}>{fmtDate(u.created_at)}</Td>
                <Td>
                  <button onClick={()=>toggleUserStatus(u.id,u.status)} style={{ fontSize:'0.75rem', padding:'0.2rem 0.55rem' }}>
                    {u.status==='active'?'Suspender':'Reactivar'}
                  </button>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ════ REGISTRAR ADMIN ════ */}
      {tab === 'register' && (
        <div style={{ maxWidth:380 }}>
          <h3 style={{ marginTop:0 }}>Registrar nuevo administrador</h3>
          <p style={{ color:'#6b7280', fontSize:'0.875rem', marginBottom:'1rem' }}>
            Solo los administradores actuales pueden crear cuentas de administrador.
          </p>
          <div style={{ display:'flex', flexDirection:'column', gap:'0.6rem' }}>
            <input placeholder="Nombre para mostrar" value={newUser.displayName}
              onChange={e=>setNewUser(p=>({...p,displayName:e.target.value}))}
              style={{ padding:'0.5rem 0.75rem', borderRadius:6, border:'1px solid #e5e7eb' }}/>
            <input placeholder="Nombre de usuario (para login)" value={newUser.username}
              onChange={e=>setNewUser(p=>({...p,username:e.target.value}))}
              style={{ padding:'0.5rem 0.75rem', borderRadius:6, border:'1px solid #e5e7eb' }}/>
            <input type="password" placeholder="Contraseña (mín. 6 caracteres)" value={newUser.password}
              onChange={e=>setNewUser(p=>({...p,password:e.target.value}))}
              style={{ padding:'0.5rem 0.75rem', borderRadius:6, border:'1px solid #e5e7eb' }}/>
            <button onClick={registerAdmin} style={{ padding:'0.6rem', fontWeight:700 }}>
              Crear administrador
            </button>
          </div>
          {msg && (
            <p style={{ marginTop:'0.5rem', fontSize:'0.875rem', color: msg.startsWith('✅')?'#16a34a':'#dc2626' }}>{msg}</p>
          )}
        </div>
      )}
    </section>
  );
}
