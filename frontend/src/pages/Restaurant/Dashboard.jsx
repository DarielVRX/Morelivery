import { useEffect, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';

export default function RestaurantDashboard() {
  const { auth } = useAuth();
  const [restaurant, setRestaurant] = useState(null);
  const [description, setDescription] = useState('Producto demo');
  const [price, setPrice] = useState('1000');
  const [orders, setOrders] = useState([]);
  const [message, setMessage] = useState('');

  async function loadData() {
    if (!auth.token) return;
    const myRestaurant = await apiFetch('/restaurants/my', {}, auth.token);
    setRestaurant(myRestaurant.restaurant);
    const myOrders = await apiFetch('/orders/my', {}, auth.token);
    setOrders(myOrders.orders);
  }

  useEffect(() => {
    loadData().catch(() => {});
  }, [auth.token]);

  async function addProduct() {
    try {
      await apiFetch('/restaurants/menu-items', {
        method: 'POST',
        body: JSON.stringify({ name: description.slice(0, 20), description, priceCents: Number(price) })
      }, auth.token);
      setMessage('Producto agregado');
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function changeStatus(orderId, status) {
    await apiFetch(`/orders/${orderId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }, auth.token);
    loadData();
  }

  return (
    <section>
      <h2>Restaurante</h2>
      <p>Mi restaurante: {restaurant?.name || 'N/A'}</p>
      <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="descripción" />
      <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="precio en cents" />
      <button disabled={!auth.token || auth.user?.role !== 'restaurant'} onClick={addProduct}>Agregar producto</button>
      <h3>Pedidos</h3>
      <ul>
        {orders.map((order) => (
          <li key={order.id}>{order.id} - {order.status}
            <button onClick={() => changeStatus(order.id, 'accepted')}>aceptado</button>
            <button onClick={() => changeStatus(order.id, 'preparing')}>preparando</button>
            <button onClick={() => changeStatus(order.id, 'ready')}>listo</button>
          </li>
        ))}
      </ul>
      {message ? <p>{message}</p> : null}
    </section>
  );
}
