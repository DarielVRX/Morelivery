// components/ActiveOrderPanel.jsx
import { useState } from 'react';
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

// ── SVG icons ─────────────────────────────────────────────────────────────────
function IconRoute() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="19" r="2"/>
      <circle cx="18" cy="5" r="2"/>
      <path d="M6 17V9a6 6 0 016-6h.5"/>
      <path d="M18 7v8a6 6 0 01-6 6h-.5"/>
    </svg>
  );
}
function IconChevron({ up }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
      style={{ transform: up ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  );
}
function IconOTW() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="3 11 22 2 13 21 11 13 3 11" fill="currentColor"/>
    </svg>
  );
}
function IconDelivered() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
}
function IconRelevo() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="17 1 21 5 17 9"/>
      <path d="M3 11V9a4 4 0 014-4h14"/>
      <polyline points="7 23 3 19 7 15"/>
      <path d="M21 13v2a4 4 0 01-4 4H3"/>
    </svg>
  );
}
function IconRelease() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6L6 18M6 6l12 12"/>
    </svg>
  );
}
function IconCard() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="1" y="4" width="22" height="16" rx="2"/>
      <line x1="1" y1="10" x2="23" y2="10"/>
    </svg>
  );
}
function IconCash() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="2" y="6" width="20" height="12" rx="2"/>
      <circle cx="12" cy="12" r="2"/>
      <path d="M6 12h.01M18 12h.01"/>
    </svg>
  );
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
  onRoute,
  panelRef,  // ref para medir altura desde Home
}) {
  if (!order) return null;

  const isOTW  = order.status === 'on_the_way';
  const isCash = isCashPayment(order);
  const total  = getOrderGrandTotalCents(order);
  const earn   = getDriverEarningCents(order);

  const canOTW      = order.status === 'ready';
  const canDeliver  = order.status === 'on_the_way';
  const canRelevo   = !['on_the_way','delivered','cancelled'].includes(order.status) && !order.picked_up_at && !order.is_disputed;
  const canRelease  = !['on_the_way','delivered','cancelled'].includes(order.status);

  return (
    <div ref={panelRef} style={{
      flexShrink: 0, background: 'var(--bg-card)',
      borderTop: '2px solid var(--success)', zIndex: 10,
      position: 'absolute', bottom: 0, left: 0, right: 0,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* ── Fila principal siempre visible ─────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'stretch', minHeight: 72 }}>

        {/* Botón ruta — columna izquierda 20% */}
        <button onClick={onRoute} title="Calcular ruta"
          style={{
            width: '20%', minWidth: 60, flexShrink: 0,
            background: 'linear-gradient(135deg, #c97b7b 0%, #9e4f4f 100%)',
            border: 'none', cursor: 'pointer', borderRadius: 0,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 4,
            color: '#fff',
          }}>
          <IconRoute />
          <span style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.02em' }}>RUTA</span>
        </button>

        {/* Info + toggle expand */}
        <div onClick={onToggleExpand} style={{
          flex: 1, padding: '0.5rem 0.75rem 0.5rem 0.75rem',
          cursor: 'pointer', userSelect: 'none', minWidth: 0,
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase',
              letterSpacing: '0.5px', color: 'var(--success)' }}>
              {STATUS_LABEL[order.status] || order.status}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {order.is_disputed && (
                <span style={{ fontSize: '0.62rem', fontWeight: 700,
                  background: '#fef9c3', color: '#854d0e',
                  border: '1px solid #fde047', borderRadius: 6,
                  padding: '0.1rem 0.4rem' }}>
                  En disputa
                </span>
              )}
              <IconChevron up={expanded} />
            </div>
          </div>

          <div style={{ fontSize: '0.82rem', marginTop: '0.15rem', overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <strong>{isOTW ? (order.customer_name || 'Cliente') : order.restaurant_name}</strong>
          </div>

          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.1rem',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {isOTW
              ? (order.customer_address || order.delivery_address || '')
              : (order.restaurant_address || '')}
          </div>

          {/* Pago */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: '0.2rem',
            fontSize: '0.72rem' }}>
            {isCash
              ? <><IconCash /><span style={{ fontWeight: 700, color: 'var(--brand)' }}>
                  {isOTW ? `Cobrar ${fmt(total)}` : `Pagar ${fmt(order.total_cents || 0)}`}
                </span></>
              : <><IconCard /><span style={{ color: 'var(--text-tertiary)' }}>
                  {order.payment_method === 'card' ? 'Tarjeta — no cobrar' : 'SPEI — no cobrar'}
                </span></>
            }
          </div>
        </div>
      </div>

      {/* ── Expandible 1: botones de acción ────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateRows: expanded ? '1fr' : '0fr',
        transition: 'grid-template-rows 0.22s ease',
        overflow: 'hidden',
      }}>
        <div style={{ overflow: 'hidden' }}>
          <div style={{ padding: '0.5rem 0.75rem 0.5rem', borderTop: '1px solid var(--border-light)',
            display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>

            {/* Acciones principales */}
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              <button
                style={{
                  flex: 1, padding: '0.55rem 0', borderRadius: 8, fontWeight: 700,
                  fontSize: '0.82rem', border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  background: canOTW ? 'var(--brand)' : 'var(--bg-raised)',
                  color: canOTW ? '#fff' : 'var(--text-tertiary)',
                  opacity: !canOTW ? 0.5 : 1,
                }}
                disabled={loadingStatus === 'on_the_way' || !canOTW}
                onClick={() => onChangeStatus(order.id, 'on_the_way')}>
                <IconOTW /> En camino
              </button>
              <button
                style={{
                  flex: 1, padding: '0.55rem 0', borderRadius: 8, fontWeight: 700,
                  fontSize: '0.82rem', border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  background: canDeliver ? 'var(--success)' : 'var(--bg-raised)',
                  color: canDeliver ? '#fff' : 'var(--text-tertiary)',
                  opacity: !canDeliver ? 0.5 : 1,
                }}
                disabled={loadingStatus === 'delivered' || !canDeliver}
                onClick={() => onChangeStatus(order.id, 'delivered')}>
                <IconDelivered /> Entregado
              </button>
            </div>

            {/* Opciones secundarias — expandible interno */}
            {(canRelevo || canRelease) && !order.is_disputed && (
              <details style={{ fontSize: '0.78rem' }}>
                <summary style={{
                  cursor: 'pointer', color: 'var(--text-tertiary)', fontWeight: 600,
                  fontSize: '0.72rem', listStyle: 'none', display: 'flex',
                  alignItems: 'center', gap: 4, padding: '0.15rem 0',
                }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  Más opciones
                </summary>
                <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.4rem' }}>
                  {canRelevo && (
                    <button style={{
                      flex: 1, padding: '0.45rem 0', borderRadius: 8, fontWeight: 700,
                      fontSize: '0.78rem', border: '1.5px solid #fde047', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                      color: '#854d0e', background: '#fef9c3',
                    }} onClick={onRebalance}>
                      <IconRelevo /> Buscar relevo
                    </button>
                  )}
                  {canRelease && (
                    <button style={{
                      flex: 1, padding: '0.45rem 0', borderRadius: 8, fontWeight: 700,
                      fontSize: '0.78rem', border: '1.5px solid #dc2626', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                      background: '#fef2f2', color: '#dc2626',
                    }} onClick={onToggleRelease}>
                      <IconRelease /> Liberar
                    </button>
                  )}
                </div>
              </details>
            )}

            {order.is_disputed && (
              <span style={{ fontSize: '0.72rem', color: '#854d0e', fontStyle: 'italic' }}>
                En disputa — buscando conductor…
              </span>
            )}

            {/* Release form */}
            {showRelease && (
              <div style={{ marginTop: '0.25rem' }}>
                <textarea value={releaseNote} onChange={e => onReleaseNoteChange(e.target.value)}
                  placeholder="Motivo (obligatorio, mín. 10 caracteres)" rows={2}
                  style={{ width: '100%', boxSizing: 'border-box',
                    marginBottom: '0.15rem', fontSize: '0.82rem' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', marginBottom: '0.3rem' }}>
                  <span style={{
                    fontSize: '0.68rem',
                    color: releaseNote.trim().length < 10 ? '#dc2626' : 'var(--text-tertiary)',
                  }}>
                    {releaseNote.trim().length}/10 mín.
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '0.3rem' }}>
                  <button className="btn-sm btn-danger"
                    onClick={onConfirmRelease}
                    disabled={releaseNote.trim().length < 10}
                    style={{ opacity: releaseNote.trim().length < 10 ? 0.45 : 1,
                      cursor: releaseNote.trim().length < 10 ? 'not-allowed' : 'pointer' }}>
                    Confirmar
                  </button>
                  <button className="btn-sm"
                    onClick={() => { onToggleRelease(); onReleaseNoteChange(''); }}>Cancelar</button>
                </div>
              </div>
            )}

            {/* ── Expandible 2: detalles del pedido ──────────────────────── */}
            <details style={{ borderTop: '1px solid var(--border-light)', paddingTop: '0.35rem' }}>
              <summary style={{
                cursor: 'pointer', color: 'var(--text-tertiary)', fontWeight: 600,
                fontSize: '0.72rem', listStyle: 'none', display: 'flex',
                alignItems: 'center', gap: 4,
              }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
                Detalles del pedido
              </summary>
              <div style={{ marginTop: '0.35rem' }}>
                {(order.items || []).length > 0 && (
                  <ul style={{ fontSize: '0.78rem', margin: '0 0 0.3rem 1rem',
                    color: 'var(--text-primary)' }}>
                    {order.items.map(i => (
                      <li key={i.menuItemId}>{i.name} × {i.quantity}</li>
                    ))}
                  </ul>
                )}
                <FeeBreakdown order={order} />
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)',
                  marginTop: '0.3rem' }}>
                  Ganancia estimada:{' '}
                  <strong style={{ color: 'var(--success)' }}>{fmt(earn)}</strong>
                </div>
              </div>
            </details>

          </div>
        </div>
      </div>
    </div>
  );
}
