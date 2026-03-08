import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useRealtimeOrders } from '../../hooks/useRealtimeOrders';

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
    <div style={{ fontSize:'0.78rem', color:'var(--gray-500)', borderTop:'1px solid var(--gray-100)', paddingTop:'0.35rem', marginTop:'0.35rem' }}>
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
      {/* Footer sticky: toggle historial/activos */}
      <div style={{
        position:'sticky', bottom:0, background:'#fff',
        borderTop:'1px solid var(--gray-200)', padding:'0.6rem 0',
        display:'flex', justifyContent:'center', zIndex:10
      }}>
        <button
          onClick={() => setTab(t => t==='active' ? 'past' : 'active')}
          style={{
            background: tab==='active' ? 'var(--gray-100)' : 'var(--brand)',
            color:       tab==='active' ? 'var(--gray-700)' : '#fff',
            border:'none', borderRadius:20, padding:'0.4rem 1.5rem',
            fontWeight:700, fontSize:'0.82rem', cursor:'pointer',
            transition:'background 0.2s, color 0.2s'
          }}>
          {tab==='active' ? 'Ver historial →' : '← Ver activos'}
        </button>
      </div>
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
  useRealtimeOrders(auth.token, () => loadDataRef.current?.(), () => {});

  const active = useMemo(() => orders.filter(o => !['delivered','cancelled'].includes(o.status)), [orders]);
  const past   = useMemo(() => orders.filter(o =>  ['delivered','cancelled'].includes(o.status)), [orders]);

  // Pedidos sin ofertar: excluir los que ya son activos de este driver
  const activeIds = useMemo(() => new Set(active.map(o => o.id)), [active]);
  const unoffered = useMemo(() => waitingOrders.filter(o => !activeIds.has(o.id)), [waitingOrders, activeIds]);

  const [actionMsg, setActionMsg] = useState('');
  const [actionLoading, setActionLoading] = useState(null);
  const [releaseNote, setReleaseNote]     = useState('');
  const [releasingId, setReleasingId]     = useState(null);
  const [expanded, setExpanded]            = useState(null);

  async function acceptDirectly(orderId) {
    setActionLoading(orderId);
    try {
      await apiFetch(`/drivers/offers/${orderId}/accept`, { method:'POST' }, auth.token);
      setActionMsg('Pedido aceptado');
      loadData();
      setTimeout(() => setActionMsg(''), 3000);
    } catch (e) { setActionMsg(e.message); }
    finally { setActionLoading(null); }
  }

  async function releaseOrder(orderId) {
    if (!releaseNote.trim()) { setActionMsg('Escribe una nota antes de liberar'); return; }
    setActionLoading(orderId);
    try {
      await apiFetch(`/drivers/release/${orderId}`, {
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
    <div>
      {reportMsg  && <p className="flash flash-ok"    style={{ marginBottom:'0.5rem' }}>{reportMsg}</p>}
      {actionMsg  && <p className="flash flash-ok"    style={{ marginBottom:'0.5rem' }}>{actionMsg}</p>}
      <h2 style={{ fontSize:'1.1rem', fontWeight:800, marginBottom:'1rem' }}>Mis pedidos</h2>

      {/* ── Pedidos en espera de conductor (sin oferta activa) ─────────── */}
      {unoffered.length > 0 && (
        <div style={{ marginBottom:'1.25rem' }}>
          <p style={{ fontSize:'0.8rem', fontWeight:700, color:'var(--gray-500)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'0.5rem' }}>
            Buscando conductor ({unoffered.length})
          </p>
          <ul style={{ listStyle:'none', padding:0 }}>
            {unoffered.map(o => {
              const color  = STATUS_COLOR[o.status] || '#9ca3af';
              const grandTotal = (o.total_cents||0)+(o.service_fee_cents||0)+(o.delivery_fee_cents||0);
              const isUExp = expanded === ('u_'+o.id);
              return (
                <li key={o.id} className="card" style={{ borderLeft:`3px solid ${color}`, marginBottom:'0.5rem', padding:0, overflow:'hidden' }}>
                  <div onClick={() => setExpanded(isUExp ? null : 'u_'+o.id)}
                    style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0.65rem 0.75rem', cursor:'pointer', gap:'0.5rem' }}>
                    <div>
                      <span className="badge" style={{ color, borderColor:`${color}55`, background:`${color}15`, fontSize:'0.72rem', marginRight:'0.4rem' }}>
                        {STATUS_LABELS[o.status]}
                      </span>
                      <span style={{ fontWeight:600, fontSize:'0.875rem' }}>{o.restaurant_name}</span>
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', flexShrink:0 }}>
                      <span style={{ fontWeight:700, fontSize:'0.875rem' }}>{fmt(grandTotal)}</span>
                      <span style={{ color:'var(--gray-400)', fontSize:'0.8rem' }}>{isUExp?'▲':'▼'}</span>
                    </div>
                  </div>
                  {isUExp && (
                    <div style={{ padding:'0 0.75rem 0.65rem', borderTop:`1px solid ${color}22` }}>
                      {o.restaurant_address && (
                        <div style={{ fontSize:'0.8rem', color:'var(--gray-600)', marginBottom:'0.3rem' }}>
                          {o.restaurant_address}
                        </div>
                      )}
                      {o.payment_method && (
                        <div style={{ fontSize:'0.78rem', color:'var(--gray-500)', marginBottom:'0.3rem' }}>
                          Pago: <strong>{{cash:'Efectivo',card:'Tarjeta',spei:'SPEI'}[o.payment_method]||o.payment_method}</strong>
                        </div>
                      )}
                      <FeeBreakdown order={o} />
                      <button
                        className="btn-sm btn-primary"
                        disabled={actionLoading === o.id}
                        onClick={() => acceptDirectly(o.id)}
                        style={{ fontSize:'0.78rem', marginTop:'0.5rem' }}
                      >
                        {actionLoading === o.id ? 'Aceptando…' : 'Aceptar pedido'}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div style={{ display:'flex', gap:'0.4rem', marginBottom:'1rem' }}>
        <span style={{ fontSize:'0.82rem', color:'var(--gray-500)', fontWeight:600 }}>
          {tab==='active' ? `Activos (${active.length})` : `Historial (${past.length})`}
        </span>
      </div>

      {tab === 'active' && (
        active.length === 0
          ? <p style={{ color:'var(--gray-600)', fontSize:'0.9rem' }}>Sin pedidos activos.</p>
          : (
            <ul className="orders-tab-panel" style={{ listStyle:'none', padding:0 }}>
              {active.map(o => {
                const color = STATUS_COLOR[o.status] || '#9ca3af';
                return (
                  <li key={o.id} className="card" style={{ borderLeft:`3px solid ${color}`, marginBottom:'0.6rem', padding:0, overflow:'hidden' }}>
                    <div onClick={() => setExpanded(expanded===o.id ? null : o.id)}
                      style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0.75rem', cursor:'pointer', gap:'0.5rem' }}>
                      <div>
                        <span className="badge" style={{ color, borderColor:`${color}55`, background:`${color}15`, marginRight:'0.5rem' }}>
                          {STATUS_LABELS[o.status]}
                        </span>
                        <span style={{ fontWeight:600, fontSize:'0.875rem' }}>{o.restaurant_name}</span>
                      </div>
                      <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', flexShrink:0 }}>
                        <span style={{ fontWeight:700 }}>{fmt((o.total_cents||0)+(o.delivery_fee_cents||0))}</span>
                        <span style={{ color:'var(--gray-400)', fontSize:'0.8rem' }}>{expanded===o.id?'▲':'▼'}</span>
                      </div>
                    </div>
                    {expanded===o.id && (
                    <div style={{ padding:'0 0.75rem 0.75rem', borderTop:`1px solid ${color}22` }}>
                    <div style={{ fontSize:'0.83rem', color:'var(--gray-600)', marginBottom:'0.2rem' }}>
                      {fmtDate(o.created_at)}
                    </div>
                    {o.customer_address && (
                      <div style={{ fontSize:'0.8rem', color:'var(--gray-500)', marginBottom:'0.2rem' }}>
                        Entregar en: <strong>{o.customer_address}</strong>
                      </div>
                    )}
                    {(o.items || []).length > 0 && (
                      <ul style={{ fontSize:'0.82rem', margin:'0.25rem 0 0 1rem' }}>
                        {o.items.map(i => <li key={i.menuItemId}>{i.name} × {i.quantity}</li>)}
                      </ul>
                    )}
                    {o.payment_method && (
                      <div style={{ fontSize:'0.78rem', color:'var(--gray-500)', marginBottom:'0.2rem', marginTop:'0.25rem' }}>
                        Pago: <strong>{{cash:'Efectivo',card:'Tarjeta',spei:'SPEI'}[o.payment_method]||o.payment_method}</strong>
                      </div>
                    )}
                    <FeeBreakdown order={o} />
                    {/* Liberar pedido asignado */}
                    {['assigned','accepted'].includes(o.status) && (
                      <div style={{ marginTop:'0.4rem' }}>
                        {releasingId === o.id ? (
                          <div style={{ display:'flex', gap:'0.3rem', alignItems:'center', flexWrap:'wrap' }}>
                            <input value={releaseNote} onChange={e => setReleaseNote(e.target.value)}
                              placeholder="Motivo de liberación…"
                              style={{ flex:1, fontSize:'0.8rem', minWidth:120 }} />
                            <button className="btn-sm" style={{ background:'var(--danger)', color:'#fff', borderColor:'var(--danger)', fontSize:'0.78rem' }}
                              disabled={actionLoading === o.id}
                              onClick={() => releaseOrder(o.id)}>
                              {actionLoading === o.id ? 'Liberando…' : 'Confirmar'}
                            </button>
                            <button className="btn-sm" style={{ fontSize:'0.78rem' }}
                              onClick={() => { setReleasingId(null); setReleaseNote(''); }}>Cancelar</button>
                          </div>
                        ) : (
                          <button className="btn-sm" style={{ fontSize:'0.78rem', color:'var(--danger)', borderColor:'var(--danger)' }}
                            onClick={() => setReleasingId(o.id)}>Liberar pedido</button>
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
          ? <p style={{ color:'var(--gray-600)', fontSize:'0.9rem' }}>Sin pedidos anteriores.</p>
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
                        <span style={{ color:'var(--gray-400)', fontSize:'0.8rem' }}>{isHExp?'▲':'▼'}</span>
                      </div>
                    </div>
                    {isHExp && (
                      <div style={{ padding:'0 0.75rem 0.75rem', borderTop:`1px solid ${color}22` }}>
                        <div style={{ fontSize:'0.82rem', color:'var(--gray-600)', marginBottom:'0.3rem' }}>{fmtDate(o.created_at)}</div>
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

      {/* ── Footer: toggle historial con slide ──────────────────── */}
      <div style={{
        position:'sticky', bottom:0, background:'#fff',
        borderTop:'1px solid var(--gray-200)', padding:'0.55rem 1rem',
        display:'flex', justifyContent:'center', zIndex:50, flexShrink:0
      }}>
        <button
          onClick={() => setTab(t => t === 'active' ? 'past' : 'active')}
          style={{
            display:'flex', alignItems:'center', gap:'0.4rem',
            background:'var(--brand)', color:'#fff',
            border:'none', borderRadius:20, padding:'0.35rem 1.25rem',
            fontWeight:700, fontSize:'0.8rem', cursor:'pointer'
          }}>
          {tab === 'active' ? (
            <><span>Historial</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg></>
          ) : (
            <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
            <span>Activos</span></>
          )}
        </button>
      </div>
    </div>
  );
}
