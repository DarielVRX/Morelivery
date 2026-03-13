// components/NavFABs.jsx — FABs del mapa + mini menú de tipo de reporte
// Props son todo lo que el componente necesita saber; zero lógica de negocio aquí.

const NAV_MENU_OPTIONS = [
  { mode: 'zone',       label: '🚦 Zona de alerta',       bg: '#f97316' },
  { mode: 'impassable', label: '⛔ Calle no viable',       bg: '#ef4444' },
  { mode: 'preference', label: '⭐ Preferencia de calle',  bg: '#16a34a' },
];

export default function NavFABs({
  hasActiveOrder,
  routeGeometry,
  centerActive,
  voiceEnabled,
  navMode,
  onCenterToggle,
  onVoiceToggle,
  onGoogleNav,
  onNavMode,
}) {
  // Offsets base dinámicos según si hay pedido activo con ruta visible
  const withRoute  = hasActiveOrder && (routeGeometry?.length > 0);
  const baseBottom = 'calc(16px + env(safe-area-inset-bottom,0px))';
  const routeBottom = 'calc(156px + env(safe-area-inset-bottom,0px))';

  const centerBottom = withRoute
    ? 'calc(16px + 196px + 8px + 36px + 8px + env(safe-area-inset-bottom,0px))'
    : baseBottom;
  const voiceBottom = withRoute
    ? 'calc(16px + 196px + 8px + 36px + 8px + 44px + env(safe-area-inset-bottom,0px))'
    : 'calc(16px + 44px + env(safe-area-inset-bottom,0px))';
  const reportBottom = 'calc(16px + 44px + 44px + env(safe-area-inset-bottom,0px))';
  const menuBottom   = 'calc(16px + 44px + 44px + 8px + env(safe-area-inset-bottom,0px))';

  const fabBase = {
    position: 'absolute', right: 12, zIndex: 402,
    width: 36, height: 36, borderRadius: '50%',
    boxShadow: '0 2px 8px rgba(0,0,0,0.18)', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: '1px solid #d1d5db', fontSize: '1rem',
  };

  return (
    <>
      {/* Google Navigation — solo si hay pedido activo con ruta */}
      {withRoute && (
        <button onClick={onGoogleNav} aria-label="Abrir en Google Maps" className="dh-fab"
          style={{ position:'absolute', bottom: routeBottom, right:12, zIndex:400,
            width:56, height:56, borderRadius:'50%',
            background:'var(--brand)', color:'#fff', border:'none',
            cursor:'pointer', boxShadow:'0 4px 16px rgba(0,0,0,0.28)',
            display:'flex', alignItems:'center', justifyContent:'center' }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
            <polygon points="3 11 22 2 13 21 11 13 3 11" fill="#fff"/>
          </svg>
        </button>
      )}

      {/* Centrar — toggle rosa/blanco */}
      <button onClick={onCenterToggle}
        aria-label={centerActive ? 'Desactivar centrado' : 'Activar centrado'}
        className="dh-fab"
        style={{ ...fabBase, bottom: centerBottom,
          background: centerActive ? 'var(--brand)' : '#ffffff',
          color:       centerActive ? '#ffffff'     : '#111827',
          border:      centerActive ? 'none'        : '1px solid #d1d5db',
          transition:  'background 0.15s, color 0.15s',
        }}>⌖</button>

      {/* Voz toggle */}
      <button onClick={onVoiceToggle}
        aria-label={voiceEnabled ? 'Desactivar voz' : 'Activar voz'}
        className="dh-fab"
        style={{ ...fabBase, bottom: voiceBottom,
          background: '#ffffff', color: '#111827' }}>
        {voiceEnabled ? '🔊' : '🔇'}
      </button>

      {/* FAB reportar — solo sin pedido activo y sin modo activo */}
      {!navMode && !hasActiveOrder && (
        <button aria-label="Reportar incidencia de ruta" className="dh-fab"
          onClick={() => onNavMode('menu')}
          style={{ ...fabBase, bottom: reportBottom,
            background: '#fff', color: '#374151' }}>⚑</button>
      )}

      {/* Mini menú de tipo de reporte */}
      {navMode === 'menu' && (
        <div style={{ position:'absolute', bottom: menuBottom, right:12, zIndex:403,
          display:'flex', flexDirection:'column', alignItems:'flex-end', gap:6 }}>
          {NAV_MENU_OPTIONS.map(opt => (
            <button key={opt.mode} onClick={() => onNavMode(opt.mode)}
              style={{ padding:'0.32rem 0.75rem', borderRadius:20, fontSize:'0.76rem',
                fontWeight:600, cursor:'pointer', whiteSpace:'nowrap',
                background: opt.bg, color:'#fff', border:'none',
                boxShadow:'0 2px 8px rgba(0,0,0,0.2)' }}>
              {opt.label}
            </button>
          ))}
          <button onClick={() => onNavMode(null)}
            style={{ padding:'0.28rem 0.65rem', borderRadius:20, fontSize:'0.72rem',
              background:'#f3f4f6', color:'#374151',
              border:'1px solid #e5e7eb', cursor:'pointer', fontWeight:600 }}>
            Cancelar
          </button>
        </div>
      )}
    </>
  );
}
