import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useRealtimeOrders } from '../../hooks/useRealtimeOrders';

const STATUS_LABELS = {
  created:'Recibido', assigned:'Asignado', accepted:'Aceptado',
  preparing:'En preparación', ready:'Listo para retiro',
  on_the_way:'En camino', delivered:'Entregado',
  cancelled:'Cancelado', pending_driver:'Buscando driver',
};
const STATUS_COLOR = {
  created:'#f59e0b', assigned:'#3b82f6', accepted:'#8b5cf6',
  preparing:'#f97316', ready:'#10b981', on_the_way:'#06b6d4',
  delivered:'#16a34a', cancelled:'#dc2626', pending_driver:'#ef4444',
};

function fmt(cents) { return `$${((cents ?? 0) / 100).toFixed(2)}`; }

function toDraft(items = []) {
  const d = {};
  items.forEach(i => { d[i.menuItemId] = i.quantity; });
  return d;
}

// Mapa inline lazy-loaded para evitar problemas si Leaflet no carga
function DriverMapInline({ lat, lng, driverName }) {
  const [loaded, setLoaded] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current || loaded) return;
    // Importar Leaflet dinámicamente para no bloquear el render
    import('leaflet').then(L => {
      import('leaflet/dist/leaflet.css').catch(() => {});
      delete L.Icon.Default.prototype._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });
      if (ref.current._leaflet_id) return; // ya inicializado
      const map = L.map(ref.current, { zoomControl: false }).setView([lat, lng], 15);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
      }).addTo(map);
      L.marker([lat, lng]).addTo(map).bindPopup(driverName || 'Driver').openPopup();
      setLoaded(true);
    }).catch(() => {});
  }, [lat, lng]);

  return (
    <div ref={ref} style={{ height: 180, borderRadius: 8, border: '1px solid #e5e7eb', marginTop: '0.5rem', background: '#f0f4f8' }} />
  );
}

