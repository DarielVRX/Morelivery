import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';

/* ── helpers ── */
function formatMoney(cents) {
  return `$${((cents ?? 0) / 100).toFixed(2)}`;
}
function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' });
}
function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}
function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const STATUS_LABELS = {
  created: 'Recibido', assigned: 'Asignado', accepted: 'Aceptado',
  preparing: 'En preparación', ready: 'Listo para retiro',
  on_the_way: 'En camino', delivered: 'Entregado',
  cancelled: 'Cancelado', pending_driver: 'Esperando driver',
};
const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

/* ── flash hook ── */
function useFlash(duration = 5000) {
  const [msgs, setMsgs] = useState({});
  const timers = useRef({});
  const flash = useCallback((text, isError = false, id = '__g__') => {
    setMsgs(p => ({ ...p, [id]: { text, isError } }));
    clearTimeout(timers.current[id]);
    timers.current[id] = setTimeout(() =>
      setMsgs(p => { const n = { ...p }; delete n[id]; return n; }), duration);
  }, [duration]);
  return [msgs, flash];
}

function FlashMsg({ msg }) {
  if (!msg) return null;
  return <p style={{ color: msg.isError ? '#c00' : '#080', margin: '0.25rem 0', fontSize: '0.875rem' }}>{msg.text}</p>;
}

