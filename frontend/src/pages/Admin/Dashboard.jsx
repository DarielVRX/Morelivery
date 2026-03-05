import { useEffect, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';

export default function AdminDashboard() {
  const { auth } = useAuth();
  const [orders, setOrders] = useState([]);
  const [users, setUsers] = useState([]);
  const [message, setMessage] = useState('');

  async function loadData() {
    const ordersResult = await apiFetch('/admin/orders', {}, auth.token);
    const usersResult = await apiFetch('/admin/users', {}, auth.token);
    setOrders(ordersResult.orders);
    setUsers(usersResult.users);
  }

  useEffect(() => {
    if (!auth.token || auth.user?.role !== 'admin') return;
    loadData().catch((error) => setMessage(error.message));
  }, [auth.token, auth.user?.role]);

  async function suspendUser(userId) {
    try {
      await apiFetch(`/admin/users/${userId}/suspend`, { method: 'PATCH', body: JSON.stringify({ reason: 'beta moderation' }) }, auth.token);
      setMessage('Usuario suspendido');
      loadData();
    } catch (error) {
      setMessage(error.message);
    }
  }

  return (
    <section className="role-panel">
      <h2>Panel Admin</h2>
      <p>Monitoreo general de pedidos y usuarios.</p>

      <h3>Pedidos recientes</h3>
      <ul>
        {orders.map((order) => (
          <li key={order.id}>{order.id} · {order.status} · ${(order.total_cents / 100).toFixed(2)}</li>
        ))}
      </ul>

      <h3>Usuarios</h3>
      <ul>
        {users.map((user) => (
          <li key={user.id}>
            {user.full_name} · {user.role} · {user.status}
            {user.status === 'active' ? <button onClick={() => suspendUser(user.id)}>Suspender</button> : null}
          </li>
        ))}
      </ul>
      {message ? <p>{message}</p> : null}
    </section>
  );
}
