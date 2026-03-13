// frontend/src/components/ZonePlacer.jsx
//
// Flujo en 3 pasos para reportar una zona sin sobrecargar la pantalla:
//   step 'place' — solo el círculo + Confirmar área / Cancelar
//   step 'type'  — bottom sheet con grid de tipos (6 chips)
//   step 'hours' — bottom sheet con grid de vigencias → llama onConfirm
//
// El driver hace pan/zoom sobre el mapa para ajustar posición y tamaño.
// Radio en metros se calcula al pasar de step 'place' a 'type'.

import { useEffect, useState } from 'react';

const CIRCLE_PX = 110;

function metersPerPx(lat, zoom) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}

const ZONE_TYPES = [
  { value: 'traffic',      emoji: '🚦', label: 'Tráfico pesado',       color: '#f97316' },
  { value: 'construction', emoji: '🚧', label: 'Obra en construcción', color: '#eab308' },
  { value: 'accident',     emoji: '🚨', label: 'Accidente',            color: '#ef4444' },
  { value: 'flood',        emoji: '🌊', label: 'Inundación',           color: '#3b82f6' },
  { value: 'blocked',      emoji: '⛔', label: 'Calle bloqueada',      color: '#8b5cf6' },
  { value: 'other',        emoji: '⚠️', label: 'Otro problema',        color: '#6b7280' },
];

const HOURS_OPTS = [
  { value: 1,  label: '~1 hora'  },
  { value: 2,  label: '~2 horas' },
  { value: 4,  label: '~4 horas' },
  { value: 8,  label: 'Medio día' },
  { value: 12, label: '12 horas' },
  { value: 24, label: '1 día'    },
  { value: 48, label: '2 días'   },
  { value: 72, label: '3 días'   },
];

