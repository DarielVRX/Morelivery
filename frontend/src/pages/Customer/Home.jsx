import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';

function toDraft(items = []) {
  const draft = {};
  items.forEach((item) => {
    draft[item.menuItemId] = item.quantity;
  });
  return draft;
}

function formatMoney(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

const STATUS_LABELS = {
  created: 'Recibido',
  assigned: 'Asignado a driver',
  accepted: 'Aceptado',
  preparing: 'En preparación',
  ready: 'Listo para retiro',
  on_the_way: 'En camino',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
  pending_driver: 'Esperando driver',
};

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

  // Bloquea si no tiene dirección guardada
  const hasAddress = Boolean(
    auth.user?.address && auth.user.address !== 'address-pending'
  );

  async function loadRestaurants() {
    const data = await apiFetch('/restaurants');
    setRestaurants(data.restaurants);
    if (data.restaurants[0]?.id) setRestaurantId(data.restaurants[0].id);
  }

  async function loadMenu(id) {
    if (!id) return;
    const data = await apiFetch(`/restaurants/${id}/menu`);
    const availableMenu = (data.menu || []).filter((item) => item.is_available !== false);
    setMenu(availableMenu);
    setSelectedItems({});
  }

  async function loadMyOrders() {
    if (!auth.token) return;
    const data = await apiFetch('/orders/my', {}, auth.token);
    setMyOrders(data.orders);
  }

  useEffect(() => {
    loadRestaurants().catch(() => setMessage('Error cargando restaurantes'));
  }, []);

  useEffect(() => {
    loadMenu(restaurantId).catch(() => setMenu([]));
  }, [restaurantId]);

  useEffect(() => {
    loadMyOrders().catch(() => setMyOrders([]));
  }, [auth.token]);

  async function createOrder() {
    try {
      if (!hasAddress) throw new Error('Debes guardar tu dirección antes de hacer un pedido');
      if (!restaurantId) throw new Error('Selecciona un restaurante');
      const currentMenuIds = new Set(menu.map((item) => item.id));
      const items = Object.entries(selectedItems)
        .filter(([menuItemId, qty]) => currentMenuIds.has(menuItemId) && Number(qty) > 0)
        .map(([menuItemId, quantity]) => ({ menuItemId, quantity: Number(quantity) }));
      if (items.length === 0) throw new Error('Selecciona al menos un producto válido');
      const data = await apiFetch('/orders', { method: 'POST', body: JSON.stringify({ restaurantId, items }) }, auth.token);
      setMessage(`✅ Pedido creado: ${data.order.id}`);
      setSelectedItems({});
      loadMyOrders();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function cancelOrder(orderId) {
    await apiFetch(`/orders/${orderId}/cancel`, { method: 'PATCH' }, auth.token);
    setOpenSuggestionFor('');
    loadMyOrders();
  }

  function openSuggestion(order) {
    setOpenSuggestionFor(order.id);
    setSuggestionDrafts((prev) => ({
      ...prev,
      [order.id]: prev[order.id] || toDraft(order.suggestion_items || [])
    }));
  }

  function adjustSuggestion(orderId, menuItemId, delta) {
    setSuggestionDrafts((prev) => {
      const current = prev[orderId] || {};
      const next = Math.max(0, (current[menuItemId] || 0) + delta);
      return { ...prev, [orderId]: { ...current, [menuItemId]: next } };
    });
  }

  async function respondSuggestion(orderId, accepted) {
    await apiFetch(`/orders/${orderId}/suggestion-response`, { method: 'PATCH', body: JSON.stringify({ accepted }) }, auth.token);
    setOpenSuggestionFor('');
    loadMyOrders();
  }

  const pendingSuggestions = useMemo(
    () => myOrders.filter((order) => order.suggestion_status === 'pending_customer' && (order.suggestion_items || []).length > 0),
    [myOrders]
  );

  return (
    <section className="role-panel">
      <h2>Cliente</h2>

      {/* Aviso si falta dirección */}
      {!hasAddress && (
        <div className="auth-card" style={{ borderLeft: '4px solid orange', background: '#fff8e1' }}>
          <p>⚠️ Debes guardar tu dirección (arriba) antes de poder hacer pedidos.</p>
        </div>
      )}

      {/* Selección de restaurante y menú */}
      <div style={{ opacity: hasAddress ? 1 : 0.5, pointerEvents: hasAddress ? 'auto' : 'none' }}>
        <select value={restaurantId} onChange={(e) => setRestaurantId(e.target.value)}>
          {restaurants.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
        <ul>
          {menu.map((item) => (
            <li key={item.id}>
              {item.name} — {item.description || 'Sin descripción'} — {formatMoney(item.price_cents)}
              <input
                type="number"
                min="0"
                placeholder="qty"
                value={selectedItems[item.id] || ''}
                onChange={(e) => setSelectedItems((prev) => ({ ...prev, [item.id]: e.target.value }))}
              />
            </li>
          ))}
        </ul>
        <button
          disabled={!auth.token || auth.user?.role !== 'customer' || !hasAddress}
          onClick={createOrder}
        >
          Crear pedido
        </button>
      </div>

      {/* Sugerencias pendientes */}
      {pendingSuggestions.length > 0 && (
        <>
          <h3>Sugerencias de restaurante ({pendingSuggestions.length})</h3>
          <ul>
            {pendingSuggestions.map((order) => (
              <li key={`sug-${order.id}`}>
                Pedido {order.id}
                <button onClick={() => openSuggestion(order)}>Ver sugerencia</button>
                {openSuggestionFor === order.id ? (
                  <div className="auth-card compact">
                    <p>Sugerencia del restaurante (+/- solo visual)</p>
                    <ul>
                      {(order.suggestion_items || []).map((item) => (
                        <li key={`${order.id}-${item.menuItemId}`}>
                          {item.name}
                          <button onClick={() => adjustSuggestion(order.id, item.menuItemId, -1)}>-</button>
                          <span style={{ margin: '0 .5rem' }}>{(suggestionDrafts[order.id] || {})[item.menuItemId] ?? item.quantity}</span>
                          <button onClick={() => adjustSuggestion(order.id, item.menuItemId, 1)}>+</button>
                        </li>
                      ))}
                    </ul>
                    <div className="row">
                      <button onClick={() => respondSuggestion(order.id, true)}>Aceptar</button>
                      <button onClick={() => respondSuggestion(order.id, false)}>Rechazar</button>
                      <button onClick={() => cancelOrder(order.id)}>Cancelar pedido</button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Mis pedidos */}
      <h3>Mis pedidos ({myOrders.length})</h3>
      {myOrders.length === 0 ? <p>Sin pedidos aún.</p> : (
        <ul>
          {myOrders.map((order) => (
            <li key={order.id} style={{ marginBottom: '1rem', borderBottom: '1px solid #eee', paddingBottom: '0.75rem' }}>
              <div><strong>Estado:</strong> {STATUS_LABELS[order.status] || order.status}</div>
              <div><strong>Total:</strong> {formatMoney(order.total_cents)}</div>
              <div><strong>Restaurante:</strong> {order.restaurant_name}</div>
              <div><strong>Driver:</strong> {order.driver_first_name || 'Pendiente de asignación'}</div>
              {(order.items || []).length > 0 && (
                <ul style={{ paddingLeft: '1rem', marginTop: '0.25rem' }}>
                  {order.items.map((item) => (
                    <li key={item.menuItemId}>{item.name} × {item.quantity}</li>
                  ))}
                </ul>
              )}
              {['created', 'pending_driver', 'assigned', 'accepted', 'preparing'].includes(order.status) ? (
                <button onClick={() => cancelOrder(order.id)}>Cancelar</button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {message ? <p style={{ color: message.startsWith('✅') ? 'green' : 'red' }}>{message}</p> : null}
    </section>
  );
}
