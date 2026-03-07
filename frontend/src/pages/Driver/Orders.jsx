import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useRealtimeOrders } from '../../hooks/useRealtimeOrders';

function fmt(cents) { return `$${((cents ?? 0) / 100).toFixed(2)}`; }

// Desglose de tarifas para conductor
function FeeBreakdown({ order }) {
  const sub     = order.total_cents          || 0;
  const svc     = order.service_fee_cents    || 0;
  const del_fee = order.delivery_fee_cents   || 0;
  const tip     = order.tip_cents            || 0;
  const grandTotal = sub + svc + del_fee + tip;
  if (!svc && !del_fee) return null;
  return (
    <div style={{ fontSize:'0.78rem', color:'var(--gray-500)', borderTop:'1px solid var(--gray-100)', paddingTop:'0.35rem', marginTop:'0.35rem' }}>
      <div style={{ display:'flex', justifyContent:'space-between' }}>
        <span>A pagar a tienda</span><span>{fmt(sub)}</span>
      </div>
      <div style={{ display:'flex', justifyContent:'space-between', color:'var(--success)' }}>
        <span>Tu tarifa de envío</span><span>{fmt(del_fee)}</span>
      </div>
      {tip > 0 && (
        <div style={{ display:'flex', justifyContent:'space-between', color:'var(--success)' }}>
          <span>Agradecimiento</span><span>+{fmt(tip)}</span>
        </div>
      )}
      <div style={{ display:'flex', justifyContent:'space-between', fontWeight:700, color:'var(--gray-700)', marginTop:'0.2rem' }}>
        <span>Total pagado por cliente</span><span>{fmt(grandTotal)}</span>
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
              const color = STATUS_COLOR[o.status] || '#9ca3af';
              return (
                <li key={o.id} className="card" style={{ borderLeft:`3px solid ${color}`, marginBottom:'0.4rem', padding:'0.6rem 0.75rem' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.2rem' }}>
                    <span className="badge" style={{ color, borderColor:`${color}55`, background:`${color}15`, fontSize:'0.72rem' }}>
                      {STATUS_LABELS[o.status]}
                    </span>
                    <span style={{ fontWeight:700, fontSize:'0.875rem' }}>{fmt(o.total_cents)}</span>
                  </div>
                  <div style={{ fontSize:'0.8rem', color:'var(--gray-600)', marginBottom:'0.4rem' }}>
                    {o.restaurant_name}
                    {o.restaurant_address && <span> · {o.restaurant_address}</span>}
                  </div>
                  <button
                    className="btn-sm btn-primary"
                    disabled={actionLoading === o.id}
                    onClick={() => acceptDirectly(o.id)}
                    style={{ fontSize:'0.78rem' }}
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
        <button style={tabStyle('active')} onClick={() => setTab('active')}>Activos ({active.length})</button>
        <button style={tabStyle('past')}   onClick={() => setTab('past')}>Historial ({past.length})</button>
      </div>

      {tab === 'active' && (
        active.length === 0
          ? <p style={{ color:'var(--gray-600)', fontSize:'0.9rem' }}>Sin pedidos activos.</p>
          : (
            <ul style={{ listStyle:'none', padding:0 }}>
              {active.map(o => {
                const color = STATUS_COLOR[o.status] || '#9ca3af';
                return (
                  <li key={o.id} className="card" style={{ borderLeft:`3px solid ${color}`, marginBottom:'0.6rem' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'0.25rem' }}>
                      <span className="badge" style={{ color, borderColor:`${color}55`, background:`${color}15` }}>
                        {STATUS_LABELS[o.status]}
                      </span>
                      <span style={{ fontWeight:700 }}>{fmt(o.total_cents)}</span>
                    </div>
                    <div style={{ fontSize:'0.83rem', color:'var(--gray-600)' }}>
                      {o.restaurant_name} · {fmtDate(o.created_at)}
                    </div>
                    {o.customer_address && (
                      <div style={{ fontSize:'0.8rem', color:'var(--gray-500)', marginTop:'0.2rem' }}>
                        Entregar en: <strong>{o.customer_address}</strong>
                      </div>
                    )}
                    {(o.items || []).length > 0 && (
                      <ul style={{ fontSize:'0.82rem', margin:'0.25rem 0 0 1rem' }}>
                        {o.items.map(i => <li key={i.menuItemId}>{i.name} × {i.quantity}</li>)}
                      </ul>
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
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Estado</th><th>Restaurante</th><th>Total</th><th>Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {past.slice(0, 50).map(o => (
                    <tr key={o.id}>
                      <td>
                        <span className="badge" style={{ color:STATUS_COLOR[o.status], borderColor:`${STATUS_COLOR[o.status]}55`, background:`${STATUS_COLOR[o.status]}15`, fontSize:'0.7rem' }}>{STATUS_LABELS[o.status]}</span>
                        {['delivered','cancelled'].includes(o.status) && (
                          <div style={{ marginTop:'0.3rem' }}>
                            {reportingId === o.id ? (
                              <div style={{ display:'flex', flexDirection:'column', gap:'0.3rem' }}>
                                <textarea value={reportText} onChange={e=>setReportText(e.target.value)}
                                  placeholder="Describe el problema…" rows={2}
                                  style={{ fontSize:'0.78rem', width:'100%', boxSizing:'border-box' }} />
                                <div style={{ display:'flex', gap:'0.3rem' }}>
                                  <button className="btn-sm" style={{ fontSize:'0.75rem', background:'var(--danger)', color:'#fff', borderColor:'var(--danger)' }} onClick={() => sendReport(o.id)}>Enviar</button>
                                  <button className="btn-sm" style={{ fontSize:'0.75rem' }} onClick={() => { setReportingId(null); setReportText(''); }}>Cancelar</button>
                                </div>
                              </div>
                            ) : (
                              <button className="btn-sm" style={{ fontSize:'0.72rem' }} onClick={() => setReportingId(o.id)}>Reportar</button>
                            )}
                          </div>
                        )}
                      </td>
                      <td style={{ fontSize:'0.85rem' }}>{o.restaurant_name}</td>
                      <td>
            <div style={{ fontWeight:700 }}>{fmt((o.total_cents || 0) + (o.service_fee_cents || 0) + (o.delivery_fee_cents || 0))}</div>
            {(o.service_fee_cents || 0) > 0 && (
              <div style={{ fontSize:'0.72rem', color:'var(--gray-400)' }}>
                Envío: {fmt(o.delivery_fee_cents || 0)}
              </div>
            )}
          </td>
                      <td style={{ fontSize:'0.82rem', color:'var(--gray-600)' }}>{fmtDate(o.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
      )}
    </div>
  );
}
