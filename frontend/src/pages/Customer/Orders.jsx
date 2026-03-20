import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useRealtimeOrders } from '../../hooks/useRealtimeOrders';

function fmt(cents) { return `$${((cents ?? 0) / 100).toFixed(2)}`; }

function FeeBreakdown({ order }) {
  const sub      = order.total_cents          || 0;
  const svc      = order.service_fee_cents    || 0;
  const del_fee  = order.delivery_fee_cents   || 0;
  const tip      = order.tip_cents            || 0;
  const grandTotal = sub + svc + del_fee + tip;
  if (!svc && !del_fee && !tip) return null;
  return (
    <div style={{ fontSize:'0.78rem', color:'var(--text-tertiary)', borderTop:'1px solid var(--border-light)', paddingTop:'0.35rem', marginTop:'0.35rem' }}>
    <div style={{ display:'flex', justifyContent:'space-between' }}><span>Subtotal</span><span>{fmt(sub)}</span></div>
    <div style={{ display:'flex', justifyContent:'space-between' }}><span>Tarifa de servicio</span><span>{fmt(svc)}</span></div>
    <div style={{ display:'flex', justifyContent:'space-between' }}><span>Tarifa de envío</span><span>{fmt(del_fee)}</span></div>
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

var STATUS_LABELS = {
  created:'Recibido', assigned:'Asignado', accepted:'Aceptado',
  preparing:'En preparación', ready:'Listo para retiro',
  on_the_way:'En camino', delivered:'Entregado',
  cancelled:'Cancelado', pending_driver:'Buscando conductor',
};
var STATUS_COLOR = {
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
        const map = L.map(ref.current, { zoomControl:false, attributionControl:false }).setView([lat,lng], 15);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { keepBuffer:1 }).addTo(map);
        const marker = L.circleMarker([lat,lng], { radius:9, fillColor:'#2563eb', fillOpacity:1, color:'#fff', weight:2 })
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

  return <div ref={ref} style={{ height:180, borderRadius:8, border:'1px solid var(--border)', marginTop:'0.5rem' }} />;
}

function toDraft(items=[]) {
  const d={};
  items.forEach(i=>{ d[i.menuItemId]=i.quantity; });
  return d;
}

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
    style={{ width:62, fontSize:'0.75rem', padding:'0.2rem 0.4rem', border:'1px solid var(--border)', borderRadius:6 }}
    />
    </div>
  );
}

