import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';

function formatMoney(cents) { return `$${((cents ?? 0) / 100).toFixed(2)}`; }
function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' });
}
function toDraft(items=[]) {
  const d={}; items.forEach(i=>{d[i.menuItemId]=i.quantity;}); return d;
}

const STATUS_LABELS = {
  created:'Recibido', assigned:'Asignado', accepted:'Aceptado',
  preparing:'En preparación', ready:'Listo para retiro',
  on_the_way:'En camino', delivered:'Entregado',
  cancelled:'Cancelado', pending_driver:'Esperando driver',
};

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

export default function CustomerHome() {
  const { auth } = useAuth();
  const [restaurants, setRestaurants] = useState([]);
  const [restaurantId, setRestaurantId] = useState('');
  const [menu, setMenu] = useState([]);
  const [selectedItems, setSelectedItems] = useState({});
  const [myOrders, setMyOrders] = useState([]);
  const [openSuggestionFor, setOpenSuggestionFor] = useState('');
  const [openComplaintFor, setOpenComplaintFor] = useState('');
  const [expanded, setExpanded] = useState({});
  const [suggestionDrafts, setSuggestionDrafts] = useState({});
  const [complaintText, setComplaintText] = useState({});
  const [flash, flashMsg] = useFlash();

  const hasAddress = Boolean(auth.user?.address && auth.user.address !== 'address-pending');

  async function loadRestaurants() {
    const data = await apiFetch('/restaurants');
    setRestaurants(data.restaurants);
    if (data.restaurants[0]?.id) setRestaurantId(data.restaurants[0].id);
  }
  async function loadMenu(id) {
    if (!id) return;
    const data = await apiFetch(`/restaurants/${id}/menu`);
    setMenu((data.menu || []).filter(i => i.is_available !== false));
    setSelectedItems({});
  }
  async function loadMyOrders() {
    if (!auth.token) return;
    const data = await apiFetch('/orders/my', {}, auth.token);
    setMyOrders(data.orders);
  }

  useEffect(()=>{ loadRestaurants().catch(()=>flashMsg('Error cargando restaurantes',true)); },[]);
  useEffect(()=>{ loadMenu(restaurantId).catch(()=>setMenu([])); },[restaurantId]);
  useEffect(()=>{ loadMyOrders().catch(()=>setMyOrders([])); },[auth.token]);

  async function createOrder() {
    if (!hasAddress) return flashMsg('Guarda tu dirección antes de hacer un pedido',true);
    if (!restaurantId) return flashMsg('Selecciona un restaurante',true);
    const ids = new Set(menu.map(i=>i.id));
    const items = Object.entries(selectedItems)
      .filter(([id,q])=>ids.has(id)&&Number(q)>0)
      .map(([menuItemId,quantity])=>({menuItemId,quantity:Number(quantity)}));
    if (items.length===0) return flashMsg('Selecciona al menos un producto',true);
    try {
      const data = await apiFetch('/orders',{method:'POST',body:JSON.stringify({restaurantId,items})},auth.token);
      flashMsg(`✅ Pedido creado`);
      setSelectedItems({});
      loadMyOrders();
    } catch(e){ flashMsg(e.message,true); }
  }

  async function cancelOrder(orderId) {
    try {
      await apiFetch(`/orders/${orderId}/cancel`,{method:'PATCH'},auth.token);
      setOpenSuggestionFor('');
      loadMyOrders();
    } catch(e){ flashMsg(e.message,true,orderId); }
  }

  async function respondSuggestion(orderId, accepted) {
    try {
      await apiFetch(`/orders/${orderId}/suggestion-response`,{method:'PATCH',body:JSON.stringify({accepted})},auth.token);
      setOpenSuggestionFor('');
      loadMyOrders();
    } catch(e){ flashMsg(e.message,true,orderId); }
  }

  async function submitComplaint(orderId) {
    const text=(complaintText[orderId]||'').trim();
    if (!text) return flashMsg('Escribe tu queja antes de enviar',true,`complaint_${orderId}`);
    try {
      await apiFetch(`/orders/${orderId}/complaint`,{method:'POST',body:JSON.stringify({text})},auth.token);
      flashMsg('Queja enviada',false,orderId);
      setOpenComplaintFor('');
      setComplaintText(p=>({...p,[orderId]:''}));
      loadMyOrders();
    } catch(e){ flashMsg(e.message,true,orderId); }
  }

  const pendingSuggestions = useMemo(
    ()=>myOrders.filter(o=>o.suggestion_status==='pending_customer'&&(o.suggestion_items||[]).length>0),
    [myOrders]
  );
  const activeOrders = useMemo(
    ()=>myOrders.filter(o=>!['delivered','cancelled'].includes(o.status)),
    [myOrders]
  );
  const historyOrders = useMemo(
    ()=>myOrders.filter(o=>['delivered','cancelled'].includes(o.status)),
    [myOrders]
  );

  return (
    <section className="role-panel">
      <h2>Cliente</h2>

      {!hasAddress&&(
        <div style={{border:'1px solid #f59e0b',background:'#fffbeb',borderRadius:8,padding:'0.75rem',marginBottom:'1rem'}}>
          ⚠️ Guarda tu dirección (arriba) para poder hacer pedidos.
        </div>
      )}

      {/* Hacer pedido */}
      <div style={{opacity:hasAddress?1:0.5,pointerEvents:hasAddress?'auto':'none',marginBottom:'1rem'}}>
        <select value={restaurantId} onChange={e=>setRestaurantId(e.target.value)} style={{marginBottom:'0.5rem'}}>
          {restaurants.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <ul style={{listStyle:'none',padding:0}}>
          {menu.map(item=>(
            <li key={item.id} style={{display:'flex',alignItems:'center',gap:'0.5rem',marginBottom:'0.3rem'}}>
              <span style={{flex:1}}>{item.name} — {item.description||''} — {formatMoney(item.price_cents)}</span>
              <input
                type="number" min="0" placeholder="qty" style={{width:'4rem'}}
                value={selectedItems[item.id]||''}
                onChange={e=>setSelectedItems(p=>({...p,[item.id]:e.target.value}))}
              />
            </li>
          ))}
        </ul>
        <button disabled={!auth.token||auth.user?.role!=='customer'||!hasAddress} onClick={createOrder}>
          Crear pedido
        </button>
        <FlashMsg msg={flash['__g__']} />
      </div>

      {/* Sugerencias pendientes */}
      {pendingSuggestions.length>0&&(
        <>
          <h3>⚡ Sugerencias del restaurante ({pendingSuggestions.length})</h3>
          <ul style={{listStyle:'none',padding:0}}>
            {pendingSuggestions.map(order=>(
              <li key={`sug-${order.id}`} style={{border:'1px solid #f59e0b',borderRadius:8,padding:'0.75rem',marginBottom:'0.75rem'}}>
                <div><strong>{order.restaurant_name}</strong> · {formatMoney(order.total_cents)}</div>
                <button onClick={()=>setOpenSuggestionFor(openSuggestionFor===order.id?'':order.id)}>
                  Ver sugerencia
                </button>
                {openSuggestionFor===order.id&&(
                  <div style={{marginTop:'0.5rem'}}>
                    <ul style={{paddingLeft:'1rem',fontSize:'0.9rem'}}>
                      {(order.suggestion_items||[]).map(i=>(
                        <li key={i.menuItemId}>{i.name} × {i.quantity} — {formatMoney(i.unitPriceCents*i.quantity)}</li>
                      ))}
                    </ul>
                    {order.suggestion_note&&<p style={{color:'#555',fontSize:'0.85rem'}}>📝 {order.suggestion_note}</p>}
                    <div className="row">
                      <button onClick={()=>respondSuggestion(order.id,true)}>✅ Aceptar</button>
                      <button onClick={()=>respondSuggestion(order.id,false)}>❌ Rechazar</button>
                      <button onClick={()=>cancelOrder(order.id)}>Cancelar pedido</button>
                    </div>
                  </div>
                )}
                <FlashMsg msg={flash[order.id]} />
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Pedidos activos */}
      <h3>Mis pedidos activos ({activeOrders.length})</h3>
      {activeOrders.length===0?<p>Sin pedidos activos.</p>:(
        <ul style={{listStyle:'none',padding:0}}>
          {activeOrders.map(order=>(
            <li key={order.id} style={{border:'1px solid #e5e7eb',borderRadius:8,padding:'0.875rem',marginBottom:'0.75rem'}}>
              <div style={{display:'flex',justifyContent:'space-between'}}>
                <strong>{STATUS_LABELS[order.status]||order.status}</strong>
                <strong>{formatMoney(order.total_cents)}</strong>
              </div>
              <div><strong>Restaurante:</strong> {order.restaurant_name}</div>
              <div><strong>Driver:</strong> {order.driver_first_name||'Pendiente de asignación'}</div>
              <div style={{fontSize:'0.82rem',color:'#555'}}>{formatDate(order.created_at)}</div>

              {/* Expandir detalle */}
              <button onClick={()=>setExpanded(p=>({...p,[order.id]:!p[order.id]}))} style={{marginTop:'0.3rem',fontSize:'0.82rem'}}>
                {expanded[order.id]?'▲ Ocultar detalles':'▼ Ver detalles'}
              </button>
              {expanded[order.id]&&(order.items||[]).length>0&&(
                <ul style={{paddingLeft:'1rem',fontSize:'0.9rem',margin:'0.25rem 0'}}>
                  {order.items.map(i=><li key={i.menuItemId}>{i.name} × {i.quantity} — {formatMoney(i.unitPriceCents*i.quantity)}</li>)}
                </ul>
              )}

              <div className="row" style={{marginTop:'0.5rem',flexWrap:'wrap'}}>
                {['created','pending_driver','assigned','accepted','preparing'].includes(order.status)&&(
                  <button onClick={()=>cancelOrder(order.id)}>Cancelar</button>
                )}
                {order.status==='delivered'&&(
                  <button onClick={()=>setOpenComplaintFor(openComplaintFor===order.id?'':order.id)}>
                    📣 Queja
                  </button>
                )}
              </div>

              <FlashMsg msg={flash[order.id]} />
            </li>
          ))}
        </ul>
      )}

      {/* Historial */}
      <h3>Historial ({historyOrders.length})</h3>
      {historyOrders.length===0?<p>Sin historial aún.</p>:(
        <ul style={{listStyle:'none',padding:0}}>
          {historyOrders.map(order=>(
            <li key={order.id} style={{borderBottom:'1px solid #eee',paddingBottom:'0.5rem',marginBottom:'0.5rem'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}}
                onClick={()=>setExpanded(p=>({...p,[`h_${order.id}`]:!p[`h_${order.id}`]}))}>
                <span>
                  <strong>{STATUS_LABELS[order.status]||order.status}</strong>
                  {' · '}{formatMoney(order.total_cents)}
                  {' · '}{order.restaurant_name}
                  <span style={{color:'#888',fontSize:'0.82rem',marginLeft:'0.4rem'}}>{formatDate(order.created_at)}</span>
                </span>
                <span>{expanded[`h_${order.id}`]?'▲':'▼'}</span>
              </div>
              {expanded[`h_${order.id}`]&&(
                <div style={{paddingLeft:'1rem',fontSize:'0.9rem',marginTop:'0.25rem'}}>
                  <div><strong>Driver:</strong> {order.driver_first_name||'—'}</div>
                  {(order.items||[]).map(i=><div key={i.menuItemId}>{i.name} × {i.quantity} — {formatMoney(i.unitPriceCents*i.quantity)}</div>)}
                  {order.status==='delivered'&&(
                    <button onClick={()=>setOpenComplaintFor(openComplaintFor===order.id?'':order.id)} style={{marginTop:'0.4rem',fontSize:'0.82rem'}}>
                      📣 Generar queja
                    </button>
                  )}
                </div>
              )}

              {/* Panel de queja */}
              {openComplaintFor===order.id&&(
                <div style={{marginTop:'0.5rem',paddingLeft:'1rem'}}>
                  <textarea
                    value={complaintText[order.id]||''}
                    onChange={e=>setComplaintText(p=>({...p,[order.id]:e.target.value}))}
                    placeholder="Describe tu queja…"
                    rows={3} style={{width:'100%',boxSizing:'border-box'}}
                  />
                  <FlashMsg msg={flash[`complaint_${order.id}`]} />
                  <div className="row">
                    <button onClick={()=>submitComplaint(order.id)}>Enviar queja</button>
                    <button onClick={()=>setOpenComplaintFor('')}>Cancelar</button>
                  </div>
                </div>
              )}
              <FlashMsg msg={flash[order.id]} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
