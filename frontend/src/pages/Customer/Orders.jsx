import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useRealtimeOrders } from '../../hooks/useRealtimeOrders';

function fmt(cents) { return `$${((cents ?? 0) / 100).toFixed(2)}`; }

const STATUS_LABELS = {
  created:'Recibido', assigned:'Asignado', accepted:'Aceptado',
  preparing:'En preparación', ready:'Listo para retiro',
  on_the_way:'En camino', delivered:'Entregado',
  cancelled:'Cancelado', pending_driver:'Buscando conductor',
};
const STATUS_COLOR = {
  created:'#f59e0b', assigned:'#3b82f6', accepted:'#8b5cf6',
  preparing:'#f97316', ready:'#16a34a', on_the_way:'#0891b2',
  delivered:'#16a34a', cancelled:'#dc2626', pending_driver:'#ef4444',
};

function ensureLeafletCSS() {
  if (document.getElementById('leaflet-css')) return;
  const lnk = document.createElement('link');
  lnk.id='leaflet-css'; lnk.rel='stylesheet';
  lnk.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  document.head.appendChild(lnk);
}

function DriverMap({ lat, lng, driverName }) {
  const ref    = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    ensureLeafletCSS();
    const t = setTimeout(() => {
      import('leaflet').then(L => {
        if (!ref.current || mapRef.current) return;
        delete L.Icon.Default.prototype._getIconUrl;
        L.Icon.Default.mergeOptions({
          iconRetinaUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
          iconUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
          shadowUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
        });
        const map = L.map(ref.current, { zoomControl:false, attributionControl:false })
          .setView([lat,lng], 15);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { keepBuffer:1 }).addTo(map);
        const marker = L.circleMarker([lat,lng],
          { radius:9, fillColor:'#2563eb', fillOpacity:1, color:'#fff', weight:2 })
          .addTo(map).bindPopup(driverName||'Conductor');
        mapRef.current = { map, marker };
        setTimeout(() => map.invalidateSize(), 200);
      }).catch(()=>{});
    }, 50);
    return () => {
      clearTimeout(t);
      if (mapRef.current?.map) { mapRef.current.map.remove(); mapRef.current=null; }
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.marker?.setLatLng([lat,lng]);
    mapRef.current.map?.panTo([lat,lng],{animate:true,duration:0.5});
  }, [lat,lng]);

  return <div ref={ref} style={{ height:180, borderRadius:8, border:'1px solid var(--gray-200)', marginTop:'0.5rem' }} />;
}

function toDraft(items=[]) {
  const d={};
  items.forEach(i=>{ d[i.menuItemId]=i.quantity; });
  return d;
}

