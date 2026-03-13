// frontend/src/components/ZoneLayer.jsx
//
// Renderiza zonas de alerta sobre el mapa MapLibre.
// Al tocar una zona muestra un cuadro flotante con:
//   - tipo de zona (etiqueta + color)
//   - botón "Sugerir cambio" → abre modal con opciones:
//       • Alerta finalizada (cuenta como voto de eliminación)
//       • Editar (misma UI que al crear: tipo + vigencia)
//   - Si la zona tiene una edición pendiente: botón "Un conductor sugirió un cambio"
//     que muestra la edición y permite confirmar o regresar.

import { useEffect, useRef, useState } from 'react';

const ZONE_COLORS = {
  traffic:      '#f97316',
  construction: '#eab308',
  accident:     '#ef4444',
  flood:        '#3b82f6',
  blocked:      '#8b5cf6',
  other:        '#6b7280',
};

const ZONE_LABELS = {
  traffic:      '🚦 Tráfico pesado',
  construction: '🚧 Obra en construcción',
  accident:     '🚨 Accidente',
  flood:        '🌊 Inundación',
  blocked:      '⛔ Calle bloqueada',
  other:        '⚠️ Otro problema',
};

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

// ── helpers ────────────────────────────────────────────────────────────────────
function circlePolygon(lat, lng, radius_m, steps = 32) {
  const latDeg = radius_m / 111320;
  const lngDeg = radius_m / (111320 * Math.cos((lat * Math.PI) / 180));
  const coords = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    coords.push([lng + lngDeg * Math.cos(a), lat + latDeg * Math.sin(a)]);
  }
  coords.push(coords[0]);
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] } };
}

function buildGeoJson(zones) {
  return {
    type: 'FeatureCollection',
    features: zones.map(z => ({
      ...circlePolygon(z.lat, z.lng, z.radius_m),
      properties: {
        id:    z.id,
        type:  z.type,
        color: ZONE_COLORS[z.type] || ZONE_COLORS.other,
      },
    })),
  };
}

// ── ZoneInfoCard — cuadro flotante sobre el mapa ───────────────────────────────
function ZoneInfoCard({ zone, onSuggest, onClose }) {
  const color = ZONE_COLORS[zone.type] || ZONE_COLORS.other;
  const label = ZONE_LABELS[zone.type]  || '⚠️ Zona de alerta';
  const hasPending = Boolean(zone.pending_edit);

  return (
    <div style={{
      position: 'absolute',
      bottom: 80, left: '50%', transform: 'translateX(-50%)',
      background: '#fff', borderRadius: 14,
      boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
      padding: '0.75rem 1rem',
      minWidth: 220, maxWidth: 'calc(100vw - 2rem)',
      zIndex: 50,
      borderTop: `4px solid ${color}`,
      pointerEvents: 'auto',
    }}>
      {/* Cerrar */}
      <button onClick={onClose} style={{
        position: 'absolute', top: 6, right: 8,
        background: 'none', border: 'none', cursor: 'pointer',
        fontSize: '0.9rem', color: '#9ca3af', lineHeight: 1,
      }}>✕</button>

      {/* Tipo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.5rem' }}>
        <span style={{
          background: color + '18', color, border: `1.5px solid ${color}`,
          borderRadius: 20, padding: '0.22rem 0.65rem',
          fontSize: '0.8rem', fontWeight: 700,
        }}>{label}</span>
      </div>

      {/* Votos de confirmación */}
      {zone.confirm_count != null && (
        <div style={{ fontSize: '0.7rem', color: '#9ca3af', marginBottom: '0.4rem' }}>
          {zone.confirm_count}/3 conductores confirmaron · {zone.dismiss_count ?? 0} finalizaron
        </div>
      )}

      {/* Edición pendiente de otro conductor */}
      {hasPending && (
        <button onClick={() => onSuggest('review_edit')} style={{
          width: '100%', marginBottom: '0.45rem',
          padding: '0.42rem 0.75rem', borderRadius: 9,
          background: '#fffbeb', border: '1.5px solid #fbbf24',
          color: '#92400e', fontSize: '0.76rem', fontWeight: 700,
          cursor: 'pointer', textAlign: 'left',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ fontSize: '1rem' }}>✏️</span>
          Un conductor sugirió un cambio
        </button>
      )}

      {/* Sugerir cambio */}
      <button onClick={() => onSuggest('menu')} style={{
        width: '100%', padding: '0.5rem 0', borderRadius: 9,
        background: color, color: '#fff', border: 'none',
        fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer',
      }}>
        Sugerir cambio
      </button>
    </div>
  );
}

