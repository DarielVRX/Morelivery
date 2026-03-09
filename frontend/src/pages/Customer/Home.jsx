import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useRealtimeOrders } from '../../hooks/useRealtimeOrders';

function fmt(cents) { return `$${((cents ?? 0) / 100).toFixed(2)}`; }

function toDraft(items=[]) {
  const d={};
  items.forEach(i=>{ d[i.menuItemId]=i.quantity; });
  return d;
}

export default function CustomerHome() {
  const { auth } = useAuth();
  const navigate = useNavigate();

  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading]         = useState(true);

  // Sugerencias pendientes — cargadas desde /orders/my
  const [pendingSugg, setPendingSugg]   = useState([]);
  const [suggFor, setSuggFor]           = useState('');
  const [suggDrafts, setSuggDrafts]     = useState({});
  const [dismissedSugg, setDismissedSugg] = useState(new Set());
  const [msg, setMsg] = useState('');
  const loadSuggRef = useRef(null);

  async function loadSuggestions() {
    if (!auth.token) return;
    try {
      const d = await apiFetch('/orders/my', {}, auth.token);
      const pending = (d.orders||[]).filter(o =>
        o.suggestion_status==='pending_customer' && (o.suggestion_items||[]).length>0
      );
      setPendingSugg(pending);
    } catch (_) {}
  }

  useEffect(() => { loadSuggRef.current = loadSuggestions; });

  // Cargar restaurantes — solo al montar
  useEffect(() => {
    apiFetch('/restaurants')
      .then(d => setRestaurants(d.restaurants||[]))
      .catch(()=>{})
      .finally(()=>setLoading(false));
    if (auth.token) loadSuggestions();
  }, [auth.token]);

  // SSE solo para sugerencias nuevas — sin hook pesado en Home
  useRealtimeOrders(
    auth.token,
    (data) => { if (data.action==='suggestion_received') loadSuggRef.current?.(); },
    ()=>{},
  );

  function openSugg(order) {
    setSuggFor(order.id);
    setSuggDrafts(prev => ({ ...prev, [order.id]: prev[order.id]||toDraft(order.suggestion_items||[]) }));
    if (order.restaurant_id) loadMenu(order.restaurant_id);
  }
  function adjustSugg(orderId, menuItemId, delta) {
    setSuggDrafts(prev => {
      const cur = prev[orderId]||{};
      return { ...prev, [orderId]: { ...cur, [menuItemId]: Math.max(0,(cur[menuItemId]||0)+delta) } };
    });
  }
  async function respondSugg(orderId, accepted) {
    try {
      await apiFetch(`/orders/${orderId}/suggestion-response`, {
        method:'PATCH', body: JSON.stringify({ accepted })
      }, auth.token);
      setSuggFor(''); loadSuggestions();
    } catch (e) { setMsg(e.message); }
  }

  async function cancelOrder(orderId) {
    const note = window.prompt('Motivo de cancelación (obligatorio):');
    if (!note?.trim()) return;
    try {
      await apiFetch(`/orders/${orderId}/cancel`, { method:'PATCH', body: JSON.stringify({ note }) }, auth.token);
      loadSuggestions();
    } catch (e) { setMsg(e.message); }
  }

  // Menú completo de la tienda para cada sugerencia (para que el cliente pueda editar)
  const [restaurantMenus, setRestaurantMenus] = useState({});
  async function loadMenu(restaurantId) {
    if (restaurantMenus[restaurantId]) return;
    try {
      const d = await apiFetch(`/restaurants/${restaurantId}/menu`, {}, auth.token);
      setRestaurantMenus(prev => ({ ...prev, [restaurantId]: d.menu || [] }));
    } catch (_) {}
  }

  const visible = pendingSugg.filter(o => !dismissedSugg.has(o.id));

  if (loading) return (
    <div style={{ padding:'2rem', textAlign:'center', color:'var(--gray-400)' }}>Cargando…</div>
  );

  return (
    <div style={{ backgroundColor:'#fff9f8', minHeight:'100vh', padding:'1rem' }}>
      {/* ── Sugerencias flotantes ─────────────────────────────────────── */}
      {visible.map(order => (
        <div key={`sug-${order.id}`} style={{
          background:'#fffbeb', border:'2px solid #f59e0b', borderRadius:10,
          padding:'0.875rem', marginBottom:'0.75rem', position:'relative',
        }}>
          {/* Botón cerrar grande */}
          <button
            onClick={() => setDismissedSugg(s => new Set([...s, order.id]))}
            style={{ position:'absolute', top:8, right:8, width:38, height:38, borderRadius:'50%', border:'none', background:'#f3f4f6', cursor:'pointer', fontSize:'1.2rem', display:'flex', alignItems:'center', justifyContent:'center' }}
            aria-label="Cerrar"
          >✕</button>

          <p style={{ fontWeight:700, fontSize:'0.875rem', color:'#92400e', marginBottom:'0.5rem', paddingRight:'3rem' }}>
            {order.restaurant_name} propone un cambio
          </p>

          {suggFor===order.id ? (
            <>
              <p style={{ fontSize:'0.75rem', color:'var(--gray-500)', marginBottom:'0.4rem' }}>
                Ajusta las cantidades o acepta la propuesta de la tienda:
              </p>
              <div style={{ display:'flex', flexDirection:'column', gap:'0.3rem', marginBottom:'0.65rem' }}>
                {(restaurantMenus[order.restaurant_id] || order.suggestion_items || []).map(item => {
                  const id  = item.id || item.menuItemId;
                  const qty = (suggDrafts[order.id]||{})[id] ?? (order.suggestion_items||[]).find(s=>s.menuItemId===id)?.quantity ?? 0;
                  return (
                    <div key={id} style={{
                      display:'flex', alignItems:'center', gap:'0.5rem',
                      background: qty>0 ? 'var(--brand-light)':'#fff',
                      border:`1px solid ${qty>0?'#bfdbfe':'var(--gray-200)'}`,
                      borderRadius:6, padding:'0.4rem 0.75rem',
                    }}>
                      <span style={{ flex:1, fontSize:'0.875rem', fontWeight:qty>0?600:400 }}>{item.name}</span>
                      <span style={{ fontSize:'0.75rem', color:'var(--gray-400)' }}>${((item.price_cents||item.unitPriceCents||0)/100).toFixed(2)}</span>
                      <div className="qty-control">
                        <button className="qty-btn" disabled={qty===0} onClick={()=>adjustSugg(order.id,id,-1)}>−</button>
                        <span className="qty-num">{qty}</span>
                        <button className="qty-btn add" onClick={()=>adjustSugg(order.id,id,1)}>+</button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ display:'flex', gap:'0.4rem', flexWrap:'wrap' }}>
                <button className="btn-primary btn-sm" onClick={()=>respondSugg(order.id,true)}>Aceptar</button>
                <button className="btn-sm btn-danger" onClick={()=>respondSugg(order.id,false)}>Rechazar</button>
                <button className="btn-sm" onClick={()=>cancelOrder(order.id)}>Cancelar pedido</button>
              </div>
            </>
          ) : (
            <button onClick={()=>openSugg(order)}
              style={{ background:'#f59e0b', color:'#fff', border:'none', borderRadius:6, padding:'0.45rem 1rem', fontWeight:700, cursor:'pointer', fontSize:'0.875rem' }}>
              Ver propuesta
            </button>
          )}
        </div>
      ))}

      {msg && <p className="flash flash-error" style={{ marginBottom:'0.5rem' }}>{msg}</p>}

      {/* ── Encabezado Tiendas ─────────────────────────────────────────── */}
      <div style={{ margin:'-1rem -1rem 1rem', padding:'0.75rem 1rem 0.65rem', background:'linear-gradient(135deg,var(--brand) 0%,var(--brand-dark,#c0546a) 100%)', color:'#fff' }}>
        <div style={{ fontWeight:800, fontSize:'1.05rem', letterSpacing:'-0.01em' }}>🛍 Tiendas</div>
        <div style={{ fontSize:'0.75rem', opacity:0.85, marginTop:'0.1rem' }}>Elige dónde quieres pedir</div>
      </div>

      {restaurants.length===0 ? (
        <p style={{ color:'var(--gray-600)' }}>No hay restaurantes disponibles.</p>
      ) : (
        <ul style={{ listStyle:'none', padding:0 }}>
          {restaurants.map(r => (
            <li key={r.id} onClick={()=>navigate(`/restaurant/${r.id}`)}
              style={{
                display:'flex', justifyContent:'space-between', alignItems:'center',
                gap:'0.75rem', padding:'0.75rem 1rem',
                border:'1px solid var(--gray-200)', borderRadius:'var(--radius)',
                marginBottom:'0.5rem', background:'#fff', cursor:'pointer',
                opacity: r.is_open ? 1 : 0.7, transition:'box-shadow 0.15s',
              }}
              onMouseEnter={e=>e.currentTarget.style.boxShadow='0 2px 10px rgba(0,0,0,0.07)'}
              onMouseLeave={e=>e.currentTarget.style.boxShadow='none'}
            >
              {/* Foto de perfil de la tienda */}
              {r.profile_photo
                ? <img src={r.profile_photo} alt={r.name}
                    style={{ width:42, height:42, borderRadius:'50%', objectFit:'cover', border:'1px solid var(--gray-200)', flexShrink:0 }} />
                : <div style={{ width:42, height:42, borderRadius:'50%', background:'var(--gray-100)', border:'1px solid var(--gray-200)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="1.5"><circle cx="12" cy="12" r="9"/><path d="M7 16c0-2.8 2.2-5 5-5s5 2.2 5 5"/><circle cx="12" cy="10" r="2"/></svg>
                  </div>
              }
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontWeight:700, fontSize:'0.975rem' }}>{r.name}</div>
                {r.address && (
                  <div style={{ fontSize:'0.8rem', color:'var(--gray-600)', marginTop:'0.1rem', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {r.address}
                  </div>
                )}
              </div>
              <span style={{
                fontSize:'0.72rem', fontWeight:700, flexShrink:0,
                color: r.is_open ? 'var(--success)':'var(--gray-400)',
                background: r.is_open ? '#f0fdf4':'var(--gray-100)',
                border:`1px solid ${r.is_open ? '#bbf7d0':'var(--gray-200)'}`,
                borderRadius:10, padding:'0.15rem 0.55rem',
              }}>
                {r.is_open ? 'Abierto':'Cerrado'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
