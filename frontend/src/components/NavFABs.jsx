// components/NavFABs.jsx

var NAV_REPORT_MODES = ['zone', 'impassable', 'preference'];

// Ciclo del FAB de reporte: null → normal → rapido → null
// En modo normal abre ZonePlacer / WayPicker según submodo
// En modo rápido envía directo sin pasos intermedios

function IconCenter({ mode }) {
  const color = mode === 'free' ? 'var(--text-secondary)' : '#fff';
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2.2" strokeLinecap="round">
      <circle cx="12" cy="12" r="3.5" fill={mode !== 'free' ? color : 'none'}/>
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
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><polygon points="3 11 22 2 13 21 11 13 3 11" fill="currentColor"/></svg>;
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
function IconReport({ reportMode }) {
  if (reportMode === 'quick') {
    return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>;
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
      <line x1="4" y1="22" x2="4" y2="15"/>
    </svg>
  );
}

// Pills de reporte — igual en normal y rápido
const REPORT_PILLS = [
  { mode: 'zone',       label: 'Zona de alerta',   icon: '🚦', color: '#f97316' },
  { mode: 'impassable', label: 'Calle no viable',   icon: '⛔', color: '#ef4444' },
  { mode: 'preference', label: 'Preferencias',     icon: '⭐', color: '#16a34a' },
];

export default function NavFABs({
  hasActiveOrder,
  routeGeometry,
  centerMode,
  bottomOffset = 16,
  voiceEnabled,
  navMode,
  myPosition,
  onCenterCycle,
  onVoiceToggle,
  onGoogleNav,
  onNavMode,
  onQuickReport,  // (type, position) → envío directo sin pasos
  isDark = false,
}) {
  const withRoute   = hasActiveOrder && (routeGeometry?.length > 0);
  const safeBot     = 'env(safe-area-inset-bottom, 0px)';
  const BASE        = bottomOffset;
  const GAP         = 12;
  const SZ_P        = 60;  // primary
  const SZ_S        = 52;  // secondary

  // reportMode: null | 'normal' | 'quick'
  const isReportNormal = navMode === 'menu';
  const isReportQuick  = navMode === 'menu-quick';
  const isReportOpen   = isReportNormal || isReportQuick;

  const centerBottom    = `calc(${BASE}px + ${safeBot})`;
  const secondaryBottom = `calc(${BASE + SZ_P + GAP}px + ${safeBot})`;
  const reportBottom    = withRoute
    ? `calc(${BASE + SZ_P + GAP + SZ_S + GAP}px + ${safeBot})`
    : secondaryBottom;
  const menuBottom      = withRoute
    ? `calc(${BASE + SZ_P + GAP + SZ_S + GAP + SZ_S + GAP}px + ${safeBot})`
    : `calc(${BASE + SZ_P + GAP + SZ_S + GAP}px + ${safeBot})`;

  const centerBg =
    centerMode === 'nav'      ? 'var(--brand)' :
    centerMode === 'overview' ? '#4f46e5'      : '#fff';

  // Colores del FAB de reporte según estado
  const reportFabBg    = isReportQuick
    ? (isDark ? '#4c1d95' : '#7c3aed')
    : isReportNormal ? 'var(--brand)' : '#fff';
  const reportFabColor = isReportOpen ? '#fff' : 'var(--text-secondary)';
  const reportFabBorder = isReportOpen ? 'none' : '1.5px solid var(--border)';

  // Resplandor modo rápido
  const quickGlow = isDark
    ? '0 0 0 3px rgba(250,204,21,0.35), 0 2px 8px rgba(0,0,0,0.3)'
    : '0 0 0 3px rgba(124,58,237,0.25), 0 2px 8px rgba(0,0,0,0.15)';

  const fabBase = {
    position: 'absolute', right: 14, zIndex: 402,
    borderRadius: '50%', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: 'none', transition: 'background 0.15s, box-shadow 0.15s',
  };

  function cycleReport() {
    if (!isReportOpen)      return onNavMode('menu');
    if (isReportNormal)     return onNavMode('menu-quick');
    return onNavMode(null);
  }

  function handlePill(type) {
    if (isReportQuick) {
      // Modo rápido: envío directo
      if (!myPosition) return;
      onQuickReport?.(type, myPosition);
      onNavMode(null);
    } else {
      // Modo normal: abre el placer/picker
      onNavMode(type);
    }
  }

  const showReport = navMode !== 'zone' && navMode !== 'impassable' && navMode !== 'preference';
  const showMore   = withRoute && navMode !== 'zone' && navMode !== 'impassable' && navMode !== 'preference' && !isReportOpen;

  return (
    <>
      {/* ── Centrar ─────────────────────────────────────────────────── */}
      <button onClick={onCenterCycle} title={
        centerMode === 'nav'      ? 'Navegación activa' :
        centerMode === 'overview' ? 'Vista de ruta' : 'Centrar en mi posición'}
        aria-label="Centrar mapa" className="dh-fab"
        style={{
          ...fabBase, bottom: centerBottom,
          width: SZ_P, height: SZ_P, background: centerBg,
          border: centerMode === 'free' ? '1.5px solid var(--border)' : 'none',
          boxShadow: centerMode !== 'free' ? '0 4px 16px rgba(0,0,0,0.28)' : '0 2px 10px rgba(0,0,0,0.16)',
          color: centerMode !== 'free' ? '#fff' : 'var(--text-secondary)',
        }}>
        <IconCenter mode={centerMode} />
      </button>

      {/* ── Más (con ruta) ──────────────────────────────────────────── */}
      {showMore && (
        <button onClick={() => onNavMode(navMode === 'more' ? null : 'more')}
          title="Más opciones" aria-label="Más" className="dh-fab"
          style={{
            ...fabBase, bottom: secondaryBottom,
            width: SZ_S, height: SZ_S,
            background: navMode === 'more' ? 'var(--brand)' : '#fff',
            border: '1.5px solid var(--border)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            color: navMode === 'more' ? '#fff' : 'var(--text-secondary)',
          }}>
          <IconMore />
        </button>
      )}

      {/* ── Menú Más expandido ──────────────────────────────────────── */}
      {withRoute && navMode === 'more' && (
        <div style={{
          position: 'absolute',
          bottom: `calc(${BASE + SZ_P + GAP + SZ_S + GAP}px + ${safeBot})`,
          right: 14, zIndex: 403,
          display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8,
        }}>
          <button onClick={() => { onVoiceToggle(); onNavMode(null); }} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '0.55rem 1rem', borderRadius: 20,
            fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
            background: voiceEnabled ? '#f0fdf4' : '#f9fafb',
            color: voiceEnabled ? '#15803d' : '#6b7280',
            border: `1.5px solid ${voiceEnabled ? '#86efac' : 'var(--border)'}`,
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)', minHeight: 'unset',
          }}>
            <IconVolume on={voiceEnabled} />
            {voiceEnabled ? 'Voz activa' : 'Voz inactiva'}
          </button>
          <button onClick={() => { onGoogleNav(); onNavMode(null); }} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '0.55rem 1rem', borderRadius: 20,
            fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
            background: 'var(--brand)', color: '#fff', border: 'none',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)', minHeight: 'unset',
          }}>
            <IconNavigate /> Abrir en Maps
          </button>
        </div>
      )}

      {/* ── FAB Reportar ────────────────────────────────────────────── */}
      {showReport && (
        <button onClick={cycleReport}
          aria-label={isReportQuick ? 'Reporte rápido' : isReportNormal ? 'Cerrar reporte' : 'Reportar'}
          title={isReportQuick ? 'Modo rápido — toca para cerrar' : 'Reportar incidencia'}
          className="dh-fab"
          style={{
            ...fabBase,
            bottom: reportBottom,
            width: SZ_S, height: SZ_S,
            background: reportFabBg,
            border: reportFabBorder,
            boxShadow: isReportQuick ? quickGlow : '0 2px 8px rgba(0,0,0,0.15)',
            color: reportFabColor,
          }}>
          <IconReport reportMode={isReportQuick ? 'quick' : 'normal'} />
        </button>
      )}

      {/* ── Menú de reporte (normal o rápido) ──────────────────────── */}
      {isReportOpen && (
        <div style={{
          position: 'absolute',
          bottom: menuBottom,
          right: 14, zIndex: 403,
          display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6,
        }}>
          {/* Etiqueta modo rápido */}
          {isReportQuick && (
            <div style={{
              padding: '0.18rem 0.6rem', borderRadius: 20,
              fontSize: '0.68rem', fontWeight: 700,
              background: isDark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.92)',
              color: isDark ? '#fff' : '#111',
              border: `1.5px solid ${isDark ? 'rgba(251,191,36,0.5)' : 'rgba(124,58,237,0.35)'}`,
              boxShadow: isDark
                ? '0 0 8px rgba(251,191,36,0.25)'
                : '0 0 8px rgba(124,58,237,0.18)',
              whiteSpace: 'nowrap',
            }}>
              ⚡ Modo rápido
            </div>
          )}

          {REPORT_PILLS.map(pill => (
            <button key={pill.mode}
              onClick={() => handlePill(pill.mode)}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '0.55rem 1rem', borderRadius: 20,
                fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer',
                whiteSpace: 'nowrap',
                background: pill.color,
                color: '#fff',
                border: isReportQuick
                  ? `2px solid ${isDark ? '#fbbf24' : '#7c3aed'}`
                  : 'none',
                boxShadow: isReportQuick
                  ? (isDark
                      ? `0 0 0 3px rgba(251,191,36,0.25), 0 2px 8px rgba(0,0,0,0.22)`
                      : `0 0 0 3px rgba(124,58,237,0.2), 0 2px 8px rgba(0,0,0,0.22)`)
                  : '0 2px 8px rgba(0,0,0,0.22)',
                minHeight: 'unset',
              }}>
              <span>{pill.icon}</span>
              {pill.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
