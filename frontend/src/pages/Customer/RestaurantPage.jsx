import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';

function fmt(cents) { return `$${((cents ?? 0) / 100).toFixed(2)}`; }

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
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

  // Radio de 3km: verificar si el pin del cliente está dentro del rango de la tienda
  const distanceKm = (() => {
    const uLat = auth.user?.lat ? Number(auth.user.lat) : null;
    const uLng = auth.user?.lng ? Number(auth.user.lng) : null;
    const rLat = restaurant?.lat ? Number(restaurant.lat) : null;
    const rLng = restaurant?.lng ? Number(restaurant.lng) : null;
    if (!uLat || !uLng || !rLat || !rLng) return null;
    return haversineKm(uLat, uLng, rLat, rLng);
  })();
  const MAX_RADIUS_KM = 3;
  const outOfRange = distanceKm !== null && distanceKm > MAX_RADIUS_KM;

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [listData, menuData] = await Promise.all([
          apiFetch('/restaurants'),
          apiFetch(`/restaurants/${id}/menu`)
        ]);
        const found = (listData.restaurants || []).find(r => r.id === id);
        setRestaurant(found || { id, name: 'Tienda', is_open: true });
        setMenu((menuData.menu || []).filter(i => i.is_available !== false));
      } catch (e) { setMsg('Error cargando la tienda'); }
      finally { setLoading(false); }
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
      await apiFetch('/orders', { method:'POST', body: JSON.stringify({ restaurantId: id, items, payment_method: paymentMethod, tip_cents: tipCents }) }, auth.token);
      setMsg('');
      setSelectedItems({});
      setTimeout(() => navigate('/customer/pedidos'), 800);
    } catch (e) { setMsg(e.message); }
    finally { setOrdering(false); }
  }

  if (loading) return <div style={{ padding:'2rem', textAlign:'center', color:'var(--gray-400)' }}>Cargando…</div>;

  const isClosed = restaurant?.is_open === false;
  const canOrder = isCustomer && hasAddress && !isClosed && !outOfRange;

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
          {outOfRange && (
            <div style={{
              background:'#fff3cd', border:'1px solid #f0ad4e', borderRadius:8,
              padding:'0.6rem 0.75rem', marginBottom:'0.4rem',
              fontSize:'0.82rem', color:'#7a5000', fontWeight:600,
            }}>
              📍 Esta tienda está a {distanceKm.toFixed(1)} km — solo se aceptan pedidos dentro de {MAX_RADIUS_KM} km de tu pin de ubicación.
              <span style={{ display:'block', fontWeight:400, marginTop:'0.2rem', fontSize:'0.78rem' }}>
                Actualiza tu pin en Perfil si tu domicilio es correcto.
              </span>
            </div>
          )}
          <button className="btn-primary" style={{ width:'100%' }} disabled={!canOrder || ordering} onClick={createOrder}>
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