export default function CustomerOrders() {
  const { auth } = useAuth();
  const [orders, setOrders]               = useState([]);
  const [tab, setTab]                     = useState('active');
  const [expanded, setExpanded]           = useState(null);
  const [driverPos, setDriverPos]         = useState({});
  const [suggestionFor, setSuggestionFor] = useState('');
  const [suggDrafts, setSuggDrafts]       = useState({});
  const [reportingId, setReportingId]     = useState(null);
  const [reportText, setReportText]       = useState('');
  const [msg, setMsg] = useState('');
  const loadDataRef = useRef(null);

  async function loadData() {
    if (!auth.token) return;
    try {
      const d = await apiFetch('/orders/my', {}, auth.token);
      setOrders(d.orders || []);
    } catch (_) {}
  }

  useEffect(() => { loadDataRef.current = loadData; });
  useEffect(() => { loadData(); }, [auth.token]);
  useRealtimeOrders(
    auth.token,
    () => loadDataRef.current?.(),
    ({ orderId, lat, lng }) => setDriverPos(p => ({ ...p, [orderId]:{ lat, lng } }))
  );

  const active = useMemo(() => orders.filter(o => !['delivered','cancelled'].includes(o.status)), [orders]);
  const past   = useMemo(() => orders.filter(o =>  ['delivered','cancelled'].includes(o.status)), [orders]);
  const pendingSuggestions = useMemo(
    () => orders.filter(o => o.suggestion_status==='pending_customer' && (o.suggestion_items||[]).length>0),
    [orders]
  );

  async function cancelOrder(orderId) {
    const note = window.prompt('Motivo de cancelación (obligatorio):');
    if (!note?.trim()) return;
    try {
      await apiFetch(`/orders/${orderId}/cancel`, { method:'PATCH', body: JSON.stringify({ note }) }, auth.token);
      loadData();
    } catch (e) { setMsg(e.message); }
  }

  const [restaurantMenus, setRestaurantMenus] = useState({});
  async function loadMenu(restaurantId) {
    if (!restaurantId || restaurantMenus[restaurantId]) return;
    try {
      const d = await apiFetch(`/restaurants/${restaurantId}/menu`, {}, auth.token);
      setRestaurantMenus(prev => ({ ...prev, [restaurantId]: d.menu || [] }));
    } catch (_) {}
  }

  function openSuggestion(order) {
    setSuggestionFor(order.id);
    setSuggDrafts(prev => ({ ...prev, [order.id]: prev[order.id] || toDraft(order.suggestion_items||[]) }));
    if (order.restaurant_id) loadMenu(order.restaurant_id);
  }

  function adjustSugg(orderId, menuItemId, delta) {
    setSuggDrafts(prev => {
      const cur = prev[orderId]||{};
      return { ...prev, [orderId]: { ...cur, [menuItemId]: Math.max(0,(cur[menuItemId]||0)+delta) } };
    });
  }

  async function respondSuggestion(orderId, accepted) {
    try {
      const body = { accepted };
      if (accepted) {
        // Enviar SIEMPRE los items del cliente — son los que deben aplicarse
        const draft = suggDrafts[orderId] || {};
        const items = Object.entries(draft)
          .filter(([,q]) => Number(q) > 0)
          .map(([menuItemId, qty]) => ({ menuItemId, quantity: Number(qty) }));
        if (items.length > 0) body.items = items;
      }
      await apiFetch(`/orders/${orderId}/suggestion-response`, {
        method:'PATCH', body: JSON.stringify(body)
      }, auth.token);
      setSuggestionFor(''); loadData();
    } catch (e) { setMsg(e.message); }
  }

  async function sendReport(orderId) {
    if (!reportText.trim()) return;
    try {
      await apiFetch(`/orders/${orderId}/report`, {
        method:'POST', body: JSON.stringify({ text: reportText, reason:'customer_report' })
      }, auth.token);
      setReportingId(null); setReportText(''); setMsg('Reporte enviado');
      setTimeout(() => setMsg(''), 3000);
    } catch (e) { setMsg(e.message); }
  }

  const tabStyle = (t) => ({
    padding:'0.4rem 1rem', cursor:'pointer', border:'none', borderRadius:6,
    fontWeight:600, fontSize:'0.875rem', transition:'background 0.15s',
    background: tab===t ? 'var(--brand)':'var(--gray-100)',
    color:      tab===t ? '#fff':'var(--gray-600)',
  });

  return (
    <div>
      <h2 style={{ fontSize:'1.1rem', fontWeight:800, marginBottom:'1rem' }}>Mis pedidos</h2>

      {/* ── Sugerencias flotantes ─────────────────────────────────────── */}
      {pendingSuggestions.map(order => (
        <div key={`sug-${order.id}`} style={{
          background:'#fffbeb', border:'2px solid #f59e0b', borderRadius:10,
          padding:'0.875rem', marginBottom:'0.75rem', position:'relative',
        }}>
          {/* Botón cerrar grande para móvil */}
          <button
            onClick={() => setSuggestionFor('')}
            style={{ position:'absolute', top:8, right:8, width:36, height:36, borderRadius:'50%', border:'none', background:'#f3f4f6', cursor:'pointer', fontSize:'1.1rem', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700 }}
          >✕</button>

          <p style={{ fontWeight:700, fontSize:'0.875rem', color:'#92400e', marginBottom:'0.5rem', paddingRight:'2.5rem' }}>
            {order.restaurant_name} propone un cambio
          </p>

          {suggestionFor === order.id ? (
            <>
              <div style={{ display:'flex', flexDirection:'column', gap:'0.3rem', marginBottom:'0.65rem' }}>
                {(restaurantMenus[order.restaurant_id] || order.suggestion_items || []).map(item => {
                  const id  = item.id || item.menuItemId;
                  const qty = (suggDrafts[order.id]||{})[id] ?? (order.suggestion_items||[]).find(s=>s.menuItemId===id)?.quantity ?? 0;
                  return (
                    <div key={id} style={{
                      display:'flex', alignItems:'center', gap:'0.5rem',
                      background: qty>0 ? 'var(--brand-light)':'#fff',
                      border:`1px solid ${qty>0 ? '#bfdbfe':'var(--gray-200)'}`,
                      borderRadius:6, padding:'0.4rem 0.75rem',
                    }}>
                      <span style={{ flex:1, fontSize:'0.875rem', fontWeight: qty>0 ? 600:400 }}>{item.name}</span>
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
              {order.suggestion_note && (
                <p style={{ fontSize:'0.82rem', color:'#92400e', marginBottom:'0.5rem', fontStyle:'italic' }}>
                  Nota: {order.suggestion_note}
                </p>
              )}
              {/* Total en tiempo real basado en cantidades del cliente */}
              {(() => {
                const draft = suggDrafts[order.id] || {};
                const allItems = restaurantMenus[order.restaurant_id] || order.suggestion_items || [];
                const total = allItems.reduce((s, item) => {
                  const id = item.id || item.menuItemId;
                  const pc = item.price_cents || item.unitPriceCents || 0;
                  return s + (Number(draft[id]) || 0) * pc;
                }, 0);
                return total > 0 ? (
                  <div style={{ fontWeight:700, fontSize:'0.9rem', color:'var(--brand)', marginBottom:'0.4rem', textAlign:'right' }}>
                    Total: {fmt(total)}
                  </div>
                ) : null;
              })()}
              <div style={{ display:'flex', gap:'0.4rem', flexWrap:'wrap' }}>
                <button className="btn-primary btn-sm" onClick={()=>respondSuggestion(order.id,true)}>Aceptar</button>
                <button className="btn-sm btn-danger" onClick={()=>respondSuggestion(order.id,false)}>Rechazar</button>
                <button className="btn-sm" onClick={()=>cancelOrder(order.id)}>Cancelar pedido</button>
              </div>
            </>
          ) : (
            <button onClick={()=>openSuggestion(order)}
              style={{ background:'#f59e0b', color:'#fff', border:'none', borderRadius:6, padding:'0.45rem 1rem', fontWeight:700, cursor:'pointer', fontSize:'0.875rem' }}>
              Ver propuesta
            </button>
          )}
        </div>
      ))}

      {msg && <p className={`flash ${msg.includes('enviado')||msg.includes('actualiz') ? 'flash-ok':'flash-error'}`} style={{ marginBottom:'0.5rem' }}>{msg}</p>}

      <div style={{ display:'flex', gap:'0.4rem', marginBottom:'1rem' }}>
        <button style={tabStyle('active')} onClick={()=>setTab('active')}>Activos ({active.length})</button>
        <button style={tabStyle('past')}   onClick={()=>setTab('past')}>Historial ({past.length})</button>
      </div>

      {/* Activos */}
      {tab==='active' && (
        active.length===0
          ? <p style={{ color:'var(--gray-600)', fontSize:'0.9rem' }}>Sin pedidos activos.</p>
          : (
            <ul style={{ listStyle:'none', padding:0 }}>
              {active.map(order => {
                const color = STATUS_COLOR[order.status]||'#9ca3af';
                const pos   = driverPos[order.id];
                const isExp = expanded===order.id;
                return (
                  <li key={order.id} className="card" style={{ borderLeft:`3px solid ${color}`, marginBottom:'0.6rem', padding:0, overflow:'hidden' }}>
                    <div onClick={()=>setExpanded(isExp?null:order.id)}
                      style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0.75rem', cursor:'pointer', gap:'0.5rem' }}>
                      <div>
                        <span className="badge" style={{ color, borderColor:`${color}55`, background:`${color}15`, marginRight:'0.5rem' }}>
                          {STATUS_LABELS[order.status]}
                        </span>
                        <span style={{ fontWeight:700, fontSize:'0.875rem' }}>{order.restaurant_name}</span>
                      </div>
                      <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', flexShrink:0 }}>
                        <span style={{ fontWeight:700 }}>{fmt(order.total_cents)}</span>
                        <span style={{ color:'var(--gray-400)', fontSize:'0.8rem' }}>{isExp?'▲':'▼'}</span>
                      </div>
                    </div>
                    {isExp && (
                      <div style={{ padding:'0 0.75rem 0.75rem', borderTop:`1px solid ${color}22` }}>
                        <div style={{ fontSize:'0.83rem', color:'var(--gray-600)', marginBottom:'0.35rem' }}>
                          Conductor: <strong>{order.driver_first_name||'Buscando…'}</strong>
                        </div>
                        {(order.items||[]).length>0 && (
                          <ul style={{ fontSize:'0.83rem', margin:'0 0 0.4rem 1rem' }}>
                            {order.items.map(i=><li key={i.menuItemId}>{i.name} × {i.quantity}</li>)}
                          </ul>
                        )}
                        {/* Mapa conductor — visible en cuanto haya posición, no solo on_the_way */}
                        {['on_the_way','assigned','accepted','preparing','ready'].includes(order.status) && pos && (
                          <DriverMap lat={pos.lat} lng={pos.lng} driverName={order.driver_first_name} />
                        )}
                        {order.status==='on_the_way' && !pos && (
                          <p style={{ fontSize:'0.8rem', color:'var(--gray-400)', fontStyle:'italic', marginTop:'0.4rem' }}>
                            Actualizando ubicación del conductor…
                          </p>
                        )}
                        {['created','pending_driver','assigned','accepted'].includes(order.status) && (
                          <button className="btn-sm btn-danger" onClick={()=>cancelOrder(order.id)} style={{ marginTop:'0.5rem' }}>
                            Cancelar pedido
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )
      )}

      {/* Historial */}
      {tab==='past' && (
        past.length===0
          ? <p style={{ color:'var(--gray-600)', fontSize:'0.9rem' }}>Sin pedidos anteriores.</p>
          : (
            <ul style={{ listStyle:'none', padding:0 }}>
              {past.slice(0,30).map(o => (
                <li key={o.id} className="card" style={{ marginBottom:'0.5rem', padding:'0.75rem' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.35rem' }}>
                    <span className="badge" style={{ color:STATUS_COLOR[o.status], borderColor:`${STATUS_COLOR[o.status]}55`, background:`${STATUS_COLOR[o.status]}15`, fontSize:'0.72rem' }}>{STATUS_LABELS[o.status]}</span>
                    <span style={{ fontWeight:700 }}>{fmt(o.total_cents)}</span>
                  </div>
                  <div style={{ fontSize:'0.82rem', color:'var(--gray-600)', marginBottom:'0.4rem' }}>{o.restaurant_name}</div>
                  {reportingId===o.id ? (
                    <div style={{ display:'flex', flexDirection:'column', gap:'0.3rem', marginTop:'0.4rem' }}>
                      <textarea value={reportText} onChange={e=>setReportText(e.target.value)}
                        placeholder="Describe el problema…" rows={2}
                        style={{ fontSize:'0.82rem', width:'100%', boxSizing:'border-box' }} />
                      <div style={{ display:'flex', gap:'0.3rem' }}>
                        <button className="btn-sm" style={{ background:'var(--danger)', color:'#fff', borderColor:'var(--danger)' }} onClick={()=>sendReport(o.id)}>Enviar reporte</button>
                        <button className="btn-sm" onClick={()=>{ setReportingId(null); setReportText(''); }}>Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <button className="btn-sm" style={{ fontSize:'0.78rem' }} onClick={()=>setReportingId(o.id)}>Reportar</button>
                  )}
                </li>
              ))}
            </ul>
          )
      )}
    </div>
  );
}
