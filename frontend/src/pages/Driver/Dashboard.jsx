import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';

function formatMoney(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

const STATUS_LABELS = {
  created: 'Recibido',
  assigned: 'Asignado',
  accepted: 'Aceptado',
  preparing: 'En preparación',
  ready: 'Listo para retiro',
  on_the_way: 'En camino',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
  pending_driver: 'Esperando driver',
};

export default function DriverDashboard() {
  const { auth, patchUser } = useAuth();
  const [orders, setOrders] = useState([]);
  const [offers, setOffers] = useState([]);
  const [networkOnline, setNetworkOnline] = useState(navigator.onLine);
  const [availability, setAvailabilityState] = useState(
    Boolean(auth.user?.driver?.is_available)
  );
  const [message, setMessage] = useState('');
  const [loadingAvail, setLoadingAvail] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState({});

  async function loadData() {
    if (!auth.token) return;
    try {
      // Notifica al backend que el driver está conectado para recibir ofertas
      await apiFetch('/drivers/listener', { method: 'POST' }, auth.token);
    } catch (_) { /* no bloquear si falla */ }
    try {
      const data = await apiFetch('/orders/my', {}, auth.token);
      setOrders(data.orders);
    } catch (_) {}
    try {
      const offerData = await apiFetch('/drivers/offers', {}, auth.token);
      setOffers(offerData.offers);
    } catch (_) {}
  }

  useEffect(() => {
    loadData();
  }, [auth.token]);

  // Sincroniza disponibilidad desde el contexto de auth
  useEffect(() => {
    setAvailabilityState(Boolean(auth.user?.driver?.is_available));
  }, [auth.user?.driver?.is_available]);

  useEffect(() => {
    function onOnline() { setNetworkOnline(true); loadData(); }
    function onOffline() { setNetworkOnline(false); }
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  async function setAvailability(isAvailable) {
    setLoadingAvail(true);
    setMessage('');
    try {
      const data = await apiFetch(
        '/drivers/availability',
        { method: 'PATCH', body: JSON.stringify({ isAvailable }) },
        auth.token
      );
      const newVal = Boolean(data.profile?.is_available);
      setAvailabilityState(newVal);
      // Persiste en localStorage via patchUser
      patchUser({ driver: { ...(auth.user?.driver || {}), is_available: newVal } });
      setMessage(newVal ? 'Ahora estás disponible' : 'Ahora estás no disponible');
      await loadData();
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setLoadingAvail(false);
    }
  }

  async function changeStatus(orderId, status) {
    setLoadingStatus((prev) => ({ ...prev, [orderId]: status }));
    setMessage('');
    try {
      await apiFetch(
        `/orders/${orderId}/status`,
        { method: 'PATCH', body: JSON.stringify({ status }) },
        auth.token
      );
      await loadData();
      setMessage(`Estado actualizado: ${STATUS_LABELS[status] || status}`);
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setLoadingStatus((prev) => ({ ...prev, [orderId]: null }));
    }
  }

  async function acceptOffer(orderId) {
    setMessage('');
    try {
      await apiFetch(`/drivers/offers/${orderId}/accept`, { method: 'POST' }, auth.token);
      await loadData();
    } catch (err) {
      setMessage(`Error al aceptar: ${err.message}`);
    }
  }

  async function rejectOffer(orderId) {
    setMessage('');
    try {
      await apiFetch(`/drivers/offers/${orderId}/reject`, { method: 'POST' }, auth.token);
      await loadData();
    } catch (err) {
      setMessage(`Error al rechazar: ${err.message}`);
    }
  }

  async function releaseOrder(orderId) {
    setMessage('');
    try {
      await apiFetch(`/drivers/orders/${orderId}/release`, { method: 'POST' }, auth.token);
      await loadData();
    } catch (err) {
      setMessage(`Error al liberar: ${err.message}`);
    }
  }

  const activeOrders = useMemo(
    () => orders.filter((order) => !['delivered', 'cancelled'].includes(order.status)),
    [orders]
  );

  const previousOrders = useMemo(
    () => orders.filter((order) => ['delivered', 'cancelled'].includes(order.status)),
    [orders]
  );

  return (
    <section className="role-panel">
      <h2>Repartidor</h2>

      {/* Estado de red y disponibilidad */}
      <div style={{ marginBottom: '1rem' }}>
        <p>🌐 Red: {networkOnline ? '✅ Conectado' : '❌ Desconectado'}</p>
        <p>
          📍 Disponibilidad: <strong>{availability ? '✅ Disponible' : '❌ No disponible'}</strong>
        </p>
        <div className="row">
          <button
            disabled={loadingAvail || !auth.token || auth.user?.role !== 'driver' || availability}
            onClick={() => setAvailability(true)}
          >
            {loadingAvail ? '...' : 'Disponible'}
          </button>
          <button
            disabled={loadingAvail || !auth.token || auth.user?.role !== 'driver' || !availability}
            onClick={() => setAvailability(false)}
          >
            {loadingAvail ? '...' : 'No disponible'}
          </button>
          <button onClick={loadData} title="Actualizar pedidos y ofertas">🔄 Actualizar</button>
        </div>
      </div>

      {/* Ofertas pendientes */}
      <h3>Ofertas pendientes ({offers.length})</h3>
      {offers.length === 0 ? (
        <p>Sin ofertas por ahora. Asegúrate de estar disponible.</p>
      ) : (
        <ul>
          {offers.map((offer) => (
            <li key={offer.id} style={{ marginBottom: '1.25rem', borderBottom: '1px solid #eee', paddingBottom: '1rem' }}>
              <div><strong>Pedido:</strong> {offer.id}</div>
              <div><strong>Total:</strong> {formatMoney(offer.total_cents)}</div>
              <div><strong>Restaurante:</strong> {offer.restaurant_name}</div>
              <div><strong>Cliente:</strong> {offer.customer_first_name}</div>
              <div><strong>Dirección restaurante:</strong> {offer.restaurant_address || '—'}</div>
              <div><strong>Dirección entrega:</strong> {offer.customer_address || offer.delivery_address || '—'}</div>

              {/* Productos de la oferta */}
              {(offer.items || []).length > 0 && (
                <div style={{ paddingLeft: '1rem', margin: '0.5rem 0' }}>
                  <strong>Productos:</strong>
                  <ul>
                    {offer.items.map((item) => (
                      <li key={item.menuItemId}>
                        {item.name} × {item.quantity} — {formatMoney(item.unitPriceCents * item.quantity)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="row" style={{ marginTop: '0.5rem' }}>
                <button onClick={() => acceptOffer(offer.id)}>✅ Aceptar</button>
                <button onClick={() => rejectOffer(offer.id)}>❌ Rechazar</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Pedidos asignados activos */}
      <h3>Pedidos asignados ({activeOrders.length})</h3>
      {activeOrders.length === 0 ? <p>Sin pedidos activos.</p> : (
        <ul>
          {activeOrders.map((order) => {
            const isLoading = loadingStatus[order.id];
            return (
              <li key={order.id} style={{ marginBottom: '1.5rem', borderBottom: '1px solid #eee', paddingBottom: '1rem' }}>
                <div><strong>Pedido:</strong> {order.id}</div>
                <div><strong>Estado:</strong> {STATUS_LABELS[order.status] || order.status}</div>
                <div><strong>Total:</strong> {formatMoney(order.total_cents)}</div>
                <div><strong>Cliente:</strong> {order.customer_first_name}</div>
                <div><strong>Restaurante:</strong> {order.restaurant_name}</div>
                <div><strong>Dirección restaurante:</strong> {order.restaurant_address || '—'}</div>
                <div><strong>Dirección entrega:</strong> {order.customer_address || order.delivery_address || '—'}</div>
                {order.driver_note ? <div><strong>Nota:</strong> {order.driver_note}</div> : null}

                {/* Productos */}
                {(order.items || []).length > 0 && (
                  <div style={{ paddingLeft: '1rem', margin: '0.5rem 0' }}>
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
                    disabled={!!isLoading || order.status !== 'ready'}
                    onClick={() => changeStatus(order.id, 'on_the_way')}
                    title={order.status !== 'ready' ? 'El restaurante debe marcar el pedido como listo primero' : ''}
                  >
                    {isLoading === 'on_the_way' ? '...' : '🛵 En camino'}
                  </button>
                  <button
                    disabled={!!isLoading || order.status !== 'on_the_way'}
                    onClick={() => changeStatus(order.id, 'delivered')}
                  >
                    {isLoading === 'delivered' ? '...' : '📦 Entregado'}
                  </button>
                  <button
                    disabled={!!isLoading}
                    onClick={() => releaseOrder(order.id)}
                  >
                    Liberar pedido
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Historial */}
      <h3>Historial reciente ({previousOrders.length})</h3>
      {previousOrders.length === 0 ? <p>Sin historial aún.</p> : (
        <ul>
          {previousOrders.map((order) => (
            <li key={`prev-${order.id}`}>
              {order.id} · {STATUS_LABELS[order.status] || order.status} · {formatMoney(order.total_cents)} · cliente: {order.customer_first_name}
            </li>
          ))}
        </ul>
      )}

      {message ? <p style={{ color: message.startsWith('Error') ? 'red' : 'green' }}>{message}</p> : null}
    </section>
  );
}
