import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useRealtimeOrders } from '../../hooks/useRealtimeOrders';

// Fix ícono por defecto de Leaflet con bundlers
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const driverIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});

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
  const draft = {};
  items.forEach(item => { draft[item.menuItemId] = item.quantity; });
  return draft;
}

// Mapa pequeño inline que muestra la posición del driver
function DriverMap({ lat, lng, driverName }) {
  return (
    <div style={{ marginTop:'0.5rem', borderRadius:8, overflow:'hidden', height:180, border:'1px solid #e5e7eb' }}>
      <MapContainer center={[lat, lng]} zoom={15} style={{ height:'100%', width:'100%' }} zoomControl={false}>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; OpenStreetMap'
        />
        <Marker position={[lat, lng]} icon={driverIcon}>
          <Popup>{driverName || 'Driver'}</Popup>
        </Marker>
      </MapContainer>
    </div>
  );
}

export default function CustomerHome() {
  const { auth } = useAuth();
  const [restaurants, setRestaurants] = useState([]);
  const [restaurantId, setRestaurantId] = useState('');
  const [menu, setMenu] = useState([]);
  const [selectedItems, setSelectedItems] = useState({});
  const [myOrders, setMyOrders] = useState([]);
  const [message, setMessage] = useState('');
  const [openSuggestionFor, setOpenSuggestionFor] = useState('');
  const [suggestionDrafts, setSuggestionDrafts] = useState({});
  const [expandedOrder, setExpandedOrder] = useState(null);
  const [driverPositions, setDriverPositions] = useState({});  // orderId → {lat,lng}

  const loadDataRef = useRef(null);

  async function loadRestaurants() {
    const data = await apiFetch('/restaurants');
    setRestaurants(data.restaurants);
    if (data.restaurants[0]?.id) setRestaurantId(data.restaurants[0].id);
  }

  async function loadMenu(id) {
    if (!id) return;
    const data = await apiFetch(`/restaurants/${id}/menu`);
    setMenu((data.menu || []).filter(i => i.is_available !== false));
    setSelectedItems({});
  }

  async function loadMyOrders() {
    if (!auth.token) return;
    const data = await apiFetch('/orders/my', {}, auth.token);
    setMyOrders(data.orders);
  }

  useEffect(() => { loadDataRef.current = loadMyOrders; });
  useEffect(() => { loadRestaurants().catch(() => setMessage('Error cargando restaurantes')); }, []);
  useEffect(() => { loadMenu(restaurantId).catch(() => setMenu([])); }, [restaurantId]);
  useEffect(() => { loadMyOrders().catch(() => setMyOrders([])); }, [auth.token]);

  // SSE — recibe actualizaciones de pedidos y posición del driver
  useRealtimeOrders(
    auth.token,
    () => loadDataRef.current?.(),
    ({ orderId, lat, lng }) => {
      setDriverPositions(prev => ({ ...prev, [orderId]: { lat, lng } }));
    }
  );

  async function createOrder() {
    try {
      if (!restaurantId) throw new Error('Selecciona un restaurante');
      const currentMenuIds = new Set(menu.map(i => i.id));
      const items = Object.entries(selectedItems)
        .filter(([id, qty]) => currentMenuIds.has(id) && Number(qty) > 0)
        .map(([menuItemId, quantity]) => ({ menuItemId, quantity: Number(quantity) }));
      if (items.length === 0) throw new Error('Selecciona al menos un producto válido');
      const data = await apiFetch('/orders', { method:'POST', body:JSON.stringify({ restaurantId, items }) }, auth.token);
      setMessage(`✅ Pedido creado`);
      setSelectedItems({});
      loadMyOrders();
    } catch (error) { setMessage(error.message); }
  }

  async function cancelOrder(orderId) {
    await apiFetch(`/orders/${orderId}/cancel`, { method:'PATCH' }, auth.token);
    setOpenSuggestionFor('');
    loadMyOrders();
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
    const items = accepted
      ? Object.entries(suggestionDrafts[orderId] || {}).filter(([,q]) => q > 0).map(([menuItemId, quantity]) => ({ menuItemId, quantity }))
      : undefined;
    await apiFetch(`/orders/${orderId}/suggestion-response`, {
      method:'PATCH',
      body: JSON.stringify({ accepted, ...(items ? { items } : {}) })
    }, auth.token);
    setOpenSuggestionFor('');
    loadMyOrders();
  }

  const pendingSuggestions = useMemo(
    () => myOrders.filter(o => o.suggestion_status === 'pending_customer' && (o.suggestion_items || []).length > 0),
    [myOrders]
  );

  const activeOrders = useMemo(
    () => myOrders.filter(o => !['delivered','cancelled'].includes(o.status)),
    [myOrders]
  );

  const pastOrders = useMemo(
    () => myOrders.filter(o => ['delivered','cancelled'].includes(o.status)),
    [myOrders]
  );

  return (
    <section className="role-panel">

      {/* ── SUGERENCIAS PENDIENTES (alerta prominente) ── */}
      {pendingSuggestions.map(order => (
        <div key={`sug-${order.id}`} style={{
          background:'#fffbeb', border:'2px solid #f59e0b', borderRadius:8,
          padding:'0.875rem', marginBottom:'1rem'
        }}>
          <p style={{ fontWeight:700, margin:'0 0 0.5rem', color:'#92400e' }}>
            ⚠️ El restaurante propone un cambio en tu pedido
          </p>
          <div style={{ background:'#fff', border:'1px solid #fde68a', borderRadius:6, padding:'0.5rem 0.75rem', marginBottom:'0.6rem' }}>
            {(order.suggestion_items || []).map(item => (
              <div key={item.menuItemId} style={{ display:'flex', justifyContent:'space-between', fontSize:'0.875rem', padding:'0.15rem 0' }}>
                <span>{item.name}</span>
                <span style={{ color:'#6b7280' }}>× {item.quantity} — {fmt(item.unitPriceCents * item.quantity)}</span>
              </div>
            ))}
          </div>

          {openSuggestionFor === order.id ? (
            <>
              <p style={{ fontSize:'0.78rem', color:'#6b7280', margin:'0 0 0.35rem' }}>Ajusta las cantidades si quieres:</p>
              <div style={{ display:'flex', flexDirection:'column', gap:'0.3rem', marginBottom:'0.6rem' }}>
                {(order.suggestion_items || []).map(item => {
                  const qty = (suggestionDrafts[order.id] || {})[item.menuItemId] ?? item.quantity;
                  return (
                    <div key={item.menuItemId} style={{ display:'flex', alignItems:'center', gap:'0.5rem', background:'#fff', border:'1px solid #e5e7eb', borderRadius:6, padding:'0.35rem 0.75rem' }}>
                      <span style={{ flex:1, fontSize:'0.875rem' }}>{item.name}</span>
                      <button onClick={() => adjustSuggestion(order.id, item.menuItemId, -1)} disabled={qty===0}
                        style={{ width:26, height:26, borderRadius:'50%', border:'1px solid #e5e7eb', background:'#f9fafb', fontWeight:700, cursor: qty===0?'default':'pointer', opacity: qty===0?0.4:1 }}>−</button>
                      <span style={{ minWidth:20, textAlign:'center', fontWeight:700 }}>{qty}</span>
                      <button onClick={() => adjustSuggestion(order.id, item.menuItemId, 1)}
                        style={{ width:26, height:26, borderRadius:'50%', border:'none', background:'#2563eb', color:'#fff', fontWeight:700, cursor:'pointer' }}>+</button>
                    </div>
                  );
                })}
              </div>
              <div style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap' }}>
                <button onClick={() => respondSuggestion(order.id, true)}
                  style={{ background:'#16a34a', color:'#fff', border:'none', borderRadius:6, padding:'0.45rem 1rem', fontWeight:700, cursor:'pointer' }}>
                  ✅ Aceptar
                </button>
                <button onClick={() => respondSuggestion(order.id, false)}
                  style={{ background:'#dc2626', color:'#fff', border:'none', borderRadius:6, padding:'0.45rem 1rem', fontWeight:700, cursor:'pointer' }}>
                  ❌ Rechazar
                </button>
                <button onClick={() => cancelOrder(order.id)}
                  style={{ background:'#f3f4f6', border:'none', borderRadius:6, padding:'0.45rem 1rem', cursor:'pointer' }}>
                  Cancelar pedido
                </button>
              </div>
            </>
          ) : (
            <button onClick={() => openSuggestion(order)}
              style={{ background:'#f59e0b', color:'#fff', border:'none', borderRadius:6, padding:'0.45rem 1rem', fontWeight:700, cursor:'pointer' }}>
              Ver y responder
            </button>
          )}
        </div>
      ))}

      {/* ── RESTAURANTES ── */}
      <h3 style={{ marginTop:0 }}>Pedir</h3>
      <div style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap', marginBottom:'0.75rem' }}>
        <select value={restaurantId} onChange={e => setRestaurantId(e.target.value)}
          style={{ flex:1, minWidth:140, padding:'0.4rem 0.6rem', borderRadius:6, border:'1px solid #e5e7eb' }}>
          {restaurants.map(r => (
            <option key={r.id} value={r.id}>{r.name} {r.is_open ? '● Abierto' : '● Cerrado'}</option>
          ))}
        </select>
      </div>

      {/* Menú del restaurante seleccionado */}
      {menu.length > 0 && (
        <div style={{ border:'1px solid #e5e7eb', borderRadius:8, overflow:'hidden', marginBottom:'1rem' }}>
          {menu.map(item => (
            <div key={item.id} style={{ display:'flex', alignItems:'center', gap:'0.75rem', padding:'0.6rem 0.875rem', borderBottom:'1px solid #f3f4f6' }}>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:600, fontSize:'0.875rem' }}>{item.name}</div>
                <div style={{ fontSize:'0.78rem', color:'#6b7280' }}>{item.description}</div>
              </div>
              <div style={{ fontWeight:700, fontSize:'0.875rem', color:'#374151', whiteSpace:'nowrap' }}>{fmt(item.price_cents)}</div>
              <input
                type="number" min="0" max="20" placeholder="0"
                value={selectedItems[item.id] || ''}
                onChange={e => setSelectedItems(prev => ({ ...prev, [item.id]: e.target.value }))}
                style={{ width:52, padding:'0.3rem', borderRadius:6, border:'1px solid #e5e7eb', textAlign:'center' }}
              />
            </div>
          ))}
          <div style={{ padding:'0.75rem 0.875rem', background:'#f9fafb' }}>
            <button onClick={createOrder} disabled={!auth.token || auth.user?.role !== 'customer'}
              style={{ width:'100%', padding:'0.6rem', background:'#2563eb', color:'#fff', border:'none', borderRadius:6, fontWeight:700, cursor:'pointer', fontSize:'0.95rem' }}>
              Crear pedido
            </button>
          </div>
        </div>
      )}

      {message && <p style={{ fontSize:'0.875rem', color: message.startsWith('✅') ? '#16a34a' : '#dc2626', marginBottom:'0.75rem' }}>{message}</p>}

      {/* ── PEDIDOS ACTIVOS con mapa del driver ── */}
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
                  {/* Cabecera del pedido */}
                  <div
                    onClick={() => setExpandedOrder(isExpanded ? null : order.id)}
                    style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0.75rem 0.875rem', cursor:'pointer', background:`${color}11` }}>
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

                  {/* Detalle expandible */}
                  {isExpanded && (
                    <div style={{ padding:'0.75rem 0.875rem', borderTop:`1px solid ${color}33` }}>
                      <div style={{ fontSize:'0.85rem', color:'#6b7280', marginBottom:'0.4rem' }}>
                        Driver: <strong>{order.driver_first_name || 'Buscando…'}</strong>
                      </div>
                      {order.items?.length > 0 && (
                        <ul style={{ margin:'0 0 0.5rem 1rem', fontSize:'0.875rem' }}>
                          {order.items.map(i => <li key={i.menuItemId}>{i.name} × {i.quantity}</li>)}
                        </ul>
                      )}

                      {/* Mapa del driver — solo si hay posición y pedido en camino */}
                      {driverPos && order.status === 'on_the_way' && (
                        <DriverMap lat={driverPos.lat} lng={driverPos.lng} driverName={order.driver_first_name} />
                      )}

                      {/* Botón de cancelar si aplica */}
                      {['created','pending_driver','assigned','accepted','preparing'].includes(order.status) && (
                        <button onClick={() => cancelOrder(order.id)}
                          style={{ marginTop:'0.5rem', background:'#fee2e2', color:'#dc2626', border:'1px solid #fca5a5', borderRadius:6, padding:'0.35rem 0.75rem', cursor:'pointer', fontSize:'0.82rem' }}>
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
          <h3 style={{ color:'#6b7280' }}>Historial</h3>
          <ul style={{ listStyle:'none', padding:0 }}>
            {pastOrders.slice(0, 10).map(order => (
              <li key={order.id} style={{ display:'flex', justifyContent:'space-between', padding:'0.45rem 0', borderBottom:'1px solid #f3f4f6', fontSize:'0.875rem' }}>
                <span style={{ color: order.status==='delivered'?'#16a34a':'#dc2626' }}>
                  {STATUS_LABELS[order.status]}
                </span>
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
