import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useRealtimeOrders } from '../../hooks/useRealtimeOrders';
import PullToRefresh    from '../../components/PullToRefresh';

function fmt(cents) { return `$${((cents ?? 0) / 100).toFixed(2)}`; }

// Desglose de tarifas para conductor
// Desglose para Conductor
function FeeBreakdown({ order }) {
  const sub           = order.total_cents          || 0;
  const svc           = order.service_fee_cents    || 0;
  const del_fee       = order.delivery_fee_cents   || 0;
  const tip           = order.tip_cents            || 0;
  const isCash        = (order.payment_method || 'cash') === 'cash';
  const driverEarning = del_fee + Math.round(svc * 0.5) + tip;
  const grandTotal    = sub + svc + del_fee + tip;
  if (!svc && !del_fee) return null;
  return (
    <div style={{ fontSize:'0.78rem', color:'var(--text-tertiary)', borderTop:'1px solid var(--border-light)', paddingTop:'0.35rem', marginTop:'0.35rem' }}>
      {isCash && (
        <>
          <div style={{ display:'flex', justifyContent:'space-between', color:'var(--gray-700)' }}>
            <span>A pagar a tienda</span><span>{fmt(sub)}</span>
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', fontWeight:700, color:'var(--brand)', marginBottom:'0.15rem' }}>
            <span>Cobrar a cliente</span><span>{fmt(grandTotal)}</span>
          </div>
        </>
      )}
      <div style={{ display:'flex', justifyContent:'space-between', fontWeight:700, color:'var(--success)', marginTop:'0.1rem' }}>
        <span>Tu ganancia</span><span>{fmt(driverEarning)}</span>
      </div>
      {tip > 0 && (
        <div style={{ fontSize:'0.72rem', color:'var(--success)', textAlign:'right' }}>incl. agradecimiento {fmt(tip)}</div>
      )}
    </div>
  );
}

function fmtDate(iso) { return iso ? new Date(iso).toLocaleString('es', { dateStyle:'short', timeStyle:'short' }) : '—'; }

