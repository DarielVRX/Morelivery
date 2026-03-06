import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useRealtimeOrders } from '../../hooks/useRealtimeOrders';

function fmt(cents) { return `$${((cents ?? 0) / 100).toFixed(2)}`; }

const STATUS_LABELS = {
  created:'Recibido', assigned:'Asignado', accepted:'Aceptado',
  preparing:'En preparación', ready:'Listo para retiro',
  on_the_way:'En camino', delivered:'Entregado',
  cancelled:'Cancelado', pending_driver:'Buscando conductor',
};
const STATUS_COLOR = {
  created:'#f59e0b', assigned:'#3b82f6', accepted:'#8b5cf6',
  preparing:'#f97316', ready:'#16a34a', on_the_way:'#0891b2',
  delivered:'#16a34a', cancelled:'#dc2626', pending_driver:'#ef4444',
};

// Mapa lazy del conductor
function DriverMap({ lat, lng, driverName }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    import('leaflet').then(L => {
      import('leaflet/dist/leaflet.css').catch(() => {});
      if (ref.current._leaflet_id) return;
      delete L.Icon.Default.prototype._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });
      const map = L.map(ref.current, { zoomControl: false }).setView([lat, lng], 15);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
      L.marker([lat, lng]).addTo(map).bindPopup(driverName || 'Conductor').openPopup();
    }).catch(() => {});
  }, [lat, lng]);
  return <div ref={ref} style={{ height:180, borderRadius:8, border:'1px solid var(--gray-200)', marginTop:'0.75rem' }} />;
}

function toDraft(items = []) {
  const d = {};
  items.forEach(i => { d[i.menuItemId] = i.quantity; });
  return d;
}