// ── Chat de pedido ────────────────────────────────────────────────────────────
function OrderChat({ orderId, token }) {
  const [messages,  setMessages]  = useState([]);
  const [text,      setText]      = useState('');
  const [loading,   setLoading]   = useState(true);
  const [sending,   setSending]   = useState(false);
  const bottomRef = useRef(null);
  const { auth } = useAuth();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const d = await apiFetch(`/orders/${orderId}/messages`, {}, token);
        if (!cancelled) setMessages(d.messages || []);
      } catch (_) {}
      finally { if (!cancelled) setLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [orderId, token]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior:'smooth' });
  }, [messages]);

  async function send() {
    if (!text.trim() || sending) return;
    setSending(true);
    const optimistic = { id: Date.now(), sender_id: auth.user?.id, sender_name: 'Tú', sender_role:'customer', text: text.trim(), created_at: new Date().toISOString() };
    setMessages(m => [...m, optimistic]);
    const sent = text.trim();
    setText('');
    try {
      await apiFetch(`/orders/${orderId}/messages`, { method:'POST', body: JSON.stringify({ text: sent }) }, token);
      // Reload to get server message with real id
      const d = await apiFetch(`/orders/${orderId}/messages`, {}, token);
      setMessages(d.messages || []);
    } catch (e) {
      setMessages(m => m.filter(msg => msg.id !== optimistic.id));
      setText(sent);
    }
    finally { setSending(false); }
  }

  if (loading) return <div style={{ fontSize:'0.78rem', color:'var(--text-tertiary)', padding:'0.4rem 0' }}>Cargando mensajes…</div>;

  return (
    <div style={{ marginTop:'0.5rem', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
    {/* Messages */}
    <div style={{ maxHeight:160, overflowY:'auto', padding:'0.5rem 0.65rem', display:'flex', flexDirection:'column', gap:'0.3rem', background:'var(--bg-sunken)' }}>
    {messages.length === 0 && (
      <span style={{ fontSize:'0.75rem', color:'var(--text-tertiary)', textAlign:'center' }}>Sin mensajes aún</span>
    )}
    {messages.map(m => {
      const isMe = m.sender_role === 'customer';
      return (
        <div key={m.id} style={{ display:'flex', flexDirection:'column', alignItems: isMe ? 'flex-end' : 'flex-start' }}>
        <div style={{
          background: isMe ? 'var(--brand)' : 'var(--bg-card)',
              color: isMe ? '#fff' : 'var(--text-primary)',
              border: isMe ? 'none' : '1px solid var(--border)',
              borderRadius: isMe ? '10px 10px 2px 10px' : '10px 10px 10px 2px',
              padding:'0.3rem 0.6rem', fontSize:'0.8rem', maxWidth:'80%',
        }}>
        {m.text}
        </div>
        <span style={{ fontSize:'0.65rem', color:'var(--text-tertiary)', marginTop:'1px' }}>
        {!isMe && `${m.sender_name} · `}
        {new Date(m.created_at).toLocaleTimeString('es-MX', { timeZone:'America/Mexico_City', hour:'2-digit', minute:'2-digit' })}
        </span>
        </div>
      );
    })}
    <div ref={bottomRef} />
    </div>
    {/* Input */}
    <div style={{ display:'flex', borderTop:'1px solid var(--border)', background:'var(--bg-card)' }}>
    <input
    value={text}
    onChange={e => setText(e.target.value)}
    onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
    placeholder="Escribe un mensaje…"
    style={{ flex:1, border:'none', outline:'none', padding:'0.45rem 0.65rem', fontSize:'0.8rem', background:'none' }}
    />
    <button
    onClick={send}
    disabled={!text.trim() || sending}
    style={{ background:'var(--brand)', color:'#fff', border:'none', padding:'0 0.75rem', cursor:'pointer', fontSize:'0.8rem', fontWeight:700, opacity: text.trim() ? 1 : 0.45 }}
    >
    {sending ? '…' : '➤'}
    </button>
    </div>
    </div>
  );
}

// ── Paginación ────────────────────────────────────────────────────────────────
const HISTORY_PAGE = 20;

export default function CustomerOrders() {
  const { auth } = useAuth();
  const [activeOrders,  setActiveOrders]  = useState([]);
  const [pastOrders,    setPastOrders]    = useState([]);
  const [pastOffset,    setPastOffset]    = useState(0);
  const [pastHasMore,   setPastHasMore]   = useState(true);
  const [pastLoading,   setPastLoading]   = useState(false);
  const [tab,           setTab]           = useState('active');
  const [expanded,      setExpanded]      = useState(null);
  const [chatOpen,      setChatOpen]      = useState(null); // orderId | null
  const [tipDraft,      setTipDraft]      = useState({});
  const [driverPos,     setDriverPos]     = useState({});
  const [suggestionFor, setSuggestionFor] = useState('');
  const [suggDrafts,    setSuggDrafts]    = useState({});
  const [reportingId,   setReportingId]   = useState(null);
  const [reportText,    setReportText]    = useState('');
  const [complaintId,   setComplaintId]   = useState(null);
  const [complaintText, setComplaintText] = useState('');
  const [msg,           setMsg]           = useState('');
  const loadDataRef  = useRef(null);
  const sentinelRef  = useRef(null);

  // Rating state
  const [ratingOrder,    setRatingOrder]    = useState(null);
  const [ratingRestStar, setRatingRestStar] = useState(0);
  const [ratingDrvStar,  setRatingDrvStar]  = useState(0);
  const [ratingComment,  setRatingComment]  = useState('');
  const [ratingLoading,  setRatingLoading]  = useState(false);
  const [ratedOrders,    setRatedOrders]    = useState(new Set());

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
    } catch (e) { setMsg(e.message || 'Error al calificar'); }
    finally { setRatingLoading(false); }
  }

  function StarPicker({ value, onChange, label }) {
    return (
      <div style={{ marginBottom:'0.6rem' }}>
      <div style={{ fontSize:'0.78rem', fontWeight:600, color:'var(--text-secondary)', marginBottom:'0.3rem' }}>{label}</div>
      <div style={{ display:'flex', gap:'0.3rem' }}>
      {[1,2,3,4,5].map(s => (
        <button key={s} onClick={() => onChange(s)}
        style={{ fontSize:'1.5rem', background:'none', border:'none', cursor:'pointer',
          padding:'0 0.1rem', opacity: s <= value ? 1 : 0.25,
          filter: s <= value ? 'none' : 'grayscale(1)' }}>
          ⭐
          </button>
      ))}
      </div>
      </div>
    );
  }

  // ── Carga activos (siempre todos, sin paginación) ─────────────────────────
  async function loadActive() {
    if (!auth.token) return;
    try {
      const d = await apiFetch('/orders/my?active=1', {}, auth.token);
      setActiveOrders(d.orders || []);
    } catch (_) {}
  }

  // ── Carga historial paginado ──────────────────────────────────────────────
  // El backend devuelve todos los pedidos mezclados — pedimos limit grande y filtramos
  // los past localmente. Para compensar, pedimos HISTORY_PAGE * 3 por llamada.
  async function loadPastPage(offset, replace = false) {
    if (!auth.token || pastLoading) return;
    setPastLoading(true);
    try {
      const fetchLimit = HISTORY_PAGE * 3;
      const d = await apiFetch(`/orders/my?limit=${fetchLimit}&offset=${offset}`, {}, auth.token);
      const all = d.orders || [];
      const incoming = all.filter(o => ['delivered','cancelled'].includes(o.status));
      setPastOrders(prev => replace ? incoming : [...prev, ...incoming]);
      setPastOffset(offset + all.length); // advance by total fetched, not just past
      setPastHasMore(all.length === fetchLimit); // more pages exist if we got a full batch
    } catch (_) {}
    finally { setPastLoading(false); }
  }

  async function loadData() {
    await loadActive();
    if (tab === 'past' && pastOrders.length === 0) await loadPastPage(0, true);
  }

  useEffect(() => { loadDataRef.current = loadData; });

  useEffect(() => {
    // Evitar recarga si ya hay datos — SplitLayout puede montar este panel
    // al navegar a RestaurantPage sin desmontarlo; la recarga la maneja el polling
    if (activeOrders.length === 0) loadActive();
  }, [auth.token]);

    useEffect(() => {
      if (tab === 'past' && pastOrders.length === 0) loadPastPage(0, true);
    }, [tab]);

      // IntersectionObserver — cargar más al llegar al fondo del historial
      useEffect(() => {
        if (tab !== 'past') return;
        const el = sentinelRef.current;
        if (!el) return;
        const obs = new IntersectionObserver(entries => {
          if (entries[0].isIntersecting && pastHasMore && !pastLoading) {
            loadPastPage(pastOffset);
          }
        }, { threshold: 0.1 });
        obs.observe(el);
        return () => obs.disconnect();
      }, [tab, pastHasMore, pastLoading, pastOffset]);

      // Polling 5s para activos
      useEffect(() => {
        if (!auth.token) return;
        const id = setInterval(() => loadActive(), 5000);
        return () => clearInterval(id);
      }, [auth.token]);

      useRealtimeOrders(
        auth.token,
        () => loadDataRef.current?.(),
                        ({ orderId, lat, lng }) => setDriverPos(p => ({ ...p, [orderId]:{ lat, lng } }))
      );

      const pendingSuggestions = useMemo(
        () => activeOrders.filter(o => o.suggestion_status==='pending_customer' && (o.suggestion_items||[]).length>0),
                                         [activeOrders]
      );

      async function sendComplaint(orderId) {
        if (!complaintText.trim()) return;
        try {
          await apiFetch(`/orders/${orderId}/complaint`,
                         { method:'POST', body: JSON.stringify({ text: complaintText.trim() }) }, auth.token);
          setMsg('Queja enviada. La revisaremos pronto.');
          setComplaintId(null); setComplaintText('');
          setTimeout(() => setMsg(''), 4000);
        } catch (e) { setMsg(e.message); }
      }

      async function cancelOrder(orderId) {
        const note = window.prompt('Motivo de cancelación (obligatorio):');
        if (!note?.trim()) return;
        try {
          await apiFetch(`/orders/${orderId}/cancel`, { method:'PATCH', body: JSON.stringify({ note }) }, auth.token);
          loadActive();
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
            const draft = suggDrafts[orderId] || {};
            const items = Object.entries(draft)
            .filter(([,q]) => Number(q) > 0)
            .map(([menuItemId, qty]) => ({ menuItemId, quantity: Number(qty) }));
            if (items.length > 0) body.items = items;
          }
          await apiFetch(`/orders/${orderId}/suggestion-response`, {
            method:'PATCH', body: JSON.stringify(body)
          }, auth.token);
          setSuggestionFor(''); loadActive();
        } catch (e) { setMsg(e.message); }
      }

      async function saveTip(orderId, newCents, isPast, minCents) {
        const val = Math.max(0, Math.round(Number(newCents)));
        if (isPast && val < minCents) return;
        try {
          await apiFetch(`/orders/${orderId}/tip`, { method:'PATCH', body: JSON.stringify({ tip_cents: val }) }, auth.token);
          if (isPast) {
            setPastOrders(prev => prev.map(o => o.id === orderId ? { ...o, tip_cents: val } : o));
          } else {
            setActiveOrders(prev => prev.map(o => o.id === orderId ? { ...o, tip_cents: val } : o));
          }
        } catch (_) {}
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

      return (
        <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>

        {/* ── Modal calificación ─────────────────────────────────────── */}
        {ratingOrder && (
          <div style={{
            position:'fixed', inset:0, zIndex:9000,
            background:'rgba(0,0,0,0.45)',
                         display:'flex', alignItems:'flex-end', justifyContent:'center',
                         padding:`0 0 env(safe-area-inset-bottom,0px)`,
          }}>
          <div style={{ background:'var(--bg-card)', borderRadius:'18px 18px 0 0', padding:'1.5rem 1.25rem 1.75rem',
            width:'100%', maxWidth:480, boxShadow:'0 -4px 32px rgba(0,0,0,0.18)' }}>
            <div style={{ fontWeight:800, fontSize:'1rem', marginBottom:'0.25rem' }}>⭐ Calificar pedido</div>
            <div style={{ fontSize:'0.82rem', color:'var(--text-tertiary)', marginBottom:'1rem' }}>
            {ratingOrder.restaurant_name}
            </div>
            <StarPicker value={ratingRestStar} onChange={setRatingRestStar} label="Tienda / Restaurante" />
            {ratingOrder.driver_id && (
              <StarPicker value={ratingDrvStar} onChange={setRatingDrvStar} label="Conductor (opcional)" />
            )}
            <div style={{ marginBottom:'0.75rem' }}>
            <div style={{ fontSize:'0.78rem', fontWeight:600, color:'var(--text-secondary)', marginBottom:'0.3rem' }}>Comentario (opcional)</div>
            <textarea value={ratingComment} onChange={e => setRatingComment(e.target.value)}
            placeholder="¿Qué tal estuvo tu experiencia?" rows={2}
            style={{ width:'100%', fontSize:'0.85rem', resize:'none', boxSizing:'border-box' }} />
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
            <button onClick={submitRating} disabled={ratingRestStar < 1 || ratingLoading}
            style={{ background:'var(--brand)', color:'#fff', border:'none', borderRadius:10,
              padding:'0.75rem', fontSize:'0.95rem', fontWeight:700, cursor:'pointer',
              opacity: ratingRestStar < 1 ? 0.5 : 1 }}>
              {ratingLoading ? 'Enviando…' : 'Enviar calificación'}
              </button>
              <button onClick={() => setRatingOrder(null)}
              style={{ background:'none', border:'none', color:'var(--text-tertiary)', padding:'0.4rem', cursor:'pointer', fontSize:'0.875rem' }}>
              Ahora no
              </button>
              </div>
              </div>
              </div>
        )}

        {/* ── Encabezado fijo ─────────────────────────────────────────── */}
        <div style={{
          flexShrink:0, background:'var(--bg-card)', borderBottom:'2px solid var(--border)',
              padding:'0.65rem 1rem 0', zIndex:30,
              boxShadow:'0 1px 4px rgba(0,0,0,0.04)'
        }}>
        <div style={{ fontWeight:800, fontSize:'1rem', color:'var(--brand)', letterSpacing:'-0.01em', marginBottom:'0.4rem' }}>
        Mis pedidos
        </div>
        <div style={{ display:'flex', gap:0, borderTop:'1px solid var(--border-light)' }}>
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

        {/* ── Activos ──────────────────────────────────────────────── */}
        {tab==='active' && (
          activeOrders.length===0
          ? <p style={{ color:'var(--text-secondary)', fontSize:'0.9rem' }}>Sin pedidos activos.</p>
          : (
            <ul className="orders-tab-panel" style={{ listStyle:'none', padding:0 }}>
            {activeOrders.map(order => {
              const color = STATUS_COLOR[order.status]||'#9ca3af';
              const pos   = driverPos[order.id];
              const isExp = expanded===order.id;
              const isChatOpen = chatOpen === order.id;
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
                <span style={{ color:'var(--text-tertiary)', fontSize:'0.8rem' }}>{isExp?'▲':'▼'}</span>
                </div>
                </div>
                {isExp && (
                  <div style={{ padding:'0 0.75rem 0.75rem', borderTop:`1px solid ${color}22` }}>
                  {order.payment_method && (
                    <div style={{ fontSize:'0.78rem', color:'var(--text-tertiary)', marginBottom:'0.3rem', marginTop:'0.35rem' }}>
                    Pago: <strong>{{cash:'Efectivo',card:'Tarjeta',spei:'SPEI'}[order.payment_method]||order.payment_method}</strong>
                    </div>
                  )}
                  <FeeBreakdown order={order} />
                  {tipDraft[order.id] !== undefined && tipDraft[order.id] !== order.tip_cents && (() => {
                    const sub=order.total_cents||0, svc=order.service_fee_cents||0, del_fee=order.delivery_fee_cents||0;
                    const previewTip=tipDraft[order.id], previewTotal=sub+svc+del_fee+previewTip;
                    return (
                      <div style={{ fontSize:'0.78rem', background:'var(--success-bg)', border:'1px solid var(--success-border)',
                        borderRadius:6, padding:'0.25rem 0.6rem', marginTop:'0.25rem', color:'var(--success)' }}>
                        Total con agradecimiento: <strong>{fmt(previewTotal)}</strong>
                        {previewTip > 0 && <span style={{ fontWeight:400, marginLeft:'0.3rem' }}>(incl. {fmt(previewTip)})</span>}
                        </div>
                    );
                  })()}
                  <div style={{ marginTop:'0.4rem', display:'flex', alignItems:'center', gap:'0.5rem', flexWrap:'wrap' }}>
                  <span style={{ fontSize:'0.78rem', color:'var(--text-tertiary)' }}>Agradecimiento:</span>
                  <div style={{ display:'flex', gap:'0.25rem', flexWrap:'wrap' }}>
                  {(() => {
                    const sub = order.total_cents || 0;
                    return [{pct:0,label:'—'},{pct:5,label:'5%'},{pct:10,label:'10%'},{pct:20,label:'20%'}].map(({pct,label}) => {
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
                  {tipDraft[order.id] !== undefined && tipDraft[order.id] !== order.tip_cents && tipDraft[order.id] > 0 && (
                    <button
                    onClick={() => saveTip(order.id, tipDraft[order.id], false, 0)}
                    style={{ marginTop:'0.3rem', padding:'0.25rem 0.9rem', background:'var(--success)', color:'#fff', border:'none', borderRadius:6, fontWeight:700, fontSize:'0.78rem', cursor:'pointer' }}>
                    Confirmar propina
                    </button>
                  )}
                  {order.customer_address && (
                    <div style={{ fontSize:'0.8rem', color:'var(--text-secondary)', marginBottom:'0.3rem', marginTop:'0.35rem' }}>
                    Dirección: <strong>{order.customer_address}</strong>
                    </div>
                  )}
                  <div style={{ fontSize:'0.83rem', color:'var(--text-secondary)', marginBottom:'0.35rem' }}>
                  Conductor: <strong>{order.driver_first_name||'Buscando…'}</strong>
                  </div>
                  {(order.items||[]).length>0 && (
                    <ul style={{ fontSize:'0.83rem', margin:'0 0 0.4rem 1rem' }}>
                    {order.items.map(i=><li key={i.menuItemId}>{i.name} × {i.quantity}</li>)}
                    </ul>
                  )}
                  {['on_the_way','assigned','accepted','preparing','ready'].includes(order.status) && pos && (
                    <DriverMap lat={pos.lat} lng={pos.lng} driverName={order.driver_first_name} />
                  )}
                  {order.status==='on_the_way' && !pos && (
                    <p style={{ fontSize:'0.8rem', color:'var(--text-tertiary)', fontStyle:'italic', marginTop:'0.4rem' }}>
                    Actualizando ubicación del conductor…
                    </p>
                  )}

                  {/* ── Chat ── */}
                  <button
                  onClick={() => setChatOpen(isChatOpen ? null : order.id)}
                  style={{ marginTop:'0.5rem', display:'flex', alignItems:'center', gap:'0.35rem',
                    background:'none', border:'1px solid var(--border)', borderRadius:6,
                           padding:'0.25rem 0.65rem', fontSize:'0.78rem', cursor:'pointer',
                           color:'var(--text-secondary)', fontWeight:600 }}>
                           💬 {isChatOpen ? 'Cerrar chat' : 'Chat del pedido'}
                           </button>
                           {isChatOpen && <OrderChat orderId={order.id} token={auth.token} />}

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

        {/* ── Historial ────────────────────────────────────────────── */}
        {tab==='past' && (
          pastOrders.length===0 && !pastLoading
          ? <p style={{ color:'var(--text-secondary)', fontSize:'0.9rem' }}>Sin pedidos anteriores.</p>
          : (
            <>
            <ul className="orders-tab-panel reverse" style={{ listStyle:'none', padding:0 }}>
            {pastOrders.map(o => {
              const color    = STATUS_COLOR[o.status] || '#9ca3af';
              const grandTotal = (o.total_cents||0)+(o.service_fee_cents||0)+(o.delivery_fee_cents||0)+(o.tip_cents||0);
              const isHExp   = expanded === ('h_'+o.id);
              const isChatOpen = chatOpen === o.id;
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
                <span style={{ color:'var(--text-tertiary)', fontSize:'0.8rem' }}>{isHExp?'▲':'▼'}</span>
                </div>
                </div>
                {isHExp && (
                  <div style={{ padding:'0 0.75rem 0.75rem', borderTop:`1px solid ${color}22` }}>
                  {o.payment_method && (
                    <div style={{ fontSize:'0.78rem', color:'var(--text-tertiary)', marginBottom:'0.3rem' }}>
                    Pago: <strong>{{cash:'Efectivo',card:'Tarjeta',spei:'SPEI'}[o.payment_method]||o.payment_method}</strong>
                    </div>
                  )}
                  <FeeBreakdown order={o} />
                  {(o.items||[]).length > 0 && (
                    <ul style={{ fontSize:'0.82rem', margin:'0.35rem 0 0.35rem 1rem' }}>
                    {o.items.map(i=><li key={i.menuItemId}>{i.name} × {i.quantity}</li>)}
                    </ul>
                  )}
                  {/* Propina historial */}
                  {(() => {
                    const minTip  = o.delivered_tip_cents || 0;
                    const draft   = tipDraft[o.id] ?? o.tip_cents ?? minTip;
                    const isDirty = draft !== o.tip_cents;
                    const canSave = draft >= Math.max(minTip, o.tip_cents || 0);
                    return (
                      <div style={{ marginTop:'0.35rem' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', flexWrap:'wrap' }}>
                      <span style={{ fontSize:'0.78rem', color:'var(--text-tertiary)' }}>Agradecimiento:</span>
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
                                borderRadius:6, background: sel?'#f0fdf4':'#fff',
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
                        <div style={{ fontSize:'0.72rem', color:'var(--text-tertiary)', marginTop:'0.15rem' }}>
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

                  {/* Chat historial */}
                  <button
                  onClick={() => setChatOpen(isChatOpen ? null : o.id)}
                  style={{ marginTop:'0.4rem', display:'flex', alignItems:'center', gap:'0.35rem',
                    background:'none', border:'1px solid var(--border)', borderRadius:6,
                            padding:'0.25rem 0.65rem', fontSize:'0.78rem', cursor:'pointer',
                            color:'var(--text-secondary)', fontWeight:600 }}>
                            💬 {isChatOpen ? 'Cerrar chat' : 'Ver chat'}
                            </button>
                            {isChatOpen && <OrderChat orderId={o.id} token={auth.token} />}

                            {/* Reporte / queja */}
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
                            ) : complaintId===o.id ? (
                              <div style={{ display:'flex', flexDirection:'column', gap:'0.3rem', marginTop:'0.3rem' }}>
                              <div style={{ fontSize:'0.78rem', color:'var(--danger)', fontWeight:600, marginBottom:'0.1rem' }}>
                              Queja formal — se envía al equipo de soporte
                              </div>
                              <textarea value={complaintText} onChange={e=>setComplaintText(e.target.value)}
                              placeholder="Describe el problema con detalle…" rows={3}
                              style={{ fontSize:'0.82rem', width:'100%', boxSizing:'border-box' }} />
                              <div style={{ display:'flex', gap:'0.3rem' }}>
                              <button className="btn-sm btn-danger" onClick={()=>sendComplaint(o.id)}>Enviar queja</button>
                              <button className="btn-sm" onClick={()=>{ setComplaintId(null); setComplaintText(''); }}>Cancelar</button>
                              </div>
                              </div>
                            ) : (
                              <div style={{ display:'flex', gap:'0.4rem', flexWrap:'wrap', marginTop:'0.3rem' }}>
                              {o.status === 'delivered' && !ratedOrders.has(o.id) && (
                                <button className="btn-sm"
                                style={{ background:'var(--brand-light)', color:'var(--brand)', borderColor:'var(--brand)', fontSize:'0.78rem', fontWeight:700 }}
                                onClick={() => { setRatingOrder(o); setRatingRestStar(0); setRatingDrvStar(0); setRatingComment(''); }}>
                                ⭐ Calificar
                                </button>
                              )}
                              {ratedOrders.has(o.id) && (
                                <span style={{ fontSize:'0.75rem', color:'var(--success)', fontWeight:600 }}>✓ Calificado</span>
                              )}
                              <button className="btn-sm" style={{ fontSize:'0.78rem' }} onClick={()=>setReportingId(o.id)}>Reportar problema</button>
                              {o.status === 'delivered' && (
                                <button className="btn-sm" style={{ fontSize:'0.78rem', color:'var(--danger)', borderColor:'var(--danger-border)' }}
                                onClick={()=>{ setComplaintId(o.id); setReportingId(null); }}>
                                Queja formal
                                </button>
                              )}
                              </div>
                            )}
                            </div>
                )}
                </li>
              );
            })}
            </ul>

            {/* Sentinel — IntersectionObserver carga el siguiente batch al llegar aquí */}
            <div ref={sentinelRef} style={{ height:1 }} />
            {pastLoading && (
              <p style={{ color:'var(--text-tertiary)', fontSize:'0.85rem', textAlign:'center', padding:'0.75rem 0' }}>
              Cargando…
              </p>
            )}
            {!pastHasMore && pastOrders.length > 0 && (
              <p style={{ color:'var(--text-tertiary)', fontSize:'0.78rem', textAlign:'center', padding:'0.5rem 0' }}>
              — fin del historial —
              </p>
            )}
            </>
          )
        )}
        </div>
        </div>
      );
}
