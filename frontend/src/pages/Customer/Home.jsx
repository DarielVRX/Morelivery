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
      if (!restaurantId) throw new Error('Selecciona un restaurante');
      const currentMenuIds = new Set(menu.map((item) => item.id));
      const items = Object.entries(selectedItems)
        .filter(([menuItemId, qty]) => currentMenuIds.has(menuItemId) && Number(qty) > 0)
        .map(([menuItemId, quantity]) => ({ menuItemId, quantity: Number(quantity) }));
      if (items.length === 0) throw new Error('Selecciona al menos un producto válido');
      const data = await apiFetch('/orders', { method: 'POST', body: JSON.stringify({ restaurantId, items }) }, auth.token);
      setMessage(`Pedido creado: ${data.order.id} estado ${data.order.status}`);
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
      <select value={restaurantId} onChange={(e) => setRestaurantId(e.target.value)}>
        {restaurants.map((r) => (
          <option key={r.id} value={r.id}>{r.name}</option>
        ))}
      </select>
      <ul>
        {menu.map((item) => (
          <li key={item.id}>
            {item.name} - {(item.description || 'Sin descripción')} - ${(item.price_cents / 100).toFixed(2)}
            <input
              type="number"
              min="0"
              placeholder="qty"
              onChange={(e) => setSelectedItems((prev) => ({ ...prev, [item.id]: e.target.value }))}
            />
          </li>
        ))}
      </ul>
      <button disabled={!auth.token || auth.user?.role !== 'customer'} onClick={createOrder}>Crear pedido</button>

      <h3>Sugerencias de restaurante</h3>
      <ul>
        {pendingSuggestions.map((order) => (
          <li key={`sug-${order.id}`}>
            Pedido {order.id}
            <button onClick={() => openSuggestion(order)}>Ver sugerencia</button>
            {openSuggestionFor === order.id ? (
              <div className="auth-card compact">
                <p>Preview de sugerencia (+/- solo visual)</p>
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
                  <button onClick={() => respondSuggestion(order.id, true)}>Aceptar sugerencia</button>
                  <button onClick={() => respondSuggestion(order.id, false)}>Rechazar sugerencia</button>
                  <button onClick={() => cancelOrder(order.id)}>Cancelar pedido</button>
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <h3>Mis pedidos</h3>
      <ul>
        {myOrders.map((order) => (
          <li key={order.id}>
            {order.id} · {order.status} · ${(order.total_cents / 100).toFixed(2)} · restaurante: {order.restaurant_name} · driver: {order.driver_first_name || 'pending'}
            {['created', 'pending_driver', 'assigned', 'accepted', 'preparing'].includes(order.status) ? (
              <button onClick={() => cancelOrder(order.id)}>Cancelar</button>
            ) : null}
          </li>
        ))}
      </ul>
      {message ? <p>{message}</p> : null}
    </section>
  );
}