export default function CustomerOrders() {
  const { auth } = useAuth();
  const [orders, setOrders]           = useState([]);
  const [tab, setTab]                 = useState('active');
  const [expanded, setExpanded]       = useState(null);
  const [driverPos, setDriverPos]     = useState({}); // { orderId: {lat,lng} }
  const [suggestionFor, setSuggestionFor] = useState('');
  const [suggDrafts, setSuggDrafts]       = useState({});
  const [msg, setMsg] = useState('');
  const loadDataRef = useRef(null);

  async function loadData() {
    if (!auth.token) return;
    try {
      const d = await apiFetch('/orders/my', {}, auth.token);
      setOrders(d.orders || []);
    } catch (_) {}
  }

  useEffect(() => { loadDataRef.current = loadData; });
  useEffect(() => { loadData(); }, [auth.token]);
  useRealtimeOrders(
    auth.token,
    () => loadDataRef.current?.(),
    ({ orderId, lat, lng }) => setDriverPos(p => ({ ...p, [orderId]: { lat, lng } }))
  );

  const active = useMemo(() => orders.filter(o => !['delivered','cancelled'].includes(o.status)), [orders]);
  const past   = useMemo(() => orders.filter(o =>  ['delivered','cancelled'].includes(o.status)), [orders]);

  // Alertas de sugerencia pendiente
  const pendingSuggestions = useMemo(
    () => orders.filter(o => o.suggestion_status === 'pending_customer' && (o.suggestion_items || []).length > 0),
    [orders]
  );

  async function cancelOrder(orderId) {
    const note = window.prompt('Motivo de cancelación (obligatorio):');
    if (!note?.trim()) return;
    try {
      await apiFetch(`/orders/${orderId}/cancel`, { method:'PATCH', body: JSON.stringify({ note }) }, auth.token);
      loadData();
    } catch (e) { setMsg(e.message); }
  }

  function openSuggestion(order) {
    setSuggestionFor(order.id);
    setSuggDrafts(prev => ({ ...prev, [order.id]: prev[order.id] || toDraft(order.suggestion_items || []) }));
  }

  function adjustSugg(orderId, menuItemId, delta) {
    setSuggDrafts(prev => {
      const cur = prev[orderId] || {};
      return { ...prev, [orderId]: { ...cur, [menuItemId]: Math.max(0, (cur[menuItemId] || 0) + delta) } };
    });
  }

  async function respondSuggestion(orderId, accepted) {
    try {
      const items = accepted
        ? Object.entries(suggDrafts[orderId] || {}).filter(([,q]) => q > 0).map(([menuItemId, quantity]) => ({ menuItemId, quantity }))
        : undefined;
      await apiFetch(`/orders/${orderId}/suggestion-response`, {
        method:'PATCH',
        body: JSON.stringify({ accepted, ...(items ? { items } : {}) })
      }, auth.token);
      setSuggestionFor('');
      loadData();
    } catch (e) { setMsg(e.message); }
  }

  const tabStyle = (t) => ({
    padding:'0.4rem 1rem', cursor:'pointer', border:'none', borderRadius:6, fontWeight:600,
    fontSize:'0.875rem', transition:'background 0.15s',
    background: tab === t ? 'var(--brand)' : 'var(--gray-100)',
    color:      tab === t ? '#fff'         : 'var(--gray-600)',
  });

  return (
    <div>
      <h2 style={{ fontSize:'1.1rem', fontWeight:800, marginBottom:'1rem' }}>Mis pedidos</h2>

      {/* Alertas de sugerencia */}
      {pendingSuggestions.map(order => (
        <div key={`sug-${order.id}`} style={{
          background:'#fffbeb', border:'2px solid #f59e0b', borderRadius:8,
          padding:'0.875rem', marginBottom:'0.75rem'
        }}>
          <p style={{ fontWeight:700, fontSize:'0.875rem', color:'#92400e', marginBottom:'0.5rem' }}>
            {order.restaurant_name} propone un cambio en tu pedido
          </p>
          {suggestionFor === order.id ? (
            <>
              <div style={{ display:'flex', flexDirection:'column', gap:'0.3rem', marginBottom:'0.65rem' }}>
                {(order.suggestion_items || []).map(item => {
                  const qty = (suggDrafts[order.id] || {})[item.menuItemId] ?? item.quantity;
                  return (
                    <div key={item.menuItemId} style={{
                      display:'flex', alignItems:'center', gap:'0.5rem',
                      background: qty > 0 ? 'var(--brand-light)' : '#fff',
                      border:`1px solid ${qty > 0 ? '#bfdbfe' : 'var(--gray-200)'}`,
                      borderRadius:6, padding:'0.4rem 0.75rem',
                    }}>
                      <span style={{ flex:1, fontSize:'0.875rem', fontWeight: qty > 0 ? 600 : 400 }}>{item.name}</span>
                      <div className="qty-control">
                        <button className="qty-btn" disabled={qty===0} onClick={() => adjustSugg(order.id, item.menuItemId, -1)}>−</button>
                        <span className="qty-num">{qty}</span>
                        <button className="qty-btn add" onClick={() => adjustSugg(order.id, item.menuItemId, 1)}>+</button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ display:'flex', gap:'0.4rem', flexWrap:'wrap' }}>
                <button className="btn-primary btn-sm" onClick={() => respondSuggestion(order.id, true)}>Aceptar</button>
                <button className="btn-sm btn-danger" onClick={() => respondSuggestion(order.id, false)}>Rechazar</button>
                <button className="btn-sm" onClick={() => cancelOrder(order.id)}>Cancelar pedido</button>
              </div>
            </>
          ) : (
            <button onClick={() => openSuggestion(order)} style={{ background:'#f59e0b', color:'#fff', border:'none', borderRadius:6, padding:'0.45rem 1rem', fontWeight:700, cursor:'pointer', fontSize:'0.875rem' }}>
              Ver propuesta
            </button>
          )}
        </div>
      ))}

      {msg && <p className="flash flash-error">{msg}</p>}

      <div style={{ display:'flex', gap:'0.4rem', marginBottom:'1rem' }}>
        <button style={tabStyle('active')} onClick={() => setTab('active')}>Activos ({active.length})</button>
        <button style={tabStyle('past')}   onClick={() => setTab('past')}>Historial ({past.length})</button>
      </div>

      {/* Activos */}
      {tab === 'active' && (
        active.length === 0
          ? <p style={{ color:'var(--gray-600)', fontSize:'0.9rem' }}>Sin pedidos activos.</p>
          : (
            <ul style={{ listStyle:'none', padding:0 }}>
              {active.map(order => {
                const color = STATUS_COLOR[order.status] || '#9ca3af';
                const pos   = driverPos[order.id];
                const isExp = expanded === order.id;
                return (
                  <li key={order.id} className="card" style={{ borderLeft:`3px solid ${color}`, marginBottom:'0.6rem', padding:0, overflow:'hidden' }}>
                    <div
                      onClick={() => setExpanded(isExp ? null : order.id)}
                      style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0.75rem', cursor:'pointer', gap:'0.5rem' }}
                    >
                      <div>
                        <span className="badge" style={{ color, borderColor:`${color}55`, background:`${color}15`, marginRight:'0.5rem' }}>
                          {STATUS_LABELS[order.status]}
                        </span>
                        <span style={{ fontWeight:700, fontSize:'0.875rem' }}>{order.restaurant_name}</span>
                      </div>
                      <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', flexShrink:0 }}>
                        <span style={{ fontWeight:700 }}>{fmt(order.total_cents)}</span>
                        <span style={{ color:'var(--gray-400)', fontSize:'0.8rem' }}>{isExp ? '▲' : '▼'}</span>
                      </div>
                    </div>

                    {isExp && (
                      <div style={{ padding:'0 0.75rem 0.75rem', borderTop:`1px solid ${color}22` }}>
                        <div style={{ fontSize:'0.83rem', color:'var(--gray-600)', marginBottom:'0.35rem' }}>
                          Conductor: <strong>{order.driver_first_name || 'Buscando…'}</strong>
                        </div>
                        {(order.items || []).length > 0 && (
                          <ul style={{ fontSize:'0.83rem', margin:'0 0 0.4rem 1rem' }}>
                            {order.items.map(i => <li key={i.menuItemId}>{i.name} × {i.quantity}</li>)}
                          </ul>
                        )}

                        {/* Mapa solo cuando está en camino y hay posición */}
                        {order.status === 'on_the_way' && pos && (
                          <DriverMap lat={pos.lat} lng={pos.lng} driverName={order.driver_first_name} />
                        )}
                        {order.status === 'on_the_way' && !pos && (
                          <p style={{ fontSize:'0.8rem', color:'var(--gray-400)', fontStyle:'italic', marginTop:'0.4rem' }}>
                            Esperando ubicación del conductor…
                          </p>
                        )}

                        {['created','pending_driver','assigned','accepted','preparing'].includes(order.status) && (
                          <button className="btn-sm btn-danger" onClick={() => cancelOrder(order.id)} style={{ marginTop:'0.5rem' }}>
                            Cancelar pedido
                          </button>
                        )}
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
                <thead><tr><th>Estado</th><th>Restaurante</th><th>Total</th></tr></thead>
                <tbody>
                  {past.slice(0, 30).map(o => (
                    <tr key={o.id}>
                      <td><span className="badge" style={{ color:STATUS_COLOR[o.status], borderColor:`${STATUS_COLOR[o.status]}55`, background:`${STATUS_COLOR[o.status]}15`, fontSize:'0.7rem' }}>{STATUS_LABELS[o.status]}</span></td>
                      <td style={{ fontSize:'0.85rem' }}>{o.restaurant_name}</td>
                      <td style={{ fontWeight:700 }}>{fmt(o.total_cents)}</td>
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
