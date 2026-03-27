// frontend/src/components/ActiveOrderPanel.jsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDriverEarningCents, getOrderGrandTotalCents, isCashPayment } from '../features/driver/shared/orderUtils';
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
function IconSupport() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>;
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
  routeActive = false,
  handMode = 'left',
  panelRef,
}) {
  const navigate = useNavigate();
  const [showCallSelector, setShowCallSelector] = useState(false);
  const [callingTarget,    setCallingTarget]    = useState(null);
  const [callFeedback,     setCallFeedback]     = useState(null);

  useEffect(() => { if (!expanded) setShowCallSelector(false); }, [expanded]);
  useEffect(() => {
    if (!callFeedback) return;
    const t = setTimeout(() => setCallFeedback(null), 3000);
    return () => clearTimeout(t);
  }, [callFeedback]);

  if (!order) return null;

  const isOTW  = order.status === 'on_the_way';
  const isCash = isCashPayment(order);
  const total  = getOrderGrandTotalCents(order);
  const earn   = getDriverEarningCents(order);

  const canOTW     = order.status === 'ready';
  const canDeliver = order.status === 'on_the_way';
  const canRelevo  = !['on_the_way','delivered','cancelled'].includes(order.status) && !order.picked_up_at && !order.is_disputed;
  const canRelease = !['on_the_way','delivered','cancelled'].includes(order.status);

  const isRight = handMode === 'right';
  const restaurantConfirmed = order.restaurant_confirmed !== false;

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
    }}>
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
              {order.is_disputed && (
                <span style={{ fontSize:'0.62rem', fontWeight:700, background:'#fef9c3',
                  color:'#854d0e', border:'1px solid #fde047', borderRadius:6,
                  padding:'0.1rem 0.4rem' }}>En disputa</span>
              )}
              <IconChevron up={expanded} />
            </div>
          </div>
          <div style={{ fontSize:'0.82rem', marginTop:'0.15rem', overflow:'hidden',
            textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            <strong>{isOTW ? (order.customer_name || 'Cliente') : order.restaurant_name}</strong>
          </div>
          <div style={{ fontSize:'0.72rem', color:'var(--text-secondary)', marginTop:'0.1rem',
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {isOTW
              ? (order.customer_address || order.delivery_address || '')
              : (order.restaurant_address || '')}
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:4, marginTop:'0.2rem', fontSize:'0.72rem' }}>
            {isCash
              ? <><IconCash /><span style={{ fontWeight:700, color:'var(--brand)' }}>
                  {isOTW ? `Cobrar ${fmt(total)}` : `Pagar ${fmt(order.total_cents || 0)}`}
                </span></>
              : <><IconCard /><span style={{ color:'var(--text-tertiary)' }}>
                  {order.payment_method === 'card' ? 'Tarjeta — no cobrar' : 'SPEI — no cobrar'}
                </span></>
            }
          </div>
        </div>

        {/* Botones principales */}
        <div style={{
          display:'flex', flexDirection:'column', gap:4, padding:'0.4rem 0.5rem',
          justifyContent:'center', flexShrink:0,
          alignItems: isRight ? 'flex-start' : 'flex-end',
        }}>
          <button
            style={{
              padding:'0.5rem 0.75rem', borderRadius:8, fontWeight:700, fontSize:'0.8rem',
              border:'none', cursor: canOTW ? 'pointer' : 'not-allowed',
              display:'flex', alignItems:'center', justifyContent:'center', gap:5,
              background: canOTW ? 'var(--brand)' : 'var(--bg-raised)',
              color: canOTW ? '#fff' : 'var(--text-tertiary)',
              opacity: canOTW ? 1 : 0.45, minWidth:100, minHeight:44,
            }}
            disabled={loadingStatus === 'on_the_way' || !canOTW}
            onClick={() => onChangeStatus(order.id, 'on_the_way')}>
            <IconOTW /> En camino
          </button>
          <button
            style={{
              padding:'0.5rem 0.75rem', borderRadius:8, fontWeight:700, fontSize:'0.8rem',
              border:'none', cursor: canDeliver ? 'pointer' : 'not-allowed',
              display:'flex', alignItems:'center', justifyContent:'center', gap:5,
              background: canDeliver ? 'var(--success)' : 'var(--bg-raised)',
              color: canDeliver ? '#fff' : 'var(--text-tertiary)',
              opacity: canDeliver ? 1 : 0.45, minWidth:100, minHeight:44,
            }}
            disabled={loadingStatus === 'delivered' || !canDeliver}
            onClick={() => onChangeStatus(order.id, 'delivered')}>
            <IconDelivered /> Entregado
          </button>
        </div>
      </div>

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

            {/* Notificar */}
            <div style={{ position:'relative' }}>
              <button
                onClick={() => setShowCallSelector(v => !v)}
                disabled={!!callingTarget}
                style={{
                  display:'flex', alignItems:'center', gap:6,
                  padding:'0.45rem 0.75rem', borderRadius:8, fontWeight:700,
                  fontSize:'0.78rem', border:'1.5px solid #3b82f6',
                  background: callingTarget ? '#dbeafe' : '#eff6ff',
                  color:'#1d4ed8', cursor: callingTarget ? 'not-allowed' : 'pointer',
                  width:'100%', opacity: callingTarget ? 0.7 : 1,
                }}>
                <IconPhone />
                {callingTarget ? 'Notificando…' : 'Notificar'}
                <span style={{ marginLeft:'auto', fontSize:'0.7rem', opacity:0.7 }}>
                  {showCallSelector ? '▲' : '▼'}
                </span>
              </button>

              {callFeedback && (
                <div style={{
                  marginTop:4, padding:'0.3rem 0.6rem', borderRadius:6,
                  fontSize:'0.75rem', fontWeight:600,
                  background: callFeedback.ok ? 'var(--success-bg)' : 'var(--danger-bg)',
                  color:      callFeedback.ok ? 'var(--success)' : 'var(--danger)',
                  border:`1px solid ${callFeedback.ok ? 'var(--success-border)' : 'var(--danger-border)'}`,
                }}>
                  {callFeedback.msg}
                </div>
              )}

              {showCallSelector && (
                <div style={{
                  position:'absolute', bottom:'110%', left:0, right:0,
                  background:'var(--bg-card)', border:'1px solid var(--border)',
                  borderRadius:8, boxShadow:'0 4px 16px rgba(0,0,0,0.15)',
                  zIndex:50, overflow:'hidden',
                }}>
                  <button onClick={() => handleNotify('customer')}
                    style={{ width:'100%', padding:'0.6rem 0.75rem', textAlign:'left',
                      background:'none', border:'none', borderBottom:'1px solid var(--border-light)',
                      cursor:'pointer', fontSize:'0.82rem', fontWeight:600 }}>
                    Notificar al cliente
                  </button>
                  <button onClick={() => handleNotify('restaurant')}
                    style={{ width:'100%', padding:'0.6rem 0.75rem', textAlign:'left',
                      background:'none', border:'none', cursor:'pointer',
                      fontSize:'0.82rem', fontWeight:600 }}>
                    Notificar a la tienda
                  </button>
                </div>
              )}
            </div>

            {/* Botón de soporte — compacto */}
            <button
              onClick={() => navigate('/profile?tab=support')}
              style={{
                display:'flex', alignItems:'center', gap:6,
                padding:'0.35rem 0.75rem', borderRadius:8, fontWeight:600,
                fontSize:'0.75rem', border:'1px solid var(--border)',
                background:'var(--bg-raised)', color:'var(--text-secondary)',
                cursor:'pointer', width:'100%',
              }}>
              <IconSupport />
              Contactar soporte
            </button>

            {/* Disputa activa */}
            {order.is_disputed && (
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

            {/* Opciones secundarias */}
            {(canRelevo || canRelease) && !order.is_disputed && (
              <div style={{ display:'flex', gap:'0.4rem', marginTop:'0.15rem' }}>
                {canRelevo && (
                  <button style={{
                    flex:1, padding:'0.45rem 0', borderRadius:8, fontWeight:700,
                    fontSize:'0.78rem', border:'1.5px solid var(--warn-border)', cursor:'pointer',
                    display:'flex', alignItems:'center', justifyContent:'center', gap:5,
                    color:'var(--warn)', background:'var(--warn-bg)',
                  }} onClick={onRebalance}>
                    <IconRelevo /> Buscar relevo
                  </button>
                )}
                {canRelease && (
                  <button style={{
                    flex:1, padding:'0.45rem 0', borderRadius:8, fontWeight:700,
                    fontSize:'0.78rem', border:'1.5px solid var(--danger-border)', cursor:'pointer',
                    display:'flex', alignItems:'center', justifyContent:'center', gap:5,
                    background:'var(--danger-bg)', color:'var(--danger)',
                  }} onClick={onToggleRelease}>
                    <IconRelease /> Liberar
                  </button>
                )}
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

            {/* Detalles del pedido */}
            <details style={{ borderTop:'1px solid var(--border-light)', paddingTop:'0.35rem' }}>
              <summary style={{ cursor:'pointer', color:'var(--text-tertiary)', fontWeight:600,
                fontSize:'0.72rem', listStyle:'none', display:'flex', alignItems:'center', gap:4 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
                Detalles del pedido
              </summary>
              <div style={{ marginTop:'0.35rem' }}>
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
            </details>
          </div>
        </div>
      </div>
    </div>
  );
}
