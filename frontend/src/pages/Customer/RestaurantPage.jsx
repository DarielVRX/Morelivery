import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';

function fmt(cents) { return `$${((cents ?? 0) / 100).toFixed(2)}`; }

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

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [listData, menuData] = await Promise.all([
          apiFetch('/restaurants'),
          apiFetch(`/restaurants/${id}/menu`)
        ]);
        const found = (listData.restaurants || []).find(r => r.id === id);
        setRestaurant(found || { id, name: 'Restaurante', is_open: true });
        setMenu((menuData.menu || []).filter(i => i.is_available !== false));
      } catch (e) { setMsg('Error cargando el restaurante'); }
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
  const total        = subtotal + serviceFee + deliveryFee; // lo que paga el cliente

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
      await apiFetch('/orders', { method:'POST', body: JSON.stringify({ restaurantId: id, items, paymentMethod, tipCents }) }, auth.token);
      setMsg('');
      setSelectedItems({});
      setTimeout(() => navigate('/customer/pedidos'), 800);
    } catch (e) { setMsg(e.message); }
    finally { setOrdering(false); }
  }

  if (loading) return <div style={{ padding:'2rem', textAlign:'center', color:'var(--gray-400)' }}>Cargando…</div>;

  const isClosed = restaurant?.is_open === false;
  const canOrder = isCustomer && hasAddress && !isClosed;

  return (
    <div>
      {/* Volver */}
      <button
        onClick={() => navigate(-1)}
        style={{ background:'none', border:'none', color:'var(--brand)', cursor:'pointer', padding:0, fontSize:'0.875rem', marginBottom:'1rem', fontWeight:600 }}
      >
        ← Volver
      </button>

      {/* Cabecera restaurante — fondo rosado suave para contraste */}
      <div style={{ margin:'0 -1rem 0', padding:'1rem 1rem 1.1rem',
        background:'var(--brand-light)', borderBottom:'2px solid #e3aaaa',
        marginBottom:'1.25rem' }}>
      <div style={{ display:'flex', gap:'0.875rem', alignItems:'flex-start' }}>
        {/* Foto de perfil de la tienda */}
        {restaurant?.profile_photo
          ? <img src={restaurant.profile_photo} alt={restaurant?.name}
              style={{ width:60, height:60, borderRadius:'50%', objectFit:'cover', border:'2px solid var(--gray-200)', flexShrink:0 }} />
          : <div style={{ width:60, height:60, borderRadius:'50%', background:'var(--gray-100)', border:'2px solid var(--gray-200)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="1.5"><circle cx="12" cy="12" r="9"/><path d="M7 16c0-2.8 2.2-5 5-5s5 2.2 5 5"/><circle cx="12" cy="10" r="2"/></svg>
            </div>
        }
        <div style={{ flex:1 }}>
        <h2 style={{ fontSize:'1.2rem', fontWeight:800, margin:'0 0 0.2rem' }}>{restaurant?.name}</h2>
        {restaurant?.address && (
          <p style={{ color:'var(--gray-600)', fontSize:'0.85rem', margin:'0 0 0.35rem' }}>{restaurant.address}</p>
        )}
        <span style={{
          fontSize:'0.75rem', fontWeight:700,
          color: isClosed ? 'var(--gray-400)' : 'var(--success)',
          background: isClosed ? 'var(--gray-100)' : '#f0fdf4',
          border: `1px solid ${isClosed ? 'var(--gray-200)' : '#bbf7d0'}`,
          borderRadius:10, padding:'0.15rem 0.55rem',
        }}>
          {isClosed ? 'Cerrado' : 'Abierto'}
        </span>
        {isClosed && (
          <p style={{ fontSize:'0.82rem', color:'var(--gray-600)', marginTop:'0.5rem' }}>
            Este restaurante está cerrado. Puedes explorar el menú pero los pedidos están deshabilitados.
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
        <ul style={{ listStyle:'none', padding:0 }}>
          {menu.map(item => {
            const qty = Number(selectedItems[item.id]) || 0;
            return (
              <li key={item.id} style={{
                display:'flex', gap:'0.75rem', padding:'0.875rem 0',
                borderBottom:'1px solid var(--gray-100)', alignItems:'center'
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

      {/* Resumen pegajoso */}
      {isCustomer && total > 0 && !isClosed && (
        <div style={{
          position:'sticky', bottom:0, background:'#fff',
          borderTop:'1px solid var(--gray-200)', padding:'0.875rem 0 0', marginTop:'1rem'
        }}>
          {!hasAddress && (
            <p style={{ fontSize:'0.82rem', color:'var(--warn)', marginBottom:'0.4rem', fontWeight:600 }}>
              Guarda tu dirección en Perfil antes de pedir
            </p>
          )}
          {/* Método de pago */}
          <div style={{ display:'flex', gap:'0.4rem', marginBottom:'0.5rem' }}>
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
          <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'0.5rem', flexWrap:'wrap' }}>
            <span style={{ fontSize:'0.78rem', color:'var(--gray-500)' }}>Agradecimiento:</span>
            <div style={{ display:'flex', gap:'0.25rem', flexWrap:'wrap' }}>
              {[0,1000,2000,5000].map(v => (
                <button key={v} onClick={() => setTipCents(v)}
                  style={{ padding:'0.2rem 0.45rem', cursor:'pointer',
                    border:`1px solid ${tipCents===v?'var(--success)':'var(--gray-200)'}`,
                    borderRadius:6, background: tipCents===v?'#f0fdf4':'#fff',
                    color: tipCents===v?'var(--success)':'var(--gray-600)',
                    fontSize:'0.75rem', fontWeight: tipCents===v?700:400 }}>
                  {v===0?'—':fmt(v)}
                </button>
              ))}
              <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="$ otro"
              onChange={e => {
                const val = e.target.value.replace(/\D/g, ''); // Solo permite números
                setTipCents(Math.round(Number(val || 0) * 100));
              }}
              style={{ width: 62, fontSize: '0.75rem', padding: '0.2rem 0.4rem', border: '1px solid var(--gray-200)', borderRadius: 6 }}
              />
            </div>
          </div>
          {/* Desglose */}
          <div style={{ fontSize:'0.8rem', color:'var(--gray-500)', marginBottom:'0.3rem' }}>
            <div style={{ display:'flex', justifyContent:'space-between' }}>
              <span>Subtotal</span><span>{fmt(subtotal)}</span>
            </div>
            <div style={{ display:'flex', justifyContent:'space-between' }}>
              <span>Tarifa de servicio</span><span>{fmt(serviceFee)}</span>
            </div>
            <div style={{ display:'flex', justifyContent:'space-between' }}>
              <span>Tarifa de envío</span><span>{fmt(deliveryFee)}</span>
            </div>
            {tipCents > 0 && (
              <div style={{ display:'flex', justifyContent:'space-between', color:'var(--success)' }}>
                <span>Agradecimiento</span><span>+{fmt(tipCents)}</span>
              </div>
            )}
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span style={{ fontWeight:800 }}>Total: {fmt(total)}</span>
            <button className="btn-primary" disabled={!canOrder || ordering} onClick={createOrder}>
              {ordering ? 'Procesando…' : 'Hacer pedido'}
            </button>
          </div>
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
