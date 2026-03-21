export default function DriverHomeStatusBar({
  availability,
  position,
  notifPermission,
  notifPriorityMode,
  wakeLockActive,
  gpsError,
  counters,
  onToggleAvailability,
  msg,
  onDismissMsg,
  transferBanner,
  onDismissTransferBanner,
}) {
  return (
    <>
      <div style={{
        flexShrink:0,
        background:'var(--promo-gradient)',
        padding:'0.65rem 1rem',
        display:'flex',
        justifyContent:'space-between',
        alignItems:'center',
        gap:8,
        zIndex:10,
      }}>
        <div>
          <div style={{ fontWeight:700, fontSize:'0.875rem', color:'#fff' }}>
            {availability ? '● Disponible' : '○ No disponible'}
          </div>
          {position && <div style={{ fontSize:'0.7rem', color:'rgba(255,255,255,0.8)' }}>GPS · ±{position.accuracy}m</div>}
          <div style={{ fontSize:'0.68rem', color:'rgba(255,255,255,0.86)' }}>
            🔔 {notifPermission === 'granted' ? 'Notifs ON' : notifPermission === 'denied' ? 'Notifs bloqueadas' : 'Notifs pendientes'} · prioridad {notifPriorityMode === 'high' ? 'alta' : 'normal'}
          </div>
          {wakeLockActive && <div style={{ fontSize:'0.68rem', color:'rgba(255,255,255,0.85)' }}>Pantalla activa para navegación</div>}
          {gpsError && <div style={{ fontSize:'0.7rem', color:'#ffb3b3', maxWidth:200 }}>{gpsError}</div>}
          {counters && (
            <div style={{ fontSize:'0.65rem', color:'rgba(255,255,255,0.7)', marginTop:'0.1rem', display:'flex', gap:'0.6rem' }}>
              {counters.session_releases > 0 && <span>↩ {counters.session_releases} liberaciones</span>}
              {counters.session_rebalances > 0 && <span>⇄ {counters.session_rebalances} rebalanceos</span>}
              {counters.session_expires > 0 && <span>⏱ {counters.session_expires} expiradas</span>}
              {counters.session_cancels > 0 && <span>✕ {counters.session_cancels} canceladas</span>}
            </div>
          )}
        </div>
        <button onClick={onToggleAvailability} className={availability ? 'btn-primary btn-sm' : 'btn-sm'}>
          {availability ? 'Disponible' : 'No disponible'}
        </button>
      </div>

      {msg && (
        <div className="flash flash-error" style={{ flexShrink:0, borderRadius:0, margin:0, display:'flex', justifyContent:'space-between' }}>
          <span style={{ fontSize:'0.83rem' }}>{msg}</span>
          <button onClick={onDismissMsg} style={{ border:'none', background:'none', cursor:'pointer', fontWeight:700 }}>✕</button>
        </div>
      )}

      {transferBanner && (
        <div style={{
          flexShrink: 0,
          zIndex: 25,
          background: transferBanner.type === 'order_transferred_in' ? 'var(--success-bg)' : 'var(--warn-bg)',
          borderBottom: `2px solid ${transferBanner.type === 'order_transferred_in' ? 'var(--success)' : 'var(--warn)'}`,
          padding: '0.6rem 1rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            {transferBanner.type === 'order_transferred_in'
              ? '📦 Se te asignó un pedido transferido'
              : '↩️ Un pedido fue reasignado a otro conductor'}
          </span>
          <button onClick={onDismissTransferBanner} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontWeight: 700, minHeight:'unset' }}>✕</button>
        </div>
      )}
    </>
  );
}
