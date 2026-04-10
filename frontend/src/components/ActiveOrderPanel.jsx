// frontend/src/components/ActiveOrderPanel.jsx
import { useState, useEffect, useRef } from 'react';
import { getDriverEarningCents, getOrderGrandTotalCents, isCashPayment } from '../features/driver/shared/orderUtils';
import { IconChat, OrderChat } from '../features/customer/orders/components';
import { fmt } from '../utils/format';
import FeeBreakdown from './FeeBreakdown';

const STATUS_LABEL = {
  assigned:   'Ve a recoger',
  on_the_way: 'En camino al cliente',
  preparing:  'Esperando en tienda',
  ready:      'Listo para retiro',
  accepted:   'Aceptado',
  created:    'Nuevo pedido',
};

// ── Icons ─────────────────────────────────────────────────────────────────────
function IconNavigateActive() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><polygon points="3 11 22 2 13 21 11 13 3 11" fill="currentColor"/></svg>;
}
function IconRoute() {
  return <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M6 17V9a6 6 0 016-6h.5"/><path d="M18 7v8a6 6 0 01-6 6h-.5"/></svg>;
}
function IconChevron({ up }) {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ transform: up ? 'rotate(180deg)' : 'rotate(0deg)', transition:'transform 0.2s' }}><polyline points="6 9 12 15 18 9"/></svg>;
}
function IconOTW() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11" fill="currentColor"/></svg>;
}
function IconDelivered() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>;
}
function IconRelevo() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>;
}
function IconRelease() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>;
}
function IconCard() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>;
}
function IconCash() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>;
}
function IconPhone() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.55 12 19.79 19.79 0 01.48 3.38 2 2 0 012.46 1h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 8.73A16 16 0 0015.27 17l1.8-1.8a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>;
}
// ── Helper: agrupar stops por posición física (mismo restaurante/cliente) ────
function buildStopGroups(routeStopsOverride, activeOrders) {
  if (!Array.isArray(routeStopsOverride) || !routeStopsOverride.length) return null;
  const orderMap = {};
  for (const o of (activeOrders || [])) orderMap[o.id] = o;

  const groups = [];
  let i = 0;
  while (i < routeStopsOverride.length) {
    const stop = routeStopsOverride[i];
    const group = { type: stop.type, pos: stop.pos, stops: [stop] };
    // Agrupar stops consecutivos con misma pos y mismo tipo
    let j = i + 1;
    while (j < routeStopsOverride.length) {
      const next = routeStopsOverride[j];
      if (next.type === stop.type &&
          next.pos?.lat === stop.pos?.lat &&
          next.pos?.lng === stop.pos?.lng) {
        group.stops.push(next);
        j++;
      } else break;
    }
    // Enriquecer con datos de pedido
    group.orders = group.stops
      .map(s => orderMap[s.orderId])
      .filter(Boolean);
    groups.push(group);
    i = j;
  }
  return groups.length > 0 ? groups : null;
}

// ── Helpers para agrupar stops ───────────────────────────────────────────────
function buildStopGroups(activeOrders, routeStopsOverride) {
  const orderMap = {};
  for (const o of (activeOrders || [])) orderMap[o.id] = o;

  if (Array.isArray(routeStopsOverride) && routeStopsOverride.length > 0) {
    const groups = [];
    for (const stop of routeStopsOverride) {
      const orderIds = stop.orderIds ?? (stop.orderId ? [stop.orderId] : []);
      const orders = orderIds.map(id => orderMap[id]).filter(Boolean);
      if (!orders.length) continue;
      const prev = groups[groups.length - 1];
      if (prev && prev.type === stop.type &&
          stop.pos?.lat === prev.pos?.lat && stop.pos?.lng === prev.pos?.lng) {
        prev.orders.push(...orders.filter(o => !prev.orders.find(p => p.id === o.id)));
      } else {
        groups.push({ type: stop.type, pos: stop.pos, orders, key: `${stop.type}-${stop.pos?.lat}-${stop.pos?.lng}` });
      }
    }
    return groups;
  }

  const sorted = [...(activeOrders || [])]
    .filter(o => !['delivered', 'cancelled'].includes(o.status))
    .sort((a, b) => new Date(a.accepted_at || a.created_at) - new Date(b.accepted_at || b.created_at));

  const groups = [];
  for (const o of sorted) {
    if (!o.picked_up_at) {
      const lat = Number(o.restaurant_lat), lng = Number(o.restaurant_lng);
      const prev = groups[groups.length - 1];
      if (prev && prev.type === 'pickup' && prev.pos?.lat === lat && prev.pos?.lng === lng) {
        prev.orders.push(o);
      } else {
        groups.push({ type: 'pickup', pos: { lat, lng }, orders: [o], key: `pickup-${lat}-${lng}` });
      }
    }
    if (o.status === 'on_the_way') {
      const lat = Number(o.customer_lat ?? o.delivery_lat);
      const lng = Number(o.customer_lng ?? o.delivery_lng);
      groups.push({ type: 'delivery', pos: { lat, lng }, orders: [o], key: `delivery-${o.id}` });
    }
  }
  return groups;
}

