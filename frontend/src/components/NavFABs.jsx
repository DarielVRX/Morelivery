// components/NavFABs.jsx — FABs del mapa del conductor
//
// Diseño:
// - Botones principales: 44px (WCAG touch target)
// - Google Maps: 52px, prominente, solo con ruta activa
// - Stack vertical derecho, separado del ActiveOrderPanel
// - Centrar: 3 modos (ver handleCenterToggle en DriverHome)

const NAV_MENU_OPTIONS = [
  { mode: 'zone',       label: '🚦 Zona de alerta',      bg: '#f97316' },
  { mode: 'impassable', label: '⛔ Calle no viable',      bg: '#ef4444' },
  { mode: 'preference', label: '⭐ Preferencia de calle', bg: '#16a34a' },
];

// Ícono: crosshair con círculo — más claro que ⌖ en pantallas pequeñas
function IconCenter({ active }) {
  const color = active ? '#fff' : 'var(--text-primary)';
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4"/>
      <line x1="12" y1="2"  x2="12" y2="6"/>
      <line x1="12" y1="18" x2="12" y2="22"/>
      <line x1="2"  y1="12" x2="6"  y2="12"/>
      <line x1="18" y1="12" x2="22" y2="12"/>
    </svg>
  );
}

function IconVolume({ on }) {
  return on
    ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="2" strokeLinecap="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
    : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>;
}

function IconNavigate() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <polygon points="3 11 22 2 13 21 11 13 3 11" fill="#fff"/>
    </svg>
  );
}

export default function NavFABs({
  hasActiveOrder,
  routeGeometry,
  centerMode,       // 'off' | 'follow' | 'overview'
  voiceEnabled,
  navMode,
  onCenterCycle,    // cycles: off → follow → overview → off
  onVoiceToggle,
  onGoogleNav,
  onNavMode,
}) {
  const withRoute = hasActiveOrder && (routeGeometry?.length > 0);
  const safeBot   = 'env(safe-area-inset-bottom, 0px)';

  // Positions — right side stack, bottom up
  // Google Nav: big primary button when route active
  // Center:  44px
  // Voice:   44px
  // Report:  44px (only when no active order)
  const GAP = 10;
  const SZ  = 44;

  const googleBottom  = `calc(16px + ${safeBot})`;
  const centerBottom  = withRoute
    ? `calc(16px + 52px + ${GAP}px + ${safeBot})`   // above google nav
    : `calc(16px + ${safeBot})`;
  const voiceBottom   = `calc(16px + ${SZ}px + ${GAP}px + ${withRoute ? `52px + ${GAP}px + ` : ''}${safeBot})`;
  const reportBottom  = `calc(16px + ${SZ * 2}px + ${GAP * 2}px + ${withRoute ? `52px + ${GAP}px + ` : ''}${safeBot})`;
  const menuBottom    = `calc(16px + ${SZ * 2}px + ${GAP * 2}px + 8px + ${withRoute ? `52px + ${GAP}px + ` : ''}${safeBot})`;

  const fabStyle = (extra = {}) => ({
    position: 'absolute',
    right: 12,
    zIndex: 402,
    width: SZ,
    height: SZ,
    borderRadius: '50%',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 2px 10px rgba(0,0,0,0.22)',
    border: 'none',
    transition: 'background 0.15s, transform 0.12s',
    ...extra,
  });

  // Center button appearance by mode
  const centerBg    = centerMode === 'follow'   ? 'var(--brand)'
                    : centerMode === 'overview' ? '#4f46e5'
                    : '#fff';
  const centerTitle = centerMode === 'follow'   ? 'Seguimiento activo — pulsa para ver resumen de ruta'
                    : centerMode === 'overview' ? 'Vista de ruta — pulsa para desactivar'
                    : 'Centrar en mi posición';

  return (
    <>
      {/* Google Maps — primary action when navigating */}
      {withRoute && (
        <button
          onClick={onGoogleNav}
          title="Abrir navegación en Google Maps"
          aria-label="Google Maps"
          className="dh-fab"
          style={{
            position: 'absolute',
            bottom: googleBottom,
            right: 12,
            zIndex: 402,
            width: 52,
            height: 52,
            borderRadius: '50%',
            background: 'var(--brand)',
            border: 'none',
            cursor: 'pointer',
            boxShadow: '0 4px 18px rgba(0,0,0,0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <IconNavigate />
        </button>
      )}

      {/* Center / Follow button */}
      <button
        onClick={onCenterCycle}
        title={centerTitle}
        aria-label="Centrar mapa"
        className="dh-fab"
        style={fabStyle({
          bottom: centerBottom,
          background: centerBg,
          border: centerMode === 'off' ? '1.5px solid var(--border)' : 'none',
        })}>
        <IconCenter active={centerMode !== 'off'} />
      </button>

      {/* Voice toggle */}
      <button
        onClick={onVoiceToggle}
        title={voiceEnabled ? 'Desactivar instrucciones de voz' : 'Activar instrucciones de voz'}
        aria-label="Voz"
        className="dh-fab"
        style={fabStyle({
          bottom: voiceBottom,
          background: 'var(--bg-card)',
          border: '1.5px solid var(--border)',
        })}>
        <IconVolume on={voiceEnabled} />
      </button>

      {/* Report FAB — only without active order */}
      {!navMode && !hasActiveOrder && (
        <button
          aria-label="Reportar incidencia"
          title="Reportar zona, calle no viable o preferencia"
          className="dh-fab"
          onClick={() => onNavMode('menu')}
          style={fabStyle({
            bottom: reportBottom,
            background: 'var(--bg-card)',
            border: '1.5px solid var(--border)',
            color: 'var(--text-primary)',
            fontSize: '1rem',
          })}>
          ⚑
        </button>
      )}

      {/* Report mode mini-menu */}
      {navMode === 'menu' && (
        <div style={{
          position: 'absolute',
          bottom: menuBottom,
          right: 12,
          zIndex: 403,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 6,
        }}>
          {NAV_MENU_OPTIONS.map(opt => (
            <button key={opt.mode}
              onClick={() => onNavMode(opt.mode)}
              style={{
                padding: '0.35rem 0.875rem',
                borderRadius: 20,
                fontSize: '0.78rem',
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                background: opt.bg,
                color: '#fff',
                border: 'none',
                boxShadow: '0 2px 8px rgba(0,0,0,0.22)',
                minHeight: 'unset',
              }}>
              {opt.label}
            </button>
          ))}
          <button onClick={() => onNavMode(null)}
            style={{
              padding: '0.3rem 0.75rem',
              borderRadius: 20,
              fontSize: '0.75rem',
              background: 'var(--bg-card)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
              cursor: 'pointer',
              fontWeight: 600,
              minHeight: 'unset',
            }}>
            Cancelar
          </button>
        </div>
      )}
    </>
  );
}
