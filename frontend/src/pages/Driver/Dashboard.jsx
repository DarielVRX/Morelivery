import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';

function formatMoney(cents) { return `$${((cents ?? 0) / 100).toFixed(2)}`; }
function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' });
}
function startOfWeek(date) {
  const d = new Date(date); d.setHours(0,0,0,0); d.setDate(d.getDate() - d.getDay()); return d;
}
function isSameDay(a, b) {
  return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
}

const STATUS_LABELS = {
  created:'Recibido', assigned:'Asignado', accepted:'Aceptado',
  preparing:'En preparación', ready:'Listo para retiro',
  on_the_way:'En camino', delivered:'Entregado',
  cancelled:'Cancelado', pending_driver:'Esperando driver',
};
const DAY_NAMES = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];

function useFlash(duration=5000) {
  const [msgs, setMsgs] = useState({});
  const timers = useRef({});
  const flash = useCallback((text, isError=false, id='__g__') => {
    setMsgs(p=>({...p,[id]:{text,isError}}));
    clearTimeout(timers.current[id]);
    timers.current[id]=setTimeout(()=>setMsgs(p=>{const n={...p};delete n[id];return n;}),duration);
  },[duration]);
  return [msgs, flash];
}
function FlashMsg({msg}) {
  if (!msg) return null;
  return <p style={{color:msg.isError?'#c00':'#080',margin:'0.25rem 0',fontSize:'0.875rem'}}>{msg.text}</p>;
}

