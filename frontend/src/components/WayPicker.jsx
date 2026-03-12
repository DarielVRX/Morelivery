// frontend/src/components/WayPicker.jsx
//
// Permite al driver seleccionar tramos de calle VISUALMENTE sobre el mapa
// sin escribir ningún ID técnico.
//
// Flujo:
//   1. El driver toca cualquier punto del mapa.
//   2. Se consulta Overpass para obtener ways con tag highway cerca (radio 35 m).
//   3. Los ways candidatos se pintan amarillo sobre el mapa.
//   4. El driver toca el tramo deseado en la lista del panel → se añade a "seleccionados"
//      y se pinta verde/rojo según el modo.
//   5. Se pueden añadir varios tramos antes de confirmar (anidado).
//   6. Al confirmar se devuelven los way_ids reales de OSM al padre.
//
// Props:
//   map        — instancia MapLibre GL
//   mode       — 'impassable' | 'preference'
//   onConfirm  — (ways: Array<{way_id, name, ...opts}>) => void
//   onCancel   — () => void

import { useCallback, useEffect, useRef, useState } from 'react';

// ── Overpass ──────────────────────────────────────────────────────────────────
async function queryNearbyWays(lat, lng, radiusM = 35) {
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

  // Reconstruir nodos por id para los ways sin geometría inlined
  const nodeMap = {};
  for (const el of data.elements) {
    if (el.type === 'node') nodeMap[el.id] = [el.lon, el.lng ?? el.lat]; // [lng, lat]
  }

  return data.elements
    .filter(el => el.type === 'way' && el.tags?.highway)
    .map(way => {
      // geometry inlined (out geom) o reconstruida desde node refs
      let coords = [];
      if (Array.isArray(way.geometry)) {
        coords = way.geometry.map(n => [n.lon, n.lat]);
      } else if (Array.isArray(way.nodes)) {
        coords = way.nodes
          .map(id => nodeMap[id])
          .filter(Boolean);
      }
      return {
        way_id:   String(way.id),
        name:     way.tags?.name || way.tags?.ref || hwLabel(way.tags?.highway),
        highway:  way.tags?.highway,
        oneway:   way.tags?.oneway === 'yes',
        coords,                            // [[lng, lat], ...]
        maxspeed: way.tags?.maxspeed || null,
      };
    })
    .filter(w => w.coords.length >= 2)
    // ordenar por longitud del nombre para que los más específicos salgan primero
    .sort((a, b) => (b.name.length - a.name.length));
}

function hwLabel(type) {
  return {
    residential: 'Calle residencial', primary: 'Vía primaria',
    secondary: 'Vía secundaria', tertiary: 'Calle terciaria',
    service: 'Servicio', unclassified: 'Sin clasificar',
    trunk: 'Vía rápida', motorway: 'Autopista',
    footway: 'Andador', cycleway: 'Carril bici', path: 'Camino',
    living_street: 'Zona habitacional', track: 'Terracería',
  }[type] || type || 'Calle';
}

// ── MapLibre layer ids ────────────────────────────────────────────────────────
const SRC_C = 'wp-candidates-src';
const LYR_C = 'wp-candidates-lyr';
const LYR_CH = 'wp-candidates-hover-lyr';
const SRC_S = 'wp-selected-src';
const LYR_S = 'wp-selected-lyr';

function toGeoJSON(ways) {
  return {
    type: 'FeatureCollection',
    features: ways.map(w => ({
      type: 'Feature',
      properties: { way_id: w.way_id, name: w.name },
      geometry: { type: 'LineString', coordinates: w.coords },
    })),
  };
}

// ── Colores según modo ────────────────────────────────────────────────────────
const MODE_COLOR = {
  impassable:  '#ef4444',
  preference:  '#16a34a',
};

const PREF_OPTS = [
  { value: 'preferred', label: '⭐ Preferida',  color: '#16a34a' },
  { value: 'difficult', label: '⚠️ Difícil',    color: '#f59e0b' },
  { value: 'avoid',     label: '🚫 Evitar',      color: '#ef4444' },
];
const DUR_OPTS = [
  { value: 'days',      label: 'Días' },
  { value: 'weeks',     label: 'Semanas' },
  { value: 'months',    label: 'Meses' },
  { value: 'permanent', label: 'Permanente' },
];

