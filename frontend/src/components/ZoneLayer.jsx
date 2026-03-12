// frontend/src/components/ZoneLayer.jsx
import { useEffect, useRef } from 'react';

const ZONE_COLORS = {
  traffic:      '#f97316',
  construction: '#eab308',
  accident:     '#ef4444',
  flood:        '#3b82f6',
  blocked:      '#8b5cf6',
  other:        '#6b7280',
};

/**
 * Genera un polígono GeoJSON (círculo aproximado) a partir de un centro y radio.
 * @param {number} lat       — latitud del centro
 * @param {number} lng       — longitud del centro
 * @param {number} radius_m  — radio en metros
 * @param {number} steps     — número de vértices del polígono (default 32)
 */
function circlePolygon(lat, lng, radius_m, steps = 32) {
  const coords = [];
  // Convertir radio de metros a grados aproximados
  const latDeg = radius_m / 111320;
  const lngDeg = radius_m / (111320 * Math.cos((lat * Math.PI) / 180));

  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    coords.push([
      lng + lngDeg * Math.cos(angle),
      lat + latDeg * Math.sin(angle),
    ]);
  }
  // Cerrar el polígono
  coords.push(coords[0]);

  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [coords],
    },
  };
}

function buildGeoJson(zones) {
  return {
    type: 'FeatureCollection',
    features: zones.map(zone => ({
      ...circlePolygon(zone.lat, zone.lng, zone.radius_m),
      properties: {
        id:    zone.id,
        type:  zone.type,
        color: ZONE_COLORS[zone.type] || ZONE_COLORS.other,
      },
    })),
  };
}

/**
 * ZoneLayer — renderiza zonas de alerta sobre un mapa MapLibre GL.
 *
 * @param {Object}   props
 * @param {Object}   props.map         — instancia de MapLibre GL ya inicializada
 * @param {Array}    props.zones        — array de zonas activas
 * @param {Function} props.onZoneClick  — callback al hacer click en una zona
 */
export default function ZoneLayer({ map, zones = [], onZoneClick }) {
  const zonesRef = useRef(zones);
  zonesRef.current = zones;

  useEffect(() => {
    if (!map) return;

    const SOURCE_ID    = 'nav-zones-source';
    const FILL_LAYER   = 'nav-zones-fill';
    const LINE_LAYER   = 'nav-zones-line';

    const geoJson = buildGeoJson(zones);

    function addLayers() {
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, { type: 'geojson', data: geoJson });
      } else {
        map.getSource(SOURCE_ID).setData(geoJson);
        return; // capas ya existen
      }

      map.addLayer({
        id:     FILL_LAYER,
        type:   'fill',
        source: SOURCE_ID,
        paint: {
          'fill-color':   ['get', 'color'],
          'fill-opacity': 0.12,
        },
      });

      map.addLayer({
        id:     LINE_LAYER,
        type:   'line',
        source: SOURCE_ID,
        paint: {
          'line-color':   ['get', 'color'],
          'line-width':   2,
          'line-opacity': 0.6,
        },
      });

      map.on('click', FILL_LAYER, (e) => {
        const props = e.features?.[0]?.properties;
        if (!props || !onZoneClick) return;
        const zone = zonesRef.current.find(z => z.id === props.id);
        if (zone) onZoneClick(zone);
      });
    }

    if (map.isStyleLoaded()) {
      addLayers();
    } else {
      map.once('load', addLayers);
    }

    return () => {
      try {
        if (map.getLayer(LINE_LAYER)) map.removeLayer(LINE_LAYER);
        if (map.getLayer(FILL_LAYER)) map.removeLayer(FILL_LAYER);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch (_) {}
    };
  }, [map]); // eslint-disable-line react-hooks/exhaustive-deps

  // Actualizar datos cuando cambian las zonas
  useEffect(() => {
    if (!map) return;
    const source = map.getSource('nav-zones-source');
    if (source) {
      source.setData(buildGeoJson(zones));
    }
  }, [map, zones]);

  return null;
}
