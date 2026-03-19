import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';

// ── Leaflet helpers ───────────────────────────────────────────────────────────
function ensureLeafletCSS() {
  if (document.getElementById('leaflet-css')) return;
  const lnk = document.createElement('link');
  lnk.id = 'leaflet-css'; lnk.rel = 'stylesheet';
  lnk.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  document.head.appendChild(lnk);
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371, toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2-lat1), dLng = toRad(lng2-lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function fmt(cents) { return `$${((cents ?? 0) / 100).toFixed(2)}`; }

// ── Manual pin map ────────────────────────────────────────────────────────────
function ManualPinMap({ initialPos, mapRef, onConfirm, onCancel }) {
  const containerRef  = useRef(null);
  const pinMarkerRef  = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;
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
      const center = initialPos ? [initialPos.lat, initialPos.lng] : [19.706700, -101.194900];
      const map = L.map(containerRef.current, { zoomControl: true }).setView(center, 15);
      mapRef.current = map;
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap', maxZoom: 19,
      }).addTo(map);
      const icon = L.divIcon({
        html: `<div style="font-size:28px;line-height:1;filter:drop-shadow(0 2px 4px #0005)">📌</div>`,
        iconSize: [28, 28], iconAnchor: [14, 28], className: '',
      });
      const marker = L.marker(center, { icon, draggable: true }).addTo(map);
      pinMarkerRef.current = marker;
      map.on('click', e => marker.setLatLng(e.latlng));
    });
    return () => {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, []);

  async function handleConfirm() {
    if (!pinMarkerRef.current) return;
    const ll = pinMarkerRef.current.getLatLng();
    let result = { lat: ll.lat, lng: ll.lng, label: null };
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${ll.lat}&lon=${ll.lng}&format=json&addressdetails=1&countrycodes=mx`,
        { headers: { 'Accept-Language': 'es' } }
      );
      const data = await r.json();
      const a = data.address || {};
      const parts = [
        [a.road, a.house_number].filter(Boolean).join(' '),
        a.suburb || a.neighbourhood || a.quarter,
        a.city || a.town || a.municipality,
      ].filter(Boolean);
      result.label = parts.join(', ') || data.display_name?.split(',').slice(0,3).join(',') || null;
    } catch (_) {}
    onConfirm(result);
  }

  return (
    <div style={{ marginTop:'0.5rem', borderRadius:'var(--radius)', overflow:'hidden', border:'1px solid var(--border)' }}>
      <div ref={containerRef} style={{ height:220, width:'100%' }} />
      <div style={{ display:'flex', gap:'0.5rem', padding:'0.5rem', background:'var(--bg-sunken)' }}>
        <button className="btn-primary btn-sm" style={{ flex:1 }} onClick={handleConfirm}>
          Confirmar ubicación
        </button>
        <button className="btn-sm" style={{ flex:1 }} onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

// ── Product image ─────────────────────────────────────────────────────────────
function ProductImage({ src, name }) {
  const [err, setErr] = useState(false);
  if (!src || err) return (
    <div className="product-img-placeholder">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="9"/>
        <path d="M7 14c0-2.8 2.2-5 5-5s5 2.2 5 5"/>
        <path d="M9 9h.01M15 9h.01"/>
      </svg>
    </div>
  );
  return (
    <img src={src} alt={name} onError={() => setErr(true)}
      className="product-img" />
  );
}

// ── Star picker component ─────────────────────────────────────────────────────
function StarPicker({ value, onChange, label }) {
  return (
    <div style={{ marginBottom:'0.5rem' }}>
      <div style={{ fontSize:'0.78rem', color:'var(--text-secondary)', marginBottom:'0.25rem' }}>{label}</div>
      <div style={{ display:'flex', gap:'4px' }}>
        {[1,2,3,4,5].map(s => (
          <button key={s} onClick={() => onChange(s)}
            style={{ fontSize:'1.4rem', background:'none', border:'none', cursor:'pointer',
              color: s <= value ? '#f59e0b' : 'var(--border)', padding:0, minHeight:'unset', lineHeight:1 }}>
            ★
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function RestaurantPage() {
  const { id }     = useParams();
  const { auth }   = useAuth();
  const navigate   = useNavigate();

  const [restaurant,    setRestaurant]    = useState(null);
  const [menu,          setMenu]          = useState([]);
  const [selectedItems, setSelectedItems] = useState({});
  const [loading,       setLoading]       = useState(true);
  const [msg,           setMsg]           = useState('');
  const [ordering,      setOrdering]      = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [tipCents,      setTipCents]      = useState(0);

  // Rating state
  const [ratingOrder,    setRatingOrder]    = useState(null);
  const [ratingRestStar, setRatingRestStar] = useState(0);
  const [ratingDrvStar,  setRatingDrvStar]  = useState(0);
  const [ratingComment,  setRatingComment]  = useState('');
  const [ratingLoading,  setRatingLoading]  = useState(false);
  const [ratedOrders,    setRatedOrders]    = useState(new Set());

  const isCustomer  = auth.user?.role === 'customer';
  const hasAddress  = Boolean(auth.user?.address && auth.user.address !== 'address-pending');
  const homeLatNum  = Number(auth.user?.home_lat);
  const homeLngNum  = Number(auth.user?.home_lng);
  const hasHomePin  = Number.isFinite(homeLatNum) && Number.isFinite(homeLngNum);

  // Menu sort
  const [sortBy, setSortBy] = useState('default'); // 'default' | 'asc' | 'desc'

  // Delivery location — reads from Layout GPS panel or GPS/home fallback
  const [currentPos,    setCurrentPos]    = useState(() => {
    try {
      const stored = sessionStorage.getItem('morelivery_delivery_pos');
      if (stored) return JSON.parse(stored);
    } catch (_) {}
    return null;
  });
  const [gpsError,      setGpsError]      = useState('');
  const [deliveryMode,  setDeliveryMode]  = useState(() => {
    try { return sessionStorage.getItem('morelivery_delivery_pos') ? 'confirmed' : 'current'; }
    catch (_) { return 'current'; }
  });
  const [manualPos,     setManualPos]     = useState(null);
  const [showManualMap, setShowManualMap] = useState(false);
  const manualMapRef = useRef(null);

  // GPS — skip if Layout panel already provided a confirmed location
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem('morelivery_delivery_pos');
      if (stored) return; // GPS panel already confirmed a location
    } catch (_) {}
    if (!isCustomer || !navigator.geolocation) { setGpsError('GPS no disponible'); return; }
    navigator.geolocation.getCurrentPosition(
      pos => setCurrentPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      ()  => setGpsError('No se pudo obtener tu ubicación'),
      { timeout: 8000, maximumAge: 60000 }
    );
  }, [isCustomer]);

  // Load restaurant + menu
  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [restData, menuData] = await Promise.all([
          apiFetch(`/restaurants/${id}`),
          apiFetch(`/restaurants/${id}/menu`),
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

  // Rating submit
  async function submitRating() {
    if (!ratingOrder || ratingRestStar < 1) return;
    setRatingLoading(true);
    try {
      await apiFetch(`/orders/${ratingOrder.id}/rating`, {
        method: 'POST',
        body: JSON.stringify({
          restaurant_stars: ratingRestStar,
          driver_stars:     ratingDrvStar > 0 ? ratingDrvStar : undefined,
          comment:          ratingComment.trim() || undefined,
        }),
      }, auth.token);
      setRatedOrders(prev => new Set([...prev, ratingOrder.id]));
      setRatingOrder(null); setRatingRestStar(0); setRatingDrvStar(0); setRatingComment('');
      setMsg('¡Gracias por tu calificación!');
      setTimeout(() => setMsg(''), 4000);
    } catch (e) {
      setMsg(e.message);
    } finally {
      setRatingLoading(false);
    }
  }

  // Order totals
  const subtotal    = Object.entries(selectedItems).reduce((sum, [itemId, qty]) => {
    const item = menu.find(i => i.id === itemId);
    return sum + (item ? item.price_cents * Number(qty) : 0);
  }, 0);
  const serviceFee  = Math.round(subtotal * 0.05);
  const deliveryFee = Math.round(subtotal * 0.10);
  const total       = subtotal + serviceFee + deliveryFee + tipCents;

  function adjust(itemId, delta) {
    setSelectedItems(p => ({ ...p, [itemId]: Math.max(0, (Number(p[itemId]) || 0) + delta) }));
  }

  async function createOrder() {
    if (!auth.token) return navigate('/customer/login');
    if (!isCustomer) return setMsg('Solo los clientes pueden hacer pedidos');
    if (!hasAddress) return setMsg('Guarda tu dirección antes de hacer un pedido');

    const items = Object.entries(selectedItems)
      .filter(([, qty]) => Number(qty) > 0)
      .map(([menuItemId, quantity]) => ({ menuItemId, quantity: Number(quantity) }));
    if (items.length === 0) return setMsg('Selecciona al menos un producto');

    setOrdering(true);
    try {
      const body = { restaurantId: id, items, payment_method: paymentMethod, tip_cents: tipCents };

      if (deliveryMode === 'manual' && manualPos) {
        body.delivery_address = manualPos.label || `${manualPos.lat.toFixed(5)}, ${manualPos.lng.toFixed(5)}`;
        body.delivery_lat = manualPos.lat;
        body.delivery_lng = manualPos.lng;
      } else if (deliveryMode === 'home' && hasHomePin) {
        body.delivery_address = auth.user.address;
        body.delivery_lat = homeLatNum;
        body.delivery_lng = homeLngNum;
      } else if (currentPos) {
        body.delivery_lat = currentPos.lat;
        body.delivery_lng = currentPos.lng;
      }

      await apiFetch('/orders', { method: 'POST', body: JSON.stringify(body) }, auth.token);
      setMsg('');
      setSelectedItems({});
      setTimeout(() => navigate('/customer'), 800);
    } catch (e) {
      setMsg(e.message);
    } finally {
      setOrdering(false);
    }
  }

  // Distance checks
  const restLat = Number.isFinite(Number(restaurant?.lat)) ? Number(restaurant.lat) : null;
  const restLng = Number.isFinite(Number(restaurant?.lng)) ? Number(restaurant.lng) : null;
  // Priority: GPS panel confirmed > manual > home > GPS
  const activePos =
    (deliveryMode === 'confirmed' && currentPos) ? currentPos :
    deliveryMode === 'manual'  ? manualPos :
    deliveryMode === 'home'    ? (hasHomePin ? { lat: homeLatNum, lng: homeLngNum } : null) :
    currentPos;
  const distKm = (activePos && restLat !== null && restLng !== null)
    ? haversineKm(activePos.lat, activePos.lng, restLat, restLng) : null;
  const tooFar = distKm !== null && distKm > 5;
  const isClosed = restaurant?.is_open === false;
  const canOrder = isCustomer && hasAddress && !isClosed && !tooFar && restLat !== null;

  const itemCount = Object.values(selectedItems).reduce((s, q) => s + Number(q), 0);

  if (loading) return (
    <div style={{ padding:'3rem', textAlign:'center', color:'var(--text-tertiary)' }}>Cargando…</div>
  );

  return (
    <div style={{ backgroundColor:'var(--bg-base)', minHeight:'100vh' }}>

      {/* Rating modal */}
      {ratingOrder && (
        <div style={{ position:'fixed', inset:0, background:'var(--bg-overlay)', zIndex:999,
          display:'flex', alignItems:'flex-end', justifyContent:'center' }}
          onClick={e => { if (e.target === e.currentTarget) setRatingOrder(null); }}>
          <div style={{ background:'var(--bg-card)', borderRadius:'20px 20px 0 0',
            padding:'1.5rem', width:'100%', maxWidth:480,
            boxShadow:'0 -4px 32px rgba(0,0,0,0.2)' }}>
            <h3 style={{ fontSize:'1rem', fontWeight:800, color:'var(--text-primary)', marginBottom:'1rem' }}>
              Calificar pedido
            </h3>
            <StarPicker value={ratingRestStar} onChange={setRatingRestStar} label="Tienda / Restaurante" />
            {ratingOrder.driver_id && (
              <StarPicker value={ratingDrvStar} onChange={setRatingDrvStar} label="Conductor (opcional)" />
            )}
            <textarea value={ratingComment} onChange={e => setRatingComment(e.target.value)}
              placeholder="Comentario opcional…" rows={2}
              style={{ width:'100%', marginBottom:'0.75rem', fontSize:'0.875rem', resize:'none' }} />
            <div style={{ display:'flex', gap:'0.5rem' }}>
              <button className="btn-primary" style={{ flex:1 }}
                disabled={ratingRestStar < 1 || ratingLoading} onClick={submitRating}>
                {ratingLoading ? 'Enviando…' : 'Enviar calificación'}
              </button>
              <button className="btn-sm" onClick={() => setRatingOrder(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Hero header */}
      <div style={{
        background: restaurant?.profile_photo
          ? 'var(--bg-sunken)'
          : 'var(--promo-gradient)',
        position: 'relative', overflow: 'hidden',
        minHeight: 140,
      }}>
        {restaurant?.profile_photo && (
          <>
            <img src={restaurant.profile_photo} alt={restaurant?.name}
              style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover', opacity:0.35 }} />
            <div style={{ position:'absolute', inset:0,
              background:'linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.7) 100%)' }} />
          </>
        )}
        <div style={{ position:'relative', padding:'1rem 1rem 1.25rem', display:'flex', flexDirection:'column', gap:'0.5rem' }}>
          {/* Back button */}
          <button onClick={() => navigate(-1)}
            style={{ background:'rgba(255,255,255,0.15)', border:'1px solid rgba(255,255,255,0.3)',
              borderRadius:8, color:'#fff', padding:'0.3rem 0.65rem', fontSize:'0.82rem',
              fontWeight:600, cursor:'pointer', alignSelf:'flex-start', minHeight:'unset',
              display:'flex', alignItems:'center', gap:'0.3rem' }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Volver
          </button>

          {/* Restaurant info */}
          <div style={{ display:'flex', gap:'0.875rem', alignItems:'flex-start' }}>
            {restaurant?.profile_photo
              ? <img src={restaurant.profile_photo} alt={restaurant?.name}
                  style={{ width:56, height:56, borderRadius:'50%', objectFit:'cover',
                    border:'2px solid rgba(255,255,255,0.7)', flexShrink:0 }} />
              : <div style={{ width:56, height:56, borderRadius:'50%',
                  background:'rgba(255,255,255,0.2)', border:'2px solid rgba(255,255,255,0.4)',
                  display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                  <span style={{ fontSize:'1.5rem' }}>🏪</span>
                </div>
            }
            <div style={{ flex:1 }}>
              <h2 style={{ fontSize:'1.15rem', fontWeight:900, margin:'0 0 0.2rem', color:'#fff',
                letterSpacing:'-0.02em' }}>{restaurant?.name}</h2>
              {restaurant?.address && (
                <p style={{ color:'rgba(255,255,255,0.8)', fontSize:'0.8rem', margin:'0 0 0.3rem' }}>
                  {restaurant.address}
                </p>
              )}
              <div style={{ display:'flex', gap:'0.5rem', alignItems:'center', flexWrap:'wrap' }}>
                {restaurant?.rating_avg != null && restaurant.rating_count > 0 && (
                  <span style={{ fontSize:'0.78rem', color:'rgba(255,255,255,0.9)',
                    display:'flex', alignItems:'center', gap:'0.2rem' }}>
                    <span style={{ color:'#fbbf24' }}>★</span>
                    {Number(restaurant.rating_avg).toFixed(1)}
                    <span style={{ opacity:0.7 }}>({restaurant.rating_count})</span>
                  </span>
                )}
                {distKm !== null && (
                  <span style={{ fontSize:'0.75rem', color:'rgba(255,255,255,0.8)' }}>
                    📍 {distKm < 1 ? `${Math.round(distKm*1000)}m` : `${distKm.toFixed(1)}km`}
                  </span>
                )}
                <span style={{
                  fontSize:'0.72rem', fontWeight:700,
                  color: isClosed ? 'rgba(255,255,255,0.55)' : '#fff',
                  background: isClosed ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.2)',
                  border:`1px solid ${isClosed ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.5)'}`,
                  borderRadius:10, padding:'0.15rem 0.55rem',
                }}>
                  {isClosed ? '● Cerrado' : '● Abierto'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding:'0.875rem 1rem 6rem' }}>
        {msg && <p className="flash flash-error" style={{ marginBottom:'0.75rem' }}>{msg}</p>}

        {isClosed && (
          <div style={{ background:'var(--bg-raised)', border:'1px solid var(--border)',
            borderRadius:'var(--radius)', padding:'0.75rem', marginBottom:'1rem',
            fontSize:'0.85rem', color:'var(--text-secondary)', textAlign:'center' }}>
            Esta tienda está cerrada. Puedes ver el menú pero no hacer pedidos.
          </div>
        )}

        {tooFar && (
          <div className="flash flash-error" style={{ marginBottom:'0.75rem' }}>
            Esta tienda está a {distKm?.toFixed(1)} km. Solo se aceptan pedidos dentro de 5 km.
          </div>
        )}

        {/* Menu */}
        <div style={{ fontWeight:800, fontSize:'0.85rem', color:'var(--text-tertiary)',
          textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:'0.75rem' }}>
          Menú
        </div>

        {menu.length === 0 ? (
          <p style={{ color:'var(--text-tertiary)' }}>Sin productos disponibles.</p>
        ) : (
          <>
          {/* Sort controls */}
        <div style={{ display:'flex', gap:'0.4rem', marginBottom:'0.6rem', alignItems:'center' }}>
          <span style={{ fontSize:'0.72rem', color:'var(--text-tertiary)', fontWeight:600 }}>Ordenar:</span>
          {[['default','Por defecto'],['asc','Menor precio'],['desc','Mayor precio']].map(([val,label]) => (
            <button key={val} onClick={() => setSortBy(val)}
              className={`chip${sortBy===val?' active':''}`}
              style={{ fontSize:'0.7rem', padding:'3px 9px' }}>
              {label}
            </button>
          ))}
        </div>

        <ul style={{ listStyle:'none', padding:0, margin:0 }}>
            {[...menu].sort((a,b) => {
              if (sortBy === 'asc')  return (a.price_cents||0) - (b.price_cents||0);
              if (sortBy === 'desc') return (b.price_cents||0) - (a.price_cents||0);
              return 0;
            }).map(item => {
              const qty = Number(selectedItems[item.id]) || 0;
              return (
                <li key={item.id} className="card"
                  style={{ display:'flex', gap:'0.75rem', alignItems:'center',
                    opacity: isClosed ? 0.65 : 1 }}>
                  <ProductImage src={item.image_url} name={item.name} />
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontWeight:700, fontSize:'0.95rem', color:'var(--text-primary)' }}>
                      {item.name}
                    </div>
                    {item.description && (
                      <div style={{ color:'var(--text-secondary)', fontSize:'0.82rem', margin:'0.1rem 0' }}>
                        {item.description}
                      </div>
                    )}
                    <div style={{ fontWeight:700, color:'var(--brand)', marginTop:'0.2rem' }}>
                      {fmt(item.price_cents)}
                    </div>
                  </div>
                  {isCustomer && !isClosed && (
                    <div className="qty-control" style={{ flexShrink:0 }}>
                      <button className="qty-btn" disabled={qty === 0} onClick={() => adjust(item.id, -1)}>−</button>
                      <span className="qty-num">{qty}</span>
                      <button className="qty-btn add" onClick={() => adjust(item.id, 1)}>+</button>
                    </div>
                  )}
                </li>
              );
            })}
            </ul>
          </>
        )}

        {/* Order summary */}
        {isCustomer && total > 0 && !isClosed && (
          <div style={{ marginTop:'1rem', background:'var(--bg-card)',
            border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', padding:'1rem' }}>

            {/* Payment method */}
            <p style={{ fontSize:'0.72rem', fontWeight:700, color:'var(--text-tertiary)',
              textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'0.4rem' }}>
              Método de pago
            </p>
            <div style={{ display:'flex', gap:'0.4rem', marginBottom:'1rem' }}>
              {[['cash','💵 Efectivo'],['card','💳 Tarjeta'],['spei','🏦 SPEI']].map(([val,label]) => (
                <button key={val} onClick={() => setPaymentMethod(val)}
                  className={paymentMethod===val ? 'btn-primary btn-sm' : 'btn-sm'}
                  style={{ flex:1, fontSize:'0.78rem' }}>
                  {label}
                </button>
              ))}
            </div>

            {/* Tip */}
            <p style={{ fontSize:'0.72rem', fontWeight:700, color:'var(--text-tertiary)',
              textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'0.4rem' }}>
              Agradecimiento al conductor
            </p>
            <div style={{ display:'flex', gap:'0.25rem', flexWrap:'wrap', marginBottom:'1rem' }}>
              {[{pct:0,label:'—'},{pct:5,label:'5%'},{pct:10,label:'10%'},{pct:20,label:'20%'}].map(({pct,label}) => {
                const v = pct===0 ? 0 : Math.round(subtotal * pct / 100);
                const sel = tipCents === v;
                return (
                  <button key={pct} onClick={() => setTipCents(v)}
                    style={{ padding:'0.25rem 0.55rem', cursor:'pointer', fontSize:'0.78rem',
                      border:`1.5px solid ${sel ? 'var(--success)' : 'var(--border)'}`,
                      borderRadius:6, background: sel ? 'var(--success-bg)' : 'var(--bg-card)',
                      color: sel ? 'var(--success)' : 'var(--text-secondary)',
                      fontWeight: sel ? 700 : 400, minHeight:'unset' }}>
                    {label}{pct>0&&subtotal>0?` (${fmt(v)})` : ''}
                  </button>
                );
              })}
            </div>

            {/* Totals */}
            <div style={{ fontSize:'0.82rem', color:'var(--text-secondary)',
              borderTop:'1px solid var(--border-light)', paddingTop:'0.6rem' }}>
              {[['Subtotal', subtotal],['Servicio (5%)', serviceFee],['Envío (10%)', deliveryFee]].map(([label, val]) => (
                <div key={label} style={{ display:'flex', justifyContent:'space-between', marginBottom:'0.15rem' }}>
                  <span>{label}</span><span>{fmt(val)}</span>
                </div>
              ))}
              {tipCents > 0 && (
                <div style={{ display:'flex', justifyContent:'space-between',
                  color:'var(--success)', marginBottom:'0.15rem' }}>
                  <span>Agradecimiento</span><span>+{fmt(tipCents)}</span>
                </div>
              )}
              <div style={{ display:'flex', justifyContent:'space-between', fontWeight:800,
                fontSize:'0.95rem', color:'var(--text-primary)', marginTop:'0.4rem',
                paddingTop:'0.4rem', borderTop:'1px solid var(--border)' }}>
                <span>Total</span><span>{fmt(total)}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Sticky bottom bar */}
      {isCustomer && !isClosed && (
        <div style={{ position:'fixed', bottom:0, left:0, right:0, zIndex:50,
          background:'var(--bg-card)', borderTop:'1px solid var(--border)',
          padding:'0.75rem 1rem', paddingBottom:'calc(0.75rem + env(safe-area-inset-bottom, 0px))',
          boxShadow:'0 -4px 20px rgba(0,0,0,0.1)' }}>

          {/* Delivery mode selector */}
          <div style={{ marginBottom:'0.6rem' }}>
            <div style={{ fontSize:'0.72rem', fontWeight:700, color:'var(--text-tertiary)',
              textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:'0.35rem' }}>
              Enviar a
            </div>
            <div style={{ display:'flex', gap:'0.35rem', flexWrap:'wrap' }}>
              {[
                ['current', `📍 Actual${!currentPos && !gpsError ? ' (buscando…)' : gpsError ? ' (no disp.)' : ''}`],
                ...(currentPos && deliveryMode !== 'confirmed' ? [['current', `📍 GPS`]] : []),
                ...(deliveryMode === 'confirmed' ? [['confirmed', `✓ Confirmada`]] : []),
                ...(hasHomePin ? [['home', '🏠 Casa']] : []),
                ['manual', `📌 Manual${manualPos ? ' ✓' : ''}`],
              ].map(([mode, label]) => (
                <button key={mode}
                  onClick={() => {
                    setDeliveryMode(mode);
                    if (mode === 'manual') setShowManualMap(true);
                    else setShowManualMap(false);
                  }}
                  style={{ padding:'0.3rem 0.65rem', borderRadius:6, fontSize:'0.78rem',
                    cursor:'pointer', minHeight:'unset',
                    border:`1.5px solid ${deliveryMode===mode ? 'var(--brand)' : 'var(--border)'}`,
                    background: deliveryMode===mode ? 'var(--brand-light)' : 'var(--bg-card)',
                    color: deliveryMode===mode ? 'var(--brand)' : 'var(--text-secondary)',
                    fontWeight: deliveryMode===mode ? 700 : 400 }}>
                  {label}
                </button>
              ))}
            </div>
            {deliveryMode === 'home' && auth.user?.address && (
              <div style={{ fontSize:'0.72rem', color:'var(--text-tertiary)', marginTop:'0.25rem' }}>
                {auth.user.address}
              </div>
            )}
            {deliveryMode === 'manual' && manualPos?.label && (
              <div style={{ fontSize:'0.72rem', color:'var(--text-tertiary)', marginTop:'0.25rem' }}>
                📌 {manualPos.label}
              </div>
            )}
            {deliveryMode === 'manual' && showManualMap && (
              <ManualPinMap
                initialPos={currentPos || (hasHomePin ? { lat:homeLatNum, lng:homeLngNum } : null)}
                mapRef={manualMapRef}
                onConfirm={pos => { setManualPos(pos); setShowManualMap(false); }}
                onCancel={() => { setShowManualMap(false); if (!manualPos) setDeliveryMode('current'); }}
              />
            )}
          </div>

          {!hasAddress && (
            <p style={{ fontSize:'0.82rem', color:'var(--warn)', marginBottom:'0.4rem', fontWeight:600 }}>
              Guarda tu dirección en Perfil antes de pedir
            </p>
          )}
          {deliveryMode === 'manual' && !manualPos && !showManualMap && (
            <p style={{ fontSize:'0.82rem', color:'var(--warn)', marginBottom:'0.4rem' }}>
              Confirma tu ubicación en el mapa para continuar
            </p>
          )}

          <button className="btn-primary"
            style={{ width:'100%', fontSize:'1rem', fontWeight:800, padding:'0.75rem' }}
            disabled={!canOrder || ordering || itemCount === 0 || (deliveryMode==='manual' && !manualPos)}
            onClick={createOrder}>
            {ordering ? 'Procesando…'
              : itemCount === 0 ? 'Selecciona productos'
              : `Hacer pedido · ${fmt(total)}`}
          </button>
        </div>
      )}

      {!isCustomer && auth.user && (
        <div style={{ padding:'1rem', textAlign:'center', color:'var(--text-tertiary)', fontSize:'0.85rem' }}>
          Solo los clientes pueden hacer pedidos.
        </div>
      )}
      {!auth.user && (
        <div style={{ padding:'1rem' }}>
          <button className="btn-primary" style={{ width:'100%' }}
            onClick={() => navigate('/customer/login')}>
            Iniciar sesión para pedir
          </button>
        </div>
      )}
    </div>
  );
}
