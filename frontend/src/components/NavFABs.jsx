// components/NavFABs.jsx — FABs del mapa del conductor
//
// Jerarquía visual:
//
// SIN pedido activo:
//   [⚑ Reportar]  ← expandible, arriba
//   [⊕ Centrar]   ← principal, abajo derecha
//
// CON pedido activo (ruta cargada):
//   [⋯ Más]       ← secundario: voz + google maps, arriba
//   [⊕ Centrar]   ← principal, prominente, abajo derecha
//
// BASE_BOTTOM = 164px sobre safe area — por encima de las cards de oferta/pedido

var NAV_MENU_OPTIONS = [
  { mode: 'zone',       label: '🚦 Zona de alerta',      bg: '#f97316' },
  { mode: 'impassable', label: '⛔ Calle no viable',      bg: '#ef4444' },
  { mode: 'preference', label: '⭐ Preferencia de calle', bg: '#16a34a' },
];

function IconCenter({ mode }) {
  const color = mode === 'off' ? 'var(--text-secondary)' : '#fff';
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2.2" strokeLinecap="round">
      <circle cx="12" cy="12" r="3.5" fill={mode !== 'off' ? color : 'none'}/>
      <line x1="12" y1="2"  x2="12" y2="7"/>
      <line x1="12" y1="17" x2="12" y2="22"/>
      <line x1="2"  y1="12" x2="7"  y2="12"/>
      <line x1="17" y1="12" x2="22" y2="12"/>
    </svg>
  );
}

function IconVolume({ on }) {
  return on
    ? <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
    : <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>;
}

function IconNavigate() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <polygon points="3 11 22 2 13 21 11 13 3 11" fill="currentColor"/>
    </svg>
  );
}

function IconMore() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <circle cx="12" cy="5"  r="1" fill="currentColor"/>
      <circle cx="12" cy="12" r="1" fill="currentColor"/>
      <circle cx="12" cy="19" r="1" fill="currentColor"/>
    </svg>
  );
}

