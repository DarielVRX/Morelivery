import { useEffect, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';

export default function DriverDashboard() {
  const { auth } = useAuth();
  const [orders, setOrders] = useState([]);
  const [offers, setOffers] = useState([]);
  const [online, setOnline] = useState(navigator.onLine);

  async function loadData() {
    if (!auth.token) return;
    await apiFetch('/drivers/listener', { method: 'POST' }, auth.token);
    const data = await apiFetch('/orders/my', {}, auth.token);
    setOrders(data.orders);
    const offerData = await apiFetch('/drivers/offers', {}, auth.token);
    setOffers(offerData.offers);
  }

  useEffect(() => {
    loadData().catch(() => {});
  }, [auth.token]);

  useEffect(() => {
    function onOnline() { setOnline(true); }
    function onOffline() { setOnline(false); }
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  async function setAvailability(isAvailable) {
    await apiFetch('/drivers/availability', { method: 'PATCH', body: JSON.stringify({ isAvailable }) }, auth.token);
    loadData();
  }

  async function changeStatus(orderId, status) {
    await apiFetch(`/orders/${orderId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }, auth.token);
    loadData();
  }

  async function acceptOffer(orderId) {
    await apiFetch(`/drivers/offers/${orderId}/accept`, { method: 'POST' }, auth.token);
    loadData();
  }

  async function rejectOffer(orderId) {
    await apiFetch(`/drivers/offers/${orderId}/reject`, { method: 'POST' }, auth.token);
    loadData();
  }

  async function releaseOrder(orderId) {
    await apiFetch(`/drivers/orders/${orderId}/release`, { method: 'POST' }, auth.token);
    loadData();
  }

  return (
    <section className="role-panel">
      <h2>Repartidor</h2>
      <p>Estado de conexión: {online ? 'Conectado' : 'Desconectado'}</p>
      <button disabled={!auth.token || auth.user?.role !== 'driver'} onClick={() => setAvailability(true)}>Disponible</button>
      <button disabled={!auth.token || auth.user?.role !== 'driver'} onClick={() => setAvailability(false)}>No disponible</button>

      <h3>Ofertas (preview resumido)</h3>
      <ul>
        {offers.map((offer) => (
          <li key={offer.id}>
            {offer.id} · {offer.restaurant_name} · cliente: {offer.customer_first_name} · dir: {offer.customer_address || offer.delivery_address}
            <button onClick={() => acceptOffer(offer.id)}>Aceptar</button>
            <button onClick={() => rejectOffer(offer.id)}>Rechazar</button>
          </li>
        ))}
      </ul>

      <h3>Pedidos asignados</h3>
      <ul>
        {orders.map((order) => (
          <li key={order.id}>
            {order.id} · {order.status} · cliente: {order.customer_first_name}
            {order.driver_note ? <p>{order.driver_note}</p> : null}
            <button onClick={() => changeStatus(order.id, 'on_the_way')}>En camino</button>
            <button onClick={() => changeStatus(order.id, 'delivered')}>Entregado</button>
            <button onClick={() => releaseOrder(order.id)}>Liberar</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
