// frontend/src/components/ZonePlacer.jsx
//
// Overlay semitransparente sobre el mapa con un círculo de tamaño fijo en px.
// El driver hace pan/zoom sobre el mapa para ajustar tamaño y posición del área.
// Al confirmar, se lee el centro del mapa y el radio en metros derivado del
// zoom actual exactamente igual que se detectan los parámetros del pin.
//
// Props:
//   map        — instancia de MapLibre GL (ya montado)
//   onConfirm  — ({ lat, lng, radius_m, type, estimated_hours }) => void
//   onCancel   — () => void

import { useEffect, useRef, useState } from 'react';

// ── radio del círculo en píxeles (constante en pantalla) ─────────────────────
const CIRCLE_PX = 110;

// metros por píxel dado el zoom y la latitud del centro actual del mapa
function metersPerPx(lat, zoom) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}

const ZONE_TYPES = [
  { value: 'traffic',      emoji: '🚦', label: 'Tráfico',     color: '#f97316' },
  { value: 'construction', emoji: '🚧', label: 'Obra',        color: '#eab308' },
  { value: 'accident',     emoji: '🚨', label: 'Accidente',   color: '#ef4444' },
  { value: 'flood',        emoji: '🌊', label: 'Inundación',  color: '#3b82f6' },
  { value: 'blocked',      emoji: '⛔', label: 'Bloqueada',   color: '#8b5cf6' },
  { value: 'other',        emoji: '⚠️', label: 'Otro',        color: '#6b7280' },
];
const HOURS_OPTIONS = [1, 2, 4, 8, 12, 24, 48, 72];

