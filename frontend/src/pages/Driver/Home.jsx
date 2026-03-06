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
  cancelled:'Cancelado', pending_driver:'Buscando conductor',
};

function FullMap({ driverPos, activeOrder }) {
  const ref    = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    const center = driverPos ? [driverPos.lat, driverPos.lng] : [20.6597, -103.3496];

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

      if (ref.current._leaflet_id && mapRef.current) {
        if (driverPos) {
          if (mapRef.current.driverMarker) mapRef.current.driverMarker.setLatLng([driverPos.lat, driverPos.lng]);
          else {
            mapRef.current.driverMarker = L.circleMarker([driverPos.lat, driverPos.lng],
              { radius:9, fillColor:'#2563eb', fillOpacity:1, color:'#fff', weight:2 })
              .addTo(mapRef.current.map).bindPopup('Tu posición');
          }
        }
        return;
      }

      const map = L.map(ref.current, { zoomControl:false, attributionControl:false }).setView(center, 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
      L.control.zoom({ position:'bottomright' }).addTo(map);

      const markers = {};
      if (driverPos) {
        markers.driverMarker = L.circleMarker([driverPos.lat, driverPos.lng],
          { radius:9, fillColor:'#2563eb', fillOpacity:1, color:'#fff', weight:2 })
          .addTo(map).bindPopup('Tu posición');
      }
      if (activeOrder?.delivery_lat) {
        markers.destMarker = L.marker([activeOrder.delivery_lat, activeOrder.delivery_lng])
          .addTo(map).bindPopup('Punto de entrega');
      }
      mapRef.current = { map, ...markers };
    }).catch(() => {});
  }, [driverPos?.lat, driverPos?.lng, activeOrder?.id]);

  return <div ref={ref} style={{ position:'fixed', inset:0, zIndex:0, background:'#e8e8e8' }} />;
}

