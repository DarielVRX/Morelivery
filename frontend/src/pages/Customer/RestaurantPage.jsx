import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';

function ensureLeafletCSS() {
  if (document.getElementById('leaflet-css')) return;
  const lnk = document.createElement('link');
  lnk.id = 'leaflet-css';
  lnk.rel = 'stylesheet';
  lnk.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  document.head.appendChild(lnk);
}


function ManualPinMap({ initialPos, mapRef, onConfirm, onCancel }) {
  const containerRef = useRef(null);
  const pinMarkerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let pinMarker = null;
    let map = null;

    import('leaflet').then(L => {
      if (!containerRef.current) return;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      ensureLeafletCSS();

      delete L.Icon.Default.prototype._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      const center = initialPos
        ? [initialPos.lat, initialPos.lng]
        : [19.706700, -101.194900]; // Morelia por defecto

      map = L.map(containerRef.current, { zoomControl: true }).setView(center, 15);
      mapRef.current = map;
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap', maxZoom: 19
      }).addTo(map);

      const icon = L.divIcon({
        html: `<div style="font-size:28px;line-height:1;filter:drop-shadow(0 2px 4px #0005)">📌</div>`,
        iconSize: [28, 28], iconAnchor: [14, 28], className: ''
      });

      pinMarker = L.marker(center, { icon, draggable: true }).addTo(map);
      pinMarkerRef.current = pinMarker;

      pinMarker.on('dragend', () => {
        const ll = pinMarker.getLatLng();
        pinMarker.setLatLng(ll);
      });

      map.on('click', (e) => {
        pinMarker.setLatLng(e.latlng);
      });
    });

    return () => {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      pinMarkerRef.current = null;
    };
  }, []); // solo al montar

  async function handleConfirm() {
    if (!mapRef.current || !pinMarkerRef.current) return;
    const ll = pinMarkerRef.current.getLatLng();
    if (!ll) return;

    let result = { lat: ll.lat, lng: ll.lng, label: null,
      postalCode: null, estado: null, ciudad: null,
      colonia: null, calle: null };
      try {
        const r = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${ll.lat}&lon=${ll.lng}&format=json&addressdetails=1&countrycodes=mx`,
          { headers: { 'Accept-Language': 'es' } }
        );
        const data = await r.json();
        const a = data.address || {};

        result.postalCode = a.postcode || null;
        result.estado     = a.state || null;
        result.ciudad     = a.city || a.town || a.municipality || a.county || null;
        result.colonia    = a.suburb || a.neighbourhood || a.quarter || null;
        result.calle      = [a.road, a.house_number].filter(Boolean).join(' ') || null;
        result.label      = [result.calle, result.colonia, result.ciudad]
        .filter(Boolean).join(', ') || data.display_name?.split(',').slice(0,3).join(',') || null;
      } catch (_) {}

      onConfirm(result);
  }

  return (
    <div style={{ marginTop:'0.5rem', borderRadius:8, overflow:'hidden', border:'1px solid var(--gray-200)' }}>
      <div ref={containerRef} style={{ height:220, width:'100%' }} />
      <div style={{ display:'flex', gap:'0.5rem', padding:'0.5rem', background:'#f9fafb' }}>
        <button
          type="button"
          className="btn-primary btn-sm"
          style={{ flex:1 }}
          onClick={handleConfirm}>
          Confirmar ubicación
        </button>
        <button
          type="button"
          className="btn-sm"
          style={{ flex:1 }}
          onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

function fmt(cents) { return `$${((cents ?? 0) / 100).toFixed(2)}`; }

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
    Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function ProductImage({ src, name }) {
  const [err, setErr] = useState(false);
  if (!src || err) {
    return (
      <div style={{ width:68, height:68, borderRadius:6, background:'var(--gray-100)', border:'1px solid var(--gray-200)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="1.5">
          <circle cx="12" cy="12" r="9"/>
          <path d="M7 14c0-2.8 2.2-5 5-5s5 2.2 5 5"/>
          <path d="M9 9h.01M15 9h.01"/>
        </svg>
      </div>
    );
  }
  return (
    <img
      src={src} alt={name}
      onError={() => setErr(true)}
      style={{ width:68, height:68, borderRadius:6, objectFit:'cover', border:'1px solid var(--gray-200)', flexShrink:0 }}
    />
  );
}

export default function RestaurantPage() {
  const { id } = useParams();
  const { auth } = useAuth();
  const navigate  = useNavigate();
  const [restaurant, setRestaurant] = useState(null);
  const [menu, setMenu]             = useState([]);
  const [selectedItems, setSelectedItems] = useState({});
  const [loading, setLoading]       = useState(true);
  const [msg, setMsg]               = useState('');
  const [ordering, setOrdering]     = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('cash'); // 'cash' por defecto
  const [tipCents, setTipCents]           = useState(0);      // Propina por defecto

  const isCustomer  = auth.user?.role === 'customer';
  const hasAddress  = Boolean(auth.user?.address && auth.user.address !== 'address-pending');
  const homeLatNum = Number(auth.user?.home_lat);
  const homeLngNum = Number(auth.user?.home_lng);
  const hasHomePin  = Number.isFinite(homeLatNum) && Number.isFinite(homeLngNum);

  // Ubicación actual del customer via GPS
  const [currentPos,   setCurrentPos]   = useState(null);  // { lat, lng }
  const [gpsError,     setGpsError]     = useState('');
  // 'current' = GPS, 'home' = pin Casa
  const [deliveryMode, setDeliveryMode] = useState('current');
  const [manualPos,    setManualPos]    = useState(null); // { lat, lng } elegido en mapa manual
  const [showManualMap, setShowManualMap] = useState(false);
  const manualMapRef = useRef(null); // instancia del mapa Leaflet manual

  useEffect(() => {
    if (!isCustomer) return;
    if (!navigator.geolocation) { setGpsError('GPS no disponible'); return; }
    navigator.geolocation.getCurrentPosition(
      pos => setCurrentPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      ()  => setGpsError('No se pudo obtener tu ubicación actual'),
      { timeout: 8000, maximumAge: 60000 }
    );
  }, [isCustomer]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [restData, menuData] = await Promise.all([
          apiFetch(`/restaurants/${id}`),
                                                       apiFetch(`/restaurants/${id}/menu`)
        ]);
        setRestaurant(restData.restaurant);
        setMenu((menuData.menu || []).filter(i => i.is_available !== false));
      } catch (e) {
        setMsg('Error cargando la tienda');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  const subtotal     = Object.entries(selectedItems).reduce((sum, [menuItemId, qty]) => {
    const item = menu.find(i => i.id === menuItemId);
    return sum + (item ? item.price_cents * Number(qty) : 0);
  }, 0);
  const serviceFee   = Math.round(subtotal * 0.05);
  const deliveryFee  = Math.round(subtotal * 0.10);
  const total        = subtotal + serviceFee + deliveryFee + tipCents; // lo que paga el cliente

  function adjust(itemId, delta) {
    setSelectedItems(p => ({ ...p, [itemId]: Math.max(0, (Number(p[itemId]) || 0) + delta) }));
  }

  async function sendProposal() {
    if (!activeOrder) return;
    if (!proposalNote.trim()) { setMsg('Escribe tu propuesta'); return; }
    try {
      // El cliente envía su propia nota — se guarda como restaurant_note para que el restaurante la vea
      // No requiere confirmación: es solo comunicación directa
      await apiFetch(`/orders/${activeOrder.id}/messages`, {
        method:'POST',
        body: JSON.stringify({ text: `[PROPUESTA CLIENTE] ${proposalNote.trim()}` })
      }, auth.token);
      setProposalNote(''); setShowProposal(false);
      setMsg('Propuesta enviada al restaurante');
      setTimeout(()=>setMsg(''),4000);
    } catch (e) { setMsg(e.message); }
  }

  async function createOrder() {
    if (!auth.token) return navigate('/login');
    if (!isCustomer)  return setMsg('Solo los clientes pueden hacer pedidos');
    if (!hasAddress)  return setMsg('Guarda tu dirección antes de hacer un pedido');

    const items = Object.entries(selectedItems)
      .filter(([, qty]) => Number(qty) > 0)
      .map(([menuItemId, quantity]) => ({ menuItemId, quantity: Number(quantity) }));
    if (items.length === 0) return setMsg('Selecciona al menos un producto');

    setOrdering(true);
    try {
      const orderBody = { restaurantId: id, items, payment_method: paymentMethod, tip_cents: tipCents };

      if (deliveryMode === 'manual' && manualPos?.label) {
        orderBody.delivery_address = manualPos.label;
      } else if (deliveryMode === 'home' && auth.user?.address) {
        orderBody.delivery_address = auth.user.address;
      }
      // Elegir coordenadas según modo de entrega
      if (deliveryMode === 'home' && hasHomePin) {
        orderBody.delivery_lat = homeLatNum;
        orderBody.delivery_lng = homeLngNum;
      } else if (currentPos) {
        orderBody.delivery_lat = currentPos.lat;
        orderBody.delivery_lng = currentPos.lng;
      }
      // Usar coords manuales si se eligieron
      if (deliveryMode === 'manual' && manualPos) {
        orderBody.delivery_lat = manualPos.lat;
        orderBody.delivery_lng = manualPos.lng;
      }
      await apiFetch('/orders', { method:'POST', body: JSON.stringify(orderBody) }, auth.token);
      setMsg('');
      setSelectedItems({});
      setTimeout(() => navigate('/customer/pedidos'), 800);
    } catch (e) { setMsg(e.message); }
    finally { setOrdering(false); }
  }

  if (loading) return <div style={{ padding:'2rem', textAlign:'center', color:'var(--gray-400)' }}>Cargando…</div>;

  // Coordenadas de entrega activas según modo
  const activeDeliveryPos =
    deliveryMode === 'manual'  ? manualPos :
    deliveryMode === 'home'    ? (hasHomePin ? { lat: homeLatNum, lng: homeLngNum } : null) :
    currentPos;

  // Distancia customer→restaurant (solo cuando ambos tienen coords)
  const restLat = Number.isFinite(Number(restaurant?.lat)) ? Number(restaurant.lat) : null;
  const restLng = Number.isFinite(Number(restaurant?.lng)) ? Number(restaurant.lng) : null;
  const distKm = (activeDeliveryPos && restLat !== null && restLng !== null)
    ? haversineKm(activeDeliveryPos.lat, activeDeliveryPos.lng, restLat, restLng)
    : null;
  const tooFar = distKm !== null && distKm > 5;
  const distanceError = tooFar
    ? `Esta tienda está a ${distKm.toFixed(1)} km. Solo se aceptan pedidos dentro de 5 km.`
    : null;
  const missingCoordsError = restLat === null || restLng === null
    ? 'Esta tienda no tiene coordenadas configuradas. No se pueden calcular distancias por ahora.'
    : (!activeDeliveryPos ? 'No se pudo obtener tu ubicación de entrega.' : null);

  // Logger de distancia — visible en consola del navegador
  if (typeof window !== 'undefined') {
    const tag = '[distancia]';
    console.log(tag, 'restaurant.lat:', restaurant?.lat, '| restaurant.lng:', restaurant?.lng);
    console.log(tag, 'activeDeliveryPos:', activeDeliveryPos);
    console.log(tag, 'distKm:', distKm, '| tooFar:', tooFar);
  }

  const isClosed = restaurant?.is_open === false;
  const canOrder = isCustomer && hasAddress && !isClosed && !tooFar && !missingCoordsError;

  return (
    <div style={{ backgroundColor:'#fff9f8', minHeight:'100vh', padding:'1rem' }}>
      {/* Volver */}
      <button
        onClick={() => navigate(-1)}
        style={{ background:'none', border:'none', color:'var(--brand)', cursor:'pointer',
          padding:0, fontSize:'0.875rem', marginBottom:'1rem', fontWeight:600,
          display:'flex', alignItems:'center', gap:'0.3rem' }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Volver
      </button>

      {/* Cabecera restaurante */}
      <div style={{ margin:'-1rem -1rem 1.25rem', padding:'0.875rem 1rem 1rem',
        background:'linear-gradient(135deg,var(--brand) 0%,#c0546a 100%)' }}>
      <div style={{ display:'flex', gap:'0.875rem', alignItems:'flex-start' }}>
        {/* Foto de perfil de la tienda */}
        {restaurant?.profile_photo
          ? <img src={restaurant.profile_photo} alt={restaurant?.name}
              style={{ width:60, height:60, borderRadius:'50%', objectFit:'cover', border:'2px solid rgba(255,255,255,0.6)', flexShrink:0 }} />
          : <div style={{ width:60, height:60, borderRadius:'50%', background:'var(--gray-100)', border:'2px solid rgba(255,255,255,0.4)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="1.5"><circle cx="12" cy="12" r="9"/><path d="M7 16c0-2.8 2.2-5 5-5s5 2.2 5 5"/><circle cx="12" cy="10" r="2"/></svg>
            </div>
        }
        <div style={{ flex:1 }}>
        <h2 style={{ fontSize:'1.2rem', fontWeight:800, margin:'0 0 0.2rem', color:'#fff' }}>{restaurant?.name}</h2>
        {restaurant?.address && (
          <p style={{ color:'rgba(255,255,255,0.85)', fontSize:'0.85rem', margin:'0 0 0.35rem' }}>{restaurant.address}</p>
        )}
        {restaurant?.rating_avg != null && restaurant.rating_count > 0 && (
          <div style={{ display:'inline-flex', alignItems:'center', gap:'0.25rem', marginBottom:'0.35rem' }}>
            <span style={{ color:'#fbbf24', fontSize:'0.85rem' }}>★</span>
            <span style={{ fontSize:'0.82rem', fontWeight:700, color:'#fff' }}>
              {Number(restaurant.rating_avg).toFixed(1)}
            </span>
            <span style={{ fontSize:'0.75rem', color:'rgba(255,255,255,0.7)' }}>
              ({restaurant.rating_count} {restaurant.rating_count === 1 ? 'reseña' : 'reseñas'})
            </span>
          </div>
        )}
        <span style={{
          fontSize:'0.75rem', fontWeight:700,
          color: isClosed ? 'rgba(255,255,255,0.6)' : '#fff',
          background: isClosed ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.2)',
          border: `1px solid ${isClosed ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.5)'}`,
          borderRadius:10, padding:'0.15rem 0.55rem',
        }}>
          {isClosed ? '● Cerrado' : '● Abierto'}
        </span>
        {isClosed && (
          <p style={{ fontSize:'0.82rem', color:'rgba(255,255,255,0.8)', marginTop:'0.5rem' }}>
            Cerrada · puedes ver el menú pero no hacer pedidos.
          </p>
        )}
        </div>{/* fin contenido */}
      </div>{/* fin flex */}
      </div>{/* fin fondo rosado */}

      {msg && <p className="flash flash-error" style={{ marginBottom:'0.75rem' }}>{msg}</p>}

      {/* Menú */}
      <h3 style={{ fontSize:'0.95rem', fontWeight:800, color:'var(--gray-700)',
        margin:'0 0 0.75rem', letterSpacing:'0.01em' }}>Menú</h3>
      {menu.length === 0 ? (
        <p style={{ color:'var(--gray-600)' }}>Sin productos disponibles.</p>
      ) : (
        <ul style={{ listStyle:'none', padding:0, margin:0 }}>
          {menu.map(item => {
            const qty = Number(selectedItems[item.id]) || 0;
            return (
              <li key={item.id} style={{
                display:'flex', gap:'0.75rem', padding:'0.75rem',
                border:'1px solid var(--gray-200)', borderRadius:'var(--radius)',
                marginBottom:'0.5rem', background:'#fff', alignItems:'center',
                opacity: isClosed ? 0.7 : 1,
              }}>
                <ProductImage src={item.image_url} name={item.name} />
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:700, fontSize:'0.95rem' }}>{item.name}</div>
                  {item.description && <div style={{ color:'var(--gray-600)', fontSize:'0.82rem', margin:'0.1rem 0' }}>{item.description}</div>}
                  <div style={{ fontWeight:700, marginTop:'0.2rem' }}>{fmt(item.price_cents)}</div>
                </div>
                {/* Controles +/- solo si puede pedir */}
                {isCustomer && !isClosed && (
                  <div className="qty-control" style={{ flexShrink:0 }}>
                    <button className="qty-btn" disabled={qty === 0} onClick={() => adjust(item.id, -1)}>−</button>
                    <span className="qty-num">{qty}</span>
                    <button className="qty-btn add" onClick={() => adjust(item.id, 1)}>+</button>
                  </div>
                )}
                {isCustomer && isClosed && (
                  <span style={{ fontSize:'0.75rem', color:'var(--gray-400)', flexShrink:0 }}>No disponible</span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Desglose — debajo del menú, como contenido normal */}
      {isCustomer && total > 0 && !isClosed && (
        <div style={{ marginTop:'1rem', padding:'0.875rem', background:'var(--gray-50,#f9fafb)', borderRadius:10, border:'1px solid var(--gray-100)' }}>
          {/* Método de pago */}
          <p style={{ fontSize:'0.75rem', fontWeight:700, color:'var(--gray-500)', marginBottom:'0.35rem', textTransform:'uppercase', letterSpacing:'0.04em' }}>Método de pago</p>
          <div style={{ display:'flex', gap:'0.4rem', marginBottom:'0.75rem' }}>
            {[['cash','Efectivo'],['card','Tarjeta'],['spei','SPEI']].map(([val,label]) => (
              <button key={val} onClick={() => setPaymentMethod(val)}
                style={{ flex:1, padding:'0.35rem', cursor:'pointer',
                  border:`2px solid ${paymentMethod===val?'var(--brand)':'var(--gray-200)'}`,
                  borderRadius:6, background: paymentMethod===val?'var(--brand-light)':'#fff',
                  fontWeight: paymentMethod===val?700:400, fontSize:'0.8rem' }}>
                {label}
              </button>
            ))}
          </div>
          {/* Agradecimiento */}
          <p style={{ fontSize:'0.75rem', fontWeight:700, color:'var(--gray-500)', marginBottom:'0.35rem', textTransform:'uppercase', letterSpacing:'0.04em' }}>Agradecimiento al conductor</p>
          <div style={{ display:'flex', gap:'0.25rem', flexWrap:'wrap', marginBottom:'0.75rem', alignItems:'center' }}>
            {[{pct:0,label:'—'},{pct:5,label:'5%'},{pct:10,label:'10%'},{pct:20,label:'20%'}].map(({pct,label}) => {
              const v = pct===0 ? 0 : Math.round(subtotal * pct / 100);
              const sel = tipCents === v;
              return (
                <button key={pct} onClick={() => setTipCents(v)}
                  style={{ padding:'0.25rem 0.5rem', cursor:'pointer',
                    border:`1px solid ${sel?'var(--success)':'var(--gray-200)'}`,
                    borderRadius:6, background: sel?'#f0fdf4':'#fff',
                    color: sel?'var(--success)':'var(--gray-600)',
                    fontSize:'0.78rem', fontWeight: sel?700:400 }}>
                  {label}{pct>0&&subtotal>0?` (${fmt(v)})`:''}
                </button>
              );
            })}
            <input
              type="text" inputMode="numeric" pattern="[0-9]*" placeholder="$ otro"
              onBlur={e => {
                const val = e.target.value.replace(/\D/g,'');
                const cents = Math.round(Number(val||0)*100);
                if (cents >= 0) setTipCents(cents);
                e.target.value = '';
              }}
              style={{ width:62, fontSize:'0.75rem', padding:'0.25rem 0.4rem', border:'1px solid var(--gray-200)', borderRadius:6 }}
            />
          </div>
          {/* Desglose de tarifas */}
          <div style={{ fontSize:'0.8rem', color:'var(--gray-500)', borderTop:'1px solid var(--gray-100)', paddingTop:'0.5rem' }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'0.15rem' }}><span>Subtotal</span><span>{fmt(subtotal)}</span></div>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'0.15rem' }}><span>Tarifa de servicio (5%)</span><span>{fmt(serviceFee)}</span></div>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'0.15rem' }}><span>Tarifa de envío (10%)</span><span>{fmt(deliveryFee)}</span></div>
            {tipCents > 0 && (
              <div style={{ display:'flex', justifyContent:'space-between', color:'var(--success)', marginBottom:'0.15rem' }}>
                <span>Agradecimiento</span><span>+{fmt(tipCents)}</span>
              </div>
            )}
            <div style={{ display:'flex', justifyContent:'space-between', fontWeight:800, fontSize:'0.875rem', marginTop:'0.35rem', paddingTop:'0.35rem', borderTop:'1px solid var(--gray-200)' }}>
              <span>Total</span><span>{fmt(total)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Botón sticky */}
      {isCustomer && total > 0 && !isClosed && (
        <div style={{ position:'sticky', bottom:0, background:'#fff', borderTop:'1px solid var(--gray-100)', padding:'0.75rem 0', marginTop:'0.75rem' }}>
          {!hasAddress && (
            <p style={{ fontSize:'0.82rem', color:'var(--warn)', marginBottom:'0.4rem', fontWeight:600 }}>
              Guarda tu dirección en Perfil antes de pedir
            </p>
          )}
          {/* Selector de destino de entrega */}
          <div style={{ marginBottom:'0.5rem' }}>
            <div style={{ fontSize:'0.78rem', color:'var(--gray-500)', marginBottom:'0.3rem', fontWeight:600 }}>
              Enviar a:
            </div>
            <div style={{ display:'flex', gap:'0.4rem', flexWrap:'wrap' }}>
              <button
                type="button"
                onClick={() => setDeliveryMode('current')}
                style={{
                  padding:'0.3rem 0.75rem', borderRadius:6, fontSize:'0.78rem', cursor:'pointer',
                  border: `1px solid ${deliveryMode==='current' ? 'var(--brand)' : 'var(--gray-200)'}`,
                  background: deliveryMode==='current' ? 'var(--brand-light)' : '#fff',
                  color: deliveryMode==='current' ? 'var(--brand)' : 'var(--gray-600)',
                  fontWeight: deliveryMode==='current' ? 700 : 400,
                }}>
                📍 Ubicación actual{currentPos ? '' : gpsError ? ' (no disp.)' : ' (buscando…)'}
              </button>
              {hasHomePin && (
                <button
                  type="button"
                  onClick={() => { setDeliveryMode('home'); setShowManualMap(false); }}
                  style={{
                    padding:'0.3rem 0.75rem', borderRadius:6, fontSize:'0.78rem', cursor:'pointer',
                    border: `1px solid ${deliveryMode==='home' ? 'var(--brand)' : 'var(--gray-200)'}`,
                    background: deliveryMode==='home' ? 'var(--brand-light)' : '#fff',
                    color: deliveryMode==='home' ? 'var(--brand)' : 'var(--gray-600)',
                    fontWeight: deliveryMode==='home' ? 700 : 400,
                  }}>
                  🏠 Casa
                </button>
              )}
              <button
                type="button"
                onClick={() => { setDeliveryMode('manual'); setShowManualMap(true); }}
                style={{
                  padding:'0.3rem 0.75rem', borderRadius:6, fontSize:'0.78rem', cursor:'pointer',
                  border: `1px solid ${deliveryMode==='manual' ? 'var(--brand)' : 'var(--gray-200)'}`,
                  background: deliveryMode==='manual' ? 'var(--brand-light)' : '#fff',
                  color: deliveryMode==='manual' ? 'var(--brand)' : 'var(--gray-600)',
                  fontWeight: deliveryMode==='manual' ? 700 : 400,
                }}>
                📌 Manual
              </button>
            </div>
            {deliveryMode === 'home' && auth.user?.address && (
              <div style={{ fontSize:'0.72rem', color:'var(--gray-400)', marginTop:'0.25rem' }}>
                {auth.user.address}
              </div>
            )}
            {deliveryMode === 'manual' && manualPos && (
              <div style={{ fontSize:'0.72rem', color:'var(--gray-400)', marginTop:'0.25rem' }}>
                📌 {manualPos.label || `${manualPos.lat.toFixed(5)}, ${manualPos.lng.toFixed(5)}`}
              </div>
            )}
            {/* Mini-mapa para ubicación manual */}
            {deliveryMode === 'manual' && showManualMap && (
              <ManualPinMap
                initialPos={currentPos || (hasHomePin ? { lat: homeLatNum, lng: homeLngNum } : null)}
                mapRef={manualMapRef}
                onConfirm={(pos) => {
                  setManualPos(pos);
                  setShowManualMap(false);
                  // Si quieres auto-rellenar el perfil:
                  if (pos.postalCode) setPostalCode(pos.postalCode);
                  if (pos.estado)     setEstado(pos.estado);
                  if (pos.ciudad)     setCiudad(pos.ciudad);
                  if (pos.colonia)    setColonia(pos.colonia);
                }}
                onCancel={() => { setShowManualMap(false); if (!manualPos) setDeliveryMode('current'); }}
              />
            )}
          </div>
          {distanceError && (
            <p style={{ fontSize:'0.82rem', color:'var(--error,#dc2626)', marginBottom:'0.4rem', fontWeight:600 }}>
              {distanceError}
            </p>
          )}
          {missingCoordsError && (
            <p style={{ fontSize:'0.82rem', color:'var(--error,#dc2626)', marginBottom:'0.4rem', fontWeight:600 }}>
              {missingCoordsError}
            </p>
          )}
          {deliveryMode === 'manual' && !manualPos && (
            <p style={{ fontSize:'0.82rem', color:'var(--warn)', marginBottom:'0.4rem' }}>
              Confirma tu ubicación en el mapa para continuar
            </p>
          )}
          <button className="btn-primary" style={{ width:'100%' }} disabled={!canOrder || ordering || (deliveryMode==='manual' && !manualPos)} onClick={createOrder}>
            {ordering ? 'Procesando…' : `Hacer pedido · ${fmt(total)}`}
          </button>
        </div>
      )}

      {/* Si no es cliente */}
      {!isCustomer && auth.user && (
        <p style={{ color:'var(--gray-400)', fontSize:'0.85rem', marginTop:'1rem' }}>
          Solo los clientes pueden hacer pedidos.
        </p>
      )}
      {!auth.user && (
        <div style={{ marginTop:'1.5rem' }}>
          <button className="btn-primary" onClick={() => navigate('/login')}>Iniciar sesión para pedir</button>
        </div>
      )}
    </div>
  );
}
