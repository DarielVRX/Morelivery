import { STADIA_KEY } from './config';

export function DriverMapOverlays({ hasGPS, showAttrib, onToggleAttrib, bottomOffset = 8 }) {
  return (
    <>
      {/* Atribución expandida */}
      {showAttrib && (
        <div style={{
          position: 'absolute', bottom: bottomOffset + 28, left: 8, zIndex: 10,
          background: 'rgba(255,255,255,0.92)', borderRadius: 6,
          padding: '0.3rem 0.6rem', fontSize: '0.65rem', color: '#444',
          boxShadow: '0 1px 6px #0002', maxWidth: 260, pointerEvents: 'auto',
        }}>
          © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer"
            style={{ color: '#2563eb' }}>OpenStreetMap</a> contributors ·{' '}
          {STADIA_KEY
            ? <><a href="https://stadiamaps.com" target="_blank" rel="noopener noreferrer"
                style={{ color: '#2563eb' }}>Stadia Maps</a> · </>
            : <><a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer"
                style={{ color: '#2563eb' }}>OpenFreeMap</a> · </>}
          <a href="https://maplibre.org" target="_blank" rel="noopener noreferrer"
            style={{ color: '#2563eb' }}>MapLibre</a>
        </div>
      )}

      {/* Botón atribución — siempre visible, sube con paneles */}
      <button onClick={onToggleAttrib} title="Atribuciones del mapa"
        style={{
          position: 'absolute', bottom: bottomOffset, left: 8, zIndex: 10,
          background: 'rgba(255,255,255,0.75)', border: 'none',
          borderRadius: 3, padding: '1px 5px', cursor: 'pointer',
          fontSize: '0.6rem', color: '#555', lineHeight: 1,
          transition: 'bottom 0.25s ease',
        }}>
        ©
      </button>

      {/* Sin GPS */}
      {!hasGPS && (
        <div style={{
          position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.5)', color: '#fff', borderRadius: 20,
          padding: '0.2rem 0.75rem', fontSize: '0.72rem', zIndex: 5,
          pointerEvents: 'none', whiteSpace: 'nowrap',
          display: 'flex', alignItems: 'center', gap: 5,
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
          </svg>
          Sin GPS — toca el mapa para marcar posición
        </div>
      )}
    </>
  );
}