export default function ZonePlacer({ map, onConfirm, onCancel }) {
  const [step,     setStep]     = useState('place'); // 'place' | 'type' | 'hours'
  const [radiusM,  setRadiusM]  = useState(100);
  const [zoneType, setZoneType] = useState(null);
  const [captured, setCaptured] = useState(null);    // {lat,lng,radius_m} fijado en step 1
  const [saving,   setSaving]   = useState(false);

  const sel = ZONE_TYPES.find(t => t.value === zoneType) || null;
  const circleColor = sel ? sel.color : '#e3aaaa';

  // Radio en tiempo real
  useEffect(() => {
    if (!map) return;
    function refresh() {
      const c = map.getCenter();
      setRadiusM(Math.round(CIRCLE_PX * metersPerPx(c.lat, map.getZoom())));
    }
    refresh();
    map.on('move', refresh);
    map.on('zoom', refresh);
    return () => { map.off('move', refresh); map.off('zoom', refresh); };
  }, [map]);

  function handleStep1() {
    if (!map) return;
    const c = map.getCenter();
    const r = Math.max(20, Math.min(2000, Math.round(CIRCLE_PX * metersPerPx(c.lat, map.getZoom()))));
    setCaptured({ lat: c.lat, lng: c.lng, radius_m: r });
    setStep('type');
  }

  function handleTypeSelect(val) {
    setZoneType(val);
    setStep('hours');
  }

  function handleHoursSelect(h) {
    if (!captured || saving) return;
    setSaving(true);
    onConfirm({ ...captured, type: zoneType, estimated_hours: h });
  }

  const displayR = radiusM >= 1000
    ? `${(radiusM / 1000).toFixed(1)} km`
    : `${radiusM} m`;

  // Panel inferior compartido — altura depende del step
  const panelBase = {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    pointerEvents: 'auto',
    background: '#fff',
    borderTop: `3px solid ${circleColor}`,
    padding: `0.75rem 1rem calc(0.8rem + env(safe-area-inset-bottom,0px))`,
    boxShadow: '0 -4px 24px rgba(0,0,0,0.14)',
    transition: 'border-top-color 0.25s',
  };

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 20,
      pointerEvents: 'none',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
    }}>

      {/* ── Círculo (siempre visible) ─────────────────────────────────── */}
      <div style={{
        width: CIRCLE_PX * 2, height: CIRCLE_PX * 2, borderRadius: '50%',
        border: `2.5px solid ${circleColor}`,
        background: circleColor + '1a',
        boxShadow: `0 0 0 3px ${circleColor}33`,
        position: 'relative', flexShrink: 0,
        transition: 'border-color 0.25s, background 0.25s, box-shadow 0.25s',
        // En steps 2/3, empujar el círculo hacia arriba para que el panel no lo tape
        transform: step !== 'place' ? 'translateY(-90px)' : 'none',
      }}>
        <div style={{ position:'absolute', top:'50%', left:'50%', width:1, height:20, background:circleColor, transform:'translate(-50%,-50%)' }} />
        <div style={{ position:'absolute', top:'50%', left:'50%', width:20, height:1, background:circleColor, transform:'translate(-50%,-50%)' }} />
        <div style={{ position:'absolute', top:'50%', left:'50%', width:6, height:6, borderRadius:'50%', background:circleColor, transform:'translate(-50%,-50%)' }} />
      </div>

      {/* Radio hint — solo en step place */}
      {step === 'place' && (
        <div style={{
          marginTop: 8, pointerEvents: 'none',
          background: 'rgba(0,0,0,0.58)', color: '#fff',
          borderRadius: 10, padding: '0.18rem 0.6rem',
          fontSize: '0.7rem', fontWeight: 600,
        }}>
          {displayR} · mueve y ajusta el zoom
        </div>
      )}

      {/* ══ STEP 1 — solo Confirmar / Cancelar ══════════════════════════ */}
      {step === 'place' && (
        <div style={panelBase}>
          <p style={{ margin: '0 0 0.55rem', fontSize: '0.78rem', color: '#6b7280', textAlign: 'center' }}>
            Zona de alerta · ajusta el área sobre el mapa
          </p>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={handleStep1} style={{
              flex: 1, padding: '0.68rem 0', borderRadius: 10, fontSize: '0.9rem',
              fontWeight: 700, cursor: 'pointer', border: 'none',
              background: '#e3aaaa', color: '#fff',
              boxShadow: '0 2px 8px rgba(227,170,170,0.45)',
            }}>
              Confirmar área →
            </button>
            <button onClick={onCancel} style={{
              flex: 1, padding: '0.68rem 0', borderRadius: 10, fontSize: '0.9rem',
              fontWeight: 600, cursor: 'pointer',
              background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb',
            }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* ══ STEP 2 — Tipo de problema ════════════════════════════════════ */}
      {step === 'type' && (
        <div style={panelBase}>
          <p style={{ margin: '0 0 0.6rem', fontWeight: 700, fontSize: '0.88rem' }}>
            ¿Qué tipo de problema?
          </p>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
            gap: '0.45rem', marginBottom: '0.6rem',
          }}>
            {ZONE_TYPES.map(t => (
              <button key={t.value} onClick={() => handleTypeSelect(t.value)} style={{
                padding: '0.65rem 0.2rem', borderRadius: 10, cursor: 'pointer',
                background: t.color + '14', border: `2px solid ${t.color}`,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
              }}>
                <span style={{ fontSize: '1.5rem', lineHeight: 1 }}>{t.emoji}</span>
                <span style={{ fontSize: '0.65rem', fontWeight: 700, color: t.color, textAlign: 'center', lineHeight: 1.2 }}>
                  {t.label}
                </span>
              </button>
            ))}
          </div>
          <button onClick={() => setStep('place')} style={{
            width: '100%', padding: '0.5rem 0', borderRadius: 8, fontSize: '0.8rem',
            fontWeight: 600, cursor: 'pointer',
            background: '#f3f4f6', color: '#6b7280', border: '1px solid #e5e7eb',
          }}>← Volver</button>
        </div>
      )}

      {/* ══ STEP 3 — Vigencia ════════════════════════════════════════════ */}
      {step === 'hours' && sel && (
        <div style={panelBase}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.6rem' }}>
            <span style={{ fontSize: '1.4rem' }}>{sel.emoji}</span>
            <span style={{ fontWeight: 700, fontSize: '0.88rem', color: sel.color }}>{sel.label}</span>
            <span style={{ fontSize: '0.72rem', color: '#9ca3af', marginLeft: 'auto' }}>¿Cuánto durará?</span>
          </div>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr',
            gap: '0.4rem', marginBottom: '0.6rem',
          }}>
            {HOURS_OPTS.map(o => (
              <button key={o.value}
                onClick={() => handleHoursSelect(o.value)}
                disabled={saving}
                style={{
                  padding: '0.6rem 0.2rem', borderRadius: 9,
                  cursor: saving ? 'wait' : 'pointer',
                  background: sel.color + '12', border: `1.5px solid ${sel.color}55`,
                  fontSize: '0.82rem', fontWeight: 600, color: sel.color,
                  opacity: saving ? 0.6 : 1,
                }}>
                {saving ? '…' : o.label}
              </button>
            ))}
          </div>
          <button onClick={() => setStep('type')} style={{
            width: '100%', padding: '0.5rem 0', borderRadius: 8, fontSize: '0.8rem',
            fontWeight: 600, cursor: 'pointer',
            background: '#f3f4f6', color: '#6b7280', border: '1px solid #e5e7eb',
          }}>← Cambiar tipo</button>
        </div>
      )}

    </div>
  );
}
