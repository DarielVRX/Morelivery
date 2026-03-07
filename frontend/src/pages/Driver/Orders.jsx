import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useRealtimeOrders } from '../../hooks/useRealtimeOrders';

function fmt(cents) { return `$${((cents ?? 0) / 100).toFixed(2)}`; }
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
  const [orders, setOrders]     = useState([]);
  const [tab, setTab]           = useState('active');
  const [reportingId, setReportingId] = useState(null);
  const [reportText, setReportText]   = useState('');
  const [reportMsg, setReportMsg]     = useState('');
  const loadDataRef = useRef(null);

  async function loadData() {
    if (!auth.token) return;
    try {
      const d = await apiFetch('/orders/my', {}, auth.token);
      setOrders(d.orders || []);
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

  const tabStyle = (t) => ({
    padding:'0.4rem 1rem', cursor:'pointer', border:'none', borderRadius:6, fontWeight:600,
    fontSize:'0.875rem', transition:'background 0.15s',
    background: tab === t ? 'var(--brand)' : 'var(--gray-100)',
    color:      tab === t ? '#fff'         : 'var(--gray-600)',
  });

  return (
    <div>
      {reportMsg && <p className="flash flash-ok" style={{ marginBottom:'0.5rem' }}>{reportMsg}</p>}
      <h2 style={{ fontSize:'1.1rem', fontWeight:800, marginBottom:'1rem' }}>Mis pedidos</h2>

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
                    {(o.items || []).length > 0 && (
                      <ul style={{ fontSize:'0.82rem', margin:'0.25rem 0 0 1rem' }}>
                        {o.items.map(i => <li key={i.menuItemId}>{i.name} × {i.quantity}</li>)}
                      </ul>
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
                      <td style={{ fontWeight:700 }}>{fmt(o.total_cents)}</td>
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
