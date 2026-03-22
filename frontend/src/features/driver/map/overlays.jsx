import { STADIA_KEY } from './config';

export function DriverMapOverlays({ hasGPS, showAttrib, onToggleAttrib }) {
  return (
    <>
      {showAttrib && (
        <div style={{ position: 'absolute', bottom: 52, left: 8, zIndex: 10,
          background: 'rgba(255,255,255,0.92)', borderRadius: 6,
          padding: '0.3rem 0.6rem', fontSize: '0.65rem', color: '#444',
          boxShadow: '0 1px 6px #0002', maxWidth: 260, pointerEvents: 'none' }}>
          © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer"
            style={{ color: '#2563eb' }}>OpenStreetMap</a> contributors ·{' '}
          {STADIA_KEY
            ? <><a href="https://stadiamaps.com" target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb' }}>Stadia Maps</a> · </>
            : <><a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb' }}>OpenFreeMap</a> · </>}
          <a href="https://maplibre.org" target="_blank" rel="noopener noreferrer"
            style={{ color: '#2563eb' }}>MapLibre</a>
        </div>
      )}

      <button onClick={onToggleAttrib} title="Atribuciones"
        style={{ position: 'absolute', bottom: 8, left: 8, zIndex: 10,
          background: 'rgba(255,255,255,0.82)', border: '1px solid #ccc',
          borderRadius: 4, width: 22, height: 22, cursor: 'pointer',
          fontSize: '0.65rem', display: 'flex', alignItems: 'center',
          justifyContent: 'center', color: '#555', padding: 0 }}>ℹ</button>

      {!hasGPS && (
        <div style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.5)', color: '#fff', borderRadius: 20,
          padding: '0.2rem 0.75rem', fontSize: '0.72rem', zIndex: 5,
          pointerEvents: 'none', whiteSpace: 'nowrap' }}>
          📍 Sin GPS — toca el mapa para marcar posición
        </div>
      )}
    </>
  );
}
