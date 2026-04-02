import { STADIA_KEY } from './config';

export function DriverMapOverlays({ hasGPS }) {
  return (
    <>
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
