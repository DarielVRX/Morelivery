import { useEffect, useRef, useState } from 'react';
import { readPendingOrder, savePendingOrder, schedulePendingOrderExpiry, cancelPendingOrderExpiry } from '../../utils/pendingOrder';
import { useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { AddressSearchBar, fmt, haversineKm, IconMap, IconPin, IconSearch, IconStore, IconStoreXL, IconWarning, ProductImage, StarPicker } from '../../features/customer/restaurant-page/components';

export default function RestaurantPage() {
  const { id }   = useParams();
  const { auth } = useAuth();
  const navigate = useNavigate();

  const [restaurant,    setRestaurant]    = useState(null);
  const [menu,          setMenu]          = useState([]);
  const [selectedItems, setSelectedItems] = useState({});
  const [loading,       setLoading]       = useState(true);
  const [msg,           setMsg]           = useState('');
  const [ordering,      setOrdering]      = useState(false);
  const [tipCents,      setTipCents]      = useState(0);
  const [sortBy,        setSortBy]        = useState('default');
  const [searchPos,     setSearchPos]     = useState(null);
  const [gpsPos,        setGpsPos]        = useState(null);
  const [toast,         setToast]         = useState(null); // {msg, type}

  // Rating
  const [ratingOrder,    setRatingOrder]    = useState(null);
  const [ratingRestStar, setRatingRestStar] = useState(0);
  const [ratingDrvStar,  setRatingDrvStar]  = useState(0);
  const [ratingComment,  setRatingComment]  = useState('');
  const [ratingLoading,  setRatingLoading]  = useState(false);
  const [ratedOrders,    setRatedOrders]    = useState(new Set());

  const isCustomer = auth.user?.role === 'customer';
  const hasAddress = Boolean(auth.user?.address && auth.user.address !== 'address-pending');

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
      } catch (_) {
        setMsg('Error cargando la tienda');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  // GPS — para centrar el mapa y calcular distancia home
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      pos => setGpsPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { timeout: 6000, maximumAge: 60000 }
    );
  }, []);

  // Leer draft de ubicación de Home o sesión anterior
  useEffect(() => {
    const draft = readPendingOrder();
    if (draft?.delivery_lat && draft?.delivery_lng) {
      setSearchPos({ lat: draft.delivery_lat, lng: draft.delivery_lng, label: draft.delivery_address || '' });
      return; // ya hay ubicación, no mostrar toast
    }
    // Sin draft — mostrar toast apropiado después de cargar GPS
    const timer = setTimeout(() => {
      const homeLatNum = Number(auth.user?.home_lat);
      const homeLngNum = Number(auth.user?.home_lng);
      const hasHome = Number.isFinite(homeLatNum) && Number.isFinite(homeLngNum);
      if (hasHome && gpsPos) {
        const dist = haversineKm(gpsPos.lat, gpsPos.lng, homeLatNum, homeLngNum);
        if (dist > 0.5) {
          setToast({ msg: '¿Te encuentras lejos de casa?', type: 'warn' });
          return;
        }
      }
      setToast({ msg: 'Por favor confirma tu ubicación', type: 'info' });
    }, 800);
    return () => clearTimeout(timer);
  }, [gpsPos]);

  // TTL del draft al salir
  useEffect(() => {
    function onHide()  { schedulePendingOrderExpiry(); }
    function onShow()  { if (document.visibilityState === 'visible') cancelPendingOrderExpiry(); }
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('pagehide', onHide);
    };
  }, []);

  // Order totals
  const subtotal    = Object.entries(selectedItems).reduce((sum, [itemId, qty]) => {
    const item = menu.find(i => i.id === itemId);
    return sum + (item ? item.price_cents * Number(qty) : 0);
  }, 0);
  const serviceFee  = Math.round(subtotal * 0.05);
  const deliveryFee = Math.round(subtotal * 0.10);
  const total       = subtotal + serviceFee + deliveryFee + tipCents;
  const itemCount   = Object.values(selectedItems).reduce((s, q) => s + Number(q), 0);

  // Distance / state — coords válidas solo dentro del bbox de Morelia y zona metropolitana
  const _rLat = Number(restaurant?.lat);
  const _rLng = Number(restaurant?.lng);
  const _inMorelia = Number.isFinite(_rLat) && Number.isFinite(_rLng)
    && _rLat > 19.5 && _rLat < 20.0 && _rLng > -101.6 && _rLng < -100.8;
  const restLat = _inMorelia ? _rLat : null;
  const restLng = _inMorelia ? _rLng : null;
  const refPos = searchPos || gpsPos;
  const distKm = (refPos && restLat !== null && restLng !== null)
  ? haversineKm(refPos.lat, refPos.lng, restLat, restLng) : null;
  const tooFar   = distKm !== null && distKm > 5;
  const isClosed = restaurant?.is_open === false;
  const canOrder = isCustomer && hasAddress && !isClosed && !tooFar && restLat !== null;

  // Measure order bar height so content isn't hidden behind fixed bar
  useEffect(() => {
    function update() {
      const bar = document.getElementById('order-bar');
      if (bar) document.documentElement.style.setProperty('--order-bar-h', bar.offsetHeight + 'px');
    }
    update();
    const bar = document.getElementById('order-bar');
    const obs = bar && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    if (obs) obs.observe(bar);
    return () => {
      obs?.disconnect();
      document.documentElement.style.removeProperty('--order-bar-h');
    };
  }, [isCustomer, isClosed, searchPos]);

  async function submitRating() {
    if (!ratingOrder || ratingRestStar < 1) return;
    setRatingLoading(true);
    try {
      await apiFetch(`/orders/${ratingOrder.id}/rating`, {
        method: 'POST',
        body: JSON.stringify({
          restaurant_stars: ratingRestStar,
          driver_stars: ratingDrvStar > 0 ? ratingDrvStar : undefined,
          comment: ratingComment.trim() || undefined,
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
      if (searchPos) {
        body.delivery_address = searchPos.label;
        body.delivery_lat = searchPos.lat;
        body.delivery_lng = searchPos.lng;
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

  if (loading) return (
    <div style={{ padding:'3rem', textAlign:'center', color:'var(--text-tertiary)' }}>Cargando…</div>
  );

  // Restaurante sin ubicación configurada — página deshabilitada
  if (restaurant && restLat === null) return (
    <div style={{ backgroundColor:'var(--bg-base)', minHeight:'100vh' }}>
      <div style={{
        background:'linear-gradient(135deg, #c97b7b 0%, #b56060 60%, #9e4f4f 100%)',
        position:'relative', overflow:'hidden', minHeight:120,
        padding:'1rem 1rem 1.25rem', display:'flex', flexDirection:'column', gap:'0.5rem',
      }}>
        <button onClick={() => navigate(-1)}
          style={{ background:'rgba(255,255,255,0.15)', border:'1px solid rgba(255,255,255,0.3)',
            borderRadius:8, color:'#fff', padding:'0.3rem 0.65rem', fontSize:'0.82rem',
            fontWeight:600, cursor:'pointer', alignSelf:'flex-start', minHeight:'unset',
            display:'flex', alignItems:'center', gap:'0.3rem', width:'fit-content' }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Volver
        </button>
        <div style={{ display:'flex', gap:'0.875rem', alignItems:'center' }}>
          <div style={{ width:48, height:48, borderRadius:'50%', background:'rgba(255,255,255,0.2)',
            border:'2px solid rgba(255,255,255,0.4)', display:'flex', alignItems:'center',
            justifyContent:'center', flexShrink:0, color:'rgba(255,255,255,0.8)' }}>
            <IconStore />
          </div>
          <h2 style={{ fontSize:'1.1rem', fontWeight:900, color:'#fff', margin:0, letterSpacing:'-0.02em' }}>
            {restaurant.name}
          </h2>
        </div>
      </div>
      <div style={{ padding:'2.5rem 1.5rem', textAlign:'center' }}>
        <div style={{ fontSize:'2.5rem', marginBottom:'0.75rem' }}>📍</div>
        <div style={{ fontWeight:800, fontSize:'1rem', color:'var(--text-primary)', marginBottom:'0.5rem' }}>
          Tienda sin ubicación configurada
        </div>
        <p style={{ fontSize:'0.88rem', color:'var(--text-secondary)', lineHeight:1.5, maxWidth:300, margin:'0 auto' }}>
          Esta tienda aún no ha configurado su dirección. No es posible realizar pedidos hasta que el restaurante complete su perfil.
        </p>
      </div>
    </div>
  );
    <div style={{ backgroundColor:'var(--bg-base)', minHeight:'100vh' }}>

      {/* Toast de ubicación */}
      {toast && (
        <div style={{
          position:'fixed', top:'calc(var(--header-h, 56px) + 0.5rem)', left:'50%',
          transform:'translateX(-50%)', zIndex:900,
          background: toast.type === 'warn' ? 'var(--warn-bg)' : 'var(--bg-card)',
          border: `1px solid ${toast.type === 'warn' ? 'var(--warn-border)' : 'var(--border)'}`,
          borderRadius:10, padding:'0.6rem 1rem',
          boxShadow:'0 4px 16px rgba(0,0,0,0.14)',
          display:'flex', alignItems:'center', gap:'0.5rem',
          fontSize:'0.85rem', fontWeight:600, whiteSpace:'nowrap',
          color: toast.type === 'warn' ? 'var(--warn)' : 'var(--text-primary)',
          animation:'fadeInDown 0.25s ease',
        }}>
          <span style={{display:'inline-flex',alignItems:'center',gap:'0.4rem'}}>{toast.type === 'warn' ? <IconWarning /> : <IconPin />}{toast.msg}</span>
          <button onClick={() => setToast(null)}
            style={{ background:'none', border:'none', cursor:'pointer', fontSize:'0.9rem',
              color:'var(--text-tertiary)', minHeight:'unset', padding:'0 2px', marginLeft:4 }}>✕</button>
        </div>
      )}
      <style>{`@keyframes fadeInDown { from { opacity:0; transform:translateX(-50%) translateY(-8px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }`}</style>

      {/* Rating modal */}
      {ratingOrder && (
        <div style={{ position:'fixed', inset:0, background:'var(--bg-overlay)', zIndex:999,
          display:'flex', alignItems:'flex-end', justifyContent:'center' }}
          onClick={e => { if (e.target === e.currentTarget) setRatingOrder(null); }}>
          <div style={{ background:'var(--bg-card)', borderRadius:'20px 20px 0 0',
            padding:'1.5rem', width:'100%', maxWidth:480, boxShadow:'0 -4px 32px rgba(0,0,0,0.2)' }}>
            <h3 style={{ fontSize:'1rem', fontWeight:800, marginBottom:'1rem' }}>Calificar pedido</h3>
            <StarPicker value={ratingRestStar} onChange={setRatingRestStar} label="Tienda / Restaurante" />
            {ratingOrder.driver_id && (
              <StarPicker value={ratingDrvStar} onChange={setRatingDrvStar} label="Conductor (opcional)" />
            )}
            <textarea value={ratingComment} onChange={e => setRatingComment(e.target.value)}
              placeholder="Comentario opcional…" rows={2}
              style={{ width:'100%', marginBottom:'0.75rem', fontSize:'0.875rem', resize:'none', boxSizing:'border-box' }} />
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
          ? '#2a1a1a'
          : 'linear-gradient(135deg, #c97b7b 0%, #b56060 60%, #9e4f4f 100%)',
        position:'relative', overflow:'hidden', minHeight:140,
      }}>
        {restaurant?.profile_photo && (
          <>
            <img src={restaurant.profile_photo} alt={restaurant.name}
              style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover', opacity:0.35 }} />
            <div style={{ position:'absolute', inset:0,
              background:'linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.7) 100%)' }} />
          </>
        )}
        <div style={{ position:'relative', padding:'1rem 1rem 1.25rem', display:'flex', flexDirection:'column', gap:'0.5rem' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
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
            <AddressSearchBar
              userPos={gpsPos}
              homeAddress={auth.user?.address || null}
              onSelectPos={pos => {
                setSearchPos(pos);
                setToast(null);
                if (pos?.lat && pos?.lng) savePendingOrder({ delivery_lat: pos.lat, delivery_lng: pos.lng, delivery_address: pos.label });
              }}
            />
          </div>

          <div style={{ display:'flex', gap:'0.875rem', alignItems:'flex-start' }}>
            {restaurant?.profile_photo
              ? <img src={restaurant.profile_photo} alt={restaurant.name}
                  style={{ width:56, height:56, borderRadius:'50%', objectFit:'cover',
                    border:'2px solid rgba(255,255,255,0.7)', flexShrink:0 }} />
              : <div style={{ width:56, height:56, borderRadius:'50%',
                  background:'rgba(255,255,255,0.2)', border:'2px solid rgba(255,255,255,0.4)',
                  display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                  <span style={{color:'rgba(255,255,255,0.7)'}}><IconStore /></span>
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
                  <span style={{ fontSize:'0.75rem', color:'rgba(255,255,255,0.8)', display:'inline-flex', alignItems:'center', gap:'0.2rem' }}>
                    <IconPin />{distKm < 1 ? `${Math.round(distKm*1000)}m` : `${distKm.toFixed(1)}km`}
                  </span>
                )}
                <span style={{
                  fontSize:'0.72rem', fontWeight:700,
                  color: isClosed ? 'rgba(255,255,255,0.55)' : '#fff',
                  background: isClosed ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.2)',
                  border:`1px solid ${isClosed ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.5)'}`,
                  borderRadius:10, padding:'0.15rem 0.55rem',
                }}>
                  {isClosed ? '· Cerrado' : '· Abierto'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content — padded to clear fixed bottom bar */}
      <div style={{ padding:'0.875rem 1rem',
        paddingBottom: isCustomer && !isClosed ? 'calc(var(--order-bar-h, 160px) + 0.5rem)' : '1rem'}}>

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
            <div style={{ display:'flex', gap:'0.4rem', marginBottom:'0.6rem', alignItems:'center' }}>
              <span style={{ fontSize:'0.72rem', color:'var(--text-tertiary)', fontWeight:600 }}>Ordenar:</span>
              {[['default','Por defecto'],['asc','Menor precio'],['desc','Mayor precio']].map(([val, label]) => (
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
                      <div style={{ fontWeight:700, fontSize:'0.95rem', color:'var(--text-primary)' }}>{item.name}</div>
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


      </div>

      {/* Sticky bottom bar */}
      {isCustomer && !isClosed && (
        <div id="order-bar" style={{ position:'fixed', bottom:0, left:0, right:0, zIndex:50,
          background:'var(--bg-card)', borderTop:'1px solid var(--border)',
          padding:'0.75rem 1rem', paddingBottom:'calc(0.75rem + var(--nav-h-mobile) + env(safe-area-inset-bottom, 0px))',
          boxShadow:'0 -4px 20px rgba(0,0,0,0.1)' }}>

          {searchPos?.label && (
            <div style={{ fontSize:'0.78rem', color:'var(--text-secondary)', marginBottom:'0.5rem',
              display:'flex', alignItems:'center', gap:'0.3rem' }}>
              <span style={{display:'inline-flex',alignItems:'center',gap:'0.3rem'}}><IconPin />{searchPos.label}</span>
              <button onClick={() => setSearchPos(null)}
                style={{ background:'none', border:'none', cursor:'pointer',
                  color:'var(--text-tertiary)', fontSize:'0.7rem', minHeight:'unset', padding:0 }}>✕</button>
            </div>
          )}
          {!searchPos && (
            <div style={{ fontSize:'0.78rem', color:'var(--warn)', marginBottom:'0.5rem', fontWeight:600 }}>
              <span style={{display:'inline-flex',alignItems:'center',gap:'0.3rem'}}>Toca <IconPin /> en el encabezado para indicar dónde entregar</span>
            </div>
          )}

          {!hasAddress && (
            <p style={{ fontSize:'0.82rem', color:'var(--warn)', marginBottom:'0.4rem', fontWeight:600 }}>
              Guarda tu dirección en Perfil antes de pedir
            </p>
          )}

          <button className="btn-primary"
            style={{ width:'100%', fontSize:'1rem', fontWeight:800, padding:'0.75rem' }}
            disabled={itemCount === 0 || tooFar || !isCustomer}
            onClick={() => {
              savePendingOrder({
                restaurantId:     id,
                items:            Object.entries(selectedItems).filter(([,q])=>Number(q)>0).map(([menuItemId,quantity])=>({ menuItemId, quantity:Number(quantity) })),
                items_detail:     Object.entries(selectedItems).filter(([,q])=>Number(q)>0).map(([menuItemId,quantity]) => {
                                    const item = menu.find(m => String(m.id) === String(menuItemId));
                                    return { menuItemId, quantity: Number(quantity), name: item?.name || '', price_cents: item?.price_cents || 0 };
                                  }),
                subtotal_cents:   subtotal,
                tip_cents:        tipCents,
                delivery_lat:     searchPos?.lat ?? gpsPos?.lat,
                delivery_lng:     searchPos?.lng ?? gpsPos?.lng,
                delivery_address: searchPos?.label || '',
                delivery_from_gps: !searchPos && !!gpsPos,
              });
              navigate('/customer/pagos');
            }}>
            {itemCount === 0 ? 'Selecciona productos'
              : tooFar ? `Tienda fuera de rango (${distKm?.toFixed(1)}km)`
              : `Ir a pagar · ${fmt(total)}`}
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
}