export default function DriverHome() {
  const { auth } = useAuth();
  const [offers, setOffers]           = useState([]);
  const [activeOrder, setActiveOrder] = useState(null);
  const [availability, setAvailability] = useState(false);
  const [loadingOffer, setLoadingOffer] = useState('');
  const [loadingStatus, setLoadingStatus] = useState('');
  const [releaseNote, setReleaseNote]   = useState('');
  const [showRelease, setShowRelease]   = useState(false);
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
      // Pedido en curso = el más antiguo aceptado/activo
      const active = (od.orders || [])
        .filter(o => !['delivered','cancelled'].includes(o.status))
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0] || null;
      setActiveOrder(active);
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
        method:'PATCH', body: JSON.stringify({ isAvailable: !availability })
      }, auth.token);
      setAvailability(r.profile.is_available);
    } catch (e) { setMsg(e.message); }
  }

  async function acceptOffer(orderId) {
    setLoadingOffer(orderId);
    try { await apiFetch(`/drivers/offers/${orderId}/accept`, { method:'POST' }, auth.token); loadData(); }
    catch (e) { setMsg(e.message); }
    finally { setLoadingOffer(''); }
  }

  async function rejectOffer(orderId) {
    setLoadingOffer(orderId);
    try { await apiFetch(`/drivers/offers/${orderId}/reject`, { method:'POST' }, auth.token); loadData(); }
    catch (e) { setMsg(e.message); }
    finally { setLoadingOffer(''); }
  }

  async function changeStatus(orderId, status) {
    setLoadingStatus(status);
    try { await apiFetch(`/orders/${orderId}/status`, { method:'PATCH', body: JSON.stringify({ status }) }, auth.token); loadData(); }
    catch (e) { setMsg(e.message); }
    finally { setLoadingStatus(''); }
  }

  async function doRelease() {
    if (!activeOrder) return;
    try {
      await apiFetch(`/drivers/orders/${activeOrder.id}/release`, {
        method:'POST', body: JSON.stringify({ note: releaseNote })
      }, auth.token);
      setShowRelease(false); setReleaseNote(''); loadData();
    } catch (e) { setMsg(e.message); }
  }

  const panelStyle = {
    position:'absolute', bottom:0, left:0, right:0, zIndex:20,
    background:'#fffffff5', borderRadius:'16px 16px 0 0',
    boxShadow:'0 -4px 20px #0002', padding:'0.75rem',
    maxHeight:'60vh', overflowY:'auto',
  };

  return (
    <div style={{ position:'relative', height:'calc(100dvh - var(--header-h))', overflow:'hidden', margin:'-1rem -1.25rem', marginBottom:'calc(-1rem - var(--nav-h-mobile))' }}>
      <FullMap driverPos={myPosition} activeOrder={activeOrder} />

      {/* Disponibilidad — overlay superior */}
      <div style={{ position:'absolute', top:12, left:12, right:12, zIndex:10 }}>
        <div style={{ background:'#ffffffee', borderRadius:12, padding:'0.55rem 0.85rem', boxShadow:'0 2px 8px #0002', display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
          <div>
            <div style={{ fontWeight:700, fontSize:'0.85rem' }}>
              {availability ? '● Disponible' : '○ No disponible'}
            </div>
            {myPosition && <div style={{ fontSize:'0.72rem', color:'var(--gray-600)' }}>GPS · ±{myPosition.accuracy} m</div>}
            {gpsError   && <div style={{ fontSize:'0.72rem', color:'var(--danger)' }}>{gpsError}</div>}
          </div>
          <button onClick={toggleAvailability} className={availability ? 'btn-primary btn-sm' : 'btn-sm'} style={{ whiteSpace:'nowrap', flexShrink:0 }}>
            {availability ? 'Disponible' : 'No disponible'}
          </button>
        </div>
      </div>

      {msg && (
        <div className="flash flash-error" style={{ position:'absolute', top:70, left:12, right:12, zIndex:10, borderRadius:8 }}>
          {msg}
          <button onClick={() => setMsg('')} style={{ float:'right', border:'none', background:'none', cursor:'pointer', fontWeight:700 }}>✕</button>
        </div>
      )}

      {/* Panel ofertas */}
      {offers.length > 0 && (
        <div style={{ ...panelStyle, borderTop:'2px solid var(--brand)' }}>
          <div style={{ fontSize:'0.72rem', fontWeight:700, letterSpacing:'0.5px', textTransform:'uppercase', color:'var(--brand)', marginBottom:'0.5rem' }}>
            {offers.length} oferta{offers.length > 1 ? 's' : ''} disponible{offers.length > 1 ? 's' : ''}
          </div>
          {offers.map(offer => (
            <div key={offer.id} style={{ background:'#fff', border:'1px solid var(--gray-200)', borderRadius:10, padding:'0.75rem', marginBottom:'0.5rem', borderLeft:'3px solid var(--brand)' }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'0.3rem' }}>
                <span style={{ fontWeight:700 }}>{offer.restaurant_name}</span>
                <span style={{ fontWeight:700 }}>{fmt(offer.total_cents)}</span>
              </div>
              <div style={{ fontSize:'0.8rem', color:'var(--gray-600)', marginBottom:'0.35rem' }}>
                {offer.restaurant_address && <div>Retiro: {offer.restaurant_address}</div>}
                {offer.customer_address   && <div>Entrega: {offer.customer_address}</div>}
              </div>
              {(offer.items||[]).length > 0 && (
                <ul style={{ fontSize:'0.8rem', margin:'0 0 0.4rem 1rem', color:'var(--gray-600)' }}>
                  {offer.items.map(i => <li key={i.menuItemId}>{i.name} × {i.quantity}</li>)}
                </ul>
              )}
              {/* offerCreatedAt es el prop correcto */}
              <OfferCountdown offerCreatedAt={offer.offer_created_at} />
              <div style={{ display:'flex', gap:'0.4rem', marginTop:'0.5rem' }}>
                <button className="btn-primary btn-sm" style={{ flex:1 }} disabled={loadingOffer===offer.id} onClick={() => acceptOffer(offer.id)}>
                  {loadingOffer===offer.id ? 'Aceptando…' : 'Aceptar'}
                </button>
                <button className="btn-sm" disabled={loadingOffer===offer.id} onClick={() => rejectOffer(offer.id)}>Rechazar</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Panel pedido activo — sin mapa inline */}
      {activeOrder && offers.length === 0 && (
        <div style={{ ...panelStyle, borderTop:'2px solid var(--success)' }}>
          <div style={{ fontSize:'0.72rem', fontWeight:700, letterSpacing:'0.5px', textTransform:'uppercase', color:'var(--success)', marginBottom:'0.4rem' }}>Pedido en curso</div>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'0.3rem' }}>
            <span style={{ fontWeight:700 }}>{STATUS_LABELS[activeOrder.status]}</span>
            <span style={{ fontWeight:700 }}>{fmt(activeOrder.total_cents)}</span>
          </div>
          <div style={{ fontSize:'0.82rem', color:'var(--gray-600)', marginBottom:'0.4rem' }}>
            <strong>{activeOrder.restaurant_name}</strong> → {activeOrder.customer_address || activeOrder.delivery_address || '—'}
          </div>
          <div style={{ display:'flex', gap:'0.4rem', flexWrap:'wrap' }}>
            <button className="btn-sm"
              style={{ background: activeOrder.status==='ready' ? 'var(--brand)':'', color: activeOrder.status==='ready' ? '#fff':'' }}
              disabled={loadingStatus==='on_the_way'||activeOrder.status!=='ready'}
              onClick={() => changeStatus(activeOrder.id,'on_the_way')}>En camino</button>
            <button className="btn-sm"
              style={{ background: activeOrder.status==='on_the_way' ? 'var(--success)':'', color: activeOrder.status==='on_the_way' ? '#fff':'' }}
              disabled={loadingStatus==='delivered'||activeOrder.status!=='on_the_way'}
              onClick={() => changeStatus(activeOrder.id,'delivered')}>Entregado</button>
            {!['on_the_way','delivered','cancelled'].includes(activeOrder.status) && (
              <button className="btn-sm btn-danger" onClick={() => setShowRelease(s=>!s)}>Liberar</button>
            )}
          </div>
          {showRelease && (
            <div style={{ marginTop:'0.5rem' }}>
              <textarea value={releaseNote} onChange={e => setReleaseNote(e.target.value)}
                placeholder="Motivo (obligatorio)" rows={2}
                style={{ width:'100%', boxSizing:'border-box', marginBottom:'0.4rem' }} />
              <div style={{ display:'flex', gap:'0.4rem' }}>
                <button className="btn-sm btn-danger" onClick={doRelease}>Confirmar</button>
                <button className="btn-sm" onClick={() => { setShowRelease(false); setReleaseNote(''); }}>Cancelar</button>
              </div>
            </div>
          )}
        </div>
      )}

      {!activeOrder && offers.length === 0 && (
        <div style={{ position:'absolute', bottom:24, left:'50%', transform:'translateX(-50%)', zIndex:10, background:'#ffffffdd', borderRadius:20, padding:'0.5rem 1.25rem', fontSize:'0.85rem', color:'var(--gray-600)', boxShadow:'0 2px 8px #0002', whiteSpace:'nowrap' }}>
          {availability ? 'En espera de pedidos…' : 'Activa tu disponibilidad para recibir pedidos'}
        </div>
      )}
    </div>
  );
}
