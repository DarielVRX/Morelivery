import { useEffect, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';

export default function DriverDashboard() {
  const { auth } = useAuth();
  const [orders, setOrders] = useState([]);

  async function loadOrders() {
    if (!auth.token) return;
    const data = await apiFetch('/orders/my', {}, auth.token);
    setOrders(data.orders);
  }

  useEffect(() => {
    loadOrders().catch(() => {});
  }, [auth.token]);

  async function setAvailability(isAvailable) {
    await apiFetch('/drivers/availability', { method: 'PATCH', body: JSON.stringify({ isAvailable }) }, auth.token);
  }

  async function changeStatus(orderId, status) {
    await apiFetch(`/orders/${orderId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }, auth.token);
    loadOrders();
  }

  return (
    <section>
      <h2>Repartidor</h2>
      <button disabled={!auth.token || auth.user?.role !== 'driver'} onClick={() => setAvailability(true)}>Disponible</button>
      <button disabled={!auth.token || auth.user?.role !== 'driver'} onClick={() => setAvailability(false)}>No disponible</button>
      <ul>
        {orders.map((order) => (
          <li key={order.id}>{order.id} - {order.status}
            <button onClick={() => changeStatus(order.id, 'on_the_way')}>en camino</button>
            <button onClick={() => changeStatus(order.id, 'delivered')}>entregado</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
