// frontend/src/components/RoadPrefsLayer.jsx
//
// Renderiza calles no viables (impassable) y preferencias de ruta (road_preferences)
// sobre el mapa MapLibre.
//
// Colores:
//   - impassable (confirmado o pendiente): #ef4444 (rojo)
//   - preference preferred: #16a34a (verde)
//   - preference difficult: #f59e0b (naranja)
//   - preference avoid:     #ef4444 (rojo)
//
// Capas persistentes — coexisten con ZoneLayer y ruta del driver.

import { useEffect, useRef } from 'react';

const PREF_COLORS = {
  preferred: '#16a34a',
  difficult: '#f59e0b',
  avoid:     '#ef4444',
};

const IMPASSABLE_COLOR = '#ef4444';

// IDs de capas y fuentes — prefijo "road-" para evitar conflictos
const SOURCE_ID     = 'road-prefs-source';
const LAYER_BORDER  = 'road-prefs-border';
const LAYER_LINE    = 'road-prefs-line';

/**
 * Convierte lista de ways a GeoJSON FeatureCollection
 * @param {Array} ways - Array de objetos con { way_id, coords, type?, preference? }
 * @returns {Object} GeoJSON FeatureCollection
 */
function waysToGeoJSON(ways) {
  const features = ways
  .filter(w => w.coords && w.coords.length >= 2)
  .map(w => ({
    type: 'Feature',
    properties: {
      way_id: w.way_id,
      type:   w.type || (w.preference ? 'preference' : 'impassable'),
             preference: w.preference || null,
             color: w.preference
             ? PREF_COLORS[w.preference] || PREF_COLORS.preferred
             : IMPASSABLE_COLOR,
    },
    geometry: {
      type: 'LineString',
      coordinates: w.coords.map(c => {
        // Normalizar coords: puede ser [lng, lat] o {lng, lat}
        if (Array.isArray(c)) return [c[0], c[1]];
        return [c.lng, c.lat];
      }),
    },
  }));
  return { type: 'FeatureCollection', features };
}

/**
 * Capas persistentes de vialidad (impassable + road preferences)
 *
 * @param {Object} props
 * @param {Object} props.map - instancia de MapLibre
 * @param {Array} props.impassableWays - lista de { way_id, coords, confirmed, ... }
 * @param {Array} props.roadPreferences - lista de { way_id, coords, preference, ... }
 */
export default function RoadPrefsLayer({ map, impassableWays = [], roadPreferences = [] }) {
  const prevImpassableRef  = useRef([]);
  const prevPreferencesRef = useRef([]);
  const initializedRef     = useRef(false);

  // Combinar todas las vías con su tipo
  const allWays = [
    ...impassableWays.map(w => ({ ...w, type: 'impassable' })),
    ...roadPreferences.map(p => ({ ...p, type: 'preference' })),
  ];

  // ── Inicializar capas ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!map || initializedRef.current) return;

    const initLayers = () => {
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });

        // Borde blanco para mejor visibilidad
        map.addLayer({
          id: LAYER_BORDER,
          type: 'line',
          source: SOURCE_ID,
          paint: {
            'line-color': '#ffffff',
            'line-width': 5,
            'line-opacity': 0.65,
          },
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
        });

        // Línea principal con color dinámico
        map.addLayer({
          id: LAYER_LINE,
          type: 'line',
          source: SOURCE_ID,
          paint: {
            'line-color': ['get', 'color'],
            'line-width': 3,
            'line-opacity': 0.85,
          },
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
        });
      }
      initializedRef.current = true;
    };

    if (map.isStyleLoaded()) {
      initLayers();
    } else {
      map.once('load', initLayers);
    }

    return () => {
      // No eliminar capas al desmontar — pueden ser reutilizadas por otro componente
      // que use el mismo mapa. Se limpian solo si el componente principal lo requiere.
    };
  }, [map]);

  // ── Actualizar datos cuando cambian las vías ───────────────────────────────
  useEffect(() => {
    if (!map || !initializedRef.current) return;

    const hasChanges =
    impassableWays.length !== prevImpassableRef.current.length ||
    roadPreferences.length !== prevPreferencesRef.current.length;

    if (!hasChanges) return;

    prevImpassableRef.current = [...impassableWays];
    prevPreferencesRef.current = [...roadPreferences];

    const source = map.getSource(SOURCE_ID);
    if (source) {
      source.setData(waysToGeoJSON(allWays));
    }
  }, [map, impassableWays, roadPreferences, allWays]);

  // No renderiza nada — solo efectos de mapa
  return null;
}
