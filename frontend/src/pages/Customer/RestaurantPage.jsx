import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';

function formatMoney(cents) { return `$${((cents ?? 0) / 100).toFixed(2)}`; }

function useFlash(duration=5000) {
  const [msgs, setMsgs] = useState({});
  const timers = useRef({});
  const flash = useCallback((text,isError=false,id='__g__')=>{
    setMsgs(p=>({...p,[id]:{text,isError}}));
    clearTimeout(timers.current[id]);
    timers.current[id]=setTimeout(()=>setMsgs(p=>{const n={...p};delete n[id];return n;}),duration);
  },[duration]);
  return [msgs,flash];
}
function FlashMsg({msg}) {
  if (!msg) return null;
  return <p style={{color:msg.isError?'#c00':'#080',margin:'0.25rem 0',fontSize:'0.875rem'}}>{msg.text}</p>;
}

export default function RestaurantPage() {
  const { id } = useParams();
  const { auth } = useAuth();
  const navigate = useNavigate();
  const [restaurant, setRestaurant] = useState(null);
  const [menu, setMenu] = useState([]);
  const [selectedItems, setSelectedItems] = useState({});
  const [loading, setLoading] = useState(true);
  const [flash, flashMsg] = useFlash();

  const hasAddress = Boolean(auth.user?.address && auth.user.address !== 'address-pending');
  const isCustomer = auth.user?.role === 'customer';

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        // Obtener lista de restaurantes para encontrar info del restaurante actual
        const [listData, menuData] = await Promise.all([
          apiFetch('/restaurants'),
          apiFetch(`/restaurants/${id}/menu`)
        ]);
        const found = listData.restaurants.find(r => r.id === id);
        setRestaurant(found || { id, name: 'Restaurante', address: '' });
        setMenu((menuData.menu || []).filter(i => i.is_available !== false));
      } catch(e) {
        flashMsg('Error cargando restaurante', true);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  const total = Object.entries(selectedItems).reduce((sum, [menuItemId, qty]) => {
    const item = menu.find(i => i.id === menuItemId);
    return sum + (item ? item.price_cents * Number(qty) : 0);
  }, 0);

  async function createOrder() {
    if (!auth.token) return navigate('/login');
    if (!isCustomer) return flashMsg('Solo clientes pueden hacer pedidos', true);
    if (!hasAddress) return flashMsg('Guarda tu dirección antes de hacer un pedido', true);

    const items = Object.entries(selectedItems)
      .filter(([, qty]) => Number(qty) > 0)
      .map(([menuItemId, quantity]) => ({ menuItemId, quantity: Number(quantity) }));

    if (items.length === 0) return flashMsg('Selecciona al menos un producto', true);

    try {
      await apiFetch('/orders', { method: 'POST', body: JSON.stringify({ restaurantId: id, items }) }, auth.token);
      flashMsg('✅ Pedido creado correctamente');
      setSelectedItems({});
      // Volver al home después de 1.5s
      setTimeout(() => navigate('/customer'), 1500);
    } catch(e) { flashMsg(e.message, true); }
  }

  if (loading) return <section className="role-panel"><p>Cargando…</p></section>;

  return (
    <section className="role-panel">
      {/* Botón volver */}
      <button
        onClick={() => navigate(-1)}
        style={{ marginBottom: '1rem', fontSize: '0.875rem', background: 'none', border: 'none', cursor: 'pointer', color: '#2563eb', padding: 0 }}
      >
        ← Volver
      </button>

      {/* Info del restaurante */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ margin: '0 0 0.25rem' }}>{restaurant?.name}</h2>
        {restaurant?.address && (
          <p style={{ color: '#6b7280', margin: '0 0 0.25rem', fontSize: '0.9rem' }}>📍 {restaurant.address}</p>
        )}
        <span style={{ fontSize: '0.8rem', color: restaurant?.is_open !== false ? '#059669' : '#dc2626' }}>
          {restaurant?.is_open !== false ? '● Abierto' : '● Cerrado'}
        </span>
      </div>

      {/* Menú */}
      <h3>Menú</h3>
      {menu.length === 0 ? (
        <p style={{ color: '#888' }}>Sin productos disponibles.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {menu.map(item => (
            <li key={item.id} style={{
              display: 'flex', alignItems: 'center', gap: '0.75rem',
              padding: '0.75rem 0', borderBottom: '1px solid #f3f4f6'
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{item.name}</div>
                {item.description && <div style={{ color: '#6b7280', fontSize: '0.875rem' }}>{item.description}</div>}
                <div style={{ fontWeight: 600, color: '#111', marginTop: '0.15rem' }}>{formatMoney(item.price_cents)}</div>
              </div>
              {isCustomer && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <button
                    onClick={() => setSelectedItems(p => ({ ...p, [item.id]: Math.max(0, (Number(p[item.id]) || 0) - 1) }))}
                    style={{ width: '2rem', height: '2rem', borderRadius: '50%', border: '1px solid #e5e7eb', background: '#f9fafb', cursor: 'pointer', fontWeight: 700 }}
                  >−</button>
                  <span style={{ minWidth: '1.5rem', textAlign: 'center', fontWeight: 600 }}>
                    {selectedItems[item.id] || 0}
                  </span>
                  <button
                    onClick={() => setSelectedItems(p => ({ ...p, [item.id]: (Number(p[item.id]) || 0) + 1 }))}
                    style={{ width: '2rem', height: '2rem', borderRadius: '50%', border: '1px solid #e5e7eb', background: '#f9fafb', cursor: 'pointer', fontWeight: 700 }}
                  >+</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Resumen y crear pedido */}
      {isCustomer && total > 0 && (
        <div style={{ position: 'sticky', bottom: 0, background: '#fff', borderTop: '1px solid #e5e7eb', padding: '1rem 0 0', marginTop: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontWeight: 600 }}>Total: {formatMoney(total)}</span>
            <button
              disabled={!hasAddress}
              onClick={createOrder}
              style={{ fontWeight: 700, padding: '0.6rem 1.5rem' }}
            >
              Hacer pedido
            </button>
          </div>
          {!hasAddress && <p style={{ color: '#f59e0b', fontSize: '0.85rem', margin: 0 }}>⚠️ Guarda tu dirección primero</p>}
          <FlashMsg msg={flash['__g__']} />
        </div>
      )}

      {!isCustomer && auth.user && (
        <p style={{ color: '#888', fontSize: '0.85rem', marginTop: '1rem' }}>Solo los clientes pueden hacer pedidos.</p>
      )}

      {!auth.user && (
        <div style={{ marginTop: '1rem' }}>
          <button onClick={() => navigate('/login')}>Iniciar sesión para pedir</button>
        </div>
      )}
    </section>
  );
}