export default function CustomerHome() {
  const { auth } = useAuth();
  const navigate = useNavigate();
  const [restaurants, setRestaurants] = useState([]);
  const [myOrders, setMyOrders]       = useState([]);
  const [message, setMessage]         = useState('');
  const [openSuggestionFor, setOpenSuggestionFor] = useState('');
  const [suggestionDrafts, setSuggestionDrafts]   = useState({});
  const [expandedOrder, setExpandedOrder]         = useState(null);
  const [driverPositions, setDriverPositions]     = useState({});

  const loadDataRef = useRef(null);

  async function loadRestaurants() {
    try {
      const data = await apiFetch('/restaurants');
      setRestaurants(data.restaurants || []);
    } catch (_) {}
  }

  async function loadMyOrders() {
    if (!auth.token) return;
    try {
      const data = await apiFetch('/orders/my', {}, auth.token);
      setMyOrders(data.orders || []);
    } catch (_) {}
  }

  useEffect(() => { loadDataRef.current = loadMyOrders; });
  useEffect(() => { loadRestaurants(); }, []);
  useEffect(() => { loadMyOrders(); }, [auth.token]);

  // SSE — recibe actualizaciones y posición del driver en tiempo real
  useRealtimeOrders(
    auth.token,
    () => loadDataRef.current?.(),
    ({ orderId, lat, lng }) => setDriverPositions(p => ({ ...p, [orderId]: { lat, lng } }))
  );

  async function cancelOrder(orderId) {
    try {
      await apiFetch(`/orders/${orderId}/cancel`, { method: 'PATCH' }, auth.token);
      setOpenSuggestionFor('');
      loadMyOrders();
    } catch (e) { setMessage(e.message); }
  }

  function openSuggestion(order) {
    setOpenSuggestionFor(order.id);
    setSuggestionDrafts(prev => ({ ...prev, [order.id]: prev[order.id] || toDraft(order.suggestion_items || []) }));
  }

  function adjustSuggestion(orderId, menuItemId, delta) {
    setSuggestionDrafts(prev => {
      const cur = prev[orderId] || {};
      return { ...prev, [orderId]: { ...cur, [menuItemId]: Math.max(0, (cur[menuItemId] || 0) + delta) } };
    });
  }

  async function respondSuggestion(orderId, accepted) {
    try {
      const items = accepted
        ? Object.entries(suggestionDrafts[orderId] || {}).filter(([,q]) => q > 0).map(([menuItemId, quantity]) => ({ menuItemId, quantity }))
        : undefined;
      await apiFetch(`/orders/${orderId}/suggestion-response`, {
        method: 'PATCH',
        body: JSON.stringify({ accepted, ...(items ? { items } : {}) })
      }, auth.token);
      setOpenSuggestionFor('');
      loadMyOrders();
    } catch (e) { setMessage(e.message); }
  }

  const pendingSuggestions = useMemo(
    () => myOrders.filter(o => o.suggestion_status === 'pending_customer' && (o.suggestion_items || []).length > 0),
    [myOrders]
  );
  const activeOrders = useMemo(() => myOrders.filter(o => !['delivered','cancelled'].includes(o.status)), [myOrders]);
  const pastOrders   = useMemo(() => myOrders.filter(o => ['delivered','cancelled'].includes(o.status)), [myOrders]);

  return (
    <section className="role-panel">

      {/* ── ALERTAS DE SUGERENCIAS ── */}
      {pendingSuggestions.map(order => (
        <div key={`sug-${order.id}`} style={{
          background:'#fffbeb', border:'2px solid #f59e0b', borderRadius:8,
          padding:'0.875rem', marginBottom:'1rem'
        }}>
          <p style={{ fontWeight:700, margin:'0 0 0.5rem', color:'#92400e' }}>
            ⚠️ El restaurante propone un cambio en tu pedido ({order.restaurant_name})
          </p>
          <div style={{ background:'#fff', border:'1px solid #fde68a', borderRadius:6, padding:'0.5rem 0.75rem', marginBottom:'0.6rem' }}>
            {(order.suggestion_items || []).map(item => (
              <div key={item.menuItemId} style={{ display:'flex', justifyContent:'space-between', fontSize:'0.875rem', padding:'0.15rem 0' }}>
                <span>{item.name}</span>
                <span style={{ color:'#6b7280' }}>× {item.quantity} — {fmt((item.unitPriceCents || 0) * item.quantity)}</span>
              </div>
            ))}
          </div>
          {openSuggestionFor === order.id ? (
            <>
              <p style={{ fontSize:'0.78rem', color:'#6b7280', margin:'0 0 0.35rem' }}>Ajusta cantidades si quieres:</p>
              <div style={{ display:'flex', flexDirection:'column', gap:'0.3rem', marginBottom:'0.6rem' }}>
                {(order.suggestion_items || []).map(item => {
                  const qty = (suggestionDrafts[order.id] || {})[item.menuItemId] ?? item.quantity;
                  return (
                    <div key={item.menuItemId} style={{ display:'flex', alignItems:'center', gap:'0.5rem', background:'#fff', border:'1px solid #e5e7eb', borderRadius:6, padding:'0.35rem 0.75rem' }}>
                      <span style={{ flex:1, fontSize:'0.875rem' }}>{item.name}</span>
                      <button onClick={() => adjustSuggestion(order.id, item.menuItemId, -1)} disabled={qty===0}
                        style={{ width:26, height:26, borderRadius:'50%', border:'1px solid #e5e7eb', background:'#f9fafb', fontWeight:700, cursor:qty===0?'default':'pointer', opacity:qty===0?0.4:1 }}>−</button>
                      <span style={{ minWidth:20, textAlign:'center', fontWeight:700 }}>{qty}</span>
                      <button onClick={() => adjustSuggestion(order.id, item.menuItemId, 1)}
                        style={{ width:26, height:26, borderRadius:'50%', border:'none', background:'#2563eb', color:'#fff', fontWeight:700, cursor:'pointer' }}>+</button>
                    </div>
                  );
                })}
              </div>
              <div style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap' }}>
                <button onClick={() => respondSuggestion(order.id, true)} style={{ background:'#16a34a', color:'#fff', border:'none', borderRadius:6, padding:'0.45rem 1rem', fontWeight:700, cursor:'pointer' }}>✅ Aceptar</button>
                <button onClick={() => respondSuggestion(order.id, false)} style={{ background:'#dc2626', color:'#fff', border:'none', borderRadius:6, padding:'0.45rem 1rem', fontWeight:700, cursor:'pointer' }}>❌ Rechazar</button>
                <button onClick={() => cancelOrder(order.id)} style={{ background:'#f3f4f6', border:'none', borderRadius:6, padding:'0.45rem 1rem', cursor:'pointer' }}>Cancelar pedido</button>
              </div>
            </>
          ) : (
            <button onClick={() => openSuggestion(order)} style={{ background:'#f59e0b', color:'#fff', border:'none', borderRadius:6, padding:'0.45rem 1rem', fontWeight:700, cursor:'pointer' }}>
              Ver y responder
            </button>
          )}
        </div>
      ))}

      {message && <p style={{ color:'#dc2626', fontSize:'0.875rem', marginBottom:'0.75rem' }}>{message}</p>}

      {/* ── LISTA DE RESTAURANTES ── */}
      <h3 style={{ marginTop:0 }}>Restaurantes</h3>
      {restaurants.length === 0
        ? <p style={{ color:'#888' }}>Sin restaurantes disponibles.</p>
        : (
          <ul style={{ listStyle:'none', padding:0, marginBottom:'1.5rem' }}>
            {restaurants.map(r => (
              <li key={r.id}
                onClick={() => navigate(`/restaurant/${r.id}`)}
                style={{
                  display:'flex', justifyContent:'space-between', alignItems:'center',
                  padding:'0.75rem 0.875rem', border:'1px solid #e5e7eb', borderRadius:8,
                  marginBottom:'0.5rem', cursor:'pointer', background:'#fff',
                  transition:'box-shadow 0.15s'
                }}
                onMouseEnter={e => e.currentTarget.style.boxShadow='0 2px 8px #0001'}
                onMouseLeave={e => e.currentTarget.style.boxShadow='none'}
              >
                <div>
                  <div style={{ fontWeight:700, fontSize:'0.95rem' }}>{r.name}</div>
                  {r.address && <div style={{ fontSize:'0.8rem', color:'#6b7280' }}>📍 {r.address}</div>}
                </div>
                <span style={{ fontSize:'0.78rem', fontWeight:700, color: r.is_open ? '#16a34a' : '#dc2626' }}>
                  {r.is_open ? '● Abierto' : '● Cerrado'}
                </span>
              </li>
            ))}
          </ul>
        )
      }

      {/* ── PEDIDOS ACTIVOS ── */}
      {activeOrders.length > 0 && (
        <>
          <h3>Pedidos activos ({activeOrders.length})</h3>
          <ul style={{ listStyle:'none', padding:0 }}>
            {activeOrders.map(order => {
              const color = STATUS_COLOR[order.status] || '#9ca3af';
              const driverPos = driverPositions[order.id];
              const isExpanded = expandedOrder === order.id;
              return (
                <li key={order.id} style={{ border:`1px solid ${color}44`, borderRadius:8, marginBottom:'0.75rem', overflow:'hidden' }}>
                  <div
                    onClick={() => setExpandedOrder(isExpanded ? null : order.id)}
                    style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0.75rem 0.875rem', cursor:'pointer', background:`${color}11` }}
                  >
                    <div>
                      <span style={{ background:`${color}22`, color, border:`1px solid ${color}55`, borderRadius:10, padding:'0.1rem 0.5rem', fontSize:'0.75rem', fontWeight:700, marginRight:'0.5rem' }}>
                        {STATUS_LABELS[order.status] || order.status}
                      </span>
                      <span style={{ fontWeight:700, fontSize:'0.875rem' }}>{order.restaurant_name}</span>
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
                      <span style={{ fontWeight:700 }}>{fmt(order.total_cents)}</span>
                      <span style={{ color:'#9ca3af' }}>{isExpanded ? '▲' : '▼'}</span>
                    </div>
                  </div>

                  {isExpanded && (
                    <div style={{ padding:'0.75rem 0.875rem', borderTop:`1px solid ${color}33` }}>
                      <div style={{ fontSize:'0.85rem', color:'#6b7280', marginBottom:'0.4rem' }}>
                        Driver: <strong>{order.driver_first_name || 'Buscando…'}</strong>
                      </div>
                      {(order.items || []).length > 0 && (
                        <ul style={{ margin:'0 0 0.5rem 1rem', fontSize:'0.875rem' }}>
                          {order.items.map(i => <li key={i.menuItemId}>{i.name} × {i.quantity}</li>)}
                        </ul>
                      )}

                      {/* Mapa del driver — cuando hay posición GPS disponible via SSE */}
                      {driverPos && (
                        <DriverMapInline lat={driverPos.lat} lng={driverPos.lng} driverName={order.driver_first_name} />
                      )}
                      {order.status === 'on_the_way' && !driverPos && (
                        <p style={{ fontSize:'0.8rem', color:'#9ca3af', fontStyle:'italic' }}>📍 Esperando ubicación del driver…</p>
                      )}

                      {['created','pending_driver','assigned','accepted','preparing'].includes(order.status) && (
                        <button onClick={() => cancelOrder(order.id)} style={{ marginTop:'0.5rem', background:'#fee2e2', color:'#dc2626', border:'1px solid #fca5a5', borderRadius:6, padding:'0.35rem 0.75rem', cursor:'pointer', fontSize:'0.82rem' }}>
                          Cancelar pedido
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* ── HISTORIAL ── */}
      {pastOrders.length > 0 && (
        <>
          <h3 style={{ color:'#6b7280', marginTop:'1.5rem' }}>Historial</h3>
          <ul style={{ listStyle:'none', padding:0 }}>
            {pastOrders.slice(0, 10).map(order => (
              <li key={order.id} style={{ display:'flex', justifyContent:'space-between', padding:'0.45rem 0', borderBottom:'1px solid #f3f4f6', fontSize:'0.875rem' }}>
                <span style={{ color: order.status==='delivered'?'#16a34a':'#dc2626' }}>{STATUS_LABELS[order.status]}</span>
                <span style={{ color:'#6b7280' }}>{order.restaurant_name}</span>
                <span style={{ fontWeight:700 }}>{fmt(order.total_cents)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
