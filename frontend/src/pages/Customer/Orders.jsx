import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useRealtimeOrders } from '../../hooks/useRealtimeOrders';

function fmt(cents) { return `$${((cents ?? 0) / 100).toFixed(2)}`; }

// Desglose de tarifas — visible solo para Cliente y Conductor
// total_cents = subtotal neto (lo que ve la Tienda)
// Desglose para Cliente — lo que paga
function FeeBreakdown({ order }) {
  const sub      = order.total_cents          || 0;
  const svc      = order.service_fee_cents    || 0;
  const del_fee  = order.delivery_fee_cents   || 0;
  const tip      = order.tip_cents            || 0;
  const grandTotal = sub + svc + del_fee + tip;
  if (!svc && !del_fee && !tip) return null;
  return (
    <div style={{ fontSize:'0.78rem', color:'var(--gray-500)', borderTop:'1px solid var(--gray-100)', paddingTop:'0.35rem', marginTop:'0.35rem' }}>
      <div style={{ display:'flex', justifyContent:'space-between' }}>
        <span>Subtotal</span><span>{fmt(sub)}</span>
      </div>
      <div style={{ display:'flex', justifyContent:'space-between' }}>
        <span>Tarifa de servicio</span><span>{fmt(svc)}</span>
      </div>
      <div style={{ display:'flex', justifyContent:'space-between' }}>
        <span>Tarifa de envío</span><span>{fmt(del_fee)}</span>
      </div>
      {tip > 0 && (
        <div style={{ display:'flex', justifyContent:'space-between', color:'var(--success)' }}>
          <span>Agradecimiento</span><span>+{fmt(tip)}</span>
        </div>
      )}
      <div style={{ display:'flex', justifyContent:'space-between', fontWeight:700, color:'var(--gray-700)', marginTop:'0.2rem' }}>
        <span>Total</span><span>{fmt(grandTotal)}</span>
      </div>
    </div>
  );
}


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

// Componente local para el input custom de propina — evita re-renders de la lista completa
// Solo actualiza el draft en el padre; el botón "Confirmar propina" del padre envía.
function TipInput({ onValidAmount }) {
  const [val, setVal] = useState('');
  return (
    <div style={{ display:'flex', alignItems:'center', gap:'0.3rem', flexWrap:'wrap' }}>
      <input
        type="text" inputMode="numeric" pattern="[0-9]*" placeholder="$ otro"
        value={val}
        onChange={e => {
          const raw = e.target.value.replace(/[^0-9]/g,'');
          setVal(raw);
          const cents = Math.round(Number(raw) * 100);
          if (cents > 0) onValidAmount(cents);
          else if (raw === '') onValidAmount(0);
        }}
        style={{ width:62, fontSize:'0.75rem', padding:'0.2rem 0.4rem', border:'1px solid var(--gray-200)', borderRadius:6 }}
      />
    </div>
  );
}

