import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';

function buildInitialSuggestion(items = []) {
  const map = {};
  items.forEach((item) => {
    map[item.menuItemId] = item.quantity;
  });
  return map;
}

export default function RestaurantDashboard() {
  const { auth } = useAuth();
  const [restaurant, setRestaurant] = useState(null);
  const [description, setDescription] = useState('Producto demo');
  const [price, setPrice] = useState('1000');
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [message, setMessage] = useState('');
  const [suggestionDrafts, setSuggestionDrafts] = useState({});
  const [openSuggestionFor, setOpenSuggestionFor] = useState('');

  async function loadData() {
    if (!auth.token) return;
    const myRestaurant = await apiFetch('/restaurants/my', {}, auth.token);
    setRestaurant(myRestaurant.restaurant);
    const myOrders = await apiFetch('/orders/my', {}, auth.token);
    setOrders(myOrders.orders);
    const myProducts = await apiFetch('/restaurants/my/menu', {}, auth.token);
    setProducts(myProducts.menu);
  }

  useEffect(() => {
    loadData().catch((error) => setMessage(error.message));
  }, [auth.token]);

  useEffect(() => {
    const nextDrafts = {};
    for (const order of orders) {
      nextDrafts[order.id] = suggestionDrafts[order.id] || buildInitialSuggestion(order.items);
    }
    setSuggestionDrafts(nextDrafts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders.length]);

  async function addProduct() {
    try {
      await apiFetch('/restaurants/menu-items', {
        method: 'POST',
        body: JSON.stringify({ name: description.slice(0, 20), description, priceCents: Number(price) })
      }, auth.token);
      setMessage('Producto agregado');
      loadData();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function updateProduct(productId, current, field, value) {
    try {
      const payload = {
        name: current.name,
        description: current.description,
        priceCents: current.price_cents,
        isAvailable: current.is_available,
        [field]: value
      };
      await apiFetch(`/restaurants/menu-items/${productId}`, { method: 'PATCH', body: JSON.stringify(payload) }, auth.token);
      setMessage('Producto actualizado');
      loadData();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function changeStatus(orderId, status) {
    await apiFetch(`/orders/${orderId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }, auth.token);
    loadData();
  }

  function adjustSuggestion(orderId, menuItemId, delta) {
    setSuggestionDrafts((prev) => {
      const current = prev[orderId] || {};
      const nextQty = Math.max(0, (current[menuItemId] || 0) + delta);
      return { ...prev, [orderId]: { ...current, [menuItemId]: nextQty } };
    });
  }

  async function sendSuggestion(order) {
    const draft = suggestionDrafts[order.id] || {};
    const items = Object.entries(draft)
      .filter(([, quantity]) => quantity > 0)
      .map(([menuItemId, quantity]) => ({ menuItemId, quantity }));

    if (items.length === 0) {
      setMessage('La sugerencia debe tener al menos 1 producto');
      return;
    }

    await apiFetch(`/orders/${order.id}/suggest`, { method: 'PATCH', body: JSON.stringify({ items }) }, auth.token);
    setMessage('Sugerencia enviada');
    setOpenSuggestionFor('');
    loadData();
  }

  const restaurantOrders = useMemo(
    () => orders.filter((order) => ['created', 'assigned', 'accepted', 'preparing', 'ready'].includes(order.status)),
    [orders]
  );

  return (
    <section className="role-panel">
      <h2>Restaurante</h2>
      <p>Mi restaurante: {restaurant?.name || 'N/A'}</p>
      <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="descripción" />
      <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="precio en cents" />
      <button disabled={!auth.token || auth.user?.role !== 'restaurant'} onClick={addProduct}>Agregar producto</button>

      <h3>Mis productos</h3>
      <ul>
        {products.map((product) => (
          <li key={product.id}>
            <strong>{product.name}</strong> · {product.description} · ${(product.price_cents / 100).toFixed(2)} · {product.is_available ? 'activo' : 'inactivo'}
            <button onClick={() => updateProduct(product.id, product, 'isAvailable', !product.is_available)}>
              {product.is_available ? 'Desactivar' : 'Activar'}
            </button>
            <button onClick={() => {
              const nextPrice = Number(prompt('Nuevo precio en cents', String(product.price_cents)));
              if (!Number.isNaN(nextPrice) && nextPrice > 0) updateProduct(product.id, product, 'priceCents', nextPrice);
            }}>Editar precio</button>
          </li>
        ))}
      </ul>

      <h3>Vista previa pedidos</h3>
      <ul>
        {restaurantOrders.map((order) => (
          <li key={order.id}>
            {order.id} · {order.status} · cliente: {order.customer_first_name} · driver: {order.driver_first_name || 'pendiente'}
            {order.restaurant_note ? <p>{order.restaurant_note}</p> : null}
            <div className="row">
              <button onClick={() => changeStatus(order.id, 'preparing')}>preparación</button>
              <button onClick={() => changeStatus(order.id, 'ready')}>listo</button>
              <button onClick={() => setOpenSuggestionFor(openSuggestionFor === order.id ? '' : order.id)}>Sugerir alternativa</button>
            </div>

            {openSuggestionFor === order.id ? (
              <div className="auth-card compact">
                <p>Pedido solicitado (no editable)</p>
                <ul>
                  {(order.items || []).map((item) => (
                    <li key={item.menuItemId}>{item.name} · qty solicitada: {item.quantity}</li>
                  ))}
                </ul>
                <p>Armar sugerencia (+/-)</p>
                <ul>
                  {(order.items || []).map((item) => (
                    <li key={`s-${item.menuItemId}`}>
                      {item.name}
                      <button onClick={() => adjustSuggestion(order.id, item.menuItemId, -1)}>-</button>
                      <span style={{ margin: '0 .5rem' }}>{(suggestionDrafts[order.id] || {})[item.menuItemId] ?? item.quantity}</span>
                      <button onClick={() => adjustSuggestion(order.id, item.menuItemId, 1)}>+</button>
                    </li>
                  ))}
                </ul>
                <button onClick={() => sendSuggestion(order)}>Enviar sugerencia</button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {message ? <p>{message}</p> : null}
    </section>
  );
}