export default function ActiveOrderPanel({
  order,
  expanded,
  loadingStatus,
  showRelease,
  releaseNote,
  onToggleExpand,
  onChangeStatus,
  onToggleRelease,
  onReleaseNoteChange,
  onConfirmRelease,
  onRebalance,
  onCancelDispute,
  onRoute,
  onSimulatedCall,
  authToken,
  chatTick = 0,
  routeActive = false,
  handMode = 'left',
  panelRef,
  distToNextStop = null,
  stopOrderCount = 1,
  activeOrders = [],
  routeStopsOverride = null,
}) {
  const [showCallSelector, setShowCallSelector] = useState(false);
  const [callingTarget,    setCallingTarget]    = useState(null);
  const [callFeedback,     setCallFeedback]     = useState(null);
  const [chatOpen,         setChatOpen]         = useState(false);
  const [kitchenSecsLeft,  setKitchenSecsLeft]  = useState(null);
  const [statusFeedback,   setStatusFeedback]   = useState(null);
  const [detailsOpen,      setDetailsOpen]      = useState(false);

  // P5: swipe state
  const swipeTouchStartY = useRef(null);
  const swipeTouchStartX = useRef(null);
  const statusFeedbackTimer = useRef(null);

  const handleChangeStatus = async (id, status) => {
    clearTimeout(statusFeedbackTimer.current);
    setStatusFeedback(null);
    try {
      await onChangeStatus(id, status);
    } catch (e) {
      const msg = e?.message || '';
      let feedback;
      if (msg.includes('100m') || msg.includes('Debes estar')) {
        const dist = distToNextStop != null ? ` (estás a ${distToNextStop}m)` : '';
        feedback = `Debes estar más cerca del punto${dist}`;
      } else if (msg.includes('No se puede cambiar') || msg.includes('estado')) {
        feedback = 'El pedido aún no está listo para este cambio';
      } else {
        feedback = msg || 'No se pudo actualizar el estado';
      }
      setStatusFeedback({ ok: false, msg: feedback });
      statusFeedbackTimer.current = setTimeout(() => setStatusFeedback(null), 4000);
    }
  };

  // Countdown de cocina — solo activo en estados previos al pickup
  useEffect(() => {
    const isWaiting = ['accepted', 'preparing'].includes(currentOrder?.status);
    if (!isWaiting || !currentOrder?.kitchen_estimated_ready) {
      setKitchenSecsLeft(null);
      return;
    }
    const tick = () => {
      const diff = Math.ceil(
        (new Date(currentOrder.kitchen_estimated_ready).getTime() - Date.now()) / 1000
      );
      setKitchenSecsLeft(diff);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [order?.status, order?.kitchen_estimated_ready]);

  useEffect(() => { if (!expanded) setShowCallSelector(false); }, [expanded]);
  useEffect(() => {
    if (!callFeedback) return;
    const t = setTimeout(() => setCallFeedback(null), 3000);
    return () => clearTimeout(t);
  }, [callFeedback]);

  if (!order) return null;

  // Construir grupos de stops desde routeStopsOverride
  const stopGroups = buildStopGroups(activeOrders, routeStopsOverride);
  const currentGroup = stopGroups?.[0] ?? null;
  const upcomingGroups = stopGroups?.slice(1) ?? [];

  // Determinar el pedido activo: si hay grupos, usar el primero del grupo actual
  const currentOrder = currentGroup?.orders?.[0] ?? order;
  const currentGroupOrders = currentGroup?.orders ?? [order];
  const currentGroupCount = currentGroupOrders.length;

  const isOTW  = currentOrder.status === 'on_the_way';
  const isCash = isCashPayment(currentOrder);
  const total  = getOrderGrandTotalCents(currentOrder);
  const earn   = getDriverEarningCents(currentOrder);

  const canOTW     = ['assigned', 'accepted', 'preparing', 'ready'].includes(currentOrder.status);
  const canDeliver = currentOrder.status === 'on_the_way';
  const canRelevo  = !['on_the_way','delivered','cancelled'].includes(currentOrder.status) && !currentOrder.picked_up_at && !currentOrder.is_disputed;
  const canRelease = !['on_the_way','delivered','cancelled'].includes(currentOrder.status);

  const FENCE_M  = 100;
  const nearStop = distToNextStop != null && distToNextStop <= FENCE_M;

  // ETA estimado: distancia / 6.94 m/s + 5 min tolerancia
  const etaLabel = (() => {
    if (distToNextStop == null) return null;
    const etaSecs = Math.round(distToNextStop / 6.94) + 300;
    const mins    = Math.ceil(etaSecs / 60);
    return `~${mins} min`;
  })();

  const isRight = handMode === 'right';
  const restaurantConfirmed = currentOrder.restaurant_confirmed !== false;

  const handleNotify = async (target) => {
    setShowCallSelector(false);
    setCallingTarget(target);
    setCallFeedback(null);
    try {
      await onSimulatedCall?.(target);
      setCallFeedback({ ok: true, msg: target === 'customer' ? '✓ Cliente notificado' : '✓ Tienda notificada' });
    } catch (e) {
      setCallFeedback({ ok: false, msg: e?.message || 'Error al notificar' });
    } finally {
      setCallingTarget(null);
    }
  };

  return (
    <div ref={panelRef} style={{
      flexShrink:0, background:'var(--bg-card)',
      borderTop:'2px solid var(--success)', zIndex:10,
      position:'absolute', bottom:0, left:0, right:0,
      display:'flex', flexDirection:'column',
      touchAction:'pan-y', // P5
    }}
      onTouchStart={(e) => {
        const tag = e.target.tagName?.toLowerCase();
        if (tag === 'textarea' || tag === 'input' || tag === 'select') return;
        swipeTouchStartY.current = e.touches[0].clientY;
        swipeTouchStartX.current = e.touches[0].clientX;
      }}
      onTouchEnd={(e) => {
        if (swipeTouchStartY.current === null) return;
        const dy = swipeTouchStartY.current - e.changedTouches[0].clientY;
        const dx = Math.abs(swipeTouchStartX.current - e.changedTouches[0].clientX);
        swipeTouchStartY.current = null;
        swipeTouchStartX.current = null;
        if (Math.abs(dy) < 30 || dx > Math.abs(dy) * 0.6) return;
        if (dy > 0) {
          // swipe up — expandir panel primero, luego detalles
          if (!expanded) { onToggleExpand(); }
          else if (!detailsOpen) { setDetailsOpen(true); }
        } else {
          // swipe down — cerrar detalles primero, luego colapsar panel
          if (detailsOpen) { setDetailsOpen(false); }
          else if (expanded) { onToggleExpand(); }
        }
      }}
    >
      {/* Confirmación pendiente */}
      {!restaurantConfirmed && (
        <div style={{
          background:'var(--warn-bg)', borderBottom:'1px solid var(--warn-border)',
          padding:'0.3rem 0.75rem', fontSize:'0.72rem', color:'var(--warn)',
          display:'flex', alignItems:'center', gap:6, fontWeight:600,
        }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Esperando confirmación de la tienda
        </div>
      )}

      {/* Fila principal */}
      <div style={{ display:'flex', alignItems:'stretch', minHeight:72,
        flexDirection: isRight ? 'row-reverse' : 'row' }}>

        {/* Botón ruta */}
        <button onClick={onRoute} title={routeActive ? 'Desactivar ruta' : 'Calcular ruta'}
          style={{
            width:'18%', minWidth:56, flexShrink:0,
            background: routeActive
              ? 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)'
              : 'linear-gradient(135deg, #c97b7b 0%, #9e4f4f 100%)',
            border:'none', cursor:'pointer', borderRadius:0,
            display:'flex', flexDirection:'column',
            alignItems:'center', justifyContent:'center', gap:4,
            color:'#fff', transition:'background 0.2s',
          }}>
          {routeActive ? <IconNavigateActive /> : <IconRoute />}
          <span style={{ fontSize:'0.6rem', fontWeight:700, letterSpacing:'0.02em' }}>
            {routeActive ? 'NAV' : 'RUTA'}
          </span>
        </button>

        {/* Info + toggle expand */}
        <div onClick={onToggleExpand} style={{
          flex:1, padding:'0.5rem 0.75rem', cursor:'pointer', userSelect:'none', minWidth:0,
          display:'flex', flexDirection:'column', justifyContent:'center',
        }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span style={{ fontSize:'0.68rem', fontWeight:800, textTransform:'uppercase',
              letterSpacing:'0.5px', color:'var(--success)' }}>
              {STATUS_LABEL[order.status] || order.status}
            </span>
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              {/* Distancia + ETA en la barra de status */}
              {distToNextStop != null && (canOTW || canDeliver) && (
                <span style={{
                  fontSize:'0.65rem', fontWeight:700,
                  color: nearStop ? 'var(--success)' : 'var(--text-tertiary)',
                  display:'flex', alignItems:'center', gap:3,
                }}>
                  {nearStop ? '✓ ' : ''}{distToNextStop}m{etaLabel ? ` · ${etaLabel}` : ''}
                </span>
              )}
              {currentOrder.is_disputed && (
                <span style={{ fontSize:'0.62rem', fontWeight:700, background:'#fef9c3',
                  color:'#854d0e', border:'1px solid #fde047', borderRadius:6,
                  padding:'0.1rem 0.4rem' }}>En disputa</span>
              )}
              <IconChevron up={expanded} />
            </div>
          </div>
          <div style={{ fontSize:'0.82rem', marginTop:'0.15rem', overflow:'hidden',
            textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            <strong>{isOTW ? (currentOrder.customer_name || 'Cliente') : currentOrder.restaurant_name}</strong>
            {currentGroupCount > 1 && (
              <span style={{ fontSize:'0.7rem', color:'var(--text-tertiary)', marginLeft:6 }}>
                +{currentGroupCount - 1} más
              </span>
            )}
          </div>
          <div style={{ fontSize:'0.72rem', color:'var(--text-tertiary)', marginTop:'0.05rem',
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {isOTW ? (currentOrder.restaurant_name || '') : (currentOrder.customer_name || 'Cliente')}
          </div>
          <div style={{ fontSize:'0.72rem', color:'var(--text-secondary)', marginTop:'0.05rem',
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {isOTW
              ? (currentOrder.customer_address || currentOrder.delivery_address || '')
              : (currentOrder.restaurant_address || '')}
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:4, marginTop:'0.2rem', fontSize:'0.72rem' }}>
            {isCash
              ? <><IconCash /><span style={{ fontWeight:700, color:'var(--brand)' }}>
                  {isOTW ? `Cobrar ${fmt(total)}` : `Pagar ${fmt(currentOrder.total_cents || 0)}`}
                </span></>
              : <><IconCard /><span style={{ color:'var(--text-tertiary)' }}>
                  {currentOrder.payment_method === 'card' ? 'Tarjeta — no cobrar' : 'SPEI — no cobrar'}
                </span></>
            }
          </div>
        </div>

        {/* Botones principales — P3: solo el botón del siguiente estado relevante */}
        <div style={{
          display:'flex', flexDirection:'column', gap:4, padding:'0.4rem 0.5rem',
          justifyContent:'center', flexShrink:0, minWidth:120,
          alignItems:'stretch',
          position: 'relative',
        }}>
          {/* P4: badge de pedidos múltiples en el stop actual */}
          {currentGroupCount > 1 && (
            <div style={{
              position:'absolute', top:-8, right: isRight ? 'auto' : -6, left: isRight ? -6 : 'auto',
              background:'var(--brand)', color:'#fff',
              borderRadius:'50%', width:20, height:20,
              fontSize:'0.65rem', fontWeight:800,
              display:'flex', alignItems:'center', justifyContent:'center',
              boxShadow:'0 1px 4px rgba(0,0,0,0.25)', zIndex:2,
            }}>
              {currentGroupCount}
            </div>
          )}

          {/* P3: En camino — solo cuando el próximo estado es pickup→OTW */}
          {canOTW && (
            <button
              style={{
                padding:'0.75rem 0.5rem', borderRadius:10, fontWeight:800, fontSize:'0.95rem',
                border: nearStop ? '2px solid var(--success)' : 'none',
                cursor:'pointer',
                display:'flex', alignItems:'center', justifyContent:'center', gap:6,
                background:'var(--brand)', color:'#fff',
                width:'100%', minHeight:60, transition:'border 0.2s',
              }}
              disabled={loadingStatus === 'on_the_way'}
              onClick={async () => {
                for (const o of currentGroupOrders) {
                  if (['assigned','accepted','preparing','ready'].includes(o.status)) {
                    await handleChangeStatus(o.id, 'on_the_way');
                  }
                }
              }}>
              <IconOTW />
              {currentGroupCount > 1 ? `En camino (${currentGroupCount})` : 'En camino'}
            </button>
          )}

          {/* P3: Entregado — solo cuando el próximo estado es delivery */}
          {canDeliver && (
            <div style={{ display:'flex', flexDirection:'column', gap:4, width:'100%' }}>
              {currentGroupOrders.filter(o => o.status === 'on_the_way').map(o => (
                <button key={o.id}
                  style={{
                    padding:'0.6rem 0.5rem', borderRadius:10, fontWeight:800, fontSize:'0.82rem',
                    border: nearStop ? '2px solid var(--success)' : 'none',
                    cursor:'pointer',
                    display:'flex', alignItems:'center', justifyContent:'center', gap:5,
                    background:'var(--success)', color:'#fff',
                    width:'100%', minHeight: currentGroupCount > 1 ? 44 : 60,
                    transition:'border 0.2s',
                  }}
                  disabled={loadingStatus === 'delivered'}
                  onClick={() => handleChangeStatus(o.id, 'delivered')}>
                  <IconDelivered />
                  {currentGroupCount > 1
                    ? (o.customer_name || o.id.slice(-4))
                    : 'Entregado'}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Feedback de cambio de estado */}
      {statusFeedback && (
        <div style={{
          padding: '0.35rem 0.75rem',
          background: 'var(--danger-bg, #fef2f2)',
          borderTop: '1px solid var(--danger-border, #fca5a5)',
          fontSize: '0.78rem', fontWeight: 600,
          color: 'var(--danger, #dc2626)',
        }}>
          {statusFeedback.msg}
        </div>
      )}

      {/* Expandible */}
      <div style={{
        display:'grid',
        gridTemplateRows: expanded ? '1fr' : '0fr',
        transition:'grid-template-rows 0.22s ease',
        overflow:'hidden',
      }}>
        <div style={{ overflow:'hidden' }}>
          <div style={{ padding:'0.5rem 0.75rem 0.5rem',
            borderTop:'1px solid var(--border-light)',
            display:'flex', flexDirection:'column', gap:'0.4rem' }}>

            {/* Countdown de cocina */}
            {kitchenSecsLeft !== null && (
              <div style={{
                display:'flex', alignItems:'center', gap:8,
                padding:'0.4rem 0.65rem', borderRadius:8,
                background: kitchenSecsLeft <= 0 ? 'var(--success-bg)' : 'var(--bg-raised)',
                border: `1px solid ${kitchenSecsLeft <= 0 ? 'var(--success-border)' : 'var(--border)'}`,
              }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                  stroke={kitchenSecsLeft <= 0 ? 'var(--success)' : 'var(--text-secondary)'}
                  strokeWidth="2.5" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="12 6 12 12 16 14"/>
                </svg>
                <span style={{
                  fontSize:'0.75rem', fontWeight:700,
                  color: kitchenSecsLeft <= 0 ? 'var(--success)' : 'var(--text-secondary)',
                }}>
                  {kitchenSecsLeft <= 0
                    ? 'Pedido listo en cocina'
                    : `Cocina: ${Math.floor(kitchenSecsLeft / 60)}:${String(kitchenSecsLeft % 60).padStart(2, '0')} min`}
                </span>
              </div>
            )}

            {/* Pedidos del stop actual — confirmación individual (pickup o delivery) */}
            {currentGroupOrders.length > 0 && (
              <div style={{
                borderRadius: 8, overflow: 'hidden',
                border: '1px solid var(--border)',
              }}>
                {currentGroupOrders.map((o, i) => {
                  const oIsOTW  = o.status === 'on_the_way';
                  const oCanOTW = ['assigned','accepted','preparing','ready'].includes(o.status);
                  const oCanDel = o.status === 'on_the_way';
                  const oLoading = loadingStatus === o.id;
                  return (
                    <div key={o.id} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '0.45rem 0.65rem',
                      borderTop: i > 0 ? '1px solid var(--border-light)' : 'none',
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.8rem', fontWeight: 700,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {oIsOTW ? (o.customer_name || 'Cliente') : o.restaurant_name}
                        </div>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {oIsOTW
                            ? (o.customer_address || o.delivery_address || '')
                            : (o.restaurant_address || '')}
                        </div>
                      </div>
                      {oCanOTW && (
                        <button
                          disabled={oLoading}
                          onClick={() => handleChangeStatus(o.id, 'on_the_way')}
                          style={{
                            padding: '0.45rem 0.75rem', borderRadius: 8, fontWeight: 700,
                            fontSize: '0.75rem', border: 'none',
                            cursor: oLoading ? 'not-allowed' : 'pointer',
                            background: 'var(--brand)', color: '#fff', flexShrink: 0,
                            opacity: oLoading ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: 4,
                          }}>
                          <IconOTW /> En camino
                        </button>
                      )}
                      {oCanDel && (
                        <button
                          disabled={oLoading}
                          onClick={() => handleChangeStatus(o.id, 'delivered')}
                          style={{
                            padding: '0.45rem 0.75rem', borderRadius: 8, fontWeight: 700,
                            fontSize: '0.75rem', border: 'none',
                            cursor: oLoading ? 'not-allowed' : 'pointer',
                            background: 'var(--success)', color: '#fff', flexShrink: 0,
                            opacity: oLoading ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: 4,
                          }}>
                          <IconDelivered /> Entregado
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* FILA 1 — más alta: Notificar (40%) | Chat (40%) | Detalles (20%) */}
            <div style={{ display:'flex', gap:'0.3rem', alignItems:'stretch' }}>

              {/* Notificar — 40% */}
              <div style={{ flex:2, position:'relative' }}>
                <button
                  onClick={() => setShowCallSelector(v => !v)}
                  disabled={!!callingTarget}
                  style={{
                    width:'100%', minHeight:60,
                    display:'flex', alignItems:'center', justifyContent:'center', gap:6,
                    padding:'0.5rem 0.5rem', borderRadius:8, fontWeight:700,
                    fontSize:'0.78rem', border:'1.5px solid #3b82f6',
                    background: callingTarget ? '#dbeafe' : '#eff6ff',
                    color:'#1d4ed8', cursor: callingTarget ? 'not-allowed' : 'pointer',
                    opacity: callingTarget ? 0.7 : 1,
                  }}>
                  <IconPhone />
                  {callingTarget ? 'Notificando…' : 'Notificar'}
                  <span style={{ fontSize:'0.7rem', opacity:0.7 }}>
                    {showCallSelector ? '▲' : '▼'}
                  </span>
                </button>
                {showCallSelector && (
                  <div style={{
                    position:'absolute', top:'110%', left:0, right:0,
                    background:'var(--bg-card)', border:'1px solid var(--border)',
                    borderRadius:8, boxShadow:'0 4px 16px rgba(0,0,0,0.15)',
                    zIndex:50, overflow:'hidden', display:'flex',
                  }}>
                    <button onClick={() => handleNotify('customer')}
                      style={{ flex:1, padding:'0.65rem 0.5rem', textAlign:'center',
                        background:'none', border:'none', borderRight:'1px solid var(--border-light)',
                        cursor:'pointer', fontSize:'0.82rem', fontWeight:600 }}>
                      📱 Cliente
                    </button>
                    <button onClick={() => handleNotify('restaurant')}
                      style={{ flex:1, padding:'0.65rem 0.5rem', textAlign:'center',
                        background:'none', border:'none',
                        cursor:'pointer', fontSize:'0.82rem', fontWeight:600 }}>
                      🏪 Tienda
                    </button>
                  </div>
                )}
              </div>

              {/* Chat — 40% */}
              <button
                onClick={() => setChatOpen((v) => !v)}
                style={{
                  flex:2, minHeight:60,
                  display:'flex', alignItems:'center', justifyContent:'center', gap:6,
                  padding:'0.5rem 0.25rem', borderRadius:8, fontWeight:700,
                  fontSize:'0.78rem', border:'1px solid var(--border)',
                  background: chatOpen ? 'var(--brand-light)' : 'var(--bg-raised)',
                  color: chatOpen ? 'var(--brand)' : 'var(--text-secondary)',
                  cursor:'pointer',
                }}>
                <IconChat />
                Chat
              </button>

              {/* Detalles — 20% */}
              <button
                onClick={() => setDetailsOpen(v => !v)}
                style={{
                  flex:1, minHeight:60,
                  display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:3,
                  padding:'0.3rem 0.2rem', borderRadius:8, fontWeight:700,
                  fontSize:'0.65rem', border:'1px solid var(--border-light)',
                  background: detailsOpen ? 'var(--bg-raised)' : 'none',
                  color:'var(--text-tertiary)', cursor:'pointer',
                }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
                Detalles
              </button>
            </div>

            {/* FILA 2 — altura normal: Relevo | Liberar */}
            {(canRelevo || canRelease) && !currentOrder.is_disputed && (
              <div style={{ display:'flex', gap:'0.3rem' }}>
                {canRelevo && (
                  <button style={{
                    flex:1, minHeight:44,
                    display:'flex', alignItems:'center', justifyContent:'center', gap:5,
                    padding:'0.4rem 0.25rem', borderRadius:8, fontWeight:700,
                    fontSize:'0.75rem', border:'1.5px solid var(--warn-border)', cursor:'pointer',
                    color:'var(--warn)', background:'var(--warn-bg)',
                  }} onClick={onRebalance}>
                    <IconRelevo /> Relevo
                  </button>
                )}
                {canRelease && (
                  <button style={{
                    flex:1, minHeight:44,
                    display:'flex', alignItems:'center', justifyContent:'center', gap:5,
                    padding:'0.4rem 0.25rem', borderRadius:8, fontWeight:700,
                    fontSize:'0.75rem', border:'1.5px solid var(--danger-border)', cursor:'pointer',
                    background:'var(--danger-bg)', color:'var(--danger)',
                  }} onClick={onToggleRelease}>
                    <IconRelease /> Liberar
                  </button>
                )}
              </div>
            )}

            {/* Feedback notificación */}
            {callFeedback && (
              <div style={{
                padding:'0.3rem 0.6rem', borderRadius:6,
                fontSize:'0.75rem', fontWeight:600,
                background: callFeedback.ok ? 'var(--success-bg)' : 'var(--danger-bg)',
                color:      callFeedback.ok ? 'var(--success)' : 'var(--danger)',
                border:`1px solid ${callFeedback.ok ? 'var(--success-border)' : 'var(--danger-border)'}`,
              }}>
                {callFeedback.msg}
              </div>
            )}

            {/* Chat expandido */}
            {chatOpen && (
              <OrderChat orderId={order.id} token={authToken} refreshTick={chatTick} />
            )}

            {/* Disputa activa */}
            {currentOrder.is_disputed && (
              <div style={{ display:'flex', alignItems:'center', gap:'0.4rem',
                padding:'0.35rem 0.5rem', borderRadius:8,
                background:'var(--warn-bg)', border:'1px solid var(--warn-border)' }}>
                <span style={{ fontSize:'0.72rem', color:'var(--warn)', flex:1 }}>
                  En disputa — buscando conductor…
                </span>
                <button
                  style={{ padding:'0.3rem 0.65rem', borderRadius:7, fontWeight:700,
                    fontSize:'0.72rem', border:'1.5px solid var(--warn-border)', cursor:'pointer',
                    background:'var(--bg-card)', color:'var(--warn)', whiteSpace:'nowrap' }}
                  onClick={onCancelDispute}>
                  Cancelar disputa
                </button>
              </div>
            )}

            {/* Release form */}
            {showRelease && (
              <div style={{ marginTop:'0.25rem' }}>
                <textarea value={releaseNote} onChange={e => onReleaseNoteChange(e.target.value)}
                  placeholder="Motivo (obligatorio, mín. 10 caracteres)" rows={2}
                  style={{ width:'100%', boxSizing:'border-box', marginBottom:'0.15rem', fontSize:'0.82rem' }} />
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.3rem' }}>
                  <span style={{ fontSize:'0.68rem',
                    color: releaseNote.trim().length < 10 ? 'var(--danger)' : 'var(--text-tertiary)' }}>
                    {releaseNote.trim().length}/10 mín.
                  </span>
                </div>
                <div style={{ display:'flex', gap:'0.3rem' }}>
                  <button className="btn-sm btn-danger" onClick={onConfirmRelease}
                    disabled={releaseNote.trim().length < 10}
                    style={{ opacity: releaseNote.trim().length < 10 ? 0.45 : 1,
                      cursor: releaseNote.trim().length < 10 ? 'not-allowed' : 'pointer' }}>
                    Confirmar
                  </button>
                  <button className="btn-sm"
                    onClick={() => { onToggleRelease(); onReleaseNoteChange(''); }}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {/* Detalles del pedido — controlado por estado */}
            {detailsOpen && (
              <div style={{ borderTop:'1px solid var(--border-light)', paddingTop:'0.35rem' }}>
                {(order.items || []).length > 0 && (
                  <ul style={{ fontSize:'0.78rem', margin:'0 0 0.3rem 1rem', color:'var(--text-primary)' }}>
                    {order.items.map(i => <li key={i.menuItemId}>{i.name} × {i.quantity}</li>)}
                  </ul>
                )}
                <FeeBreakdown order={order} />
                <div style={{ fontSize:'0.78rem', color:'var(--text-secondary)', marginTop:'0.3rem' }}>
                  Ganancia estimada:{' '}
                  <strong style={{ color:'var(--success)' }}>{fmt(earn)}</strong>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stops siguientes — colapsados */}
      {upcomingGroups.length > 0 && (
        <div style={{
          borderTop: '1px solid var(--border-light)',
          padding: '0.3rem 0.75rem',
          display: 'flex', flexDirection: 'column', gap: '0.2rem',
        }}>
          <div style={{ fontSize: '0.62rem', fontWeight: 700, color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.15rem' }}>
            Próximos stops
          </div>
          {upcomingGroups.map((group, idx) => (
            <div key={idx} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '0.2rem 0', opacity: 0.7,
            }}>
              <span style={{ fontSize: '0.68rem', color: group.type === 'pickup' ? 'var(--brand)' : 'var(--success)',
                fontWeight: 700, minWidth: 14 }}>
                {group.type === 'pickup' ? '📦' : '🏠'}
              </span>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {group.type === 'pickup'
                  ? (group.orders?.[0]?.restaurant_name || 'Restaurante')
                  : (group.orders?.[0]?.customer_name || 'Cliente')}
                {group.orders?.length > 1 && (
                  <span style={{ color: 'var(--text-tertiary)', marginLeft: 4 }}>
                    +{group.orders.length - 1}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