export default function ZonePlacer({ map, onConfirm, onCancel }) {
  const [zoneType,  setZoneType]  = useState('traffic');
  const [zoneHours, setZoneHours] = useState(2);
  const [radiusM,   setRadiusM]   = useState(100);
  const [saving,    setSaving]    = useState(false);

  const sel = ZONE_TYPES.find(t => t.value === zoneType) || ZONE_TYPES[0];

  // ── actualizar radio en tiempo real al mover/hacer zoom ─────────────────
  useEffect(() => {
    if (!map) return;
    function refresh() {
      const c   = map.getCenter();
      const mpp = metersPerPx(c.lat, map.getZoom());
      setRadiusM(Math.round(CIRCLE_PX * mpp));
    }
    refresh();
    map.on('move', refresh);
    map.on('zoom', refresh);
    return () => { map.off('move', refresh); map.off('zoom', refresh); };
  }, [map]);

  function handleConfirm() {
    if (!map || saving) return;
    setSaving(true);
    const c   = map.getCenter();
    const mpp = metersPerPx(c.lat, map.getZoom());
    const r   = Math.max(20, Math.min(2000, Math.round(CIRCLE_PX * mpp)));
    onConfirm({ lat: c.lat, lng: c.lng, radius_m: r, type: zoneType, estimated_hours: zoneHours });
  }

  const displayR = radiusM >= 1000
    ? `${(radiusM / 1000).toFixed(1)} km`
    : `${radiusM} m`;

  return (
    // El div raíz cubre el mapa pero NO consume eventos táctiles/mouse → pointer-events:none
    // Solo el panel inferior y los botones tienen pointer-events:auto.
    <div style={{
      position: 'absolute', inset: 0, zIndex: 20,
      pointerEvents: 'none',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
    }}>

      {/* ── Círculo ───────────────────────────────────────────────────────── */}
      <div style={{
        width: CIRCLE_PX * 2, height: CIRCLE_PX * 2, borderRadius: '50%',
        border: `2.5px solid ${sel.color}`,
        background: sel.color + '1a',
        boxShadow: `0 0 0 3px ${sel.color}33, inset 0 0 0 1px ${sel.color}44`,
        position: 'relative', flexShrink: 0,
        transition: 'border-color 0.2s, box-shadow 0.2s, background 0.2s',
      }}>
        {/* crosshair */}
        {[
          { width: 1, height: 18, top: '50%', left: '50%', transform: 'translate(-50%,-50%)' },
          { height: 1, width: 18, top: '50%', left: '50%', transform: 'translate(-50%,-50%)' },
        ].map((s, i) => (
          <div key={i} style={{ position: 'absolute', background: sel.color, ...s, transition: 'background 0.2s' }} />
        ))}
        {/* punto central */}
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%,-50%)',
          width: 6, height: 6, borderRadius: '50%',
          background: sel.color, transition: 'background 0.2s',
        }} />
      </div>

      {/* ── Etiqueta de radio ─────────────────────────────────────────────── */}
      <div style={{
        marginTop: 7, pointerEvents: 'none',
        background: 'rgba(0,0,0,0.6)', color: '#fff',
        borderRadius: 10, padding: '0.18rem 0.55rem',
        fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.3px',
      }}>
        radio ≈ {displayR}
      </div>

      {/* ── Panel inferior ────────────────────────────────────────────────── */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        background: '#fff', borderTop: `3px solid ${sel.color}`,
        padding: '0.65rem 1rem 0.8rem',
        boxShadow: '0 -4px 20px rgba(0,0,0,0.14)',
        pointerEvents: 'auto',
        transition: 'border-top-color 0.2s',
      }}>

        {/* título */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <span style={{ fontWeight: 700, fontSize: '0.84rem', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: sel.color, display: 'inline-block', flexShrink: 0, transition: 'background 0.2s' }} />
            Zona de alerta
          </span>
          <span style={{ fontSize: '0.68rem', color: '#9ca3af' }}>Mueve/zoom para ajustar</span>
        </div>

        {/* tipo — chips */}
        <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginBottom: '0.48rem' }}>
          {ZONE_TYPES.map(t => {
            const active = t.value === zoneType;
            return (
              <button key={t.value} onClick={() => setZoneType(t.value)} style={{
                padding: '0.28rem 0.6rem', borderRadius: 20, fontSize: '0.72rem',
                fontWeight: active ? 700 : 500, cursor: 'pointer', transition: 'all 0.13s',
                background: active ? t.color : '#f3f4f6',
                color:      active ? '#fff'   : '#374151',
                border: `1.5px solid ${active ? t.color : '#e5e7eb'}`,
              }}>
                {t.emoji} {t.label}
              </button>
            );
          })}
        </div>

        {/* vigencia — chips */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.72rem', color: '#6b7280', flexShrink: 0 }}>Vigencia:</span>
          {HOURS_OPTIONS.map(h => {
            const active = h === zoneHours;
            return (
              <button key={h} onClick={() => setZoneHours(h)} style={{
                padding: '0.2rem 0.42rem', borderRadius: 8, fontSize: '0.7rem',
                fontWeight: active ? 700 : 400, cursor: 'pointer', transition: 'all 0.12s',
                background: active ? '#111827' : '#f3f4f6',
                color:      active ? '#fff'    : '#374151',
                border: `1px solid ${active ? '#111827' : '#e5e7eb'}`,
              }}>{h}h</button>
            );
          })}
        </div>

        {/* acciones */}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={handleConfirm} disabled={saving} style={{
            flex: 1, padding: '0.58rem 0', borderRadius: 9, fontSize: '0.86rem',
            fontWeight: 700, cursor: saving ? 'wait' : 'pointer',
            background: sel.color, color: '#fff', border: 'none',
            opacity: saving ? 0.7 : 1, transition: 'opacity 0.15s, background 0.2s',
          }}>
            {saving ? 'Guardando…' : 'Guardar zona'}
          </button>
          <button onClick={onCancel} style={{
            flex: 1, padding: '0.58rem 0', borderRadius: 9, fontSize: '0.86rem',
            fontWeight: 600, cursor: 'pointer',
            background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb',
          }}>Cancelar</button>
        </div>

      </div>
    </div>
  );
}
