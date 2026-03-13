// frontend/src/components/WayPicker.jsx
//
// Auto-selección: al tocar el mapa se consulta Overpass y se añade
// AUTOMÁTICAMENTE el way más cercano al punto tocado.
// Para deseleccionar: tocar nuevamente cerca de ese tramo.
// Sin listas de candidatos. Solo líneas en el mapa + panel mínimo.
//
// Props:
//   map       — instancia MapLibre GL
//   mode      — 'impassable' | 'preference'
//   onConfirm — (ways: Array<{way_id, name, preference?, estimated_duration?}>) => void
//   onCancel  — () => void

import { useEffect, useRef, useState } from 'react';

// ── Overpass ──────────────────────────────────────────────────────────────────
async function queryNearbyWays(lat, lng, radiusM = 40) {
  const q = `[out:json][timeout:8];
way(around:${radiusM},${lat},${lng})["highway"];
(._;>;);
out geom qt;`;
  const r = await fetch('https://overpass-api.de/api/interpreter', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    `data=${encodeURIComponent(q)}`,
    signal:  AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error('Overpass no disponible');
  const data = await r.json();

  const nodeMap = {};
  for (const el of data.elements) {
    if (el.type === 'node') nodeMap[el.id] = [el.lon, el.lat];
  }

  return data.elements
    .filter(el => el.type === 'way' && el.tags?.highway)
    .map(way => {
      let coords = [];
      if (Array.isArray(way.geometry)) {
        coords = way.geometry.map(n => [n.lon, n.lat]);
      } else if (Array.isArray(way.nodes)) {
        coords = way.nodes.map(id => nodeMap[id]).filter(Boolean);
      }
      return {
        way_id:  String(way.id),
        name:    way.tags?.name || way.tags?.ref || hwLabel(way.tags?.highway),
        highway: way.tags?.highway,
        coords,
      };
    })
    .filter(w => w.coords.length >= 2);
}

// Distancia en metros entre dos puntos [lng,lat]
function distancePt(a, b) {
  const R = 6371000;
  const dLat = (b[1] - a[1]) * Math.PI / 180;
  const dLng = (b[0] - a[0]) * Math.PI / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const c = sinLat * sinLat + Math.cos(a[1] * Math.PI / 180) * Math.cos(b[1] * Math.PI / 180) * sinLng * sinLng;
  return R * 2 * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c));
}

// Distancia mínima desde un punto a un polyline
function distToWay(pt, coords) {
  let minDist = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i], b = coords[i + 1];
    const d = distPointToSegment(pt, a, b);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

function distPointToSegment(pt, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return distancePt(pt, a);
  const t = Math.max(0, Math.min(1, ((pt[0]-a[0])*dx + (pt[1]-a[1])*dy) / (dx*dx + dy*dy)));
  return distancePt(pt, [a[0] + t*dx, a[1] + t*dy]);
}

function hwLabel(type) {
  return {
    residential:'Calle residencial', primary:'Vía primaria',
    secondary:'Vía secundaria', tertiary:'Calle terciaria',
    service:'Servicio', unclassified:'Sin clasificar',
    trunk:'Vía rápida', motorway:'Autopista',
    footway:'Andador', cycleway:'Carril bici', path:'Camino',
    living_street:'Zona habitacional', track:'Terracería',
  }[type] || type || 'Calle';
}

// ── Layer ids ─────────────────────────────────────────────────────────────────
const SRC_S = 'wp-selected-src';
const LYR_S = 'wp-selected-lyr';

function toGeoJSON(ways) {
  return {
    type: 'FeatureCollection',
    features: ways.map(w => ({
      type: 'Feature',
      properties: { way_id: w.way_id },
      geometry: { type: 'LineString', coordinates: w.coords },
    })),
  };
}

const MODE_COLOR  = { impassable: '#ef4444', preference: '#16a34a' };

const PREF_OPTS = [
  { value: 'preferred', label: '⭐ Preferida', color: '#16a34a' },
  { value: 'difficult', label: '⚠️ Difícil',   color: '#f59e0b' },
  { value: 'avoid',     label: '🚫 Evitar',     color: '#ef4444' },
];
const DUR_OPTS = [
  { value: 'days',      label: 'Días' },
  { value: 'weeks',     label: 'Semanas' },
  { value: 'months',    label: 'Meses' },
  { value: 'permanent', label: 'Permanente' },
];