export default function WayPicker({ map, mode = 'impassable', onConfirm, onCancel }) {
  const [candidates,  setCandidates]  = useState([]);   // ways de la última tap
  const [selected,    setSelected]    = useState([]);   // ways añadidos por el driver
  const [hoverId,     setHoverId]     = useState(null); // way_id con hover en la lista
  const [loading,     setLoading]     = useState(false);
  const [errMsg,      setErrMsg]      = useState('');
  const [preference,  setPreference]  = useState('avoid');
  const [duration,    setDuration]    = useState('days');
  const [description, setDescription] = useState('');
  const [saving,      setSaving]      = useState(false);

  const accentColor = MODE_COLOR[mode] || '#6b7280';
  const selectedIds = new Set(selected.map(w => w.way_id));
  const candidatesRef = useRef(candidates);
  useEffect(() => { candidatesRef.current = candidates; }, [candidates]);

  // ── Capas MapLibre ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!map) return;
    function addLayers() {
      if (!map.getSource(SRC_C)) {
        map.addSource(SRC_C, { type: 'geojson', data: toGeoJSON([]) });
        map.addLayer({ id: LYR_C, type: 'line', source: SRC_C,
          paint: { 'line-color': '#fbbf24', 'line-width': 5, 'line-opacity': 0.85 },
          layout: { 'line-cap': 'round', 'line-join': 'round' } });
        map.addLayer({ id: LYR_CH, type: 'line', source: SRC_C,
          filter: ['==', ['get', 'way_id'], ''],
          paint: { 'line-color': '#f59e0b', 'line-width': 8, 'line-opacity': 1 },
          layout: { 'line-cap': 'round', 'line-join': 'round' } });
      }
      if (!map.getSource(SRC_S)) {
        map.addSource(SRC_S, { type: 'geojson', data: toGeoJSON([]) });
        map.addLayer({ id: LYR_S, type: 'line', source: SRC_S,
          paint: { 'line-color': accentColor, 'line-width': 7, 'line-opacity': 0.92 },
          layout: { 'line-cap': 'round', 'line-join': 'round' } });
      }
    }
    if (map.isStyleLoaded()) addLayers(); else map.once('load', addLayers);
    return () => {
      try {
        [LYR_C, LYR_CH, LYR_S].forEach(l => { if (map.getLayer(l)) map.removeLayer(l); });
        [SRC_C, SRC_S].forEach(s => { if (map.getSource(s)) map.removeSource(s); });
      } catch (_) {}
    };
  }, [map]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sincronizar capas cuando cambian datos ─────────────────────────────────
  useEffect(() => { map?.getSource(SRC_C)?.setData(toGeoJSON(candidates)); }, [map, candidates]);
  useEffect(() => { map?.getSource(SRC_S)?.setData(toGeoJSON(selected)); }, [map, selected]);
  useEffect(() => {
    if (!map || !map.getLayer(LYR_CH)) return;
    map.setFilter(LYR_CH, ['==', ['get', 'way_id'], hoverId || '']);
  }, [map, hoverId]);

  // ── Click en el mapa → consultar Overpass ─────────────────────────────────
  useEffect(() => {
    if (!map) return;
    const handler = async (e) => {
      if (loading) return;
      setLoading(true);
      setErrMsg('');
      setCandidates([]);
      try {
        const ways = await queryNearbyWays(e.lngLat.lat, e.lngLat.lng);
        // Excluir los ya seleccionados para no confundir al usuario
        const fresh = ways.filter(w => !selectedIds.has(w.way_id));
        setCandidates(fresh);
        if (fresh.length === 0) setErrMsg('No se encontraron calles en esa zona. Intenta tocar más cerca de la calle.');
      } catch (_) {
        setErrMsg('No se pudo conectar con Overpass. Verifica tu conexión.');
      } finally {
        setLoading(false);
      }
    };
    map.on('click', handler);
    const prev = map.getCanvas().style.cursor;
    map.getCanvas().style.cursor = 'crosshair';
    return () => {
      map.off('click', handler);
      map.getCanvas().style.cursor = prev;
    };
  }, [map, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Agregar way a seleccionados ───────────────────────────────────────────
  function addWay(way) {
    if (selectedIds.has(way.way_id)) return;
    setSelected(prev => [...prev, way]);
    // quitar de candidatos
    setCandidates(prev => prev.filter(w => w.way_id !== way.way_id));
  }

  function removeSelected(way_id) {
    setSelected(prev => prev.filter(w => w.way_id !== way_id));
  }

  // ── Confirmar ─────────────────────────────────────────────────────────────
  function handleConfirm() {
    if (!selected.length || saving) return;
    setSaving(true);
    const ways = selected.map(w => ({
      way_id:             w.way_id,
      name:               w.name,
      ...(mode === 'preference' ? { preference } : {}),
      ...(mode === 'impassable' ? { estimated_duration: duration } : {}),
      description:        description || undefined,
    }));
    onConfirm(ways);
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Hint superior */}
      <div style={{
        position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.6)', color: '#fff', borderRadius: 20,
        padding: '0.22rem 0.8rem', fontSize: '0.7rem', fontWeight: 500,
        zIndex: 21, pointerEvents: 'none', whiteSpace: 'nowrap',
      }}>
        {loading ? '🔍 Buscando calles…' : '👇 Toca una calle en el mapa'}
      </div>

      {/* Panel inferior */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 20,
        background: '#fff', borderTop: `3px solid ${accentColor}`,
        padding: '0.65rem 1rem 0.85rem',
        boxShadow: '0 -4px 20px rgba(0,0,0,0.14)',
        maxHeight: '55vh', display: 'flex', flexDirection: 'column', gap: '0.45rem',
      }}>

        {/* Título */}
        <div style={{ fontWeight: 700, fontSize: '0.84rem', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          {mode === 'impassable' ? '⛔ Calles no viables' : '⭐ Preferencia de calle'}
          {loading && (
            <span style={{ fontSize: '0.68rem', fontWeight: 400, color: '#9ca3af', marginLeft: 4 }}>
              buscando…
            </span>
          )}
        </div>

        {/* Error */}
        {errMsg && (
          <div style={{ fontSize: '0.72rem', color: '#dc2626', background: '#fef2f2',
            border: '1px solid #fecaca', borderRadius: 7, padding: '0.3rem 0.5rem', flexShrink: 0 }}>
            {errMsg}
          </div>
        )}

        {/* Candidatos */}
        {candidates.length > 0 && (
          <div style={{ flexShrink: 0 }}>
            <div style={{ fontSize: '0.68rem', color: '#9ca3af', marginBottom: '0.25rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
              Calles encontradas — toca para agregar
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {candidates.map(w => (
                <button key={w.way_id}
                  onClick={() => addWay(w)}
                  onMouseEnter={() => setHoverId(w.way_id)}
                  onMouseLeave={() => setHoverId(null)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    padding: '0.35rem 0.55rem', borderRadius: 8, cursor: 'pointer',
                    background: hoverId === w.way_id ? '#fef3c7' : '#f9fafb',
                    border: `1.5px solid ${hoverId === w.way_id ? '#fbbf24' : '#e5e7eb'}`,
                    textAlign: 'left', transition: 'all 0.12s',
                  }}>
                  <span style={{ fontSize: '0.7rem', color: '#6b7280', background: '#e5e7eb',
                    borderRadius: 5, padding: '0.05rem 0.3rem', fontFamily: 'monospace', flexShrink: 0 }}>
                    {w.highway}
                  </span>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#111827', flex: 1,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {w.name}
                  </span>
                  {w.maxspeed && (
                    <span style={{ fontSize: '0.65rem', color: '#9ca3af', flexShrink: 0 }}>
                      {w.maxspeed} km/h
                    </span>
                  )}
                  <span style={{ fontSize: '0.75rem', color: accentColor, fontWeight: 700, flexShrink: 0 }}>＋</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Seleccionados */}
        {selected.length > 0 && (
          <div style={{ flexShrink: 0 }}>
            <div style={{ fontSize: '0.68rem', color: '#9ca3af', marginBottom: '0.25rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
              Seleccionados ({selected.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.18rem' }}>
              {selected.map(w => (
                <div key={w.way_id} style={{
                  display: 'flex', alignItems: 'center', gap: '0.45rem',
                  padding: '0.28rem 0.5rem', borderRadius: 7,
                  background: accentColor + '12', border: `1.5px solid ${accentColor}44`,
                }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: accentColor, flexShrink: 0 }} />
                  <span style={{ fontSize: '0.78rem', flex: 1, fontWeight: 600, color: '#111827',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {w.name}
                  </span>
                  <button onClick={() => removeSelected(w.way_id)} style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: '#9ca3af', fontSize: '0.7rem', padding: '0 0.15rem', lineHeight: 1,
                  }}>✕</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Opciones de modo */}
        {mode === 'preference' && (
          <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', flexShrink: 0 }}>
            {PREF_OPTS.map(o => {
              const active = o.value === preference;
              return (
                <button key={o.value} onClick={() => setPreference(o.value)} style={{
                  padding: '0.28rem 0.6rem', borderRadius: 20, fontSize: '0.72rem',
                  fontWeight: active ? 700 : 500, cursor: 'pointer', transition: 'all 0.12s',
                  background: active ? o.color : '#f3f4f6',
                  color:      active ? '#fff'   : '#374151',
                  border: `1.5px solid ${active ? o.color : '#e5e7eb'}`,
                }}>{o.label}</button>
              );
            })}
          </div>
        )}

        {mode === 'impassable' && (
          <div style={{ display: 'flex', gap: '0.28rem', flexWrap: 'wrap', alignItems: 'center', flexShrink: 0 }}>
            <span style={{ fontSize: '0.72rem', color: '#6b7280' }}>Duración:</span>
            {DUR_OPTS.map(o => {
              const active = o.value === duration;
              return (
                <button key={o.value} onClick={() => setDuration(o.value)} style={{
                  padding: '0.22rem 0.5rem', borderRadius: 20, fontSize: '0.7rem',
                  fontWeight: active ? 700 : 400, cursor: 'pointer', transition: 'all 0.12s',
                  background: active ? '#111827' : '#f3f4f6',
                  color:      active ? '#fff'    : '#374151',
                  border: `1px solid ${active ? '#111827' : '#e5e7eb'}`,
                }}>{o.label}</button>
              );
            })}
          </div>
        )}

        {/* Descripción opcional */}
        <textarea value={description} onChange={e => setDescription(e.target.value)}
          placeholder="Descripción opcional…"
          maxLength={500} rows={1}
          style={{
            width: '100%', boxSizing: 'border-box', resize: 'none',
            fontSize: '0.75rem', padding: '0.28rem 0.45rem',
            border: '1px solid #e5e7eb', borderRadius: 7, color: '#374151',
            fontFamily: 'inherit', flexShrink: 0,
          }}
        />

        {/* Acciones */}
        <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
          <button onClick={handleConfirm}
            disabled={selected.length === 0 || saving}
            style={{
              flex: 1, padding: '0.58rem 0', borderRadius: 9, fontSize: '0.86rem',
              fontWeight: 700, cursor: selected.length && !saving ? 'pointer' : 'not-allowed',
              background: selected.length ? accentColor : '#d1d5db',
              color: '#fff', border: 'none', transition: 'background 0.15s',
              opacity: saving ? 0.7 : 1,
            }}>
            {saving ? 'Enviando…' :
             mode === 'impassable'
               ? `Reportar${selected.length ? ` (${selected.length})` : ''}`
               : `Guardar${selected.length ? ` (${selected.length})` : ''}`}
          </button>
          <button onClick={onCancel} style={{
            flex: 1, padding: '0.58rem 0', borderRadius: 9, fontSize: '0.86rem',
            fontWeight: 600, cursor: 'pointer',
            background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb',
          }}>Cancelar</button>
        </div>

      </div>
    </>
  );
}
