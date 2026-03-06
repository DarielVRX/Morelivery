import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useRealtimeOrders } from '../../hooks/useRealtimeOrders';
import { useDriverLocation } from '../../hooks/useDriverLocation';
import OfferCountdown from '../../components/OfferCountdown';

function fmt(cents) { return `$${((cents ?? 0) / 100).toFixed(2)}`; }

const STATUS_LABELS = {
  created:'Recibido', assigned:'Asignado', accepted:'Aceptado',
  preparing:'En preparación', ready:'Listo para retiro',
  on_the_way:'En camino', delivered:'Entregado',
  cancelled:'Cancelado', pending_driver:'Sin conductor',
};

// Mapa inline solo para el pedido "on_the_way"
function ActiveOrderMap({ driverPos, order }) {
  const ref = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    if (!ref.current || !driverPos) return;
    import('leaflet').then(L => {
      import('leaflet/dist/leaflet.css').catch(() => {});
      if (!L.Icon.Default.prototype._getIconUrl) {
        delete L.Icon.Default.prototype._getIconUrl;
        L.Icon.Default.mergeOptions({
          iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
          iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
          shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
        });
      }
      if (ref.current._leaflet_id) {
        // Actualizar posición
        if (mapRef.current) {
          mapRef.current.marker?.setLatLng([driverPos.lat, driverPos.lng]);
          mapRef.current.map?.setView([driverPos.lat, driverPos.lng]);
        }
        return;
      }
      const map = L.map(ref.current, { zoomControl: true }).setView([driverPos.lat, driverPos.lng], 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
      const marker = L.marker([driverPos.lat, driverPos.lng]).addTo(map).bindPopup('Tu posición').openPopup();
      if (order.delivery_lat) L.marker([order.delivery_lat, order.delivery_lng]).addTo(map).bindPopup('Entrega');
      mapRef.current = { map, marker };
    }).catch(() => {});
  }, [driverPos?.lat, driverPos?.lng]);

  if (!driverPos) return (
    <div style={{ padding:'0.75rem', background:'var(--gray-50)', borderRadius:8, fontSize:'0.83rem', color:'var(--gray-600)', textAlign:'center' }}>
      GPS no disponible — activa la ubicación del dispositivo para ver el mapa
    </div>
  );

  return <div ref={ref} style={{ height:220, borderRadius:8, border:'1px solid var(--gray-200)', marginTop:'0.75rem' }} />;
}