/* ── SuggestionPanel ── */
function SuggestionPanel({ order, products, onSend, onCancel }) {
  const [draft, setDraft] = useState(() => {
    const d = {};
    (order.items || []).forEach(i => { d[i.menuItemId] = { name: i.name, quantity: i.quantity, unitPriceCents: i.unitPriceCents }; });
    return d;
  });
  const [search, setSearch] = useState('');
  const [note, setNote] = useState('');

  const filteredProducts = useMemo(() => {
    const q = search.toLowerCase();
    return products.filter(p => p.is_available && p.name.toLowerCase().includes(q) && !draft[p.id]);
  }, [search, products, draft]);

  function adjust(menuItemId, name, unitPriceCents, delta) {
    setDraft(prev => {
      const qty = Math.max(0, (prev[menuItemId]?.quantity ?? 0) + delta);
      if (qty === 0) { const { [menuItemId]: _, ...rest } = prev; return rest; }
      return { ...prev, [menuItemId]: { name, quantity: qty, unitPriceCents } };
    });
  }

  const draftItems = Object.entries(draft).map(([menuItemId, v]) => ({ menuItemId, ...v }));
  const total = draftItems.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);

  return (
    <div className="auth-card compact" style={{ marginTop: '0.75rem' }}>
      <strong>Pedido original</strong>
      <ul style={{ margin: '0.25rem 0 0.5rem 1rem', fontSize: '0.9rem' }}>
        {(order.items || []).map(i => <li key={i.menuItemId}>{i.name} × {i.quantity} — {formatMoney(i.unitPriceCents * i.quantity)}</li>)}
      </ul>

      <strong>Sugerencia</strong>
      {draftItems.length === 0 && <p style={{ color: '#888', fontSize: '0.85rem' }}>Sin productos aún</p>}
      <ul style={{ margin: '0.25rem 0 0.5rem 0', listStyle: 'none', padding: 0 }}>
        {draftItems.map(i => (
          <li key={i.menuItemId} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.2rem' }}>
            <span style={{ flex: 1, fontSize: '0.9rem' }}>{i.name}</span>
            <button onClick={() => adjust(i.menuItemId, i.name, i.unitPriceCents, -1)}>−</button>
            <span>{i.quantity}</span>
            <button onClick={() => adjust(i.menuItemId, i.name, i.unitPriceCents, +1)}>+</button>
            <span style={{ color: '#555', fontSize: '0.82rem' }}>{formatMoney(i.unitPriceCents * i.quantity)}</span>
          </li>
        ))}
      </ul>
      <div style={{ fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.9rem' }}>Total sugerido: {formatMoney(total)}</div>

      {/* Buscador */}
      <div style={{ position: 'relative', marginBottom: '0.5rem' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar producto del menú para agregar…"
          style={{ width: '100%', boxSizing: 'border-box' }}
        />
        {search.length > 0 && filteredProducts.length > 0 && (
          <ul style={{ position: 'absolute', zIndex: 10, background: '#fff', border: '1px solid #ddd', borderRadius: 4, width: '100%', margin: 0, padding: 0, listStyle: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
            {filteredProducts.slice(0, 6).map(p => (
              <li key={p.id} onClick={() => { setDraft(prev => ({ ...prev, [p.id]: { name: p.name, quantity: 1, unitPriceCents: p.price_cents } })); setSearch(''); }}
                style={{ padding: '0.4rem 0.75rem', cursor: 'pointer', fontSize: '0.9rem' }}
                onMouseEnter={e => e.currentTarget.style.background = '#f0f4ff'}
                onMouseLeave={e => e.currentTarget.style.background = ''}
              >
                {p.name} — {formatMoney(p.price_cents)}
              </li>
            ))}
          </ul>
        )}
        {search.length > 0 && filteredProducts.length === 0 && <p style={{ fontSize: '0.82rem', color: '#888', margin: '0.25rem 0 0' }}>Sin resultados</p>}
      </div>

      {/* Nota */}
      <textarea
        value={note} onChange={e => setNote(e.target.value)}
        placeholder="Nota para el cliente (opcional)…"
        rows={2} style={{ width: '100%', boxSizing: 'border-box', marginBottom: '0.5rem' }}
      />

      <div className="row">
        <button disabled={draftItems.length === 0} onClick={() => onSend(draftItems, note)}>Enviar sugerencia</button>
        <button onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

/* ── HistoryCalendar ── */
function HistoryCalendar({ orders }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState(null);
  const [expanded, setExpanded] = useState({});

  const weekStart = useMemo(() => {
    const d = startOfWeek(new Date());
    d.setDate(d.getDate() + weekOffset * 7);
    return d;
  }, [weekOffset]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart); d.setDate(weekStart.getDate() + i); return d;
  }), [weekStart]);

  const ordersInWeek = useMemo(() => orders.filter(o => {
    const d = new Date(o.created_at);
    return d >= days[0] && d <= new Date(days[6].getTime() + 86399999);
  }), [orders, days]);

  const filteredOrders = useMemo(() =>
    selectedDay ? ordersInWeek.filter(o => isSameDay(new Date(o.created_at), selectedDay)) : ordersInWeek,
    [ordersInWeek, selectedDay]);

  const countByDay = useMemo(() => {
    const m = {};
    ordersInWeek.forEach(o => { const k = new Date(o.created_at).toDateString(); m[k] = (m[k] || 0) + 1; });
    return m;
  }, [ordersInWeek]);

  const weekLabel = `${days[0].toLocaleDateString('es', { day: 'numeric', month: 'short' })} – ${days[6].toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        <button onClick={() => setWeekOffset(w => w - 1)}>◀</button>
        <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{weekLabel}</span>
        <button onClick={() => setWeekOffset(w => w + 1)} disabled={weekOffset >= 0}>▶</button>
        {weekOffset !== 0 && <button onClick={() => { setWeekOffset(0); setSelectedDay(null); }}>Hoy</button>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: '0.2rem', marginBottom: '0.75rem' }}>
        {days.map((d, i) => {
          const count = countByDay[d.toDateString()] || 0;
          const sel = selectedDay && isSameDay(d, selectedDay);
          const today = isSameDay(d, new Date());
          return (
            <div key={i} onClick={() => setSelectedDay(sel ? null : d)}
              style={{ padding: '0.3rem 0.1rem', textAlign: 'center', cursor: 'pointer', borderRadius: 6,
                background: sel ? '#2563eb' : today ? '#eff6ff' : '#f5f5f5',
                color: sel ? '#fff' : '#111',
                border: today && !sel ? '1px solid #93c5fd' : '1px solid transparent', userSelect: 'none' }}>
              <div style={{ fontSize: '0.65rem' }}>{DAY_NAMES[i]}</div>
              <div style={{ fontWeight: 700 }}>{d.getDate()}</div>
              {count > 0 && <div style={{ fontSize: '0.65rem', color: sel ? '#bfdbfe' : '#2563eb' }}>{count}</div>}
            </div>
          );
        })}
      </div>

      {selectedDay && (
        <p style={{ fontSize: '0.85rem', color: '#555', marginBottom: '0.5rem' }}>
          {filteredOrders.length} pedido(s) el {selectedDay.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })}
          <button onClick={() => setSelectedDay(null)} style={{ marginLeft: '0.5rem', fontSize: '0.75rem' }}>✕ Limpiar</button>
        </p>
      )}

      {filteredOrders.length === 0 ? <p style={{ color: '#888' }}>Sin pedidos en este período.</p> : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {filteredOrders.map(order => (
            <li key={order.id} style={{ borderBottom: '1px solid #eee' }}>
              <div onClick={() => setExpanded(p => ({ ...p, [order.id]: !p[order.id] }))}
                style={{ display: 'flex', justifyContent: 'space-between', cursor: 'pointer', padding: '0.4rem 0', alignItems: 'center' }}>
                <span>
                  <strong>{STATUS_LABELS[order.status] || order.status}</strong>
                  {' · '}{formatMoney(order.total_cents)}
                  <span style={{ color: '#888', fontSize: '0.82rem', marginLeft: '0.4rem' }}>{formatDate(order.created_at)}</span>
                </span>
                <span>{expanded[order.id] ? '▲' : '▼'}</span>
              </div>
              {expanded[order.id] && (
                <div style={{ paddingLeft: '1rem', paddingBottom: '0.5rem', fontSize: '0.9rem' }}>
                  <div><strong>Cliente:</strong> {order.customer_first_name}</div>
                  <div><strong>Driver:</strong> {order.driver_first_name || '—'}</div>
                  {(order.items || []).length > 0 && (
                    <ul style={{ margin: '0.25rem 0 0 1rem' }}>
                      {order.items.map(i => <li key={i.menuItemId}>{i.name} × {i.quantity} — {formatMoney(i.unitPriceCents * i.quantity)}</li>)}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ══ RestaurantDashboard ══ */
export default function RestaurantDashboard() {
  const { auth } = useAuth();
  const [restaurant, setRestaurant] = useState(null);
  const [productName, setProductName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('1000');
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [openSuggestionFor, setOpenSuggestionFor] = useState('');
  const [loadingStatus, setLoadingStatus] = useState({});
  const [flash, flashMsg] = useFlash();

  async function loadData() {
    if (!auth.token) return;
    const [r, o, p] = await Promise.all([
      apiFetch('/restaurants/my', {}, auth.token),
      apiFetch('/orders/my', {}, auth.token),
      apiFetch('/restaurants/my/menu', {}, auth.token),
    ]);
    setRestaurant(r.restaurant);
    setOrders(o.orders);
    setProducts(p.menu);
  }

  useEffect(() => { loadData().catch(e => flashMsg(e.message, true)); }, [auth.token]);

  async function addProduct() {
    if (!productName.trim()) return flashMsg('Ingresa nombre del producto', true);
    try {
      await apiFetch('/restaurants/menu-items', {
        method: 'POST',
        body: JSON.stringify({ name: productName.slice(0, 40), description, priceCents: Number(price) })
      }, auth.token);
      flashMsg('✅ Producto agregado');
      setProductName(''); setDescription(''); setPrice('1000');
      loadData();
    } catch (e) { flashMsg(e.message, true); }
  }

  async function updateProduct(id, cur, field, val) {
    try {
      await apiFetch(`/restaurants/menu-items/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: cur.name, description: cur.description, priceCents: cur.price_cents, isAvailable: cur.is_available, [field]: val })
      }, auth.token);
      loadData();
    } catch (e) { flashMsg(e.message, true); }
  }

  async function changeStatus(orderId, status) {
    setLoadingStatus(p => ({ ...p, [orderId]: status }));
    try {
      await apiFetch(`/orders/${orderId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }, auth.token);
      await loadData();
      flashMsg(STATUS_LABELS[status] || status, false, orderId);
    } catch (e) {
      flashMsg(e.message, true, orderId);
    } finally {
      setLoadingStatus(p => ({ ...p, [orderId]: null }));
    }
  }

  async function sendSuggestion(order, items, note) {
    try {
      await apiFetch(`/orders/${order.id}/suggest`, {
        method: 'PATCH',
        body: JSON.stringify({ items, note: note || undefined })
      }, auth.token);
      flashMsg('Sugerencia enviada', false, order.id);
      setOpenSuggestionFor('');
      loadData();
    } catch (e) { flashMsg(e.message, true, order.id); }
  }

  const activeOrders = useMemo(
    () => orders.filter(o => ['created', 'assigned', 'accepted', 'preparing', 'ready', 'pending_driver'].includes(o.status)),
    [orders]
  );
  const historyOrders = useMemo(
    () => orders.filter(o => ['delivered', 'cancelled'].includes(o.status)),
    [orders]
  );

  return (
    <section className="role-panel">
      <h2>Restaurante — {restaurant?.name || '…'}</h2>

      {/* Agregar producto */}
      <details style={{ marginBottom: '1rem' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>➕ Agregar producto</summary>
        <div style={{ paddingTop: '0.5rem' }}>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <input value={productName} onChange={e => setProductName(e.target.value)} placeholder="Nombre" />
            <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Descripción" />
            <input value={price} onChange={e => setPrice(e.target.value)} placeholder="Precio en cents" style={{ width: '7rem' }} />
            <button onClick={addProduct}>Agregar</button>
          </div>
          <FlashMsg msg={flash['__g__']} />
        </div>
      </details>

      {/* Mis productos */}
      <details style={{ marginBottom: '1rem' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>🍽 Mis productos ({products.length})</summary>
        <ul style={{ paddingTop: '0.5rem', paddingLeft: '1rem' }}>
          {products.map(p => (
            <li key={p.id} style={{ marginBottom: '0.35rem' }}>
              <strong>{p.name}</strong> · {p.description} · {formatMoney(p.price_cents)} · {p.is_available ? '✅' : '❌'}
              <button onClick={() => updateProduct(p.id, p, 'isAvailable', !p.is_available)} style={{ marginLeft: '0.5rem' }}>
                {p.is_available ? 'Desactivar' : 'Activar'}
              </button>
              <button onClick={() => {
                const v = Number(prompt('Nuevo precio en cents', String(p.price_cents)));
                if (!isNaN(v) && v > 0) updateProduct(p.id, p, 'priceCents', v);
              }} style={{ marginLeft: '0.25rem' }}>Precio</button>
            </li>
          ))}
        </ul>
      </details>

      {/* Pedidos activos */}
      <h3>Pedidos activos ({activeOrders.length})</h3>
      {activeOrders.length === 0 ? <p>No hay pedidos activos.</p> : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {activeOrders.map(order => {
            const loading = loadingStatus[order.id];
            const isReady = order.status === 'ready';
            return (
              <li key={order.id} style={{ marginBottom: '1.25rem', border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.875rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <strong>{STATUS_LABELS[order.status] || order.status}</strong>
                  <strong>{formatMoney(order.total_cents)}</strong>
                </div>
                <div style={{ fontSize: '0.85rem', color: '#555' }}>{formatDate(order.created_at)}</div>
                <div><strong>Cliente:</strong> {order.customer_first_name || '—'}</div>
                <div><strong>Driver:</strong> {order.driver_first_name || 'Pendiente'}</div>
                {(order.items || []).length > 0 && (
                  <ul style={{ margin: '0.4rem 0 0 1rem', fontSize: '0.9rem' }}>
                    {order.items.map(i => (
                      <li key={i.menuItemId}>{i.name} × {i.quantity} — {formatMoney(i.unitPriceCents * i.quantity)}</li>
                    ))}
                  </ul>
                )}

                <div className="row" style={{ marginTop: '0.6rem', flexWrap: 'wrap' }}>
                  <button disabled={!!loading || isReady || order.status === 'preparing'} onClick={() => changeStatus(order.id, 'preparing')}>
                    {loading === 'preparing' ? '…' : '🍳 Preparando'}
                  </button>
                  <button disabled={!!loading || isReady} onClick={() => changeStatus(order.id, 'ready')}>
                    {loading === 'ready' ? '…' : '✅ Listo'}
                  </button>
                  <button disabled={isReady} onClick={() => setOpenSuggestionFor(openSuggestionFor === order.id ? '' : order.id)}>
                    💬 Alternativa
                  </button>
                </div>

                <FlashMsg msg={flash[order.id]} />

                {openSuggestionFor === order.id && (
                  <SuggestionPanel
                    order={order}
                    products={products}
                    onSend={(items, note) => sendSuggestion(order, items, note)}
                    onCancel={() => setOpenSuggestionFor('')}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Historial */}
      <h3>Historial</h3>
      <HistoryCalendar orders={historyOrders} />
    </section>
  );
}