export default function NavFABs({
  hasActiveOrder,
  routeGeometry,
  centerMode,
  bottomOffset = 16,
  voiceEnabled,
  navMode,
  onCenterCycle,
  onVoiceToggle,
  onGoogleNav,
  onNavMode,
}) {
  const withRoute      = hasActiveOrder && (routeGeometry?.length > 0);
  const safeBot        = 'env(safe-area-inset-bottom, 0px)';
  const BASE_BOTTOM    = bottomOffset; // sube dinámicamente con los paneles
  const GAP            = 12;
  const SZ_PRIMARY     = 60;
  const SZ_SECONDARY   = 52;

  const centerBottom    = `calc(${BASE_BOTTOM}px + ${safeBot})`;
  const secondaryBottom = `calc(${BASE_BOTTOM + SZ_PRIMARY + GAP}px + ${safeBot})`;
  // Cuando hay ruta, el botón Más ocupa secondaryBottom y Reportar sube un nivel más
  const reportBottom    = withRoute
    ? `calc(${BASE_BOTTOM + SZ_PRIMARY + GAP + SZ_SECONDARY + GAP}px + ${safeBot})`
    : secondaryBottom;
  const menuBottom      = withRoute
    ? `calc(${BASE_BOTTOM + SZ_PRIMARY + GAP + SZ_SECONDARY + GAP + SZ_SECONDARY + GAP}px + ${safeBot})`
    : `calc(${BASE_BOTTOM + SZ_PRIMARY + GAP + SZ_SECONDARY + GAP}px + ${safeBot})`;

  const centerBg =
    centerMode === 'follow'   ? 'var(--brand)' :
    centerMode === 'overview' ? '#4f46e5'      : '#fff';

  const centerTitle =
    centerMode === 'follow'   ? 'Seguimiento activo — toca para vista de ruta' :
    centerMode === 'overview' ? 'Vista de ruta — toca para desactivar'         :
                                'Centrar en mi posición';

  const fabBase = {
    position: 'absolute',
    right: 14,
    zIndex: 402,
    borderRadius: '50%',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    transition: 'background 0.15s, box-shadow 0.15s',
  };

  return (
    <>
      {/* ── Principal: Centrar ──────────────────────────────────────────────── */}
      <button
        onClick={onCenterCycle}
        title={centerTitle}
        aria-label="Centrar mapa"
        className="dh-fab"
        style={{
          ...fabBase,
          bottom: centerBottom,
          width: SZ_PRIMARY,
          height: SZ_PRIMARY,
          background: centerBg,
          border: centerMode === 'off' ? '1.5px solid var(--border)' : 'none',
          boxShadow: centerMode !== 'off'
            ? '0 4px 16px rgba(0,0,0,0.28)'
            : '0 2px 10px rgba(0,0,0,0.16)',
          color: centerMode !== 'off' ? '#fff' : 'var(--text-secondary)',
        }}>
        <IconCenter mode={centerMode} />
      </button>

      {/* ── Con ruta: botón "Más" (voz + Google Maps) ──────────────────────── */}
      {withRoute && navMode !== 'menu' && (
        <button
          onClick={() => onNavMode(navMode === 'more' ? null : 'more')}
          title="Más opciones"
          aria-label="Más opciones de navegación"
          className="dh-fab"
          style={{
            ...fabBase,
            bottom: secondaryBottom,
            width: SZ_SECONDARY,
            height: SZ_SECONDARY,
            background: navMode === 'more' ? 'var(--brand)' : '#fff',
            border: '1.5px solid var(--border)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            color: navMode === 'more' ? '#fff' : 'var(--text-secondary)',
          }}>
          <IconMore />
        </button>
      )}

      {/* ── Menú "Más" expandido ────────────────────────────────────────────── */}
      {withRoute && navMode === 'more' && (
        <div style={{
          position: 'absolute',
          bottom: secondaryBottom,
          right: 14,
          zIndex: 403,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 8,
        }}>
          <button
            onClick={() => { onVoiceToggle(); onNavMode(null); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '0.55rem 1rem', borderRadius: 20,
              fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer',
              whiteSpace: 'nowrap',
              background: voiceEnabled ? '#f0fdf4' : '#f9fafb',
              color: voiceEnabled ? '#15803d' : '#6b7280',
              border: `1.5px solid ${voiceEnabled ? '#86efac' : 'var(--border)'}`,
              boxShadow: '0 2px 8px rgba(0,0,0,0.12)', minHeight: 'unset',
            }}>
            <IconVolume on={voiceEnabled} />
            {voiceEnabled ? 'Voz activa' : 'Voz inactiva'}
          </button>

          <button
            onClick={() => { onGoogleNav(); onNavMode(null); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '0.55rem 1rem', borderRadius: 20,
              fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer',
              whiteSpace: 'nowrap', background: 'var(--brand)',
              color: '#fff', border: 'none',
              boxShadow: '0 2px 8px rgba(0,0,0,0.2)', minHeight: 'unset',
            }}>
            <IconNavigate />
            Abrir en Maps
          </button>

          <button onClick={() => onNavMode(null)}
            style={{
              padding: '0.3rem 0.75rem', borderRadius: 20, fontSize: '0.73rem',
              background: 'var(--bg-card)', color: 'var(--text-secondary)',
              border: '1px solid var(--border)', cursor: 'pointer',
              fontWeight: 600, minHeight: 'unset',
            }}>
            Cerrar
          </button>
        </div>
      )}

      {/* ── Sin pedido: botón Reportar ──────────────────────────────────────── */}
      {!navMode && navMode !== 'more' && (
        <button
          aria-label="Reportar incidencia"
          title="Reportar zona, calle no viable o preferencia"
          className="dh-fab"
          onClick={() => onNavMode('menu')}
          style={{
            ...fabBase,
            bottom: reportBottom,
            width: SZ_SECONDARY,
            height: SZ_SECONDARY,
            background: '#fff',
            border: '1.5px solid var(--border)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            color: 'var(--text-secondary)',
            fontSize: '1rem',
          }}>
          ⚑
        </button>
      )}

      {/* ── Menú Reportar expandido ─────────────────────────────────────────── */}
      {navMode === 'menu' && (
        <div style={{
          position: 'absolute',
          bottom: menuBottom,
          right: 14,
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
                padding: '0.55rem 1rem', borderRadius: 20,
                fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer',
                whiteSpace: 'nowrap', background: opt.bg,
                color: '#fff', border: 'none',
                boxShadow: '0 2px 8px rgba(0,0,0,0.22)', minHeight: 'unset',
              }}>
              {opt.label}
            </button>
          ))}
          <button onClick={() => onNavMode(null)}
            style={{
              padding: '0.3rem 0.75rem', borderRadius: 20, fontSize: '0.75rem',
              background: 'var(--bg-card)', color: 'var(--text-secondary)',
              border: '1px solid var(--border)', cursor: 'pointer',
              fontWeight: 600, minHeight: 'unset',
            }}>
            Cancelar
          </button>
        </div>
      )}
    </>
  );
}
