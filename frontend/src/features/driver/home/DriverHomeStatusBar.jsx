// components/DriverHomeStatusBar.jsx
export default function DriverHomeStatusBar({
  availability,
  onToggleAvailability,
  msg,
  onDismissMsg,
  transferBanner,
  onDismissTransferBanner,
  counters,       // { session_deliveries, session_earnings_cents }
  bagPct = null,  // pico de capacidad de mochila en ruta actual
}) {
  // Ganancias del día
  const earnings = counters?.session_earnings_cents
    ? `$${(counters.session_earnings_cents / 100).toFixed(0)}`
    : null;
  const deliveries = counters?.session_deliveries ?? 0;

  // bagPct viene de useOrderManager — calculado al aceptar la oferta

  return (
    <>
      <div style={{
        flexShrink: 0,
        background: 'linear-gradient(135deg, #c97b7b 0%, #b56060 60%, #9e4f4f 100%)',
        padding: '0.5rem 1rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 8,
        zIndex: 10,
      }}>
        {/* Estado */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#fff', whiteSpace: 'nowrap' }}>
            {availability ? '● Disponible' : '○ No disponible'}
          </span>

          {/* Stats del día — solo si hay datos */}
          {(earnings || deliveries > 0 || bagPct !== null) && (
            <div style={{
              display: 'flex', gap: '0.6rem', alignItems: 'center',
              fontSize: '0.72rem', color: 'rgba(255,255,255,0.85)',
              borderLeft: '1px solid rgba(255,255,255,0.3)',
              paddingLeft: '0.6rem', flexWrap: 'wrap',
            }}>
              {earnings && (
                <span style={{ fontWeight: 600 }}>
                  <span style={{ opacity: 0.75 }}>Hoy </span>{earnings}
                </span>
              )}
              {deliveries > 0 && (
                <span>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)"
                    strokeWidth="2.5" strokeLinecap="round" style={{ verticalAlign: 'middle', marginRight: 2 }}>
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  {deliveries}
                </span>
              )}
              {bagPct !== null && (
                <span>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)"
                    strokeWidth="2" strokeLinecap="round" style={{ verticalAlign: 'middle', marginRight: 2 }}>
                    <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
                    <line x1="3" y1="6" x2="21" y2="6"/>
                    <path d="M16 10a4 4 0 01-8 0"/>
                  </svg>
                  {bagPct}%
                </span>
              )}
            </div>
          )}
        </div>

        {/* Toggle */}
        <button
          onClick={onToggleAvailability}
          className={availability ? 'btn-primary btn-sm' : 'btn-sm'}
          style={{ flexShrink: 0 }}>
          {availability ? 'Disponible' : 'No disponible'}
        </button>
      </div>

      {/* Flash message */}
      {msg && (
        <div className="flash flash-error" style={{
          flexShrink: 0, borderRadius: 0, margin: 0,
          display: 'flex', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: '0.83rem' }}>{msg}</span>
          <button onClick={onDismissMsg}
            style={{ border: 'none', background: 'none', cursor: 'pointer', fontWeight: 700 }}>✕</button>
        </div>
      )}

      {/* Transfer banner */}
      {transferBanner && (
        <div style={{
          flexShrink: 0, zIndex: 25,
          background: transferBanner.type === 'order_transferred_in' ? 'var(--success-bg)' : 'var(--warn-bg)',
          borderBottom: `2px solid ${transferBanner.type === 'order_transferred_in' ? 'var(--success)' : 'var(--warn)'}`,
          padding: '0.6rem 1rem',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            {transferBanner.type === 'order_transferred_in'
              ? 'Se te asignó un pedido transferido'
              : 'Un pedido fue reasignado a otro conductor'}
          </span>
          <button onClick={onDismissTransferBanner}
            style={{ border: 'none', background: 'none', cursor: 'pointer',
              color: 'var(--text-tertiary)', fontWeight: 700, minHeight: 'unset' }}>✕</button>
        </div>
      )}
    </>
  );
}
