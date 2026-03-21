import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useRealtimeOrders } from '../../hooks/useRealtimeOrders';
import { useAppBadge } from '../../hooks/useAppBadge';

function fmt(cents) { return `$${((cents ?? 0) / 100).toFixed(2)}`; }

// ── Iconos SVG ────────────────────────────────────────────────────────────────
function IconOrders() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ display:'block' }}>
      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
      <rect x="9" y="3" width="6" height="4" rx="1"/>
      <path d="M9 12h6M9 16h4"/>
    </svg>
  );
}
function IconClock() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display:'block' }}>
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>
  );
}

// ── Desglose para Tienda ──────────────────────────────────────────────────────
function FeeBreakdown({ order }) {
  const sub    = order.total_cents           || 0;
  const resFee = order.restaurant_fee_cents  || 0;
  const neto   = sub - resFee;
  if (!sub) return null;
  return (
    <div style={{ fontSize:'0.78rem', color:'var(--text-tertiary)', borderTop:'1px solid var(--border-light)', paddingTop:'0.35rem', marginTop:'0.35rem' }}>
      <div style={{ display:'flex', justifyContent:'space-between' }}>
        <span>Subtotal del pedido</span><span>{fmt(sub)}</span>
      </div>
      <div style={{ display:'flex', justifyContent:'space-between', color:'var(--danger)' }}>
        <span>Tarifa de servicio</span><span>−{fmt(resFee)}</span>
      </div>
      <div style={{ display:'flex', justifyContent:'space-between', fontWeight:700, color:'var(--success)', marginTop:'0.2rem' }}>
        <span>Tu ganancia</span><span>{fmt(neto)}</span>
      </div>
    </div>
  );
}

var STATUS_LABELS = {
  created:'Recibido', assigned:'Asignado', accepted:'Aceptado',
  preparing:'En preparación', ready:'Listo para retiro',
  on_the_way:'En camino', delivered:'Entregado',
  cancelled:'Cancelado', pending_driver:'Sin conductor',
};
var STATUS_COLOR = {
  created:'#f59e0b', assigned:'#3b82f6', accepted:'#8b5cf6',
  preparing:'#f97316', ready:'#16a34a', on_the_way:'#0891b2',
  delivered:'#16a34a', cancelled:'#dc2626', pending_driver:'#ef4444',
};

function buildInitial(items = []) {
  const m = {}; items.forEach(i => { m[i.menuItemId] = i.quantity; }); return m;
}

// ── Control de tiempo de preparación ─────────────────────────────────────────
function PrepTimeControl({ value, onChange, onSave, saving }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap',
      padding: '0.5rem 0.75rem',
      background: 'rgba(255,255,255,0.12)',
      borderRadius: 8,
      border: '1px solid rgba(255,255,255,0.2)',
      marginBottom: '0.5rem',
    }}>
      <span style={{ display:'inline-flex', alignItems:'center', gap:'0.3rem', color:'rgba(255,255,255,0.9)', fontSize:'0.78rem', fontWeight:700, flexShrink:0 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{display:'block'}}>
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
        Prep. hoy:
      </span>
      <div style={{ display:'flex', alignItems:'center', gap:'0.25rem', flex:1 }}>
        <button onClick={() => onChange(Math.max(1, value - 1))}
          style={{ width:28, height:28, borderRadius:6, border:'1px solid rgba(255,255,255,0.35)',
            background:'rgba(255,255,255,0.15)', color:'#fff', cursor:'pointer',
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:'1rem', fontWeight:700, minHeight:'unset', flexShrink:0 }}>−</button>
        <input
          type="text" inputMode="numeric"
          value={value}
          onChange={e => { const n = parseInt(e.target.value, 10); if (!isNaN(n) && n > 0) onChange(n); }}
          style={{
            width:44, textAlign:'center', background:'rgba(255,255,255,0.15)',
            border:'1px solid rgba(255,255,255,0.35)', borderRadius:6,
            color:'#fff', fontWeight:700, fontSize:'0.88rem',
            padding:'0.2rem 0', minHeight:'unset',
          }}
        />
        <span style={{ color:'rgba(255,255,255,0.8)', fontSize:'0.75rem', flexShrink:0 }}>min</span>
        <button onClick={() => onChange(value + 1)}
          style={{ width:28, height:28, borderRadius:6, border:'1px solid rgba(255,255,255,0.35)',
            background:'rgba(255,255,255,0.15)', color:'#fff', cursor:'pointer',
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:'1rem', fontWeight:700, minHeight:'unset', flexShrink:0 }}>+</button>
      </div>
      <button onClick={onSave} disabled={saving}
        style={{
          padding: '0.2rem 0.65rem', border: '1px solid rgba(255,255,255,0.4)',
          borderRadius: 6, cursor: saving ? 'default' : 'pointer',
          fontSize: '0.72rem', fontWeight: 700,
          background: saving ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.22)',
          color: '#fff', minHeight: 'unset', flexShrink: 0,
          opacity: saving ? 0.6 : 1,
        }}>
        {saving ? '…' : 'Aplicar'}
      </button>
    </div>
  );
}

