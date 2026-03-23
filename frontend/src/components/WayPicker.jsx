// frontend/src/components/WayPicker.jsx
//
// mode='impassable' — Calle no viable
//   • Al abrir, toma 2 lecturas GPS con ~2s de diferencia para calcular heading
//   • Selecciona automáticamente el tramo más cercano cuya dirección coincide con el heading
//   • Agrega los 2 tramos adyacentes de la misma calle
//   • Duración predeterminada: 'days'
//   • Confirmación: toast translúcido 1s, sin interacción extra
//
// mode='preference' — Preferencias
//   • Misma detección de heading para identificar la vialidad correcta
//   • Toma todos los segmentos de la misma calle (nombre/ref)
//   • Panel con selector de tipo: preferida / difícil / evitar
//   • Leyenda "Podrás editar después"

import { useCallback, useEffect, useRef, useState } from 'react';

// ── Overpass ──────────────────────────────────────────────────────────────────
async function queryNearbyWays(lat, lng, radiusM = 60) {
  const q = `[out:json][timeout:8];
way(around:${radiusM},${lat},${lng})["highway"];
(._;>;);
out geom qt;`;
  const r = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(q)}`,
    signal: AbortSignal.timeout(10000),
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

// ── Geo helpers ───────────────────────────────────────────────────────────────
function distancePt(a, b) {
  const R = 6371000;
  const dLat = (b[1] - a[1]) * Math.PI / 180;
  const dLng = (b[0] - a[0]) * Math.PI / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const c = sinLat * sinLat + Math.cos(a[1] * Math.PI / 180) * Math.cos(b[1] * Math.PI / 180) * sinLng * sinLng;
  return R * 2 * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c));
}

function distToWay(pt, coords) {
  let min = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const d = distPointToSegment(pt, coords[i], coords[i + 1]);
    if (d < min) min = d;
  }
  return min;
}

function distPointToSegment(pt, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return distancePt(pt, a);
  const t = Math.max(0, Math.min(1, ((pt[0]-a[0])*dx + (pt[1]-a[1])*dy) / (dx*dx + dy*dy)));
  return distancePt(pt, [a[0] + t*dx, a[1] + t*dy]);
}

// Bearing en grados entre dos puntos [lng,lat]
function bearingBetween(a, b) {
  const lat1 = a[1] * Math.PI / 180;
  const lat2 = b[1] * Math.PI / 180;
  const dLng = (b[0] - a[0]) * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// Bearing principal de un way (primer → último nodo)
function wayBearing(coords) {
  return bearingBetween(coords[0], coords[coords.length - 1]);
}

// Diferencia angular mínima entre dos bearings (0–180)
function bearingDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
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

// ── GPS heading ───────────────────────────────────────────────────────────────
// Toma 2 lecturas con ~2.5s de diferencia y calcula el bearing de movimiento
function getMovementHeading() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      (pos1) => {
        const p1 = [pos1.coords.longitude, pos1.coords.latitude];
        setTimeout(() => {
          navigator.geolocation.getCurrentPosition(
            (pos2) => {
              const p2 = [pos2.coords.longitude, pos2.coords.latitude];
              const d = distancePt(p1, p2);
              // Si se movió menos de 3m las lecturas son ruido — no confiable
              if (d < 3) { resolve(null); return; }
              resolve(bearingBetween(p1, p2));
            },
            () => resolve(null),
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
          );
        }, 2500);
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );
  });
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

const MODE_COLOR = { impassable: '#ef4444', preference: '#16a34a' };

const PREF_OPTS = [
  { value: 'preferred', label: 'Favorita',   color: '#16a34a' },
  { value: 'difficult', label: 'Difícil',    color: '#f59e0b' },
  { value: 'avoid',     label: 'Evitar',     color: '#ef4444' },
];

const DESELECT_RADIUS = 25;

// ── Standalone helpers (también usados por quickSelectWays) ─────────────────

// Prioridad de tipo de vía — menor = más prioritario
const HIGHWAY_PRIORITY = {
  motorway: 1, trunk: 2, primary: 3, secondary: 4,
  tertiary: 5, residential: 6, living_street: 7,
  unclassified: 8, service: 9, track: 10,
  footway: 11, cycleway: 11, path: 11,
};
function hwPriority(w) { return HIGHWAY_PRIORITY[w.highway] ?? 9; }

export function pickByHeading(ways, tapped, heading) {
  // Ordenar por distancia al punto tocado, luego por prioridad de vía
  const sorted = [...ways].sort((a, b) => {
    const dA = distToWay(tapped, a.coords);
    const dB = distToWay(tapped, b.coords);
    // Si la diferencia de distancia es menor a 15m, priorizar por tipo de vía
    if (Math.abs(dA - dB) < 15) return hwPriority(a) - hwPriority(b);
    return dA - dB;
  });
  if (heading === null || heading === undefined) return sorted[0];
  const aligned = sorted.filter(w => {
    const wb = wayBearing(w.coords);
    return bearingDiff(wb, heading) < 45 || bearingDiff(wb, (heading + 180) % 360) < 45;
  });
  return aligned.length > 0 ? aligned[0] : sorted[0];
}

export function expandAdjacentSegments(primary, allWays) {
  if (!primary.name || primary.name === 'Sin clasificar') return [primary];
  const same = allWays.filter(w => w.way_id !== primary.way_id && w.name === primary.name);
  const primaryEnds = [primary.coords[0], primary.coords[primary.coords.length - 1]];
  const adjacent = same.filter(w => {
    const wEnds = [w.coords[0], w.coords[w.coords.length - 1]];
    return wEnds.some(e => primaryEnds.some(pe => distancePt(e, pe) < 5));
  });
  return [primary, ...adjacent.slice(0, 2)];
}

export async function expandFullRoad(primary, tapped) {
  try {
    const allWays = await queryNearbyWays(tapped[1], tapped[0], 200);
    if (!primary.name || primary.name === 'Sin clasificar') return [primary];
    const sameName = allWays.filter(w => w.name === primary.name);
    return sameName.length > 0 ? sameName : [primary];
  } catch (_) {
    return [primary];
  }
}

/**
 * Selecciona tramos OSM desde una posición GPS para reporte rápido.
 * Reutiliza heading detection + lógica de expansión según mode.
 *
 * @param {{ lat: number, lng: number }} pos
 * @param {'impassable' | 'preference'} mode
 * @returns {Promise<Array>} ways listos para enviar al backend
 */
export async function quickSelectWays(pos, mode) {
  const tapped = [pos.lng, pos.lat];

  // Obtener heading de movimiento
  const heading = await getMovementHeading();

  // Consultar Overpass
  const ways = await queryNearbyWays(pos.lat, pos.lng, 80);
  if (!ways.length) throw new Error('No se encontró calle en esta posición');

  const primary = pickByHeading(ways, tapped, heading);

  let result;
  if (mode === 'impassable') {
    result = expandAdjacentSegments(primary, ways);
  } else {
    result = await expandFullRoad(primary, tapped);
  }

  return result.map(w => ({
    way_id: w.way_id,
    name:   w.name,
    coords: w.coords,
    ...(mode === 'impassable' ? { estimated_duration: 'days' }    : {}),
    ...(mode === 'preference' ? { preference: 'preferred' }        : {}),
  }));
}

export default function WayPicker({ map, mode = 'impassable', onConfirm, onCancel, bottomOffset = 0 }) {
  const [selected,   setSelected]   = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [detecting,  setDetecting]  = useState(false); // obteniendo heading GPS
  const [errMsg,     setErrMsg]     = useState('');
  const [preference, setPreference] = useState('preferred');
  const [saving,     setSaving]     = useState(false);
  const [toast,      setToast]      = useState(null); // mensaje toast 1s

  const headingRef   = useRef(null); // bearing de movimiento GPS
  const selectedRef  = useRef(selected);
  const accentColor  = MODE_COLOR[mode] || '#6b7280';

  useEffect(() => { selectedRef.current = selected; }, [selected]);

  // ── Obtener heading al montar ─────────────────────────────────────────────
  useEffect(() => {
    setDetecting(true);
    getMovementHeading()
      .then(h => { headingRef.current = h; })
      .finally(() => setDetecting(false));
  }, []);

  // ── Capas MapLibre ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!map) return;
    function addLayers() {
      if (!map.getSource(SRC_S)) {
        map.addSource(SRC_S, { type: 'geojson', data: toGeoJSON([]) });
        map.addLayer({ id: SRC_S + '-border', type: 'line', source: SRC_S,
          paint: { 'line-color': '#fff', 'line-width': 11, 'line-opacity': 0.7 },
          layout: { 'line-cap': 'round', 'line-join': 'round' } });
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

  // pickByHeading, expandAdjacentSegments, expandFullRoad
  // son funciones standalone exportadas — ver debajo del componente

  // ── Click en el mapa ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!map) return;
    const prev = map.getCanvas().style.cursor;
    map.getCanvas().style.cursor = 'crosshair';

    const handler = async (e) => {
      if (loading || detecting) return;
      const tapped = [e.lngLat.lng, e.lngLat.lat];

      // Deseleccionar si toca cerca de un way seleccionado
      const nearSelected = selectedRef.current.find(w => distToWay(tapped, w.coords) < DESELECT_RADIUS);
      if (nearSelected) {
        setSelected(prev => prev.filter(w => w.way_id !== nearSelected.way_id));
        return;
      }

      setLoading(true);
      setErrMsg('');
      try {
        const ways = await queryNearbyWays(e.lngLat.lat, e.lngLat.lng);
        if (!ways.length) {
          setErrMsg('No se encontró calle aquí. Toca más cerca de la calzada.');
          return;
        }
        const currentIds = new Set(selectedRef.current.map(w => w.way_id));
        const fresh = ways.filter(w => !currentIds.has(w.way_id));
        if (!fresh.length) return;

        const primary = pickByHeading(fresh, tapped, headingRef.current);

        let toAdd = [primary];
        if (mode === 'impassable') {
          toAdd = await expandAdjacentSegments(primary, ways);
        } else if (mode === 'preference') {
          toAdd = await expandFullRoad(primary, tapped);
        }

        // Deduplicar contra ya seleccionados
        const newWays = toAdd.filter(w => !currentIds.has(w.way_id));
        setSelected(prev => [...prev, ...newWays]);
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
  }, [map, loading, detecting, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Confirmar ─────────────────────────────────────────────────────────────
  function handleConfirm() {
    if (!selected.length || saving) return;
    setSaving(true);

    const payload = selected.map(w => ({
      way_id: w.way_id,
      name:   w.name,
      coords: w.coords,
      ...(mode === 'preference' ? { preference }               : {}),
      ...(mode === 'impassable' ? { estimated_duration: 'days' } : {}),
    }));

    if (mode === 'impassable') {
      // Toast 1s y confirmar directo
      setToast(`${selected.length} tramo${selected.length > 1 ? 's' : ''} reportado${selected.length > 1 ? 's' : ''} ✓`);
      setTimeout(() => {
        setToast(null);
        onConfirm(payload);
      }, 1000);
    } else {
      onConfirm(payload);
    }
  }

  const canConfirm = selected.length > 0 && !saving && !loading;
  const isPreference = mode === 'preference';
  const title = isPreference ? 'Preferencias' : 'Calle no viable';

  return (
    <>
      {/* Toast 1s para impassable */}
      {toast && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%,-50%)',
          background: 'rgba(0,0,0,0.65)', color: '#fff',
          borderRadius: 14, padding: '0.6rem 1.2rem',
          fontSize: '0.88rem', fontWeight: 600,
          zIndex: 30, pointerEvents: 'none', whiteSpace: 'nowrap',
        }}>{toast}</div>
      )}

      {/* Hint superior */}
      <div style={{
        position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.62)', color: '#fff',
        borderRadius: 20, padding: '0.22rem 0.85rem',
        fontSize: '0.7rem', fontWeight: 500,
        zIndex: 21, pointerEvents: 'none', whiteSpace: 'nowrap',
      }}>
        {detecting ? '📍 Detectando dirección…'
          : loading ? '🔍 Buscando…'
          : selected.length
            ? `${selected.length} tramo(s) · toca de nuevo para deseleccionar`
            : '👆 Toca la calle para marcarla'}
      </div>

      {/* Error */}
      {errMsg && (
        <div style={{
          position: 'absolute', top: 40, left: '50%', transform: 'translateX(-50%)',
          background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626',
          borderRadius: 10, padding: '0.3rem 0.75rem',
          fontSize: '0.72rem', zIndex: 22, pointerEvents: 'none',
          whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        }}>{errMsg}</div>
      )}

      {/* Panel inferior */}
      <div style={{
        position: 'absolute', bottom: bottomOffset, left: 0, right: 0, zIndex: 20,
        background: '#fff', borderTop: `3px solid ${accentColor}`,
        padding: `0.65rem 1rem calc(0.7rem + env(safe-area-inset-bottom,0px))`,
        boxShadow: '0 -4px 20px rgba(0,0,0,0.14)',
      }}>
        <div style={{ fontWeight: 700, fontSize: '0.84rem', marginBottom: '0.45rem',
          display: 'flex', alignItems: 'center', gap: 6 }}>
          {isPreference ? '⭐' : '⛔'} {title}
          {loading && <span style={{ fontSize:'0.68rem', fontWeight:400, color:'#9ca3af' }}>buscando…</span>}
          {selected.length > 0 && (
            <span style={{ marginLeft:'auto', fontSize:'0.7rem', fontWeight:400,
              background: accentColor+'18', color: accentColor,
              borderRadius:10, padding:'0.1rem 0.45rem' }}>
              {selected.length} seleccionada{selected.length > 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Selector de tipo (preference) */}
        {isPreference && (
          <>
            <div style={{ display:'flex', gap:'0.35rem', marginBottom:'0.4rem' }}>
              {PREF_OPTS.map(o => {
                const active = o.value === preference;
                return (
                  <button key={o.value} onClick={() => setPreference(o.value)} style={{
                    flex: 1, padding:'0.35rem 0', borderRadius:8, fontSize:'0.75rem',
                    fontWeight: active ? 700 : 500, cursor:'pointer',
                    background: active ? o.color : '#f3f4f6',
                    color: active ? '#fff' : '#374151',
                    border:`1.5px solid ${active ? o.color : '#e5e7eb'}`,
                    transition:'all 0.12s',
                  }}>{o.label}</button>
                );
              })}
            </div>
            <div style={{ fontSize:'0.68rem', color:'#9ca3af', marginBottom:'0.4rem' }}>
              Podrás editar después
            </div>
          </>
        )}

        <div style={{ display:'flex', gap:'0.5rem' }}>
          <button onClick={handleConfirm} disabled={!canConfirm} style={{
            flex:1, padding:'0.62rem 0', borderRadius:9, fontSize:'0.88rem',
            fontWeight:700, cursor: canConfirm ? 'pointer' : 'not-allowed',
            background: canConfirm ? accentColor : '#d1d5db',
            color:'#fff', border:'none',
            opacity: saving ? 0.7 : 1,
          }}>
            {saving ? 'Enviando…'
              : isPreference
                ? `Guardar${selected.length ? ` (${selected.length})` : ''}`
                : `Reportar${selected.length ? ` (${selected.length})` : ''}`}
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
