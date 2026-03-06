import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useRealtimeOrders } from '../../hooks/useRealtimeOrders';

function fmt(cents) { return `$${((cents ?? 0) / 100).toFixed(2)}`; }

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

function buildInitial(items = []) {
  const m = {}; items.forEach(i => { m[i.menuItemId] = i.quantity; }); return m;
}

export default function RestaurantOrders() {
  const { auth } = useAuth();
  const [orders, setOrders]     = useState([]);
  const [products, setProducts] = useState([]);
  const [tab, setTab]           = useState('active');
  const [msg, setMsg]           = useState('');
  const [suggestionFor, setSuggestionFor]   = useState('');
  const [suggDrafts, setSuggDrafts]         = useState({});
  const loadDataRef = useRef(null);

  async function loadData() {
    if (!auth.token) return;
    try {
      const [od, md] = await Promise.all([
        apiFetch('/orders/my', {}, auth.token),
        apiFetch('/restaurants/my/menu', {}, auth.token),
      ]);
      setOrders(od.orders || []);
      setProducts(md.menu || []);
    } catch (e) { setMsg(e.message); }
  }

  useEffect(() => { loadDataRef.current = loadData; });
  useEffect(() => { loadData(); }, [auth.token]);
  useRealtimeOrders(auth.token, () => loadDataRef.current?.(), () => {});

  useEffect(() => {
    setSuggDrafts(prev => {
      const next = {};
      orders.forEach(o => { next[o.id] = prev[o.id] || buildInitial(o.items); });
      return next;
    });
  }, [orders.length]);

  async function changeStatus(orderId, status) {
    try { await apiFetch(`/orders/${orderId}/status`, { method:'PATCH', body: JSON.stringify({ status }) }, auth.token); loadData(); }
    catch (e) { setMsg(e.message); }
  }

  function adjustSugg(orderId, menuItemId, delta) {
    setSuggDrafts(prev => {
      const cur = prev[orderId] || {};
      return { ...prev, [orderId]: { ...cur, [menuItemId]: Math.max(0, (cur[menuItemId] || 0) + delta) } };
    });
  }

  async function sendSuggestion(order) {
    const draft = suggDrafts[order.id] || {};
    const items = Object.entries(draft).filter(([,q]) => q > 0).map(([menuItemId, quantity]) => ({ menuItemId, quantity }));
    if (items.length === 0) return setMsg('La sugerencia debe tener al menos 1 producto');
    try {
      await apiFetch(`/orders/${order.id}/suggest`, { method:'PATCH', body: JSON.stringify({ items }) }, auth.token);
      setSuggestionFor(''); loadData();
    } catch (e) { setMsg(e.message); }
  }

  const active = useMemo(() => orders.filter(o => !['delivered','cancelled'].includes(o.status)), [orders]);
  const past   = useMemo(() => orders.filter(o =>  ['delivered','cancelled'].includes(o.status)), [orders]);

  const tabStyle = (t) => ({
    padding: '0.4rem 1rem', cursor:'pointer', border:'none', borderRadius:6, fontWeight:600,
    fontSize:'0.875rem', transition:'background 0.15s',
    background: tab === t ? 'var(--brand)' : 'var(--gray-100)',
    color:      tab === t ? '#fff'         : 'var(--gray-600)',
  });

  return (
    <div>
      <h2 style={{ fontSize:'1.1rem', fontWeight:800, marginBottom:'1rem' }}>Pedidos</h2>

      <div style={{ display:'flex', gap:'0.4rem', marginBottom:'1rem' }}>
        <button style={tabStyle('active')} onClick={() => setTab('active')}>
          Activos ({active.length})
        </button>
        <button style={tabStyle('past')} onClick={() => setTab('past')}>
          Historial ({past.length})
        </button>
      </div>

      {msg && <p className="flash flash-error">{msg}</p>}

      {/* Activos */}
      {tab === 'active' && (
        active.length === 0
          ? <p style={{ color:'var(--gray-600)', fontSize:'0.9rem' }}>Sin pedidos activos.</p>
          : (
            <ul style={{ listStyle:'none', padding:0 }}>
              {active.map(order => {
                const color = STATUS_COLOR[order.status] || '#9ca3af';
                return (
                  <li key={order.id} className="card" style={{ borderLeft:`3px solid ${color}`, marginBottom:'0.75rem' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.35rem' }}>
                      <span className="badge" style={{ color, borderColor:`${color}66`, background:`${color}15` }}>
                        {STATUS_LABELS[order.status]}
                      </span>
                      <span style={{ fontWeight:700 }}>{fmt(order.total_cents)}</span>
                    </div>
                    <div style={{ fontSize:'0.83rem', color:'var(--gray-600)', marginBottom:'0.35rem' }}>
                      Cliente: <strong>{order.customer_first_name || '—'}</strong>
                      {' · '}
                      Conductor: <strong>{order.driver_first_name || 'Pendiente'}</strong>
                    </div>
                    {(order.items || []).length > 0 && (
                      <ul style={{ margin:'0.25rem 0 0.5rem 1rem', fontSize:'0.83rem', color:'var(--gray-800)' }}>
                        {order.items.map(i => <li key={i.menuItemId}>{i.name} × {i.quantity}</li>)}
                      </ul>
                    )}
                    <div style={{ display:'flex', gap:'0.4rem', flexWrap:'wrap', marginTop:'0.4rem' }}>
                      <button className="btn-sm" onClick={() => changeStatus(order.id, 'preparing')}>En preparación</button>
                      <button className="btn-sm" onClick={() => changeStatus(order.id, 'ready')}>Listo</button>
                      <button className="btn-sm" onClick={() => setSuggestionFor(s => s === order.id ? '' : order.id)}
                        style={{ background: suggestionFor === order.id ? 'var(--brand-light)' : undefined }}>
                        Sugerir cambio
                      </button>
                    </div>

                    {/* Panel sugerencia */}
                    {suggestionFor === order.id && (
                      <div style={{ marginTop:'0.75rem', background:'var(--gray-50)', border:'1px solid var(--gray-200)', borderRadius:8, padding:'0.875rem' }}>
                        <p style={{ fontWeight:700, fontSize:'0.875rem', marginBottom:'0.5rem' }}>Proponer cambio al cliente</p>
                        <p style={{ fontSize:'0.75rem', color:'var(--gray-600)', marginBottom:'0.35rem' }}>Pedido original:</p>
                        <div style={{ background:'#fff', border:'1px solid var(--gray-200)', borderRadius:6, padding:'0.4rem 0.75rem', marginBottom:'0.65rem' }}>
                          {(order.items || []).map(i => (
                            <div key={i.menuItemId} style={{ display:'flex', justifyContent:'space-between', fontSize:'0.83rem', padding:'0.1rem 0' }}>
                              <span>{i.name}</span><span style={{ color:'var(--gray-400)' }}>× {i.quantity}</span>
                            </div>
                          ))}
                        </div>
                        <p style={{ fontSize:'0.75rem', color:'var(--gray-600)', marginBottom:'0.35rem' }}>Sugerencia:</p>
                        <div style={{ display:'flex', flexDirection:'column', gap:'0.3rem', marginBottom:'0.65rem' }}>
                          {products.map(p => {
                            const qty = (suggDrafts[order.id] || {})[p.id] ?? 0;
                            return (
                              <div key={p.id} style={{
                                display:'flex', alignItems:'center', gap:'0.5rem',
                                background: qty > 0 ? 'var(--brand-light)' : '#fff',
                                border: `1px solid ${qty > 0 ? '#bfdbfe' : 'var(--gray-200)'}`,
                                borderRadius:6, padding:'0.4rem 0.75rem',
                              }}>
                                <span style={{ flex:1, fontSize:'0.875rem', fontWeight: qty > 0 ? 600 : 400 }}>{p.name}</span>
                                <span style={{ fontSize:'0.75rem', color:'var(--gray-400)' }}>{fmt(p.price_cents)}</span>
                                <div className="qty-control">
                                  <button className="qty-btn" disabled={qty===0} onClick={() => adjustSugg(order.id, p.id, -1)}>−</button>
                                  <span className="qty-num">{qty}</span>
                                  <button className="qty-btn add" onClick={() => adjustSugg(order.id, p.id, 1)}>+</button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <div style={{ display:'flex', gap:'0.4rem' }}>
                          <button className="btn-primary btn-sm" onClick={() => sendSuggestion(order)}>Enviar al cliente</button>
                          <button className="btn-sm" onClick={() => setSuggestionFor('')}>Cancelar</button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )
      )}

      {/* Historial */}
      {tab === 'past' && (
        past.length === 0
          ? <p style={{ color:'var(--gray-600)', fontSize:'0.9rem' }}>Sin pedidos anteriores.</p>
          : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Estado</th><th>Cliente</th><th>Total</th><th>Conductor</th>
                  </tr>
                </thead>
                <tbody>
                  {past.slice(0, 50).map(o => (
                    <tr key={o.id}>
                      <td><span className="badge" style={{ color: STATUS_COLOR[o.status], borderColor:`${STATUS_COLOR[o.status]}55`, background:`${STATUS_COLOR[o.status]}15`, fontSize:'0.7rem' }}>{STATUS_LABELS[o.status]}</span></td>
                      <td style={{ fontSize:'0.85rem' }}>{o.customer_first_name || '—'}</td>
                      <td style={{ fontWeight:700 }}>{fmt(o.total_cents)}</td>
                      <td style={{ fontSize:'0.85rem', color:'var(--gray-600)' }}>{o.driver_first_name || '—'}</td>
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