export default function RestaurantOrders() {
  const { auth } = useAuth();
  const [orders, setOrders]     = useState([]);
  const [products, setProducts] = useState([]);
  const [tab, setTab]           = useState('active');
  const [msg, setMsg]           = useState('');
  const [reportingId, setReportingId] = useState(null);
  const [reportText, setReportText]   = useState('');
  const [ratingOrder,   setRatingOrder]   = useState(null);
  const [ratingStars,   setRatingStars]   = useState(0);
  const [ratingComment, setRatingComment] = useState('');
  const [ratingLoading, setRatingLoading] = useState(false);
  const [ratedOrders,   setRatedOrders]   = useState(new Set());
  const [reportMsg, setReportMsg]     = useState('');
  const [expanded, setExpanded]       = useState(null);
  const [suggestionFor, setSuggestionFor]   = useState('');
  const [readyCooldown, setReadyCooldown]   = useState({});
  const [suggDrafts, setSuggDrafts]         = useState({});
  // ── Banners del motor de cocina ───────────────────────────────────────────
  const [kitchenBanners, setKitchenBanners] = useState([]);
  // ── Tiempo de preparación temporal (sesión) ───────────────────────────────
  const [prepMins, setPrepMins]   = useState(15);
  const [prepSaving, setPrepSaving] = useState(false);
  const loadDataRef = useRef(null);

  const handleKitchenEvent = useCallback((data) => {
    const bannerId = `${data.type}-${Date.now()}`;
    const duration = data.type === 'order_cancelled_preparing' ? 30_000 : 12_000;
    setKitchenBanners(prev => [...prev, { ...data, bannerId }]);
    setTimeout(() => {
      setKitchenBanners(prev => prev.filter(b => b.bannerId !== bannerId));
    }, duration);
    loadDataRef.current?.();
  }, []);

  async function submitRating() {
    if (!ratingOrder || ratingStars < 1) return;
    setRatingLoading(true);
    try {
      await apiFetch(`/orders/${ratingOrder.id}/rating/restaurant`,
        { method:'POST', body: JSON.stringify({ driver_stars: ratingStars, comment: ratingComment.trim() || undefined }) },
        auth.token);
      setRatedOrders(prev => new Set([...prev, ratingOrder.id]));
      setRatingOrder(null); setRatingStars(0); setRatingComment('');
    } catch (e) { setMsg(e.message); }
    finally { setRatingLoading(false); }
  }

  async function loadData() {
    if (!auth.token) return;
    try {
      const [od, md] = await Promise.all([
        apiFetch('/orders/my', {}, auth.token),
        apiFetch('/restaurants/my/menu', {}, auth.token),
      ]);
      setOrders(od.orders || []);
      setProducts(md.menu || []);
    } catch (e) { setMsg(e.message); }
  }

  useEffect(() => { loadDataRef.current = loadData; });
  useEffect(() => { loadData(); }, [auth.token]);
  useEffect(() => {
    if (!auth.token) return;
    const id = setInterval(() => loadDataRef.current?.(), 5000);
    return () => clearInterval(id);
  }, [auth.token]);
  useRealtimeOrders(auth.token, () => loadDataRef.current?.(), () => {}, undefined, undefined, undefined, handleKitchenEvent);

  async function savePrepTime() {
    setPrepSaving(true);
    const secs = Math.round(prepMins * 60);
    try {
      await apiFetch('/restaurants/my/prep-estimate',
        { method: 'PATCH', body: JSON.stringify({ prep_time_estimate_s: secs }) },
        auth.token);
    } catch (e) { setMsg(e.message); }
    finally { setPrepSaving(false); }
  }

  async function updatePrepEstimate(minutes) {
    const secs = Math.round(minutes * 60);
    try {
      await apiFetch('/restaurants/my/prep-estimate',
        { method: 'PATCH', body: JSON.stringify({ prep_time_estimate_s: secs }) },
        auth.token);
      loadData();
    } catch (e) { setMsg(e.message); }
  }

  useEffect(() => {
    setSuggDrafts(prev => {
      const next = {};
      orders.forEach(o => { next[o.id] = prev[o.id] || buildInitial(o.items); });
      return next;
    });
  }, [orders.length]);

  async function changeStatus(orderId, status) {
    try {
      await apiFetch(`/orders/${orderId}/status`, { method:'PATCH', body: JSON.stringify({ status }) }, auth.token);
      loadData();
    } catch (e) { setMsg(e.message); }
  }

  function adjustSugg(orderId, menuItemId, delta) {
    setSuggDrafts(prev => {
      const cur = prev[orderId] || {};
      return { ...prev, [orderId]: { ...cur, [menuItemId]: Math.max(0, (cur[menuItemId] || 0) + delta) } };
    });
  }

  const READY_COOLDOWN_SECS = 5 * 60;

  async function sendSuggestion(order) {
    const draft = suggDrafts[order.id] || {};
    const items = Object.entries(draft).filter(([,q]) => q > 0).map(([menuItemId, quantity]) => ({ menuItemId, quantity }));
    if (items.length === 0) return setMsg('La sugerencia debe tener al menos 1 producto');
    try {
      await apiFetch(`/orders/${order.id}/suggest`, { method:'PATCH', body: JSON.stringify({ items }) }, auth.token);
      setReadyCooldown(prev => ({ ...prev, [order.id]: READY_COOLDOWN_SECS }));
      setSuggestionFor(''); loadData();
    } catch (e) { setMsg(e.message); }
  }

  useEffect(() => {
    const id = setInterval(() => {
      setReadyCooldown(prev => {
        const next = { ...prev };
        for (const [oid, secs] of Object.entries(next)) {
          if (secs <= 1) delete next[oid]; else next[oid] = secs - 1;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  async function cancelOrder(orderId) {
    const note = window.prompt('Motivo de cancelación (obligatorio):');
    if (!note?.trim()) return;
    try {
      await apiFetch(`/orders/${orderId}/cancel-restaurant`, { method:'PATCH', body: JSON.stringify({ note }) }, auth.token);
      loadData();
    } catch (e) { setMsg(e.message); }
  }

  async function sendReport(orderId) {
    if (!reportText.trim()) return;
    try {
      await apiFetch(`/orders/${orderId}/report`, {
        method:'POST', body: JSON.stringify({ text: reportText, reason: 'restaurant_report' })
      }, auth.token);
      setReportingId(null); setReportText(''); setReportMsg('Reporte enviado');
      setTimeout(() => setReportMsg(''), 3000);
    } catch (e) { setReportMsg(e.message); }
  }

  const active = useMemo(() => orders.filter(o => !['delivered','cancelled'].includes(o.status)), [orders]);
  const past   = useMemo(() => orders.filter(o =>  ['delivered','cancelled'].includes(o.status)), [orders]);

  useAppBadge(active.filter(o => ['created','pending_driver'].includes(o.status)).length);

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>

      {/* Rating modal */}
      {ratingOrder && (
        <div style={{ position:'fixed', inset:0, background:'var(--bg-overlay)', zIndex:999,
          display:'flex', alignItems:'flex-end', justifyContent:'center' }}
          onClick={e => { if (e.target === e.currentTarget) setRatingOrder(null); }}>
          <div style={{ background:'var(--bg-card)', borderRadius:'20px 20px 0 0',
            padding:'1.5rem', width:'100%', maxWidth:480,
            boxShadow:'0 -4px 32px rgba(0,0,0,0.2)',
            paddingBottom:'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}>
            <h3 style={{ fontSize:'1rem', fontWeight:800, color:'var(--text-primary)', marginBottom:'0.25rem' }}>
              Calificar conductor
            </h3>
            <div style={{ fontSize:'0.82rem', color:'var(--text-tertiary)', marginBottom:'1rem' }}>
              {ratingOrder.driver_first_name || 'Conductor'} — {ratingOrder.restaurant_name}
            </div>
            <div style={{ marginBottom:'0.75rem' }}>
              <div style={{ fontSize:'0.78rem', color:'var(--text-secondary)', marginBottom:'0.3rem' }}>
                ¿Cómo estuvo el servicio del conductor?
              </div>
              <div style={{ display:'flex', gap:'4px' }}>
                {[1,2,3,4,5].map(s => (
                  <button key={s} onClick={() => setRatingStars(s)}
                    style={{ fontSize:'1.6rem', background:'none', border:'none', cursor:'pointer',
                      minHeight:'unset', color: s <= ratingStars ? '#f59e0b' : 'var(--border)', padding:0, lineHeight:1 }}>
                    ★
                  </button>
                ))}
              </div>
            </div>
            <textarea value={ratingComment} onChange={e => setRatingComment(e.target.value)}
              placeholder="Comentario opcional…" rows={2}
              style={{ width:'100%', marginBottom:'0.75rem', fontSize:'0.875rem', resize:'none' }} />
            <div style={{ display:'flex', gap:'0.5rem' }}>
              <button className="btn-primary" style={{ flex:1 }}
                disabled={ratingStars < 1 || ratingLoading} onClick={submitRating}>
                {ratingLoading ? 'Enviando…' : 'Enviar calificación'}
              </button>
              <button className="btn-sm" onClick={() => setRatingOrder(null)}>Ahora no</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Encabezado con banner estilo RestaurantPage ──────────────────── */}
      <div style={{
        flexShrink: 0,
        background: 'var(--promo-gradient)',
        padding: '0.75rem 1rem 0',
        zIndex: 30,
      }}>
        {/* Título + subtítulo */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.45rem' }}>
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', color:'#fff' }}>
              <IconOrders />
              <span style={{ fontWeight:800, fontSize:'1.05rem', letterSpacing:'-0.01em' }}>Mis pedidos</span>
            </div>
            <div style={{ fontSize:'0.75rem', color:'rgba(255,255,255,0.8)', marginTop:'0.1rem' }}>
              {active.length > 0 ? `${active.length} pedido${active.length !== 1 ? 's' : ''} activo${active.length !== 1 ? 's' : ''}` : 'Sin pedidos activos'}
            </div>
          </div>
          {active.filter(o => ['created','pending_driver'].includes(o.status)).length > 0 && (
            <span style={{ fontWeight:700, fontSize:'0.82rem', padding:'0.2rem 0.65rem',
              background:'rgba(255,255,255,0.2)', borderRadius:20,
              border:'1px solid rgba(255,255,255,0.3)', color:'#fff' }}>
              ● {active.filter(o => ['created','pending_driver'].includes(o.status)).length} nuevo{active.filter(o => ['created','pending_driver'].includes(o.status)).length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Control de tiempo de preparación (temporal — solo hoy) */}
        <PrepTimeControl
          value={prepMins}
          onChange={setPrepMins}
          onSave={savePrepTime}
          saving={prepSaving}
        />

        {/* Tabs */}
        <div style={{ display:'flex', gap:0, borderTop:'1px solid rgba(255,255,255,0.2)' }}>
          {[['active','Activos'],['past','Historial']].map(([val, label]) => (
            <button key={val} onClick={() => setTab(val)}
              style={{
                flex:1, background:'none', border:'none', cursor:'pointer',
                padding:'0.4rem 0.5rem', fontSize:'0.78rem', fontWeight: tab===val ? 800 : 500,
                color: tab===val ? '#fff' : 'rgba(255,255,255,0.6)',
                borderBottom: tab===val ? '2px solid #fff' : '2px solid transparent',
                marginBottom: '-1px', transition:'color 0.15s',
              }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Contenido scrolleable ─────────────────────────────────── */}
      <div style={{ flex:1, overflowY:'auto', padding:'0.75rem 1rem', paddingBottom:'calc(var(--nav-h-mobile) + 2.5rem)' }}>

      {reportMsg && <p className="flash flash-ok" style={{ marginBottom:'0.5rem' }}>{reportMsg}</p>}
      {msg && <p className="flash flash-error">{msg}</p>}

      {/* ── Banners del motor de cocina ─────────────────────────────────── */}
      {kitchenBanners.map(banner => {
        const isCancel   = banner.type === 'order_cancelled_preparing';
        const isArrival  = banner.type === 'driver_arrival';
        const isEstimate = banner.type === 'prep_estimate_updated';
        const bg   = isCancel ? 'var(--danger-bg)' : isArrival ? 'var(--success-bg)' : isEstimate ? 'var(--warn-bg)' : 'var(--success-bg)';
        const bdr  = isCancel ? 'var(--danger-border)' : isArrival ? 'var(--success-border)' : isEstimate ? 'var(--warn-border)' : 'var(--success-border)';
        const icon = isCancel ? '⚠️' : isArrival ? '🛵' : isEstimate ? '⏱️' : '🍳';
        const title = isCancel  ? 'Pedido cancelado mientras preparabas'
                    : isArrival ? `Conductor llegó — ${banner.driverName || 'Driver'} recogió`
                    : isEstimate ? 'Estimado de preparación actualizado'
                    : 'Pedido marcado como listo automáticamente';
        return (
          <div key={banner.bannerId} style={{
            background: bg, border: `1px solid ${bdr}`,
            borderLeft: isCancel ? '4px solid var(--danger)' : undefined,
            borderRadius: 8, padding: '0.65rem 0.875rem', marginBottom: '0.5rem',
            fontSize: '0.82rem', lineHeight: 1.4, position: 'relative',
          }}>
            <div style={{ fontWeight:700, marginBottom:'0.2rem', color:'var(--text-primary)', paddingRight:'1.5rem' }}>
              {icon} {title}
            </div>
            {banner.message && <div style={{ color:'var(--text-secondary)' }}>{banner.message}</div>}
            {isCancel && banner.note && (
              <div style={{ marginTop:'0.3rem', fontSize:'0.78rem', color:'var(--text-secondary)' }}>
                Motivo: <em>{banner.note}</em>
              </div>
            )}
            {isEstimate && banner.newEstimate && (
              <div style={{ marginTop:'0.4rem', display:'flex', gap:'0.5rem', alignItems:'center' }}>
                <span style={{ fontSize:'0.75rem', color:'var(--text-secondary)' }}>
                  Nuevo estimado: <strong>{Math.round(banner.newEstimate / 60)} min</strong>
                </span>
                <button className="btn-sm" style={{ fontSize:'0.72rem' }}
                  onClick={() => updatePrepEstimate(Math.round(banner.newEstimate / 60))}>
                  Confirmar
                </button>
                <button className="btn-sm" style={{ fontSize:'0.72rem' }}
                  onClick={() => {
                    const mins = window.prompt('Corregir estimado (minutos):', String(Math.round(banner.newEstimate / 60)));
                    if (mins && Number(mins) > 0) updatePrepEstimate(Number(mins));
                  }}>
                  Corregir
                </button>
              </div>
            )}
            <button onClick={() => setKitchenBanners(prev => prev.filter(b => b.bannerId !== banner.bannerId))}
              style={{ position:'absolute', top:8, right:8, background:'none', border:'none',
                cursor:'pointer', fontSize:'0.85rem', color:'var(--text-tertiary)', minHeight:'unset' }}>✕</button>
          </div>
        );
      })}

      {/* Activos */}
      {tab === 'active' && (
        active.length === 0
          ? <p style={{ color:'var(--text-secondary)', fontSize:'0.9rem' }}>Sin pedidos activos.</p>
          : (
            <ul className="orders-tab-panel" style={{ listStyle:'none', padding:0 }}>
              {active.map(order => {
                const color = STATUS_COLOR[order.status] || '#9ca3af';
                const isExp = expanded === order.id;
                return (
                  <li key={order.id} className="card" style={{ borderLeft:`3px solid ${color}`, marginBottom:'0.6rem', padding:0, overflow:'hidden' }}>
                    <div onClick={() => setExpanded(isExp ? null : order.id)}
                      style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0.75rem', cursor:'pointer', gap:'0.5rem' }}>
                      <div>
                        <span className="badge" style={{ color, borderColor:`${color}55`, background:`${color}15`, marginRight:'0.5rem' }}>
                          {STATUS_LABELS[order.status]}
                        </span>
                        <span style={{ fontWeight:600, fontSize:'0.875rem' }}>{order.customer_first_name || '—'}</span>
                      </div>
                      <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', flexShrink:0 }}>
                        <span style={{ fontWeight:700 }}>{fmt(order.total_cents)}</span>
                        <span style={{ color:'var(--text-tertiary)', fontSize:'0.8rem' }}>{isExp?'▲':'▼'}</span>
                      </div>
                    </div>
                    {isExp && (
                    <div style={{ padding:'0 0.75rem 0.75rem', borderTop:`1px solid ${color}22` }}>
                    <div style={{ fontSize:'0.82rem', color:'var(--text-secondary)', marginBottom:'0.35rem' }}>
                      {order.customer_address && <div>Dirección: <strong>{order.customer_address}</strong></div>}
                      Conductor: <strong>{order.driver_first_name || 'Pendiente'}</strong>
                    </div>
                    {(order.items || []).length > 0 && (
                      <ul style={{ margin:'0.25rem 0 0.5rem 1rem', fontSize:'0.83rem', color:'var(--text-primary)' }}>
                        {order.items.map(i => <li key={i.menuItemId}>{i.name} × {i.quantity}</li>)}
                      </ul>
                    )}
                    {order.payment_method && (
                      <div style={{ fontSize:'0.78rem', color:'var(--text-tertiary)', marginBottom:'0.3rem' }}>
                        Pago: <strong>{{cash:'Efectivo',card:'Tarjeta',spei:'SPEI'}[order.payment_method]||order.payment_method}</strong>
                      </div>
                    )}
                    <FeeBreakdown order={order} />
                    <div style={{ display:'flex', gap:'0.4rem', flexWrap:'wrap', marginTop:'0.4rem' }}>
                      {!['preparing','ready','on_the_way','delivered','cancelled'].includes(order.status) && (
                        <button className="btn-sm" onClick={() => changeStatus(order.id, 'preparing')}>En preparación</button>
                      )}
                      {order.status !== 'ready' && !['on_the_way','delivered','cancelled'].includes(order.status) && (() => {
                        const cd = readyCooldown[order.id] || 0;
                        return (
                          <button className="btn-sm"
                            style={{ background: cd > 0 ? 'var(--gray-200)' : 'var(--success)', color: cd > 0 ? 'var(--gray-500)' : '#fff', borderColor: cd > 0 ? 'var(--gray-300)' : 'var(--success)' }}
                            disabled={cd > 0}
                            title={cd > 0 ? `Espera ${Math.floor(cd/60)}:${String(cd%60).padStart(2,'0')} min antes de marcar Listo` : ''}
                            onClick={() => changeStatus(order.id, 'ready')}>
                            {cd > 0 ? `Listo (${Math.floor(cd/60)}:${String(cd%60).padStart(2,'0')})` : 'Listo'}
                          </button>
                        );
                      })()}
                      {!['ready','on_the_way','delivered','cancelled'].includes(order.status) && (
                        <button className="btn-sm"
                          onClick={() => setSuggestionFor(s => s === order.id ? '' : order.id)}
                          style={{ background: suggestionFor === order.id ? 'var(--brand-light)' : undefined }}>
                          Sugerir cambio
                        </button>
                      )}
                      {!['delivered','cancelled','on_the_way'].includes(order.status) && (
                        <button className="btn-sm btn-danger" onClick={() => cancelOrder(order.id)}>
                          Cancelar
                        </button>
                      )}
                    </div>

                    {/* Panel sugerencia */}
                    {suggestionFor === order.id && (
                      <div style={{ marginTop:'0.75rem', background:'var(--gray-50)', border:'1px solid var(--border)', borderRadius:8, padding:'0.875rem' }}>
                        <p style={{ fontWeight:700, fontSize:'0.875rem', marginBottom:'0.5rem' }}>Proponer cambio al cliente</p>
                        {order.suggestion_status === 'pending_customer' && (
                          <p style={{ fontSize:'0.8rem', color:'#92400e', background:'#fffbeb', border:'1px solid #f59e0b', borderRadius:6, padding:'0.4rem 0.6rem', marginBottom:'0.5rem' }}>
                            Ya hay una sugerencia pendiente de respuesta.
                          </p>
                        )}
                        <p style={{ fontSize:'0.75rem', color:'var(--text-tertiary)', marginBottom:'0.35rem' }}>
                          Nota: al marcar el pedido como Listo debes esperar al menos 5 minutos despues de enviar una sugerencia.
                        </p>
                        <p style={{ fontSize:'0.75rem', color:'var(--text-secondary)', marginBottom:'0.35rem' }}>Pedido original:</p>
                        <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:6, padding:'0.4rem 0.75rem', marginBottom:'0.65rem' }}>
                          {(order.items || []).map(i => (
                            <div key={i.menuItemId} style={{ display:'flex', justifyContent:'space-between', fontSize:'0.83rem', padding:'0.1rem 0' }}>
                              <span>{i.name}</span><span style={{ color:'var(--text-tertiary)' }}>× {i.quantity}</span>
                            </div>
                          ))}
                        </div>
                        <p style={{ fontSize:'0.75rem', color:'var(--text-secondary)', marginBottom:'0.35rem' }}>Sugerencia:</p>
                        {(() => {
                          const draft = suggDrafts[order.id] || {};
                          const total = products.reduce((s, p) => s + (draft[p.id] || 0) * p.price_cents, 0);
                          return total > 0 ? (
                            <div style={{ fontWeight:700, fontSize:'0.88rem', color:'var(--brand)', marginBottom:'0.4rem', textAlign:'right' }}>
                              Total sugerencia: {fmt(total)}
                            </div>
                          ) : null;
                        })()}
                        <div style={{ display:'flex', flexDirection:'column', gap:'0.3rem', marginBottom:'0.65rem' }}>
                          {products.map(p => {
                            const qty = (suggDrafts[order.id] || {})[p.id] ?? 0;
                            return (
                              <div key={p.id} style={{
                                display:'flex', alignItems:'center', gap:'0.5rem',
                                background: qty > 0 ? 'var(--brand-light)' : '#fff',
                                border: `1px solid ${qty > 0 ? '#bfdbfe' : 'var(--gray-200)'}`,
                                borderRadius:6, padding:'0.4rem 0.75rem',
                              }}>
                                <span style={{ flex:1, fontSize:'0.875rem', fontWeight: qty > 0 ? 600 : 400 }}>{p.name}</span>
                                <span style={{ fontSize:'0.75rem', color:'var(--text-tertiary)' }}>{fmt(p.price_cents)}</span>
                                <div className="qty-control">
                                  <button className="qty-btn" disabled={qty===0} onClick={() => adjustSugg(order.id, p.id, -1)}>−</button>
                                  <span className="qty-num">{qty}</span>
                                  <button className="qty-btn add" onClick={() => adjustSugg(order.id, p.id, 1)}>+</button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <div style={{ display:'flex', gap:'0.4rem' }}>
                          <button className="btn-primary btn-sm" onClick={() => sendSuggestion(order)}>Enviar al cliente</button>
                          <button className="btn-sm" onClick={() => setSuggestionFor('')}>Cancelar</button>
                        </div>
                      </div>
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
      {tab === 'past' && (
        past.length === 0
          ? <p style={{ color:'var(--text-secondary)', fontSize:'0.9rem' }}>Sin pedidos anteriores.</p>
          : (
            <ul className="orders-tab-panel reverse" style={{ listStyle:'none', padding:0 }}>
              {past.slice(0, 50).map(o => {
                const color    = STATUS_COLOR[o.status] || '#9ca3af';
                const isPastExp = expanded === ('h_'+o.id);
                return (
                  <li key={o.id} className="card" style={{ borderLeft:`3px solid ${color}`, marginBottom:'0.6rem', padding:0, overflow:'hidden' }}>
                    <div onClick={() => setExpanded(isPastExp ? null : 'h_'+o.id)}
                      style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0.75rem', cursor:'pointer', gap:'0.5rem' }}>
                      <div>
                        <span className="badge" style={{ color, borderColor:`${color}55`, background:`${color}15`, marginRight:'0.5rem', fontSize:'0.7rem' }}>
                          {STATUS_LABELS[o.status]}
                        </span>
                        <span style={{ fontWeight:600, fontSize:'0.875rem' }}>{o.customer_first_name || '—'}</span>
                      </div>
                      <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', flexShrink:0 }}>
                        <span style={{ fontWeight:700 }}>{fmt(o.total_cents)}</span>
                        <span style={{ color:'var(--text-tertiary)', fontSize:'0.8rem' }}>{isPastExp?'▲':'▼'}</span>
                      </div>
                    </div>
                    {isPastExp && (
                      <div style={{ padding:'0 0.75rem 0.75rem', borderTop:`1px solid ${color}22` }}>
                        <div style={{ fontSize:'0.82rem', color:'var(--text-secondary)', marginBottom:'0.35rem' }}>
                          Conductor: <strong>{o.driver_first_name || '—'}</strong>
                        </div>
                        {(o.items || []).length > 0 && (
                          <ul style={{ fontSize:'0.82rem', margin:'0.2rem 0 0.35rem 1rem' }}>
                            {o.items.map(i => <li key={i.menuItemId}>{i.name} × {i.quantity}</li>)}
                          </ul>
                        )}
                        {o.payment_method && (
                          <div style={{ fontSize:'0.78rem', color:'var(--text-tertiary)', marginBottom:'0.2rem' }}>
                            Pago: <strong>{{cash:'Efectivo',card:'Tarjeta',spei:'SPEI'}[o.payment_method]||o.payment_method}</strong>
                          </div>
                        )}
                        <FeeBreakdown order={o} />
                        {reportingId === o.id ? (
                          <div style={{ display:'flex', flexDirection:'column', gap:'0.3rem', marginTop:'0.4rem' }}>
                            <textarea value={reportText} onChange={e=>setReportText(e.target.value)}
                              placeholder="Describe el problema…" rows={2}
                              style={{ fontSize:'0.78rem', width:'100%', boxSizing:'border-box' }} />
                            <div style={{ display:'flex', gap:'0.3rem' }}>
                              <button className="btn-sm" style={{ fontSize:'0.75rem', background:'var(--danger)', color:'#fff', borderColor:'var(--danger)' }} onClick={() => sendReport(o.id)}>Enviar</button>
                              <button className="btn-sm" style={{ fontSize:'0.75rem' }} onClick={() => { setReportingId(null); setReportText(''); }}>Cancelar</button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display:'flex', gap:'0.4rem', flexWrap:'wrap', marginTop:'0.4rem' }}>
                            {o.status === 'delivered' && o.driver_id && !ratedOrders.has(o.id) && (
                              <button className="btn-sm"
                                style={{ fontSize:'0.72rem', color:'var(--brand)', borderColor:'var(--brand)', background:'var(--brand-light)', minHeight:'unset' }}
                                onClick={() => { setRatingOrder(o); setRatingStars(0); setRatingComment(''); }}>
                                ⭐ Calificar conductor
                              </button>
                            )}
                            {ratedOrders.has(o.id) && (
                              <span style={{ fontSize:'0.72rem', color:'var(--success)', fontWeight:600 }}>✓ Calificado</span>
                            )}
                            <button className="btn-sm" style={{ fontSize:'0.72rem', minHeight:'unset' }}
                              onClick={() => setReportingId(o.id)}>
                              Reportar
                            </button>
                          </div>
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