export default function DriverHome() {
  const { auth } = useAuth();
  const [offers, setOffers]         = useState([]);
  const [activeOrder, setActiveOrder] = useState(null);
  const [availability, setAvailability] = useState(false);
  const [loadingOffer, setLoadingOffer] = useState('');
  const [loadingStatus, setLoadingStatus] = useState('');
  const [releaseNote, setReleaseNote] = useState('');
  const [showRelease, setShowRelease] = useState(false);
  const [msg, setMsg] = useState('');
  const loadDataRef = useRef(null);

  const { position: myPosition, error: gpsError } = useDriverLocation(auth.token, availability);

  async function loadData() {
    if (!auth.token) return;
    try { await apiFetch('/drivers/listener', { method:'POST' }, auth.token); } catch (_) {}
    try {
      const [od, off] = await Promise.all([
        apiFetch('/orders/my', {}, auth.token),
        apiFetch('/drivers/offers', {}, auth.token),
      ]);
      const active = (od.orders || []).find(o => !['delivered','cancelled'].includes(o.status));
      setActiveOrder(active || null);
      setOffers(off.offers || []);
    } catch (_) {}
  }

  useEffect(() => { loadDataRef.current = loadData; });
  useEffect(() => {
    setAvailability(Boolean(auth.user?.driver?.is_available));
    loadData();
  }, [auth.token]);

  useRealtimeOrders(auth.token, () => loadDataRef.current?.(), () => {});

  async function toggleAvailability() {
    try {
      const r = await apiFetch('/drivers/availability', {
        method: 'PATCH', body: JSON.stringify({ isAvailable: !availability })
      }, auth.token);
      setAvailability(r.profile.is_available);
    } catch (e) { setMsg(e.message); }
  }

  async function acceptOffer(orderId) {
    setLoadingOffer(orderId);
    try {
      await apiFetch(`/drivers/offers/${orderId}/accept`, { method:'POST' }, auth.token);
      loadData();
    } catch (e) { setMsg(e.message); }
    finally { setLoadingOffer(''); }
  }

  async function rejectOffer(orderId) {
    setLoadingOffer(orderId);
    try {
      await apiFetch(`/drivers/offers/${orderId}/reject`, { method:'POST' }, auth.token);
      loadData();
    } catch (e) { setMsg(e.message); }
    finally { setLoadingOffer(''); }
  }

  async function changeStatus(orderId, status) {
    setLoadingStatus(status);
    try {
      await apiFetch(`/orders/${orderId}/status`, { method:'PATCH', body: JSON.stringify({ status }) }, auth.token);
      loadData();
    } catch (e) { setMsg(e.message); }
    finally { setLoadingStatus(''); }
  }

  async function releaseOrder() {
    if (!activeOrder) return;
    try {
      await apiFetch(`/drivers/orders/${activeOrder.id}/release`, {
        method:'POST', body: JSON.stringify({ note: releaseNote })
      }, auth.token);
      setShowRelease(false); setReleaseNote('');
      loadData();
    } catch (e) { setMsg(e.message); }
  }

  return (
    <div>
      {/* Disponibilidad */}
      <div className="card" style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem' }}>
        <div>
          <div style={{ fontWeight:700, fontSize:'0.9rem' }}>Disponibilidad</div>
          <div style={{ fontSize:'0.82rem', color: availability ? 'var(--success)' : 'var(--gray-400)' }}>
            {availability ? 'Disponible para pedidos' : 'No disponible'}
          </div>
        </div>
        <button
          onClick={toggleAvailability}
          className={availability ? 'btn-primary' : ''}
          style={{ minWidth:90 }}
        >
          {availability ? 'Disponible' : 'No disponible'}
        </button>
      </div>

      {/* GPS */}
      {myPosition && (
        <div style={{ fontSize:'0.78rem', color:'var(--gray-600)', marginBottom:'0.75rem', display:'flex', alignItems:'center', gap:'0.35rem' }}>
          <span style={{ width:7, height:7, borderRadius:'50%', background:'var(--success)', display:'inline-block' }} />
          GPS activo — precisión {Math.round(myPosition.accuracy || 0)} m
        </div>
      )}
      {gpsError && (
        <div className="flash flash-error" style={{ marginBottom:'0.75rem', fontSize:'0.82rem' }}>{gpsError}</div>
      )}

      {msg && <p className="flash flash-error">{msg}</p>}

      {/* Ofertas pendientes */}
      {offers.length > 0 && (
        <>
          <div className="section-title">Ofertas recibidas ({offers.length})</div>
          {offers.map(offer => (
            <div key={offer.id} className="card" style={{ marginBottom:'0.5rem', borderLeft:'3px solid var(--brand)' }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'0.3rem' }}>
                <span style={{ fontWeight:700 }}>{offer.restaurant_name}</span>
                <span style={{ fontWeight:700 }}>{fmt(offer.total_cents)}</span>
              </div>
              <div style={{ fontSize:'0.82rem', color:'var(--gray-600)', marginBottom:'0.4rem' }}>
                {offer.restaurant_address && <div>Retiro: {offer.restaurant_address}</div>}
                {offer.customer_address   && <div>Entrega: {offer.customer_address}</div>}
              </div>
              {(offer.items || []).length > 0 && (
                <ul style={{ fontSize:'0.82rem', margin:'0 0 0.4rem 1rem' }}>
                  {offer.items.map(i => <li key={i.menuItemId}>{i.name} × {i.quantity}</li>)}
                </ul>
              )}
              <OfferCountdown createdAt={offer.offer_created_at} />
              <div style={{ display:'flex', gap:'0.4rem', marginTop:'0.5rem' }}>
                <button className="btn-primary btn-sm" disabled={loadingOffer===offer.id} onClick={() => acceptOffer(offer.id)}>
                  {loadingOffer===offer.id ? 'Aceptando…' : 'Aceptar'}
                </button>
                <button className="btn-sm" disabled={loadingOffer===offer.id} onClick={() => rejectOffer(offer.id)}>
                  Rechazar
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      {/* Pedido activo */}
      {activeOrder && (
        <>
          <div className="section-title" style={{ marginTop: offers.length > 0 ? '1rem' : 0 }}>
            Pedido en curso
          </div>
          <div className="card" style={{ borderLeft:'3px solid var(--success)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'0.35rem' }}>
              <span style={{ fontWeight:700 }}>{STATUS_LABELS[activeOrder.status]}</span>
              <span style={{ fontWeight:700 }}>{fmt(activeOrder.total_cents)}</span>
            </div>
            <div style={{ fontSize:'0.83rem', color:'var(--gray-600)', marginBottom:'0.35rem' }}>
              <div>Restaurante: <strong>{activeOrder.restaurant_name}</strong></div>
              <div>Retiro: {activeOrder.restaurant_address || '—'}</div>
              <div>Entrega: {activeOrder.customer_address || activeOrder.delivery_address || '—'}</div>
            </div>

            {/* Mapa solo cuando está en camino */}
            {activeOrder.status === 'on_the_way' && (
              <ActiveOrderMap driverPos={myPosition} order={activeOrder} />
            )}

            <div style={{ display:'flex', gap:'0.4rem', marginTop:'0.65rem', flexWrap:'wrap' }}>
              <button className="btn-sm"
                disabled={loadingStatus === 'on_the_way' || activeOrder.status !== 'ready'}
                onClick={() => changeStatus(activeOrder.id, 'on_the_way')}>
                En camino
              </button>
              <button className="btn-sm"
                disabled={loadingStatus === 'delivered' || activeOrder.status !== 'on_the_way'}
                onClick={() => changeStatus(activeOrder.id, 'delivered')}>
                Entregado
              </button>
              {!['on_the_way','delivered','cancelled'].includes(activeOrder.status) && (
                <button className="btn-sm btn-danger" onClick={() => setShowRelease(s => !s)}>
                  Liberar pedido
                </button>
              )}
            </div>

            {showRelease && (
              <div style={{ marginTop:'0.5rem' }}>
                <textarea
                  value={releaseNote}
                  onChange={e => setReleaseNote(e.target.value)}
                  placeholder="Motivo (obligatorio)"
                  rows={2}
                  style={{ width:'100%', boxSizing:'border-box', marginBottom:'0.4rem' }}
                />
                <div style={{ display:'flex', gap:'0.4rem' }}>
                  <button className="btn-sm btn-danger" onClick={releaseOrder}>Confirmar</button>
                  <button className="btn-sm" onClick={() => { setShowRelease(false); setReleaseNote(''); }}>Cancelar</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {!activeOrder && offers.length === 0 && (
        <div style={{ textAlign:'center', padding:'2rem 1rem', color:'var(--gray-400)', fontSize:'0.9rem' }}>
          {availability ? 'En espera de pedidos…' : 'Activa tu disponibilidad para recibir pedidos'}
        </div>
      )}
    </div>
  );
}