const STATUS_LABELS = {
  created:'Recibido', assigned:'Asignado', accepted:'Aceptado',
  preparing:'En preparación', ready:'Listo para retiro',
  on_the_way:'En camino', delivered:'Entregado',
  cancelled:'Cancelado', pending_driver:'Sin conductor',
};
const STATUS_COLOR = {
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
  useRealtimeOrders(auth.token, () => loadDataRef.current?.(), () => {});

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

  // Grace window ref: tracks last time driver was ≤100m from each reference point
  const graceRef = useRef({});
  const MAX_RADIUS_M = 100;
  const GRACE_MS = 3 * 60 * 1000;

  function haversineM(lat1, lng1, lat2, lng2) {
    const toRad = x => x * Math.PI / 180;
    const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  async function getGpsBody(status, order) {
    return new Promise(resolve => {
      if (!navigator.geolocation) { resolve({}); return; }
      navigator.geolocation.getCurrentPosition(
        pos => {
          const body = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          const refLat = status === 'on_the_way' ? order?.restaurant_lat : order?.delivery_lat;
          const refLng = status === 'on_the_way' ? order?.restaurant_lng : order?.delivery_lng;
          if (refLat && refLng) {
            const distM = haversineM(body.lat, body.lng, Number(refLat), Number(refLng));
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

  const tabStyle = (t) => ({
    padding:'0.4rem 1rem', cursor:'pointer', border:'none', borderRadius:6, fontWeight:600,
    fontSize:'0.875rem', transition:'background 0.15s',
    background: tab === t ? 'var(--brand)' : 'var(--gray-100)',
    color:      tab === t ? '#fff'         : 'var(--gray-600)',
  });

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
            {unoffered.map(o => {
              const color  = STATUS_COLOR[o.status] || '#9ca3af';
              const grandTotal = (o.total_cents||0)+(o.service_fee_cents||0)+(o.delivery_fee_cents||0);
              const isUExp = expanded === ('u_'+o.id);
              return (
                <li key={o.id} className="card" style={{ borderLeft:`3px solid var(--brand)`,
                  marginBottom:'0.5rem', padding:'0.6rem 0.75rem 0.75rem', overflow:'hidden' }}>
                  {/* Encabezado con estado */}
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.25rem' }}>
                    <div style={{ fontSize:'0.7rem', fontWeight:800, textTransform:'uppercase',
                      letterSpacing:'0.5px', color:'var(--brand)' }}>
                      Pedido disponible
                    </div>
                    <div style={{ display:'flex', gap:'0.3rem' }}>
                      {o.has_pending_offer && (
                        <span style={{ fontSize:'0.65rem', background:'#fef3c7', color:'#92400e',
                          border:'1px solid #fde68a', borderRadius:8, padding:'0.1rem 0.4rem', fontWeight:600 }}>
                          Ofertado
                        </span>
                      )}
                      {o.cooldown_secs > 0 && (
                        <span style={{ fontSize:'0.65rem', background:'#f1f5f9', color:'var(--text-tertiary)',
                          border:'1px solid var(--border)', borderRadius:8, padding:'0.1rem 0.4rem' }}>
                          CD {o.cooldown_secs}s
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize:'0.82rem', color:'var(--gray-700)', marginBottom:'0.3rem' }}>
                    {o.restaurant_address && (
                      <div><span style={{ color:'var(--text-tertiary)', fontSize:'0.72rem' }}>Tienda: </span>
                        <strong>{o.restaurant_address}</strong></div>
                    )}
                    {(o.customer_address||o.delivery_address) && (
                      <div><span style={{ color:'var(--text-tertiary)', fontSize:'0.72rem' }}>Cliente: </span>
                        <strong>{o.customer_address||o.delivery_address}</strong></div>
                    )}
                  </div>
                  {(() => {
                    const earn = (o.delivery_fee_cents||0)+Math.round((o.service_fee_cents||0)*0.5)+(o.tip_cents||0);
                    return earn > 0 ? (
                      <div style={{ fontSize:'0.85rem', fontWeight:800, color:'var(--success)', marginBottom:'0.3rem' }}>
                        Tu ganancia: {fmt(earn)}
                      </div>
                    ) : null;
                  })()}
                  <button
                    className="btn-primary btn-sm"
                    style={{ width:'100%' }}
                    disabled={actionLoading === o.id}
                    onClick={() => acceptDirectly(o.id)}
                  >
                    {actionLoading === o.id ? 'Aceptando…' : 'Aceptar pedido'}
                  </button>
                </li>
              );
            })}
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
              {active.map(o => {
                const color      = STATUS_COLOR[o.status] || '#9ca3af';
                const isActive   = o.id === activeOrderId;
                const isOnTheWay = o.status === 'on_the_way';
                const isCash     = (o.payment_method||'cash') === 'cash';
                const grandTotal = (o.total_cents||0)+(o.service_fee_cents||0)+(o.delivery_fee_cents||0)+(o.tip_cents||0);
                const DRIVER_ST  = { assigned:'Asignado', on_the_way:'En camino', preparing:'En tienda', ready:'Listo retiro' };
                return (
                  <li key={o.id} className="card" style={{ borderLeft:`3px solid ${isActive ? 'var(--success)' : color}`, marginBottom:'0.6rem', padding:0, overflow:'hidden', opacity: isActive ? 1 : 0.6 }}>
                    {/* Cabecera compacta */}
                    <div onClick={() => setExpanded(expanded===o.id ? null : o.id)}
                      style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                        padding:'0.6rem 0.75rem', cursor:'pointer', gap:'0.5rem' }}>
                      <div style={{ minWidth:0 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:'0.35rem', flexWrap:'wrap' }}>
                          <span style={{ fontSize:'0.7rem', fontWeight:800, textTransform:'uppercase',
                            color: isActive ? 'var(--success)' : color }}>
                            {DRIVER_ST[o.status] || STATUS_LABELS[o.status]}
                          </span>
                          {o.is_disputed && (
                            <span style={{ fontSize:'0.65rem', fontWeight:700,
                              background:'#fef9c3', color:'#854d0e',
                              border:'1px solid #fde047', borderRadius:8,
                              padding:'0.1rem 0.45rem' }}>
                              🔄 En disputa
                            </span>
                          )}
                          {!isActive && <span style={{ fontSize:'0.68rem', color:'var(--text-tertiary)' }}>no activo en home</span>}
                        </div>
                        {!isOnTheWay
                          ? <div style={{ fontSize:'0.8rem', fontWeight:600 }}>{o.restaurant_name}</div>
                          : <div style={{ fontSize:'0.8rem', fontWeight:600 }}>{o.customer_name || 'Cliente'}</div>
                        }
                      </div>
                      <span style={{ color:'var(--text-tertiary)', fontSize:'0.8rem', flexShrink:0 }}>
                        {expanded===o.id ? '▲' : '▼'}
                      </span>
                    </div>
                    {/* Detalle expandible */}
                    {expanded===o.id && (
                      <div style={{ padding:'0 0.75rem 0.65rem', borderTop:`1px solid ${color}22`,
                        maxHeight:260, overflowY:'auto' }}>
                        {!isOnTheWay ? (
                          <>
                            {o.restaurant_address && <div style={{ fontSize:'0.78rem', color:'var(--text-tertiary)' }}>{o.restaurant_address}</div>}
                            {isCash
                              ? <div style={{ fontSize:'0.8rem', fontWeight:700, color:'var(--brand)', marginTop:'0.2rem' }}>
                                  Cobrar al llegar: {fmt(grandTotal)}
                                </div>
                              : <div style={{ fontSize:'0.77rem', color:'var(--text-tertiary)', marginTop:'0.2rem' }}>
                                  {o.payment_method==='card' ? '💳 Pago con tarjeta — no cobrar' : '🏦 SPEI — no cobrar'}
                                </div>
                            }
                          </>
                        ) : (
                          <>
                            {(o.customer_address||o.delivery_address) && <div style={{ fontSize:'0.78rem', color:'var(--text-tertiary)' }}>{o.customer_address||o.delivery_address}</div>}
                            {isCash
                              ? <div style={{ fontSize:'0.8rem', fontWeight:700, color:'var(--brand)', marginTop:'0.2rem' }}>Cobrar: {fmt(grandTotal)}</div>
                              : <div style={{ fontSize:'0.77rem', color:'var(--text-tertiary)', marginTop:'0.2rem' }}>
                                  {o.payment_method==='card' ? '💳 Ya pagó con tarjeta' : '🏦 Ya pagó SPEI'}
                                </div>
                            }
                          </>
                        )}
                        {(o.items||[]).length > 0 && (
                          <ul style={{ fontSize:'0.78rem', margin:'0.25rem 0 0 1rem', color:'var(--gray-700)' }}>
                            {o.items.map(i => <li key={i.menuItemId}>{i.name} × {i.quantity}</li>)}
                          </ul>
                        )}
                        <FeeBreakdown order={o} />
                        {/* Controles solo para el pedido activo en home */}
                        {isActive && (
                          <div style={{ marginTop:'0.5rem' }}>
                            <div style={{ display:'flex', gap:'0.35rem', flexWrap:'wrap', marginBottom:'0.3rem' }}>
                              <button className="btn-sm"
                                style={{ background:o.status==='ready'?'var(--brand)':'', color:o.status==='ready'?'#fff':'' }}
                                disabled={actionLoading===o.id || o.status!=='ready'}
                                onClick={() => changeStatusWithGps(o.id, 'on_the_way', o)}>En camino</button>
                              <button className="btn-sm"
                                style={{ background:o.status==='on_the_way'?'var(--success)':'', color:o.status==='on_the_way'?'#fff':'' }}
                                disabled={actionLoading===o.id || o.status!=='on_the_way'}
                                onClick={() => changeStatusWithGps(o.id, 'delivered', o)}>Entregado</button>
                            </div>
                            {!['on_the_way','delivered','cancelled'].includes(o.status) && (
                              <>
                                {releasingId===o.id ? (
                                  <div style={{ display:'flex', gap:'0.3rem', alignItems:'center', flexWrap:'wrap' }}>
                                    <input value={releaseNote} onChange={e=>setReleaseNote(e.target.value)}
                                      placeholder="Motivo…" style={{ flex:1, fontSize:'0.78rem', minWidth:100 }} />
                                    <button className="btn-sm" style={{ background:'var(--danger)', color:'#fff', borderColor:'var(--danger)', fontSize:'0.75rem' }}
                                      disabled={actionLoading===o.id} onClick={() => releaseOrder(o.id)}>
                                      {actionLoading===o.id ? '…' : 'Confirmar'}
                                    </button>
                                    <button className="btn-sm" style={{ fontSize:'0.75rem' }}
                                      onClick={() => { setReleasingId(null); setReleaseNote(''); }}>Cancelar</button>
                                  </div>
                                ) : (
                                  <div style={{ display:'flex', gap:'0.35rem', flexWrap:'wrap' }}>
                                    {!o.is_disputed ? (
                                      <button className="btn-sm"
                                        style={{ fontSize:'0.75rem', color:'#854d0e', borderColor:'#fde047', background:'#fef9c3' }}
                                        disabled={rebalancingId === o.id}
                                        onClick={() => doRebalance(o.id)}>
                                        {rebalancingId === o.id ? '…' : '🔄 Rebalancear'}
                                      </button>
                                    ) : (
                                      <span style={{ fontSize:'0.72rem', color:'#854d0e', fontStyle:'italic' }}>
                                        En disputa — buscando conductor…
                                      </span>
                                    )}
                                    <button className="btn-sm" style={{ fontSize:'0.75rem', color:'var(--danger)', borderColor:'var(--danger)' }}
                                      onClick={() => setReleasingId(o.id)}>Liberar</button>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </li>
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
              {past.slice(0, 50).map(o => {
                const color    = STATUS_COLOR[o.status] || '#9ca3af';
                const isHExp   = expanded === ('h_'+o.id);
                const grandTotal = (o.total_cents||0)+(o.service_fee_cents||0)+(o.delivery_fee_cents||0)+(o.tip_cents||0);
                return (
                  <li key={o.id} className="card" style={{ borderLeft:`3px solid ${color}`, marginBottom:'0.6rem', padding:0, overflow:'hidden' }}>
                    <div onClick={() => setExpanded(isHExp ? null : 'h_'+o.id)}
                      style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0.75rem', cursor:'pointer', gap:'0.5rem' }}>
                      <div>
                        <span className="badge" style={{ color, borderColor:`${color}55`, background:`${color}15`, marginRight:'0.5rem', fontSize:'0.7rem' }}>
                          {STATUS_LABELS[o.status]}
                        </span>
                        <span style={{ fontWeight:600, fontSize:'0.875rem' }}>{o.restaurant_name}</span>
                      </div>
                      <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', flexShrink:0 }}>
                        <span style={{ fontWeight:700 }}>{fmt(grandTotal)}</span>
                        <span style={{ color:'var(--text-tertiary)', fontSize:'0.8rem' }}>{isHExp?'▲':'▼'}</span>
                      </div>
                    </div>
                    {isHExp && (
                      <div style={{ padding:'0 0.75rem 0.75rem', borderTop:`1px solid ${color}22` }}>
                        <div style={{ fontSize:'0.82rem', color:'var(--text-secondary)', marginBottom:'0.3rem' }}>{fmtDate(o.created_at)}</div>
                        {(o.items || []).length > 0 && (
                          <ul style={{ fontSize:'0.82rem', margin:'0.2rem 0 0.35rem 1rem' }}>
                            {o.items.map(i => <li key={i.menuItemId}>{i.name} × {i.quantity}</li>)}
                          </ul>
                        )}
                        <FeeBreakdown order={o} />
                        {reportingId === o.id ? (
                          <div style={{ display:'flex', flexDirection:'column', gap:'0.3rem', marginTop:'0.3rem' }}>
                            <textarea value={reportText} onChange={e=>setReportText(e.target.value)}
                              placeholder="Describe el problema…" rows={2}
                              style={{ fontSize:'0.78rem', width:'100%', boxSizing:'border-box' }} />
                            <div style={{ display:'flex', gap:'0.3rem' }}>
                              <button className="btn-sm" style={{ fontSize:'0.75rem', background:'var(--danger)', color:'#fff', borderColor:'var(--danger)' }} onClick={() => sendReport(o.id)}>Enviar</button>
                              <button className="btn-sm" style={{ fontSize:'0.75rem' }} onClick={() => { setReportingId(null); setReportText(''); }}>Cancelar</button>
                            </div>
                          </div>
                        ) : (
                          <button className="btn-sm" style={{ fontSize:'0.72rem', marginTop:'0.2rem' }} onClick={() => setReportingId(o.id)}>Reportar</button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )
      )}

      </div>
    </div>
  );
}