// ── SuggestModal — modal de sugerencia de cambio ──────────────────────────────
function SuggestModal({ zone, mode, onClose, onDone, token }) {
  // mode: 'menu' | 'edit' | 'review_edit'
  const [view,      setView]      = useState(mode); // 'menu'|'edit'|'review_edit'
  const [editStep,  setEditStep]  = useState('type'); // 'type'|'hours'
  const [newType,   setNewType]   = useState(zone.type);
  const [newHours,  setNewHours]  = useState(zone.estimated_hours ?? 2);
  const [saving,    setSaving]    = useState(false);
  const [errMsg,    setErrMsg]    = useState('');

  const color = ZONE_COLORS[newType] || ZONE_COLORS.other;

  async function apiFetch(url, opts = {}, tok) {
    const base = import.meta.env?.VITE_API_URL || '';
    const res  = await fetch(`${base}${url}`, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
        ...(opts.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Error');
    return data;
  }

  async function sendVote(voteType) {
    setSaving(true); setErrMsg('');
    try {
      await apiFetch(`/nav/zones/${zone.id}/vote`, {
        method: 'POST',
        body: JSON.stringify({ vote: voteType }),
      }, token);
      onDone?.();
    } catch (e) { setErrMsg(e.message); }
    finally { setSaving(false); }
  }

  async function sendEdit() {
    setSaving(true); setErrMsg('');
    try {
      await apiFetch(`/nav/zones/${zone.id}/suggest`, {
        method: 'POST',
        body: JSON.stringify({ type: newType, estimated_hours: newHours }),
      }, token);
      onDone?.();
    } catch (e) { setErrMsg(e.message); }
    finally { setSaving(false); }
  }

  async function confirmEdit() {
    setSaving(true); setErrMsg('');
    try {
      await apiFetch(`/nav/zones/${zone.id}/suggest/confirm`, {
        method: 'POST',
      }, token);
      onDone?.();
    } catch (e) { setErrMsg(e.message); }
    finally { setSaving(false); }
  }

  const overlay = {
    position: 'fixed', inset: 0, zIndex: 200,
    background: 'rgba(0,0,0,0.45)',
    display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
  };

  const sheet = {
    background: '#fff', borderRadius: '16px 16px 0 0',
    padding: '1rem 1rem calc(1rem + env(safe-area-inset-bottom,0px))',
    width: '100%', maxWidth: 480,
    boxShadow: '0 -4px 32px rgba(0,0,0,0.18)',
  };

  // ── MENU ──────────────────────────────────────────────────────────────────
  if (view === 'menu') return (
    <div style={overlay} onClick={onClose}>
      <div style={sheet} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: '0.92rem', marginBottom: '0.75rem' }}>
          Sugerir cambio
        </div>
        {errMsg && <div style={{ color: '#dc2626', fontSize: '0.75rem', marginBottom: '0.4rem' }}>{errMsg}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
          <button onClick={() => sendVote('dismiss')} disabled={saving} style={{
            padding: '0.65rem', borderRadius: 10, cursor: saving ? 'wait' : 'pointer',
            background: '#f3f4f6', border: '1.5px solid #e5e7eb',
            fontSize: '0.85rem', fontWeight: 600, color: '#374151',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ fontSize: '1.1rem' }}>✅</span>
            Alerta finalizada
          </button>
          <button onClick={() => { setView('edit'); setEditStep('type'); }} disabled={saving} style={{
            padding: '0.65rem', borderRadius: 10, cursor: saving ? 'wait' : 'pointer',
            background: '#f3f4f6', border: '1.5px solid #e5e7eb',
            fontSize: '0.85rem', fontWeight: 600, color: '#374151',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ fontSize: '1.1rem' }}>✏️</span>
            Editar zona
          </button>
          <button onClick={onClose} style={{
            padding: '0.52rem', borderRadius: 10, cursor: 'pointer',
            background: 'none', border: '1px solid #e5e7eb',
            fontSize: '0.8rem', color: '#6b7280',
          }}>Cancelar</button>
        </div>
      </div>
    </div>
  );

  // ── EDITAR — step tipo ─────────────────────────────────────────────────────
  if (view === 'edit' && editStep === 'type') return (
    <div style={overlay} onClick={onClose}>
      <div style={sheet} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: '0.92rem', marginBottom: '0.65rem' }}>
          ¿Qué tipo de problema?
        </div>
        {errMsg && <div style={{ color: '#dc2626', fontSize: '0.75rem', marginBottom: '0.4rem' }}>{errMsg}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.4rem', marginBottom: '0.6rem' }}>
          {ZONE_TYPES.map(t => {
            const active = t.value === newType;
            return (
              <button key={t.value} onClick={() => { setNewType(t.value); setEditStep('hours'); }} style={{
                padding: '0.6rem 0.2rem', borderRadius: 10, cursor: 'pointer',
                background: active ? t.color + '20' : '#f9fafb',
                border: `2px solid ${active ? t.color : '#e5e7eb'}`,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              }}>
                <span style={{ fontSize: '1.4rem', lineHeight: 1 }}>{t.emoji}</span>
                <span style={{ fontSize: '0.64rem', fontWeight: 700, color: t.color, textAlign: 'center', lineHeight: 1.2 }}>
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>
        <button onClick={() => setView('menu')} style={{
          width: '100%', padding: '0.5rem', borderRadius: 8, cursor: 'pointer',
          background: '#f3f4f6', border: '1px solid #e5e7eb',
          fontSize: '0.8rem', color: '#6b7280', fontWeight: 600,
        }}>← Volver</button>
      </div>
    </div>
  );

  // ── EDITAR — step horas ────────────────────────────────────────────────────
  if (view === 'edit' && editStep === 'hours') {
    const sel = ZONE_TYPES.find(t => t.value === newType) || ZONE_TYPES[0];
    return (
      <div style={overlay} onClick={onClose}>
        <div style={sheet} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.65rem' }}>
            <span style={{ fontSize: '1.3rem' }}>{sel.emoji}</span>
            <span style={{ fontWeight: 700, fontSize: '0.88rem', color: sel.color }}>{sel.label}</span>
            <span style={{ fontSize: '0.72rem', color: '#9ca3af', marginLeft: 'auto' }}>¿Cuánto durará?</span>
          </div>
          {errMsg && <div style={{ color: '#dc2626', fontSize: '0.75rem', marginBottom: '0.4rem' }}>{errMsg}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.38rem', marginBottom: '0.6rem' }}>
            {HOURS_OPTS.map(o => (
              <button key={o.value} onClick={() => setNewHours(o.value)} disabled={saving} style={{
                padding: '0.55rem 0.2rem', borderRadius: 9, cursor: saving ? 'wait' : 'pointer',
                background: newHours === o.value ? sel.color + '18' : '#f9fafb',
                border: `1.5px solid ${newHours === o.value ? sel.color : '#e5e7eb'}`,
                fontSize: '0.8rem', fontWeight: newHours === o.value ? 700 : 400,
                color: newHours === o.value ? sel.color : '#374151',
              }}>{o.label}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <button onClick={sendEdit} disabled={saving} style={{
              flex: 1, padding: '0.6rem', borderRadius: 9, cursor: saving ? 'wait' : 'pointer',
              background: sel.color, color: '#fff', border: 'none',
              fontSize: '0.85rem', fontWeight: 700, opacity: saving ? 0.7 : 1,
            }}>{saving ? 'Enviando…' : 'Sugerir cambio'}</button>
            <button onClick={() => setEditStep('type')} style={{
              flex: 1, padding: '0.6rem', borderRadius: 9, cursor: 'pointer',
              background: '#f3f4f6', border: '1px solid #e5e7eb',
              fontSize: '0.8rem', color: '#6b7280', fontWeight: 600,
            }}>← Tipo</button>
          </div>
        </div>
      </div>
    );
  }

  // ── REVISAR EDICIÓN DE OTRO CONDUCTOR ─────────────────────────────────────
  if (view === 'review_edit') {
    const edit      = zone.pending_edit || {};
    const editColor = ZONE_COLORS[edit.type] || ZONE_COLORS.other;
    const editLabel = ZONE_LABELS[edit.type]  || '⚠️ Zona';
    return (
      <div style={overlay} onClick={onClose}>
        <div style={sheet} onClick={e => e.stopPropagation()}>
          <div style={{ fontWeight: 700, fontSize: '0.92rem', marginBottom: '0.55rem' }}>
            ✏️ Cambio sugerido por un conductor
          </div>
          <div style={{ background: '#f9fafb', borderRadius: 10, padding: '0.65rem', marginBottom: '0.65rem' }}>
            <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: '0.25rem' }}>Propuesta</div>
            <div style={{
              display: 'inline-block', background: editColor + '18',
              color: editColor, border: `1.5px solid ${editColor}`,
              borderRadius: 20, padding: '0.22rem 0.65rem',
              fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.3rem',
            }}>{editLabel}</div>
            {edit.estimated_hours && (
              <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
                Vigencia: {HOURS_OPTS.find(o => o.value === edit.estimated_hours)?.label ?? `${edit.estimated_hours}h`}
              </div>
            )}
          </div>
          {errMsg && <div style={{ color: '#dc2626', fontSize: '0.75rem', marginBottom: '0.4rem' }}>{errMsg}</div>}
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <button onClick={confirmEdit} disabled={saving} style={{
              flex: 1, padding: '0.6rem', borderRadius: 9, cursor: saving ? 'wait' : 'pointer',
              background: editColor, color: '#fff', border: 'none',
              fontSize: '0.85rem', fontWeight: 700, opacity: saving ? 0.7 : 1,
            }}>{saving ? 'Confirmando…' : 'Confirmar'}</button>
            <button onClick={onClose} style={{
              flex: 1, padding: '0.6rem', borderRadius: 9, cursor: 'pointer',
              background: '#f3f4f6', border: '1px solid #e5e7eb',
              fontSize: '0.8rem', color: '#6b7280', fontWeight: 600,
            }}>Regresar</button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// ── ZoneLayer ─────────────────────────────────────────────────────────────────
export default function ZoneLayer({ map, zones = [], onZoneClick, token }) {
  const zonesRef          = useRef(zones);
  const [selected, setSelected] = useState(null);    // zona tocada
  const [suggestMode, setSuggestMode] = useState(null); // 'menu'|'review_edit'

  zonesRef.current = zones;

  // ── Capas MapLibre ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!map) return;
    const SRC  = 'nav-zones-source';
    const FILL = 'nav-zones-fill';
    const LINE = 'nav-zones-line';

    function addLayers() {
      if (!map.getSource(SRC)) {
        map.addSource(SRC, { type: 'geojson', data: buildGeoJson(zones) });
      } else {
        map.getSource(SRC).setData(buildGeoJson(zones));
        return;
      }
      map.addLayer({ id: FILL, type: 'fill', source: SRC,
        paint: { 'fill-color': ['get','color'], 'fill-opacity': 0.13 } });
      map.addLayer({ id: LINE, type: 'line', source: SRC,
        paint: { 'line-color': ['get','color'], 'line-width': 2, 'line-opacity': 0.65 } });

      map.on('click', FILL, (e) => {
        const props = e.features?.[0]?.properties;
        if (!props) return;
        const zone = zonesRef.current.find(z => z.id === props.id);
        if (zone) { setSelected(zone); setSuggestMode(null); }
        onZoneClick?.(zone);
      });
      map.on('mouseenter', FILL, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', FILL, () => { map.getCanvas().style.cursor = ''; });
    }

    if (map.isStyleLoaded()) addLayers(); else map.once('load', addLayers);
    return () => {
      try {
        if (map.getLayer(LINE)) map.removeLayer(LINE);
        if (map.getLayer(FILL)) map.removeLayer(FILL);
        if (map.getSource(SRC)) map.removeSource(SRC);
      } catch (_) {}
    };
  }, [map]); // eslint-disable-line react-hooks/exhaustive-deps

  // Actualizar datos
  useEffect(() => {
    map?.getSource('nav-zones-source')?.setData(buildGeoJson(zones));
  }, [map, zones]);

  return (
    <>
      {selected && !suggestMode && (
        <ZoneInfoCard
          zone={selected}
          onClose={() => setSelected(null)}
          onSuggest={(m) => setSuggestMode(m)}
        />
      )}
      {selected && suggestMode && (
        <SuggestModal
          zone={selected}
          mode={suggestMode}
          token={token}
          onClose={() => { setSuggestMode(null); setSelected(null); }}
          onDone={() => { setSuggestMode(null); setSelected(null); }}
        />
      )}
    </>
  );
}