/* ── Historial semanal driver ── */
function HistoryCalendar({ orders }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState(null);
  const [expanded, setExpanded] = useState({});

  const weekStart = useMemo(()=>{
    const d=startOfWeek(new Date()); d.setDate(d.getDate()+weekOffset*7); return d;
  },[weekOffset]);

  const days = useMemo(()=>Array.from({length:7},(_,i)=>{
    const d=new Date(weekStart); d.setDate(weekStart.getDate()+i); return d;
  }),[weekStart]);

  const ordersInWeek = useMemo(()=>orders.filter(o=>{
    const d=new Date(o.created_at);
    return d>=days[0] && d<=new Date(days[6].getTime()+86399999);
  }),[orders,days]);

  const filteredOrders = useMemo(()=>
    selectedDay ? ordersInWeek.filter(o=>isSameDay(new Date(o.created_at),selectedDay)) : ordersInWeek,
  [ordersInWeek,selectedDay]);

  const countByDay = useMemo(()=>{
    const m={};
    ordersInWeek.forEach(o=>{const k=new Date(o.created_at).toDateString();m[k]=(m[k]||0)+1;});
    return m;
  },[ordersInWeek]);

  const weekLabel=`${days[0].toLocaleDateString('es',{day:'numeric',month:'short'})} – ${days[6].toLocaleDateString('es',{day:'numeric',month:'short',year:'numeric'})}`;

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',gap:'0.5rem',marginBottom:'0.75rem',flexWrap:'wrap'}}>
        <button onClick={()=>setWeekOffset(w=>w-1)}>◀</button>
        <span style={{fontWeight:600,fontSize:'0.9rem'}}>{weekLabel}</span>
        <button onClick={()=>setWeekOffset(w=>w+1)} disabled={weekOffset>=0}>▶</button>
        {weekOffset!==0&&<button onClick={()=>{setWeekOffset(0);setSelectedDay(null);}}>Hoy</button>}
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:'0.2rem',marginBottom:'0.75rem'}}>
        {days.map((d,i)=>{
          const count=countByDay[d.toDateString()]||0;
          const sel=selectedDay&&isSameDay(d,selectedDay);
          const today=isSameDay(d,new Date());
          return (
            <div key={i} onClick={()=>setSelectedDay(sel?null:d)}
              style={{padding:'0.3rem 0.1rem',textAlign:'center',cursor:'pointer',borderRadius:6,
                background:sel?'#2563eb':today?'#eff6ff':'#f5f5f5',
                color:sel?'#fff':'#111',
                border:today&&!sel?'1px solid #93c5fd':'1px solid transparent',userSelect:'none'}}>
              <div style={{fontSize:'0.65rem'}}>{DAY_NAMES[i]}</div>
              <div style={{fontWeight:700}}>{d.getDate()}</div>
              {count>0&&<div style={{fontSize:'0.65rem',color:sel?'#bfdbfe':'#2563eb'}}>{count}</div>}
            </div>
          );
        })}
      </div>

      {selectedDay&&(
        <p style={{fontSize:'0.85rem',color:'#555',marginBottom:'0.5rem'}}>
          {filteredOrders.length} pedido(s) el {selectedDay.toLocaleDateString('es',{weekday:'long',day:'numeric',month:'long'})}
          <button onClick={()=>setSelectedDay(null)} style={{marginLeft:'0.5rem',fontSize:'0.75rem'}}>✕ Limpiar</button>
        </p>
      )}

      {filteredOrders.length===0?<p style={{color:'#888'}}>Sin pedidos en este período.</p>:(
        <ul style={{listStyle:'none',padding:0}}>
          {filteredOrders.map(order=>(
            <li key={order.id} style={{borderBottom:'1px solid #eee'}}>
              <div onClick={()=>setExpanded(p=>({...p,[order.id]:!p[order.id]}))}
                style={{display:'flex',justifyContent:'space-between',cursor:'pointer',padding:'0.4rem 0',alignItems:'center'}}>
                <span>
                  <strong>{STATUS_LABELS[order.status]||order.status}</strong>
                  {' · '}{formatMoney(order.total_cents)}
                  <span style={{color:'#888',fontSize:'0.82rem',marginLeft:'0.4rem'}}>{formatDate(order.created_at)}</span>
                </span>
                <span>{expanded[order.id]?'▲':'▼'}</span>
              </div>
              {expanded[order.id]&&(
                <div style={{paddingLeft:'1rem',paddingBottom:'0.5rem',fontSize:'0.9rem'}}>
                  <div><strong>Restaurante:</strong> {order.restaurant_name}</div>
                  <div><strong>Cliente:</strong> {order.customer_first_name}</div>
                  <div><strong>Dir. retiro:</strong> {order.restaurant_address||'—'}</div>
                  <div><strong>Dir. entrega:</strong> {order.customer_address||order.delivery_address||'—'}</div>
                  {(order.items||[]).length>0&&(
                    <ul style={{margin:'0.25rem 0 0 1rem'}}>
                      {order.items.map(i=><li key={i.menuItemId}>{i.name} × {i.quantity} — {formatMoney(i.unitPriceCents*i.quantity)}</li>)}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ══ DriverDashboard ══ */
export default function DriverDashboard() {
  const { auth, patchUser } = useAuth();
  const [orders, setOrders] = useState([]);
  const [offers, setOffers] = useState([]);
  const [networkOnline, setNetworkOnline] = useState(navigator.onLine);
  const [availability, setAvailabilityState] = useState(Boolean(auth.user?.driver?.is_available));
  const [loadingAvail, setLoadingAvail] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState({});
  // Notas obligatorias: {orderId: string}
  const [releaseNotes, setReleaseNotes] = useState({});
  const [rejectNotes, setRejectNotes] = useState({});
  const [showReleaseNote, setShowReleaseNote] = useState({});
  const [showRejectNote, setShowRejectNote] = useState({});
  const [flash, flashMsg] = useFlash();

  async function loadData() {
    if (!auth.token) return;
    try { await apiFetch('/drivers/listener',{method:'POST'},auth.token); } catch(_){}
    try { const d=await apiFetch('/orders/my',{},auth.token); setOrders(d.orders); } catch(_){}
    try { const d=await apiFetch('/drivers/offers',{},auth.token); setOffers(d.offers); } catch(_){}
  }

  useEffect(()=>{ loadData(); },[auth.token]);
  useEffect(()=>{ setAvailabilityState(Boolean(auth.user?.driver?.is_available)); },[auth.user?.driver?.is_available]);

  useEffect(()=>{
    function onOnline(){setNetworkOnline(true);loadData();}
    function onOffline(){setNetworkOnline(false);}
    window.addEventListener('online',onOnline);
    window.addEventListener('offline',onOffline);
    return()=>{window.removeEventListener('online',onOnline);window.removeEventListener('offline',onOffline);};
  },[]);

async function setAvailability(isAvailable) {
  setLoadingAvail(true);
  try {
    const data = await apiFetch('/drivers/availability', {
      method: 'PATCH',
      body: JSON.stringify({ isAvailable })
    }, auth.token);

    const v = Boolean(data.profile?.is_available);
    setAvailabilityState(v);
    
    // Actualizamos el contexto global
    patchUser({ driver: { ...(auth.user?.driver || {}), is_available: v } });
    flashMsg(v ? 'Ahora estás disponible' : 'Ahora estás no disponible');

    // IMPORTANTE: Si nos ponemos NO disponibles, NO llamamos al listener
    if (v) {
      await loadData();
    } else {
      // Si nos desconectamos, solo limpiamos las ofertas locales
      setOffers([]); 
      // Opcional: cargar historial sin disparar el listener
      const d = await apiFetch('/orders/my', {}, auth.token);
      setOrders(d.orders);
    }
  } catch (e) { 
    flashMsg(e.message, true); 
  } finally { 
    setLoadingAvail(false); 
  }
}

  async function changeStatus(orderId, status) {
    setLoadingStatus(p=>({...p,[orderId]:status}));
    try {
      await apiFetch(`/orders/${orderId}/status`,{method:'PATCH',body:JSON.stringify({status})},auth.token);
      await loadData();
      flashMsg(STATUS_LABELS[status]||status,false,orderId);
    } catch(e){ flashMsg(e.message,true,orderId); }
    finally { setLoadingStatus(p=>({...p,[orderId]:null})); }
  }

  async function acceptOffer(orderId) {
    try {
      await apiFetch(`/drivers/offers/${orderId}/accept`,{method:'POST'},auth.token);
      await loadData();
    } catch(e){ flashMsg(e.message,true); }
  }

  async function rejectOfferWithNote(orderId) {
    const note=(rejectNotes[orderId]||'').trim();
    if (!note) return flashMsg('Debes ingresar una nota antes de rechazar',true,`reject_${orderId}`);
    try {
      await apiFetch(`/drivers/offers/${orderId}/reject`,{method:'POST',body:JSON.stringify({note})},auth.token);
      setShowRejectNote(p=>({...p,[orderId]:false}));
      setRejectNotes(p=>({...p,[orderId]:''}));
      await loadData();
    } catch(e){ flashMsg(e.message,true); }
  }

  async function releaseOrderWithNote(orderId) {
    const note=(releaseNotes[orderId]||'').trim();
    if (!note) return flashMsg('Debes ingresar una nota antes de liberar',true,`release_${orderId}`);
    try {
      await apiFetch(`/drivers/orders/${orderId}/release`,{method:'POST',body:JSON.stringify({note})},auth.token);
      setShowReleaseNote(p=>({...p,[orderId]:false}));
      setReleaseNotes(p=>({...p,[orderId]:''}));
      await loadData();
    } catch(e){ flashMsg(e.message,true,orderId); }
  }

  const activeOrders = useMemo(()=>orders.filter(o=>!['delivered','cancelled'].includes(o.status)),[orders]);
  const historyOrders = useMemo(()=>orders.filter(o=>['delivered','cancelled'].includes(o.status)),[orders]);

  return (
    <section className="role-panel">
      <h2>Repartidor</h2>

      {/* Disponibilidad */}
      <div style={{marginBottom:'1rem',border:'1px solid #e5e7eb',borderRadius:8,padding:'0.75rem'}}>
        <p style={{margin:'0 0 0.4rem'}}>🌐 Red: {networkOnline?'✅ Conectado':'❌ Desconectado'}</p>
        <p style={{margin:'0 0 0.5rem'}}>
          Disponibilidad: <strong>{availability?'✅ Disponible':'❌ No disponible'}</strong>
        </p>
        <div className="row">
          <button disabled={loadingAvail||availability} onClick={()=>setAvailability(true)}>
            {loadingAvail?'…':'Disponible'}
          </button>
          <button disabled={loadingAvail||!availability} onClick={()=>setAvailability(false)}>
            {loadingAvail?'…':'No disponible'}
          </button>
          <button onClick={loadData}>🔄 Actualizar</button>
        </div>
        <FlashMsg msg={flash['__g__']} />
      </div>

      {/* Ofertas */}
      <h3>Ofertas pendientes ({offers.length})</h3>
      {offers.length===0
        ? <p>Sin ofertas. Asegúrate de estar disponible.</p>
        : (
          <ul style={{listStyle:'none',padding:0}}>
            {offers.map(offer=>(
              <li key={offer.id} style={{marginBottom:'1rem',border:'1px solid #e5e7eb',borderRadius:8,padding:'0.875rem'}}>
                <div style={{display:'flex',justifyContent:'space-between'}}><strong>{offer.restaurant_name}</strong><strong>{formatMoney(offer.total_cents)}</strong></div>
                <div><strong>Cliente:</strong> {offer.customer_first_name}</div>
                <div><strong>Dir. retiro:</strong> {offer.restaurant_address||'—'}</div>
                <div><strong>Dir. entrega:</strong> {offer.customer_address||offer.delivery_address||'—'}</div>
                {(offer.items||[]).length>0&&(
                  <ul style={{margin:'0.3rem 0 0 1rem',fontSize:'0.9rem'}}>
                    {offer.items.map(i=><li key={i.menuItemId}>{i.name} × {i.quantity} — {formatMoney(i.unitPriceCents*i.quantity)}</li>)}
                  </ul>
                )}
                <div className="row" style={{marginTop:'0.5rem'}}>
                  <button onClick={()=>acceptOffer(offer.id)}>✅ Aceptar</button>
                  <button onClick={()=>setShowRejectNote(p=>({...p,[offer.id]:!p[offer.id]}))}>❌ Rechazar</button>
                </div>
                {showRejectNote[offer.id]&&(
                  <div style={{marginTop:'0.5rem'}}>
                    <textarea
                      value={rejectNotes[offer.id]||''}
                      onChange={e=>setRejectNotes(p=>({...p,[offer.id]:e.target.value}))}
                      placeholder="Motivo del rechazo (obligatorio)…"
                      rows={2} style={{width:'100%',boxSizing:'border-box'}}
                    />
                    <FlashMsg msg={flash[`reject_${offer.id}`]} />
                    <div className="row">
                      <button onClick={()=>rejectOfferWithNote(offer.id)}>Confirmar rechazo</button>
                      <button onClick={()=>setShowRejectNote(p=>({...p,[offer.id]:false}))}>Cancelar</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )
      }

      {/* Pedidos activos */}
      <h3>Pedidos asignados ({activeOrders.length})</h3>
      {activeOrders.length===0?<p>Sin pedidos activos.</p>:(
        <ul style={{listStyle:'none',padding:0}}>
          {activeOrders.map(order=>{
            const loading=loadingStatus[order.id];
            const isOnTheWay=order.status==='on_the_way';
            const isDelivered=order.status==='delivered';
            // Liberar solo disponible antes de "en camino"
            const canRelease=!['on_the_way','delivered','cancelled'].includes(order.status);
            return (
              <li key={order.id} style={{marginBottom:'1.25rem',border:'1px solid #e5e7eb',borderRadius:8,padding:'0.875rem'}}>
                <div style={{display:'flex',justifyContent:'space-between',flexWrap:'wrap'}}>
                  <strong>{STATUS_LABELS[order.status]||order.status}</strong>
                  <strong>{formatMoney(order.total_cents)}</strong>
                </div>
                <div style={{fontSize:'0.85rem',color:'#555'}}>{formatDate(order.created_at)}</div>
                <div><strong>Restaurante:</strong> {order.restaurant_name}</div>
                <div><strong>Cliente:</strong> {order.customer_first_name}</div>
                <div><strong>Dir. retiro:</strong> {order.restaurant_address||'—'}</div>
                <div><strong>Dir. entrega:</strong> {order.customer_address||order.delivery_address||'—'}</div>
                {order.driver_note&&<div style={{color:'#555',fontSize:'0.85rem'}}>📝 {order.driver_note}</div>}
                {(order.items||[]).length>0&&(
                  <ul style={{margin:'0.3rem 0 0 1rem',fontSize:'0.9rem'}}>
                    {order.items.map(i=><li key={i.menuItemId}>{i.name} × {i.quantity} — {formatMoney(i.unitPriceCents*i.quantity)}</li>)}
                  </ul>
                )}

                <div className="row" style={{marginTop:'0.6rem',flexWrap:'wrap'}}>
                  <button
                    disabled={!!loading||order.status!=='ready'}
                    onClick={()=>changeStatus(order.id,'on_the_way')}
                    title={order.status!=='ready'?'El restaurante debe marcar el pedido como listo primero':''}
                  >
                    {loading==='on_the_way'?'…':'🛵 En camino'}
                  </button>
                  <button
                    disabled={!!loading||!isOnTheWay}
                    onClick={()=>changeStatus(order.id,'delivered')}
                  >
                    {loading==='delivered'?'…':'📦 Entregado'}
                  </button>
                  <button
                    disabled={!canRelease}
                    onClick={()=>setShowReleaseNote(p=>({...p,[order.id]:!p[order.id]}))}
                  >
                    Liberar
                  </button>
                </div>

                {/* Nota obligatoria para liberar */}
                {showReleaseNote[order.id]&&(
                  <div style={{marginTop:'0.5rem'}}>
                    <textarea
                      value={releaseNotes[order.id]||''}
                      onChange={e=>setReleaseNotes(p=>({...p,[order.id]:e.target.value}))}
                      placeholder="Motivo para liberar el pedido (obligatorio)…"
                      rows={2} style={{width:'100%',boxSizing:'border-box'}}
                    />
                    <FlashMsg msg={flash[`release_${order.id}`]} />
                    <div className="row">
                      <button onClick={()=>releaseOrderWithNote(order.id)}>Confirmar liberación</button>
                      <button onClick={()=>setShowReleaseNote(p=>({...p,[order.id]:false}))}>Cancelar</button>
                    </div>
                  </div>
                )}

                <FlashMsg msg={flash[order.id]} />
              </li>
            );
          })}
        </ul>
      )}

      {/* Historial semanal */}
      <h3>Historial</h3>
      <HistoryCalendar orders={historyOrders} />
    </section>
  );
}
