import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';

function formatMoney(cents) { return `$${((cents ?? 0) / 100).toFixed(2)}`; }
function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' });
}

const STATUS_LABELS = {
  created:'Recibido', assigned:'Asignado', accepted:'Aceptado',
  preparing:'En preparación', ready:'Listo para retiro',
  on_the_way:'En camino', delivered:'Entregado',
  cancelled:'Cancelado', pending_driver:'Esperando driver',
};

function useFlash(duration=5000) {
  const [msgs, setMsgs] = useState({});
  const timers = useRef({});
  const flash = useCallback((text,isError=false,id='__g__')=>{
    setMsgs(p=>({...p,[id]:{text,isError}}));
    clearTimeout(timers.current[id]);
    timers.current[id]=setTimeout(()=>setMsgs(p=>{const n={...p};delete n[id];return n;}),duration);
  },[duration]);
  return [msgs,flash];
}
function FlashMsg({msg}) {
  if (!msg) return null;
  return <p style={{color:msg.isError?'#c00':'#080',margin:'0.25rem 0',fontSize:'0.875rem'}}>{msg.text}</p>;
}

/* ── Panel editable de sugerencia para el cliente ── */
function CustomerSuggestionPanel({ order, onAccept, onReject, onCancel, flashMsg }) {
  // Inicializar draft con los items de la sugerencia
  const [draft, setDraft] = useState(() => {
    const d = {};
    (order.suggestion_items || []).forEach(i => {
      d[i.menuItemId] = { name: i.name, quantity: i.quantity, unitPriceCents: i.unitPriceCents };
    });
    return d;
  });
  const [menu, setMenu] = useState([]);
  const [search, setSearch] = useState('');
  const [loadingMenu, setLoadingMenu] = useState(false);

  // Cargar menú del restaurante para permitir búsqueda
  useEffect(() => {
    setLoadingMenu(true);
    apiFetch(`/restaurants/${order.restaurant_id}/menu`)
      .then(d => setMenu((d.menu || []).filter(i => i.is_available !== false)))
      .catch(() => {})
      .finally(() => setLoadingMenu(false));
  }, [order.restaurant_id]);

  const filteredMenu = useMemo(() => {
    const q = search.toLowerCase();
    return menu.filter(p => p.name.toLowerCase().includes(q) && !draft[p.id]);
  }, [search, menu, draft]);

  function adjust(menuItemId, name, unitPriceCents, delta) {
    setDraft(prev => {
      const qty = Math.max(0, (prev[menuItemId]?.quantity ?? 0) + delta);
      if (qty === 0) { const { [menuItemId]: _, ...rest } = prev; return rest; }
      return { ...prev, [menuItemId]: { name, quantity: qty, unitPriceCents } };
    });
  }

  function addFromMenu(product) {
    setDraft(prev => ({
      ...prev,
      [product.id]: { name: product.name, quantity: 1, unitPriceCents: product.price_cents }
    }));
    setSearch('');
  }

  const draftItems = Object.entries(draft).map(([menuItemId, v]) => ({ menuItemId, ...v }));
  const total = draftItems.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);

  const originalItems = order.suggestion_items || [];
  const originalTotal = originalItems.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);

  return (
    <div style={{ marginTop: '0.75rem', border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.875rem', background: '#fafafa' }}>

      {/* Nota del restaurante */}
      {order.suggestion_note && (
        <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 6, padding: '0.5rem 0.75rem', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
          📝 <strong>Nota del restaurante:</strong> {order.suggestion_note}
        </div>
      )}

      {/* Pedido original */}
      <div style={{ marginBottom: '0.75rem' }}>
        <strong style={{ fontSize: '0.85rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Pedido original
        </strong>
        <ul style={{ margin: '0.25rem 0 0 0', padding: 0, listStyle: 'none', fontSize: '0.9rem', color: '#6b7280' }}>
          {order.items?.map(i => (
            <li key={i.menuItemId} style={{ textDecoration: 'line-through' }}>
              {i.name} × {i.quantity} — {formatMoney(i.unitPriceCents * i.quantity)}
            </li>
          ))}
        </ul>
      </div>

      {/* Sugerencia editable */}
      <strong style={{ fontSize: '0.85rem', color: '#111', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Sugerencia del restaurante — puedes modificarla
      </strong>

      {draftItems.length === 0 && (
        <p style={{ color: '#888', fontSize: '0.85rem', margin: '0.25rem 0' }}>Sin productos en la sugerencia</p>
      )}

      <ul style={{ margin: '0.4rem 0', padding: 0, listStyle: 'none' }}>
        {draftItems.map(i => (
          <li key={i.menuItemId} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.3rem' }}>
            <span style={{ flex: 1, fontSize: '0.9rem' }}>{i.name}</span>
            <button
              onClick={() => adjust(i.menuItemId, i.name, i.unitPriceCents, -1)}
              style={{ width: '1.75rem', height: '1.75rem', borderRadius: '50%', border: '1px solid #e5e7eb', background: '#f9fafb', cursor: 'pointer', fontWeight: 700 }}
            >−</button>
            <span style={{ minWidth: '1.25rem', textAlign: 'center', fontWeight: 600 }}>{i.quantity}</span>
            <button
              onClick={() => adjust(i.menuItemId, i.name, i.unitPriceCents, +1)}
              style={{ width: '1.75rem', height: '1.75rem', borderRadius: '50%', border: '1px solid #e5e7eb', background: '#f9fafb', cursor: 'pointer', fontWeight: 700 }}
            >+</button>
            <span style={{ color: '#555', fontSize: '0.82rem', minWidth: '4rem', textAlign: 'right' }}>
              {formatMoney(i.unitPriceCents * i.quantity)}
            </span>
          </li>
        ))}
      </ul>

      <div style={{ fontWeight: 700, marginBottom: '0.75rem', fontSize: '0.95rem' }}>
        Total: {formatMoney(total)}
        {total !== originalTotal && (
          <span style={{ fontWeight: 400, color: '#6b7280', fontSize: '0.82rem', marginLeft: '0.5rem' }}>
            (original: {formatMoney(originalTotal)})
          </span>
        )}
      </div>

      {/* Buscador para agregar productos */}
      <div style={{ position: 'relative', marginBottom: '0.75rem' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={loadingMenu ? 'Cargando menú…' : 'Buscar producto para agregar…'}
          disabled={loadingMenu}
          style={{ width: '100%', boxSizing: 'border-box' }}
        />
        {search.length > 0 && filteredMenu.length > 0 && (
          <ul style={{
            position: 'absolute', zIndex: 10, background: '#fff', border: '1px solid #ddd',
            borderRadius: 4, width: '100%', margin: 0, padding: 0, listStyle: 'none',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
          }}>
            {filteredMenu.slice(0, 6).map(p => (
              <li
                key={p.id}
                onClick={() => addFromMenu(p)}
                style={{ padding: '0.4rem 0.75rem', cursor: 'pointer', fontSize: '0.9rem' }}
                onMouseEnter={e => e.currentTarget.style.background = '#f0f4ff'}
                onMouseLeave={e => e.currentTarget.style.background = ''}
              >
                {p.name} — {formatMoney(p.price_cents)}
              </li>
            ))}
          </ul>
        )}
        {search.length > 0 && filteredMenu.length === 0 && !loadingMenu && (
          <p style={{ fontSize: '0.82rem', color: '#888', margin: '0.2rem 0 0' }}>Sin resultados</p>
        )}
      </div>

      {/* Acciones */}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button
          disabled={draftItems.length === 0}
          onClick={() => onAccept(draftItems)}
          style={{ fontWeight: 600 }}
        >
          ✅ Aceptar{draftItems.length > 0 && total !== originalTotal ? ' con cambios' : ''}
        </button>
        <button onClick={onReject}>❌ Rechazar</button>
        <button onClick={onCancel}>Cancelar pedido</button>
      </div>
    </div>
  );
}

/* ══ CustomerHome ══ */
export default function CustomerHome() {
  const { auth } = useAuth();
  const navigate = useNavigate();
  const [restaurants, setRestaurants] = useState([]);
  const [myOrders, setMyOrders] = useState([]);
  const [openSuggestionFor, setOpenSuggestionFor] = useState('');
  const [openComplaintFor, setOpenComplaintFor] = useState('');
  const [expanded, setExpanded] = useState({});
  const [complaintText, setComplaintText] = useState({});
  const [loadingRestaurants, setLoadingRestaurants] = useState(true);
  const [flash, flashMsg] = useFlash();

  const hasAddress = Boolean(auth.user?.address && auth.user.address !== 'address-pending');

  async function reloadOrders() {
    if (!auth.token) return;
    const d = await apiFetch('/orders/my', {}, auth.token);
    setMyOrders(d.orders);
  }

  useEffect(() => {
    apiFetch('/restaurants')
      .then(d => setRestaurants(d.restaurants))
      .catch(() => flashMsg('Error cargando restaurantes', true))
      .finally(() => setLoadingRestaurants(false));
  }, []);

  useEffect(() => {
    if (!auth.token) return;
    reloadOrders().catch(() => setMyOrders([]));
  }, [auth.token]);

  async function cancelOrder(orderId) {
    try {
      await apiFetch(`/orders/${orderId}/cancel`, { method: 'PATCH' }, auth.token);
      setOpenSuggestionFor('');
      await reloadOrders();
    } catch(e) { flashMsg(e.message, true, orderId); }
  }

  // Acepta sugerencia con los items que el cliente haya editado
  async function acceptSuggestion(orderId, items) {
    try {
      await apiFetch(
        `/orders/${orderId}/suggestion-response`,
        { method: 'PATCH', body: JSON.stringify({ accepted: true, items }) },
        auth.token
      );
      flashMsg('✅ Sugerencia aceptada', false, orderId);
      setOpenSuggestionFor('');
      await reloadOrders();
    } catch(e) { flashMsg(e.message, true, orderId); }
  }

  async function rejectSuggestion(orderId) {
    try {
      await apiFetch(
        `/orders/${orderId}/suggestion-response`,
        { method: 'PATCH', body: JSON.stringify({ accepted: false }) },
        auth.token
      );
      setOpenSuggestionFor('');
      await reloadOrders();
    } catch(e) { flashMsg(e.message, true, orderId); }
  }

  async function submitComplaint(orderId) {
    const text = (complaintText[orderId] || '').trim();
    if (!text) return flashMsg('Escribe tu queja antes de enviar', true, `complaint_${orderId}`);
    try {
      await apiFetch(`/orders/${orderId}/complaint`, { method: 'POST', body: JSON.stringify({ text }) }, auth.token);
      flashMsg('Queja enviada', false, orderId);
      setOpenComplaintFor('');
      setComplaintText(p => ({ ...p, [orderId]: '' }));
    } catch(e) { flashMsg(e.message, true, orderId); }
  }

  const pendingSuggestions = useMemo(
    () => myOrders.filter(o => o.suggestion_status === 'pending_customer' && (o.suggestion_items || []).length > 0),
    [myOrders]
  );
  const activeOrders = useMemo(
    () => myOrders.filter(o => !['delivered','cancelled'].includes(o.status)),
    [myOrders]
  );
  const historyOrders = useMemo(
    () => myOrders.filter(o => ['delivered','cancelled'].includes(o.status)),
    [myOrders]
  );

  return (
    <section className="role-panel">
      <h2>¿Qué vas a pedir hoy?</h2>

      {!hasAddress && (
        <div style={{ border: '1px solid #f59e0b', background: '#fffbeb', borderRadius: 8, padding: '0.75rem', marginBottom: '1rem' }}>
          ⚠️ Guarda tu dirección (arriba) para poder hacer pedidos.
        </div>
      )}

      {/* Lista de restaurantes */}
      <h3>Restaurantes disponibles</h3>
      {loadingRestaurants ? (
        <p style={{ color: '#888' }}>Cargando…</p>
      ) : restaurants.length === 0 ? (
        <p style={{ color: '#888' }}>Sin restaurantes disponibles por ahora.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {restaurants.map(r => (
            <li
              key={r.id}
              onClick={() => navigate(`/restaurant/${r.id}`)}
              style={{
                border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.875rem',
                cursor: 'pointer', transition: 'background 0.15s',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center'
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'}
              onMouseLeave={e => e.currentTarget.style.background = ''}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: '1rem' }}>{r.name}</div>
                {r.address && <div style={{ color: '#6b7280', fontSize: '0.875rem' }}>📍 {r.address}</div>}
                <div style={{ fontSize: '0.8rem', color: r.is_open ? '#059669' : '#dc2626', marginTop: '0.15rem' }}>
                  {r.is_open ? '● Abierto' : '● Cerrado'}
                </div>
              </div>
              <span style={{ color: '#9ca3af', fontSize: '1.2rem' }}>›</span>
            </li>
          ))}
        </ul>
      )}

      <FlashMsg msg={flash['__g__']} />

      {/* Sugerencias pendientes — panel completo editable */}
      {pendingSuggestions.length > 0 && (
        <>
          <h3 style={{ marginTop: '1.5rem' }}>⚡ Sugerencias del restaurante ({pendingSuggestions.length})</h3>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {pendingSuggestions.map(order => (
              <li key={`sug-${order.id}`} style={{ border: '2px solid #f59e0b', borderRadius: 8, padding: '0.875rem', marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <div>
                    <strong>{order.restaurant_name}</strong>
                    <span style={{ color: '#6b7280', fontSize: '0.85rem', marginLeft: '0.5rem' }}>{formatDate(order.created_at)}</span>
                  </div>
                  <strong>{formatMoney(order.total_cents)}</strong>
                </div>

                <button
                  onClick={() => setOpenSuggestionFor(openSuggestionFor === order.id ? '' : order.id)}
                  style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}
                >
                  {openSuggestionFor === order.id ? '▲ Cerrar' : '▼ Ver y editar sugerencia'}
                </button>

                {openSuggestionFor === order.id && (
                  <CustomerSuggestionPanel
                    order={order}
                    onAccept={(items) => acceptSuggestion(order.id, items)}
                    onReject={() => rejectSuggestion(order.id)}
                    onCancel={() => cancelOrder(order.id)}
                    flashMsg={flashMsg}
                  />
                )}

                <FlashMsg msg={flash[order.id]} />
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Pedidos activos */}
      {activeOrders.length > 0 && (
        <>
          <h3 style={{ marginTop: '1.5rem' }}>Mis pedidos activos ({activeOrders.length})</h3>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {activeOrders.map(order => (
              <li key={order.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.875rem', marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong>{STATUS_LABELS[order.status] || order.status}</strong>
                  <strong>{formatMoney(order.total_cents)}</strong>
                </div>
                <div><strong>Restaurante:</strong> {order.restaurant_name}</div>
                <div><strong>Driver:</strong> {order.driver_first_name || 'Pendiente de asignación'}</div>
                <div style={{ fontSize: '0.82rem', color: '#555' }}>{formatDate(order.created_at)}</div>
                <button
                  onClick={() => setExpanded(p => ({ ...p, [order.id]: !p[order.id] }))}
                  style={{ marginTop: '0.3rem', fontSize: '0.82rem' }}
                >
                  {expanded[order.id] ? '▲ Ocultar' : '▼ Detalles'}
                </button>
                {expanded[order.id] && (order.items || []).length > 0 && (
                  <ul style={{ paddingLeft: '1rem', fontSize: '0.9rem', margin: '0.25rem 0' }}>
                    {order.items.map(i => <li key={i.menuItemId}>{i.name} × {i.quantity} — {formatMoney(i.unitPriceCents * i.quantity)}</li>)}
                  </ul>
                )}
                <div className="row" style={{ marginTop: '0.5rem' }}>
                  {['created','pending_driver','assigned','accepted','preparing'].includes(order.status) && (
                    <button onClick={() => cancelOrder(order.id)}>Cancelar</button>
                  )}
                </div>
                <FlashMsg msg={flash[order.id]} />
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Historial */}
      {historyOrders.length > 0 && (
        <>
          <h3 style={{ marginTop: '1.5rem' }}>Historial ({historyOrders.length})</h3>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {historyOrders.map(order => (
              <li key={order.id} style={{ borderBottom: '1px solid #eee', paddingBottom: '0.5rem', marginBottom: '0.5rem' }}>
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                  onClick={() => setExpanded(p => ({ ...p, [`h_${order.id}`]: !p[`h_${order.id}`] }))}
                >
                  <span>
                    <strong>{STATUS_LABELS[order.status] || order.status}</strong>
                    {' · '}{formatMoney(order.total_cents)}
                    {' · '}{order.restaurant_name}
                    <span style={{ color: '#888', fontSize: '0.82rem', marginLeft: '0.4rem' }}>{formatDate(order.created_at)}</span>
                  </span>
                  <span>{expanded[`h_${order.id}`] ? '▲' : '▼'}</span>
                </div>
                {expanded[`h_${order.id}`] && (
                  <div style={{ paddingLeft: '1rem', fontSize: '0.9rem', marginTop: '0.25rem' }}>
                    <div><strong>Driver:</strong> {order.driver_first_name || '—'}</div>
                    {(order.items || []).map(i => (
                      <div key={i.menuItemId}>{i.name} × {i.quantity} — {formatMoney(i.unitPriceCents * i.quantity)}</div>
                    ))}
                    {order.status === 'delivered' && (
                      <button
                        onClick={() => setOpenComplaintFor(openComplaintFor === order.id ? '' : order.id)}
                        style={{ marginTop: '0.4rem', fontSize: '0.82rem' }}
                      >
                        📣 Generar queja
                      </button>
                    )}
                  </div>
                )}
                {openComplaintFor === order.id && (
                  <div style={{ marginTop: '0.5rem', paddingLeft: '1rem' }}>
                    <textarea
                      value={complaintText[order.id] || ''}
                      onChange={e => setComplaintText(p => ({ ...p, [order.id]: e.target.value }))}
                      placeholder="Describe tu queja…"
                      rows={3} style={{ width: '100%', boxSizing: 'border-box' }}
                    />
                    <FlashMsg msg={flash[`complaint_${order.id}`]} />
                    <div className="row">
                      <button onClick={() => submitComplaint(order.id)}>Enviar queja</button>
                      <button onClick={() => setOpenComplaintFor('')}>Cancelar</button>
                    </div>
                  </div>
                )}
                <FlashMsg msg={flash[order.id]} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
