import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useRealtimeOrders } from '../../hooks/useRealtimeOrders';
import ScheduleEditor from '../../components/ScheduleEditor';

function buildInitialSuggestion(items = []) {
  const map = {};
  items.forEach(item => { map[item.menuItemId] = item.quantity; });
  return map;
}

function fmt(cents) { return `$${((cents ?? 0) / 100).toFixed(2)}`; }

const STATUS_LABELS = {
  created:'Recibido', assigned:'Asignado', accepted:'Aceptado',
  preparing:'En preparación', ready:'Listo para retiro',
  on_the_way:'En camino', delivered:'Entregado',
  cancelled:'Cancelado', pending_driver:'Esperando driver',
};

export default function RestaurantDashboard() {
  const { auth } = useAuth();
  const [tab, setTab]                 = useState('orders');
  const [restaurant, setRestaurant]   = useState(null);
  const [orders, setOrders]           = useState([]);
  const [products, setProducts]       = useState([]);
  const [description, setDescription] = useState('');
  const [price, setPrice]             = useState('1000');
  const [message, setMessage]         = useState('');
  const [suggestionDrafts, setSuggestionDrafts] = useState({});
  const [openSuggestionFor, setOpenSuggestionFor] = useState('');

  const loadDataRef = useRef(null);

  async function loadData() {
    if (!auth.token) return;
    try {
      const [restData, ordersData, menuData] = await Promise.all([
        apiFetch('/restaurants/my', {}, auth.token),
        apiFetch('/orders/my', {}, auth.token),
        apiFetch('/restaurants/my/menu', {}, auth.token),
      ]);
      setRestaurant(restData.restaurant);
      setOrders(ordersData.orders);
      setProducts(menuData.menu);
    } catch (error) { setMessage(error.message); }
  }

  // Ref estable para callbacks SSE
  useEffect(() => { loadDataRef.current = loadData; });
  useEffect(() => { loadData(); }, [auth.token]);

  // SSE — actualizaciones en tiempo real sin refresh manual
  useRealtimeOrders(auth.token, () => loadDataRef.current?.(), () => {});

  useEffect(() => {
    const nextDrafts = {};
    for (const order of orders) {
      nextDrafts[order.id] = suggestionDrafts[order.id] || buildInitialSuggestion(order.items);
    }
    setSuggestionDrafts(nextDrafts);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders.length]);

  async function addProduct() {
    if (!description.trim()) return setMessage('Escribe una descripción');
    try {
      await apiFetch('/restaurants/menu-items', {
        method: 'POST',
        body: JSON.stringify({ name: description.slice(0, 20), description, priceCents: Number(price) })
      }, auth.token);
      setMessage('Producto agregado'); setDescription('');
      loadData();
    } catch (error) { setMessage(error.message); }
  }

  async function updateProduct(productId, current, field, value) {
    try {
      await apiFetch(`/restaurants/menu-items/${productId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: current.name, description: current.description, priceCents: current.price_cents, isAvailable: current.is_available, [field]: value })
      }, auth.token);
      loadData();
    } catch (error) { setMessage(error.message); }
  }

  async function changeStatus(orderId, status) {
    try {
      await apiFetch(`/orders/${orderId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }, auth.token);
      loadData();
    } catch (error) { setMessage(error.message); }
  }

  function adjustSuggestion(orderId, menuItemId, delta) {
    setSuggestionDrafts(prev => {
      const cur = prev[orderId] || {};
      const qty = Math.max(0, (cur[menuItemId] || 0) + delta);
      return { ...prev, [orderId]: { ...cur, [menuItemId]: qty } };
    });
  }

  async function sendSuggestion(order) {
    const draft = suggestionDrafts[order.id] || {};
    const items = Object.entries(draft).filter(([, q]) => q > 0).map(([menuItemId, quantity]) => ({ menuItemId, quantity }));
    if (items.length === 0) return setMessage('La sugerencia debe tener al menos 1 producto');
    try {
      await apiFetch(`/orders/${order.id}/suggest`, { method: 'PATCH', body: JSON.stringify({ items }) }, auth.token);
      setMessage('Sugerencia enviada'); setOpenSuggestionFor('');
      loadData();
    } catch (error) { setMessage(error.message); }
  }

  const activeOrders = useMemo(
    () => orders.filter(o => ['created','assigned','accepted','preparing','ready'].includes(o.status)),
    [orders]
  );

  const tabStyle = (t) => ({
    padding: '0.45rem 1rem', cursor: 'pointer', border: 'none', borderRadius: 6, fontWeight: 600,
    background: tab === t ? '#2563eb' : '#f3f4f6',
    color: tab === t ? '#fff' : '#374151', fontSize: '0.875rem'
  });

  return (
    <section className="role-panel">
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:'0.5rem', marginBottom:'0.75rem' }}>
        <div>
          <h2 style={{ margin:0 }}>{restaurant?.name || 'Restaurante'}</h2>
          <span style={{ fontSize:'0.875rem', color: restaurant?.is_open ? '#16a34a' : '#dc2626', fontWeight:700 }}>
            {restaurant?.is_open ? '● Abierto' : '● Cerrado'}
          </span>
        </div>
        <button onClick={loadData} style={{ fontSize:'0.82rem' }}>🔄</button>
      </div>

      <div style={{ display:'flex', gap:'0.4rem', marginBottom:'1.25rem', flexWrap:'wrap' }}>
        <button style={tabStyle('orders')}  onClick={() => setTab('orders')}>📋 Pedidos ({activeOrders.length})</button>
        <button style={tabStyle('menu')}    onClick={() => setTab('menu')}>🍽 Menú ({products.length})</button>
        <button style={tabStyle('schedule')} onClick={() => setTab('schedule')}>🕐 Horario</button>
      </div>

      {message && <p style={{ color:'#c00', marginBottom:'0.5rem' }}>{message}</p>}

      {/* ── PEDIDOS ── */}
      {tab === 'orders' && (
        activeOrders.length === 0
          ? <p style={{ color:'#888' }}>Sin pedidos activos.</p>
          : (
            <ul style={{ listStyle:'none', padding:0 }}>
              {activeOrders.map(order => (
                <li key={order.id} style={{ border:'1px solid #e5e7eb', borderRadius:8, padding:'0.875rem', marginBottom:'1rem' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', flexWrap:'wrap', gap:'0.25rem' }}>
                    <strong style={{ fontSize:'0.875rem', color:'#374151' }}>{STATUS_LABELS[order.status] || order.status}</strong>
                    <strong>{fmt(order.total_cents)}</strong>
                  </div>
                  <div style={{ fontSize:'0.85rem', color:'#6b7280' }}>
                    Cliente: {order.customer_first_name || '—'} · Driver: {order.driver_first_name || 'pendiente'}
                  </div>
                  {order.items?.length > 0 && (
                    <ul style={{ margin:'0.3rem 0 0 1rem', fontSize:'0.875rem' }}>
                      {order.items.map(i => <li key={i.menuItemId}>{i.name} × {i.quantity}</li>)}
                    </ul>
                  )}
                  {order.restaurant_note && <p style={{ fontSize:'0.82rem', color:'#6b7280', marginTop:'0.25rem' }}>{order.restaurant_note}</p>}

                  <div style={{ display:'flex', gap:'0.4rem', flexWrap:'wrap', marginTop:'0.6rem' }}>
                    <button onClick={() => changeStatus(order.id, 'preparing')}>🍳 En preparación</button>
                    <button onClick={() => changeStatus(order.id, 'ready')}>✅ Listo</button>
                    <button
                      onClick={() => setOpenSuggestionFor(openSuggestionFor === order.id ? '' : order.id)}
                      style={{ background: openSuggestionFor === order.id ? '#e0e7ff' : undefined }}
                    >
                      💬 {openSuggestionFor === order.id ? 'Cerrar' : 'Sugerir cambio'}
                    </button>
                  </div>

                  {/* Panel de sugerencia — diseño igual al del cliente */}
                  {openSuggestionFor === order.id && (
                    <div style={{
                      marginTop:'0.75rem', background:'#f8fafc',
                      border:'1px solid #e0e7ff', borderRadius:8, padding:'0.875rem'
                    }}>
                      <p style={{ fontWeight:700, fontSize:'0.875rem', margin:'0 0 0.5rem', color:'#1e40af' }}>
                        Sugerir cambio al cliente
                      </p>

                      {/* Pedido original */}
                      <p style={{ fontSize:'0.75rem', color:'#6b7280', margin:'0 0 0.35rem' }}>Pedido original:</p>
                      <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:6, padding:'0.4rem 0.75rem', marginBottom:'0.75rem' }}>
                        {(order.items || []).map(i => (
                          <div key={i.menuItemId} style={{ display:'flex', justifyContent:'space-between', fontSize:'0.83rem', padding:'0.15rem 0' }}>
                            <span>{i.name}</span><span style={{ color:'#9ca3af' }}>× {i.quantity}</span>
                          </div>
                        ))}
                      </div>

                      {/* Selector de productos */}
                      <p style={{ fontSize:'0.75rem', color:'#6b7280', margin:'0 0 0.35rem' }}>Tu sugerencia:</p>
                      <div style={{ display:'flex', flexDirection:'column', gap:'0.35rem', marginBottom:'0.75rem' }}>
                        {products.map(product => {
                          const qty = (suggestionDrafts[order.id] || {})[product.id] ?? 0;
                          return (
                            <div key={product.id} style={{
                              display:'flex', alignItems:'center', gap:'0.5rem',
                              background: qty > 0 ? '#eff6ff' : '#fff',
                              border: qty > 0 ? '1px solid #bfdbfe' : '1px solid #e5e7eb',
                              borderRadius:6, padding:'0.4rem 0.75rem',
                              transition:'all 0.15s'
                            }}>
                              <span style={{ flex:1, fontSize:'0.875rem', fontWeight: qty > 0 ? 600 : 400 }}>{product.name}</span>
                              <span style={{ fontSize:'0.75rem', color:'#6b7280' }}>{fmt(product.price_cents)}</span>
                              <button
                                onClick={() => adjustSuggestion(order.id, product.id, -1)}
                                disabled={qty === 0}
                                style={{ width:26, height:26, borderRadius:'50%', border:'1px solid #e5e7eb', background: qty === 0 ? '#f9fafb' : '#fff', fontWeight:700, cursor: qty === 0 ? 'default' : 'pointer', fontSize:'1rem', lineHeight:1, opacity: qty === 0 ? 0.4 : 1 }}>
                                −
                              </button>
                              <span style={{ minWidth:20, textAlign:'center', fontWeight:700 }}>{qty}</span>
                              <button
                                onClick={() => adjustSuggestion(order.id, product.id, 1)}
                                style={{ width:26, height:26, borderRadius:'50%', border:'none', background:'#2563eb', color:'#fff', fontWeight:700, cursor:'pointer', fontSize:'1rem', lineHeight:1 }}>
                                +
                              </button>
                            </div>
                          );
                        })}
                      </div>

                      <div style={{ display:'flex', gap:'0.5rem' }}>
                        <button
                          onClick={() => sendSuggestion(order)}
                          style={{ background:'#2563eb', color:'#fff', border:'none', borderRadius:6, padding:'0.5rem 1.25rem', fontWeight:700, cursor:'pointer' }}>
                          Enviar al cliente
                        </button>
                        <button
                          onClick={() => setOpenSuggestionFor('')}
                          style={{ background:'#f3f4f6', border:'none', borderRadius:6, padding:'0.5rem 1rem', cursor:'pointer' }}>
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )
      )}

      {/* ── MENÚ ── */}
      {tab === 'menu' && (
        <>
          <div style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap', marginBottom:'1rem' }}>
            <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Nombre del producto" style={{ flex:2, minWidth:140 }} />
            <input value={price} onChange={e => setPrice(e.target.value)} placeholder="Precio en centavos" style={{ width:140 }} />
            <button onClick={addProduct}>Agregar</button>
          </div>
          {products.length === 0
            ? <p style={{ color:'#888' }}>Sin productos en el menú.</p>
            : (
              <ul style={{ listStyle:'none', padding:0 }}>
                {products.map(product => (
                  <li key={product.id} style={{ display:'flex', alignItems:'center', gap:'0.5rem', borderBottom:'1px solid #f3f4f6', padding:'0.5rem 0', flexWrap:'wrap', fontSize:'0.875rem' }}>
                    <span style={{ flex:1, fontWeight:600 }}>{product.name}</span>
                    <span style={{ color:'#6b7280' }}>{product.description}</span>
                    <span style={{ fontWeight:700 }}>{fmt(product.price_cents)}</span>
                    <span style={{ color: product.is_available ? '#16a34a' : '#dc2626', fontSize:'0.78rem' }}>
                      {product.is_available ? '● Activo' : '● Inactivo'}
                    </span>
                    <button onClick={() => updateProduct(product.id, product, 'isAvailable', !product.is_available)}>
                      {product.is_available ? 'Desactivar' : 'Activar'}
                    </button>
                    <button onClick={() => {
                      const v = Number(prompt('Nuevo precio en centavos', String(product.price_cents)));
                      if (!isNaN(v) && v > 0) updateProduct(product.id, product, 'priceCents', v);
                    }}>Editar precio</button>
                  </li>
                ))}
              </ul>
            )
          }
        </>
      )}

      {/* ── HORARIO ── */}
      {tab === 'schedule' && (
        <ScheduleEditor
          token={auth.token}
          isOpen={restaurant?.is_open}
          onIsOpenChange={(open) => setRestaurant(prev => prev ? { ...prev, is_open: open } : prev)}
        />
      )}
    </section>
  );
}