// Distancia máxima en metros para considerar que un tap es "cerca" de un way seleccionado
const DESELECT_RADIUS = 25;

export default function WayPicker({ map, mode = 'impassable', onConfirm, onCancel }) {
  const [selected,    setSelected]    = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [errMsg,      setErrMsg]      = useState('');
  const [preference,  setPreference]  = useState('avoid');
  const [duration,    setDuration]    = useState('days');
  const [saving,      setSaving]      = useState(false);

  const accentColor  = MODE_COLOR[mode] || '#6b7280';
  const selectedRef  = useRef(selected);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  // ── Capas ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!map) return;
    function addLayers() {
      if (!map.getSource(SRC_S)) {
        map.addSource(SRC_S, { type: 'geojson', data: toGeoJSON([]) });
        // Borde blanco
        map.addLayer({ id: SRC_S + '-border', type: 'line', source: SRC_S,
          paint: { 'line-color': '#fff', 'line-width': 11, 'line-opacity': 0.7 },
          layout: { 'line-cap': 'round', 'line-join': 'round' } });
        // Línea de color
        map.addLayer({ id: LYR_S, type: 'line', source: SRC_S,
          paint: { 'line-color': accentColor, 'line-width': 7, 'line-opacity': 1 },
          layout: { 'line-cap': 'round', 'line-join': 'round' } });
      }
    }
    if (map.isStyleLoaded()) addLayers(); else map.once('load', addLayers);
    return () => {
      try {
        [LYR_S, SRC_S + '-border'].forEach(l => { if (map.getLayer(l)) map.removeLayer(l); });
        if (map.getSource(SRC_S)) map.removeSource(SRC_S);
      } catch (_) {}
    };
  }, [map]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    map?.getSource(SRC_S)?.setData(toGeoJSON(selected));
  }, [map, selected]);

  // ── Click en el mapa ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!map) return;
    const prev = map.getCanvas().style.cursor;
    map.getCanvas().style.cursor = 'crosshair';

    const handler = async (e) => {
      if (loading) return;
      const tapped = [e.lngLat.lng, e.lngLat.lat];

      // ¿Hay un way seleccionado cerca? → deseleccionar
      const nearSelected = selectedRef.current.find(w => distToWay(tapped, w.coords) < DESELECT_RADIUS);
      if (nearSelected) {
        setSelected(prev => prev.filter(w => w.way_id !== nearSelected.way_id));
        return;
      }

      // Consultar Overpass y auto-seleccionar el más cercano
      setLoading(true);
      setErrMsg('');
      try {
        const ways = await queryNearbyWays(e.lngLat.lat, e.lngLat.lng);
        if (!ways.length) {
          setErrMsg('No se encontró calle aquí. Toca más cerca de la calzada.');
          return;
        }
        // Excluir ya seleccionados y elegir el más cercano al punto tocado
        const currentIds = new Set(selectedRef.current.map(w => w.way_id));
        const fresh = ways.filter(w => !currentIds.has(w.way_id));
        if (!fresh.length) return; // ya está seleccionado
        const nearest = fresh.reduce((best, w) => {
          const d = distToWay(tapped, w.coords);
          return d < distToWay(tapped, best.coords) ? w : best;
        });
        setSelected(prev => [...prev, nearest]);
      } catch (_) {
        setErrMsg('Sin conexión a Overpass. Intenta de nuevo.');
      } finally {
        setLoading(false);
      }
    };

    map.on('click', handler);
    return () => {
      map.off('click', handler);
      map.getCanvas().style.cursor = prev;
    };
  }, [map, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleConfirm() {
    if (!selected.length || saving) return;
    setSaving(true);
    onConfirm(selected.map(w => ({
      way_id:             w.way_id,
      name:               w.name,
      ...(mode === 'preference' ? { preference }                    : {}),
      ...(mode === 'impassable' ? { estimated_duration: duration }  : {}),
    })));
  }

  const canConfirm = selected.length > 0 && !saving;

  return (
    <>
      {/* Hint superior */}
      <div style={{
        position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.62)', color: '#fff',
        borderRadius: 20, padding: '0.22rem 0.85rem',
        fontSize: '0.7rem', fontWeight: 500,
        zIndex: 21, pointerEvents: 'none', whiteSpace: 'nowrap',
      }}>
        {loading
          ? '🔍 Buscando…'
          : selected.length
            ? `${selected.length} tramo(s) · toca de nuevo para deseleccionar`
            : '👆 Toca una calle para marcarla'}
      </div>

      {/* Error toast */}
      {errMsg && (
        <div style={{
          position: 'absolute', top: 40, left: '50%', transform: 'translateX(-50%)',
          background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626',
          borderRadius: 10, padding: '0.3rem 0.75rem',
          fontSize: '0.72rem', zIndex: 22, pointerEvents: 'none',
          whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        }}>{errMsg}</div>
      )}

      {/* Panel inferior — siempre visible con altura fija para no tapar botones */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 20,
        background: '#fff', borderTop: `3px solid ${accentColor}`,
        padding: `0.65rem 1rem calc(0.7rem + env(safe-area-inset-bottom,0px))`,
        boxShadow: '0 -4px 20px rgba(0,0,0,0.14)',
      }}>

        {/* Título */}
        <div style={{ fontWeight: 700, fontSize: '0.84rem', marginBottom: '0.45rem',
          display: 'flex', alignItems: 'center', gap: 6 }}>
          {mode === 'impassable' ? '⛔ Calles no viables' : '⭐ Preferencia de calle'}
          {loading && <span style={{ fontSize:'0.68rem', fontWeight:400, color:'#9ca3af' }}>buscando…</span>}
          {selected.length > 0 && (
            <span style={{ marginLeft:'auto', fontSize:'0.7rem', fontWeight:400,
              background: accentColor+'18', color: accentColor,
              borderRadius:10, padding:'0.1rem 0.45rem' }}>
              {selected.length} seleccionada{selected.length > 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Selector de preferencia (solo modo preference) */}
        {mode === 'preference' && (
          <div style={{ display:'flex', gap:'0.3rem', flexWrap:'wrap', marginBottom:'0.45rem' }}>
            {PREF_OPTS.map(o => {
              const active = o.value === preference;
              return (
                <button key={o.value} onClick={() => setPreference(o.value)} style={{
                  padding:'0.28rem 0.6rem', borderRadius:20, fontSize:'0.72rem',
                  fontWeight: active ? 700 : 500, cursor:'pointer',
                  background: active ? o.color : '#f3f4f6',
                  color:      active ? '#fff'   : '#374151',
                  border:`1.5px solid ${active ? o.color : '#e5e7eb'}`,
                  transition:'all 0.12s',
                }}>{o.label}</button>
              );
            })}
          </div>
        )}

        {/* Selector de duración (solo modo impassable) */}
        {mode === 'impassable' && (
          <div style={{ display:'flex', gap:'0.28rem', flexWrap:'wrap', alignItems:'center', marginBottom:'0.45rem' }}>
            <span style={{ fontSize:'0.72rem', color:'#6b7280' }}>Duración:</span>
            {DUR_OPTS.map(o => {
              const active = o.value === duration;
              return (
                <button key={o.value} onClick={() => setDuration(o.value)} style={{
                  padding:'0.22rem 0.5rem', borderRadius:20, fontSize:'0.7rem',
                  fontWeight: active ? 700 : 400, cursor:'pointer',
                  background: active ? '#111827' : '#f3f4f6',
                  color:      active ? '#fff'    : '#374151',
                  border:`1px solid ${active ? '#111827' : '#e5e7eb'}`,
                  transition:'all 0.12s',
                }}>{o.label}</button>
              );
            })}
          </div>
        )}

        {/* Botones de acción */}
        <div style={{ display:'flex', gap:'0.5rem' }}>
          <button onClick={handleConfirm} disabled={!canConfirm} style={{
            flex:1, padding:'0.62rem 0', borderRadius:9, fontSize:'0.88rem',
            fontWeight:700, cursor: canConfirm ? 'pointer' : 'not-allowed',
            background: canConfirm ? accentColor : '#d1d5db',
            color:'#fff', border:'none', transition:'background 0.15s',
            opacity: saving ? 0.7 : 1,
          }}>
            {saving ? 'Enviando…'
              : mode === 'impassable'
                ? `Reportar${selected.length ? ` (${selected.length})` : ''}`
                : `Guardar${selected.length ? ` (${selected.length})` : ''}`}
          </button>
          <button onClick={onCancel} style={{
            flex:1, padding:'0.62rem 0', borderRadius:9, fontSize:'0.88rem',
            fontWeight:600, cursor:'pointer',
            background:'#f3f4f6', color:'#374151', border:'1px solid #e5e7eb',
          }}>Cancelar</button>
        </div>

      </div>
    </>
  );
}
