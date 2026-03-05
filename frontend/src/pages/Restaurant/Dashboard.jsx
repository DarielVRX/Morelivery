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
  const [loadingStatus, setLoadingStatus] = useState({});

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
    setLoadingStatus((prev) => ({ ...prev, [orderId]: status }));
    setMessage('');
    try {
      await apiFetch(`/orders/${orderId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      }, auth.token);
      await loadData();
      setMessage(`Estado actualizado: ${STATUS_LABELS[status] || status}`);
    } catch (error) {
      setMessage(`Error: ${error.message}`);
    } finally {
      setLoadingStatus((prev) => ({ ...prev, [orderId]: null }));
    }
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
    () => orders.filter((order) => ['created', 'assigned', 'accepted', 'preparing', 'ready', 'pending_driver'].includes(order.status)),
    [orders]
  );

  return (
    <section className="role-panel">
      <h2>Restaurante</h2>
      <p>Mi restaurante: <strong>{restaurant?.name || 'N/A'}</strong></p>

      {/* Agregar producto */}
      <div style={{ marginBottom: '1rem' }}>
        <h3>Agregar producto</h3>
        <div className="row">
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descripción" />
          <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Precio en cents (ej: 1500 = $15.00)" />
          <button disabled={!auth.token || auth.user?.role !== 'restaurant'} onClick={addProduct}>
            Agregar producto
          </button>
        </div>
      </div>

      {/* Mis productos */}
      <h3>Mis productos</h3>
      {products.length === 0 ? <p>Sin productos aún.</p> : (
        <ul>
          {products.map((product) => (
            <li key={product.id}>
              <strong>{product.name}</strong> · {product.description} · {formatMoney(product.price_cents)} · {product.is_available ? '✅ activo' : '❌ inactivo'}
              <button onClick={() => updateProduct(product.id, product, 'isAvailable', !product.is_available)}>
                {product.is_available ? 'Desactivar' : 'Activar'}
              </button>
              <button onClick={() => {
                const nextPrice = Number(prompt('Nuevo precio en cents (ej: 1500 = $15.00)', String(product.price_cents)));
                if (!Number.isNaN(nextPrice) && nextPrice > 0) updateProduct(product.id, product, 'priceCents', nextPrice);
              }}>Editar precio</button>
            </li>
          ))}
        </ul>
      )}

      {/* Pedidos activos */}
      <h3>Pedidos activos ({restaurantOrders.length})</h3>
      {restaurantOrders.length === 0 ? <p>No hay pedidos activos.</p> : (
        <ul>
          {restaurantOrders.map((order) => {
            const isLoading = loadingStatus[order.id];
            return (
              <li key={order.id} style={{ marginBottom: '1.5rem', borderBottom: '1px solid #eee', paddingBottom: '1rem' }}>
                {/* Cabecera del pedido */}
                <div><strong>Pedido:</strong> {order.id}</div>
                <div><strong>Estado:</strong> {STATUS_LABELS[order.status] || order.status}</div>
                <div><strong>Total:</strong> {formatMoney(order.total_cents)}</div>
                <div><strong>Cliente:</strong> {order.customer_first_name || '—'}</div>
                <div><strong>Driver:</strong> {order.driver_first_name || 'Pendiente de asignación'}</div>
                {order.restaurant_note ? <div><strong>Nota:</strong> {order.restaurant_note}</div> : null}

                {/* Detalle de productos */}
                {(order.items || []).length > 0 && (
                  <div style={{ margin: '0.5rem 0', paddingLeft: '1rem' }}>
                    <strong>Productos:</strong>
                    <ul>
                      {order.items.map((item) => (
                        <li key={item.menuItemId}>
                          {item.name} × {item.quantity} — {formatMoney(item.unitPriceCents * item.quantity)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Botones de estado */}
                <div className="row" style={{ marginTop: '0.5rem' }}>
                  <button
                    disabled={!!isLoading || order.status === 'preparing'}
                    onClick={() => changeStatus(order.id, 'preparing')}
                  >
                    {isLoading === 'preparing' ? '...' : '🍳 Preparando'}
                  </button>
                  <button
                    disabled={!!isLoading || order.status === 'ready'}
                    onClick={() => changeStatus(order.id, 'ready')}
                  >
                    {isLoading === 'ready' ? '...' : '✅ Listo'}
                  </button>
                  <button
                    onClick={() => setOpenSuggestionFor(openSuggestionFor === order.id ? '' : order.id)}
                  >
                    💬 Sugerir alternativa
                  </button>
                </div>

                {/* Panel de sugerencia */}
                {openSuggestionFor === order.id ? (
                  <div className="auth-card compact">
                    <p><strong>Pedido solicitado (no editable)</strong></p>
                    <ul>
                      {(order.items || []).map((item) => (
                        <li key={item.menuItemId}>{item.name} · qty solicitada: {item.quantity}</li>
                      ))}
                    </ul>
                    <p><strong>Armar sugerencia (+/-)</strong></p>
                    <ul>
                      {(order.items || []).map((item) => (
                        <li key={`s-${item.menuItemId}`}>
                          {item.name}
                          <button onClick={() => adjustSuggestion(order.id, item.menuItemId, -1)}>-</button>
                          <span style={{ margin: '0 .5rem' }}>
                            {(suggestionDrafts[order.id] || {})[item.menuItemId] ?? item.quantity}
                          </span>
                          <button onClick={() => adjustSuggestion(order.id, item.menuItemId, 1)}>+</button>
                        </li>
                      ))}
                    </ul>
                    <button onClick={() => sendSuggestion(order)}>Enviar sugerencia</button>
                    <button onClick={() => setOpenSuggestionFor('')} style={{ marginLeft: '0.5rem' }}>Cancelar</button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {message ? <p style={{ color: message.startsWith('Error') ? 'red' : 'green' }}>{message}</p> : null}
    </section>
  );
}