export default function CustomerOrders() {
  const { auth } = useAuth();
  const [orders, setOrders]               = useState([]);
  const [tab, setTab]                     = useState('active');
  const [expanded, setExpanded]           = useState(null);
  const [tipDraft, setTipDraft]           = useState({}); // orderId -> cents draft
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
  // Polling 5s: fallback si el SSE pierde eventos
  useEffect(() => {
    if (!auth.token) return;
    const id = setInterval(() => loadDataRef.current?.(), 5000);
    return () => clearInterval(id);
  }, [auth.token]);
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

  async function saveTip(orderId, newCents, isPast, minCents) {
    const val = Math.max(0, Math.round(Number(newCents)));
    if (isPast && val < minCents) return; // backend también lo valida
    try {
      await apiFetch(`/orders/${orderId}/tip`, { method:'PATCH', body: JSON.stringify({ tip_cents: val }) }, auth.token);
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, tip_cents: val } : o));
    } catch (e) { setMsg(e.message || 'Error al guardar agradecimiento'); }
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
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      {/* ── Encabezado fijo ─────────────────────────────────────────── */}
      <div style={{
        flexShrink:0, background:'#fff', borderBottom:'2px solid var(--brand-light)',
        padding:'0.65rem 1rem 0', zIndex:30,
        boxShadow:'0 1px 4px rgba(0,0,0,0.04)'
      }}>
        <div style={{ fontWeight:800, fontSize:'1rem', color:'var(--brand)', letterSpacing:'-0.01em', marginBottom:'0.4rem' }}>
          Mis pedidos
        </div>
        <div style={{ display:'flex', gap:0, borderTop:'1px solid var(--gray-100)' }}>
          {[['active','Activos'],['past','Historial']].map(([val, label]) => (
            <button key={val} onClick={() => setTab(val)}
              style={{
                flex:1, background:'none', border:'none', cursor:'pointer',
                padding:'0.4rem 0.5rem', fontSize:'0.78rem', fontWeight: tab===val ? 800 : 500,
                color: tab===val ? 'var(--brand)' : 'var(--gray-500)',
                borderBottom: tab===val ? '2px solid var(--brand)' : '2px solid transparent',
                marginBottom:'-1px', transition:'color 0.15s'
              }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Contenido scrolleable ─────────────────────────────────── */}
      <div style={{ flex:1, overflowY:'auto', padding:'0.75rem 1rem', paddingBottom:'calc(var(--nav-h-mobile) + 2.5rem)' }}>



      {msg && <p className={`flash ${msg.includes('enviado')||msg.includes('actualiz') ? 'flash-ok':'flash-error'}`} style={{ marginBottom:'0.5rem' }}>{msg}</p>}

      <div style={{ display:'flex', gap:'0.4rem', marginBottom:'1rem' }}>
        {/* tabs se controlan desde el footer — aquí solo el título */}
      </div>

      {/* Activos */}
      {tab==='active' && (
        active.length===0
          ? <p style={{ color:'var(--gray-600)', fontSize:'0.9rem' }}>Sin pedidos activos.</p>
          : (
            <ul className="orders-tab-panel" style={{ listStyle:'none', padding:0 }}>
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
                        <span style={{ fontWeight:700 }}>{fmt((order.total_cents||0)+(order.service_fee_cents||0)+(order.delivery_fee_cents||0)+(order.tip_cents||0))}</span>
                        <span style={{ color:'var(--gray-400)', fontSize:'0.8rem' }}>{isExp?'▲':'▼'}</span>
                      </div>
                    </div>
                    {isExp && (
                      <div style={{ padding:'0 0.75rem 0.75rem', borderTop:`1px solid ${color}22` }}>
                        {/* Método de pago */}
                        {order.payment_method && (
                          <div style={{ fontSize:'0.78rem', color:'var(--gray-500)', marginBottom:'0.3rem', marginTop:'0.35rem' }}>
                            Pago: <strong>{{cash:'Efectivo',card:'Tarjeta',spei:'SPEI'}[order.payment_method]||order.payment_method}</strong>
                          </div>
                        )}
                        <FeeBreakdown order={order} />
                        {/* Preview total en tiempo real según tip draft */}
                        {tipDraft[order.id] !== undefined && tipDraft[order.id] !== order.tip_cents && (() => {
                          const sub     = order.total_cents || 0;
                          const svc     = order.service_fee_cents || 0;
                          const del_fee = order.delivery_fee_cents || 0;
                          const previewTip   = tipDraft[order.id];
                          const previewTotal = sub + svc + del_fee + previewTip;
                          return (
                            <div style={{ fontSize:'0.78rem', background:'#f0fdf4', border:'1px solid #bbf7d0',
                              borderRadius:6, padding:'0.25rem 0.6rem', marginTop:'0.25rem', color:'#166534' }}>
                              Total con agradecimiento: <strong>{fmt(previewTotal)}</strong>
                              {previewTip > 0 && <span style={{ fontWeight:400, marginLeft:'0.3rem' }}>(incl. {fmt(previewTip)})</span>}
                            </div>
                          );
                        })()}
                        {/* Agradecimiento editable en activos */}
                        <div style={{ marginTop:'0.4rem', display:'flex', alignItems:'center', gap:'0.5rem', flexWrap:'wrap' }}>
                          <span style={{ fontSize:'0.78rem', color:'var(--gray-500)' }}>Agradecimiento:</span>
                          <div style={{ display:'flex', gap:'0.25rem', flexWrap:'wrap' }}>
                            {(() => {
                              const sub = order.total_cents || 0;
                              const pcts = [{pct:0,label:'—'},{pct:5,label:'5%'},{pct:10,label:'10%'},{pct:20,label:'20%'}];
                              return pcts.map(({pct,label}) => {
                                const v = pct===0 ? 0 : Math.round(sub * pct / 100);
                                const cur = tipDraft[order.id] ?? order.tip_cents;
                                const sel = cur === v;
                                return (
                                  <button key={pct}
                                    onClick={() => setTipDraft(d => ({...d, [order.id]: v}))}
                                    style={{ padding:'0.2rem 0.5rem', cursor:'pointer',
                                      border:`1px solid ${sel?'var(--success)':'var(--gray-200)'}`,
                                      borderRadius:6, background:sel?'#f0fdf4':'#fff',
                                      color:sel?'var(--success)':'var(--gray-600)',
                                      fontSize:'0.75rem', fontWeight:sel?700:400 }}>
                                    {label}{pct>0&&sub>0?` (${fmt(v)})`:''}
                                  </button>
                                );
                              });
                            })()}
                            <TipInput onValidAmount={cents => setTipDraft(d => ({...d, [order.id]: cents}))} />
                            </div>
                          </div>
                          {/* Botón confirmar tip activos */}
                          {tipDraft[order.id] !== undefined && tipDraft[order.id] !== order.tip_cents && tipDraft[order.id] > 0 && (
                            <button
                              onClick={() => saveTip(order.id, tipDraft[order.id], false, 0)}
                              style={{ marginTop:'0.3rem', padding:'0.25rem 0.9rem', background:'var(--success)', color:'#fff', border:'none', borderRadius:6, fontWeight:700, fontSize:'0.78rem', cursor:'pointer' }}>
                              Confirmar propina
                            </button>
                          )}
                        {order.customer_address && (
                          <div style={{ fontSize:'0.8rem', color:'var(--gray-600)', marginBottom:'0.3rem', marginTop:'0.35rem' }}>
                            Dirección: <strong>{order.customer_address}</strong>
                          </div>
                        )}
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
            <ul className="orders-tab-panel reverse" style={{ listStyle:'none', padding:0 }}>
              {past.slice(0,50).map(o => {
                const color    = STATUS_COLOR[o.status] || '#9ca3af';
                const grandTotal = (o.total_cents||0)+(o.service_fee_cents||0)+(o.delivery_fee_cents||0)+(o.tip_cents||0);
                const isHExp   = expanded === ('h_'+o.id);
                return (
                  <li key={o.id} className="card" style={{ borderLeft:`3px solid ${color}`, marginBottom:'0.6rem', padding:0, overflow:'hidden' }}>
                    <div onClick={() => setExpanded(isHExp ? null : 'h_'+o.id)}
                      style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0.75rem', cursor:'pointer', gap:'0.5rem' }}>
                      <div>
                        <span className="badge" style={{ color, borderColor:`${color}55`, background:`${color}15`, marginRight:'0.5rem', fontSize:'0.7rem' }}>
                          {STATUS_LABELS[o.status]}
                        </span>
                        <span style={{ fontWeight:600, fontSize:'0.875rem' }}>{o.restaurant_name}</span>
                      </div>
                      <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', flexShrink:0 }}>
                        <span style={{ fontWeight:700 }}>{fmt(grandTotal)}</span>
                        <span style={{ color:'var(--gray-400)', fontSize:'0.8rem' }}>{isHExp?'▲':'▼'}</span>
                      </div>
                    </div>
                    {isHExp && (
                      <div style={{ padding:'0 0.75rem 0.75rem', borderTop:`1px solid ${color}22` }}>
                        {/* Método de pago */}
                        {o.payment_method && (
                          <div style={{ fontSize:'0.78rem', color:'var(--gray-500)', marginBottom:'0.3rem' }}>
                            Pago: <strong>{{cash:'Efectivo',card:'Tarjeta',spei:'SPEI'}[o.payment_method]||o.payment_method}</strong>
                          </div>
                        )}
                        <FeeBreakdown order={o} />
                        {(o.items||[]).length > 0 && (
                          <ul style={{ fontSize:'0.82rem', margin:'0.35rem 0 0.35rem 1rem' }}>
                            {o.items.map(i=><li key={i.menuItemId}>{i.name} × {i.quantity}</li>)}
                          </ul>
                        )}
                        {/* Agradecimiento — editable con draft, mínimo = delivered_tip_cents */}
                        {(() => {
                          const minTip  = o.delivered_tip_cents || 0;
                          const draft   = tipDraft[o.id] ?? o.tip_cents ?? minTip;
                          const isDirty = draft !== o.tip_cents;
                          const canSave = draft >= minTip;
                          return (
                            <div style={{ marginTop:'0.35rem' }}>
                              <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', flexWrap:'wrap' }}>
                                <span style={{ fontSize:'0.78rem', color:'var(--gray-500)' }}>Agradecimiento:</span>
                                <div style={{ display:'flex', gap:'0.25rem', flexWrap:'wrap', alignItems:'center' }}>
                                  {[{pct:0,label:'—'},{pct:5,label:'5%'},{pct:10,label:'10%'},{pct:20,label:'20%'}].map(({pct,label}) => {
                                    const sub = o.total_cents || 0;
                                    const cents = pct===0 ? 0 : Math.round(sub * pct / 100);
                                    const sel = draft === cents;
                                    return (
                                      <button key={pct}
                                        onClick={() => setTipDraft(d => ({...d, [o.id]: cents}))}
                                        style={{ padding:'0.2rem 0.5rem', cursor:'pointer',
                                          border:`1px solid ${sel?'var(--success)':'var(--gray-200)'}`,
                                          borderRadius:6,
                                          background: sel?'#f0fdf4':'#fff',
                                          color: sel?'var(--success)':'var(--gray-600)',
                                          fontSize:'0.75rem', fontWeight: sel?700:400 }}>
                                        {label}{pct>0&&sub>0?` (${fmt(cents)})`:''}
                                      </button>
                                    );
                                  })}
                                  <TipInput onValidAmount={cents => setTipDraft(d => ({...d, [o.id]: cents}))} />
                                </div>
                              </div>
                              {minTip > 0 && (
                                <div style={{ fontSize:'0.72rem', color:'var(--gray-400)', marginTop:'0.15rem' }}>
                                  Mínimo al entregar: {fmt(minTip)}
                                </div>
                              )}
                              {isDirty && canSave && draft > 0 && (
                                <div style={{ marginTop:'0.3rem', display:'flex', alignItems:'center', gap:'0.5rem' }}>
                                  <button
                                    onClick={() => saveTip(o.id, draft, true, minTip)}
                                    style={{ padding:'0.25rem 0.9rem', background:'var(--success)', color:'#fff', border:'none', borderRadius:6, fontWeight:700, fontSize:'0.78rem', cursor:'pointer' }}>
                                    Confirmar
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                        {reportingId===o.id ? (
                          <div style={{ display:'flex', flexDirection:'column', gap:'0.3rem', marginTop:'0.3rem' }}>
                            <textarea value={reportText} onChange={e=>setReportText(e.target.value)}
                              placeholder="Describe el problema…" rows={2}
                              style={{ fontSize:'0.82rem', width:'100%', boxSizing:'border-box' }} />
                            <div style={{ display:'flex', gap:'0.3rem' }}>
                              <button className="btn-sm" style={{ background:'var(--danger)', color:'#fff', borderColor:'var(--danger)' }} onClick={()=>sendReport(o.id)}>Enviar reporte</button>
                              <button className="btn-sm" onClick={()=>{ setReportingId(null); setReportText(''); }}>Cancelar</button>
                            </div>
                          </div>
                        ) : (
                          <button className="btn-sm" style={{ fontSize:'0.78rem', marginTop:'0.3rem' }} onClick={()=>setReportingId(o.id)}>Reportar problema</button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )
      )}

      </div>
    </div>
  );
}
