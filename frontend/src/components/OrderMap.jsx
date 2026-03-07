// frontend/src/components/OrderMap.jsx
// Mapa con tiles progresivos: detalle mínimo a escala ciudad, calles completas ~1km
// Leaflet + OpenStreetMap. Sin API key.

import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const driverIcon = new L.DivIcon({
  html: '<div style="font-size:1.5rem;line-height:1">🛵</div>',
  className: '', iconSize: [28, 28], iconAnchor: [14, 14],
});
const destIcon = new L.DivIcon({
  html: '<div style="font-size:1.5rem;line-height:1">📍</div>',
  className: '', iconSize: [28, 28], iconAnchor: [14, 28],
});
const restIcon = new L.DivIcon({
  html: '<div style="font-size:1.5rem;line-height:1">🍽</div>',
  className: '', iconSize: [28, 28], iconAnchor: [14, 28],
});

// ─── Capas de tiles progresivas ───────────────────────────────────────────────
//
// Cuatro niveles de detalle mapeados a los umbrales pedidos:
//
//  zoom ≤ 10  (~20 km) → Solo carreteras federales/autopistas.
//                        CartoDB Voyager No Labels: limpio, sin ruido.
//
//  zoom 11–12 (~5 km)  → Calles principales + nombres de ciudad/colonia.
//                        OSM estándar con opacidad parcial.
//
//  zoom 13–14 (~2 km)  → Red urbana casi completa, glorietas, avenidas.
//                        OSM estándar con opacidad alta.
//
//  zoom ≥ 15  (~1 km)  → Detalle completo: carriles, aceras, números, POIs.
//                        OSM estándar opacidad total.
//
// Zoom de referencia en Leaflet (pantalla ~360px ancho móvil):
//   zoom 10  ≈ 20 km
//   zoom 11  ≈ 10 km
//   zoom 12  ≈ 5 km
//   zoom 13  ≈ 2.5 km
//   zoom 14  ≈ 1.2 km
//   zoom 15  ≈ 600 m    ← detalle navegación completo

// Interpolación lineal entre dos valores
function lerp(a, b, t) { return a + (b - a) * Math.max(0, Math.min(1, t)); }

const TILE_LAYERS = [
  {
    // Capa 1: solo carreteras federales — visible a gran escala, se desvanece al acercar
    // CartoDB Voyager sin etiquetas: muestra autopistas y vías principales, muy limpio
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png',
    attribution: '© <a href="https://carto.com">CARTO</a> © <a href="https://openstreetmap.org">OSM</a>',
    minZoom: 0,
    maxZoom: 20,
    // Máximo al alejar, se apaga al entrar en zoom 12 donde OSM ya da suficiente
    opacityFn: (zoom) => zoom <= 11 ? 1 : zoom < 13 ? lerp(1, 0, (zoom - 11) / 2) : 0,
    zIndex: 1,
  },
  {
    // Capa 2: calles principales — aparece en zoom 11, domina en zoom 13-14
    // OSM estándar: muestra la red vial completa con nombres
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>',
    minZoom: 0,
    maxZoom: 20,
    // Sube desde zoom 11, llega a completo en zoom 15
    opacityFn: (zoom) => zoom < 11 ? 0 : zoom < 15 ? lerp(0, 1, (zoom - 11) / 4) : 1,
    zIndex: 2,
  },
];

// ─── Componente que actualiza opacidades al cambiar el zoom ───────────────────
function AdaptiveTiles() {
  const map = useMap();
  const refs = useRef([]);
  const [zoom, setZoom] = useState(map.getZoom());

  useMapEvents({
    zoomend: () => setZoom(map.getZoom()),
  });

  useEffect(() => {
    refs.current.forEach((layer, i) => {
      if (!layer) return;
      const opacity = TILE_LAYERS[i].opacityFn(zoom);
      // setOpacity en Leaflet mueve el valor al elemento canvas/img subyacente
      layer.setOpacity(Math.max(0, Math.min(1, opacity)));
    });
  }, [zoom]);

  return (
    <>
      {TILE_LAYERS.map((layer, i) => (
        <TileLayer
          key={layer.url}
          url={layer.url}
          attribution={layer.attribution}
          minZoom={layer.minZoom}
          maxZoom={layer.maxZoom}
          zIndex={layer.zIndex}
          opacity={layer.opacityFn(zoom)}
          ref={el => { refs.current[i] = el; }}
        />
      ))}
    </>
  );
}

// ─── FitBounds ────────────────────────────────────────────────────────────────
function FitBounds({ points }) {
  const map = useMap();
  const pointsKey = JSON.stringify(points);
  useEffect(() => {
    if (points.length < 2) return;
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40] });
  }, [pointsKey]);
  return null;
}

// ─── Ruta OSRM ───────────────────────────────────────────────────────────────
async function fetchRoute(from, to) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=simplified&geometries=geojson`;
    const r = await fetch(url);
    const data = await r.json();
    if (data.code !== 'Ok' || !data.routes[0]) return null;
    const route = data.routes[0];
    return {
      route: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      durationSeconds: Math.round(route.duration),
      distanceMeters:  Math.round(route.distance),
    };
  } catch {
    return null;
  }
}

function formatETA(seconds) {
  if (!seconds) return '—';
  const mins = Math.ceil(seconds / 60);
  if (mins < 60) return `~${mins} min`;
  return `~${Math.floor(mins / 60)}h ${mins % 60}min`;
}

// ─── Componente principal ─────────────────────────────────────────────────────
/**
 * Props:
 *  driverPos   = { lat, lng } | null
 *  pickupPos   = { lat, lng } | null  (restaurante)
 *  deliveryPos = { lat, lng } | null  (dirección del cliente)
 *  showPickup  = boolean
 *  height      = string (default '280px')
 */
export default function OrderMap({ driverPos, pickupPos, deliveryPos, showPickup = true, height = '280px' }) {
  const [routeToPickup,   setRouteToPickup]   = useState(null);
  const [routeToDelivery, setRouteToDelivery] = useState(null);
  const routeFetchRef = useRef(0);

  const center = useMemo(() => {
    return driverPos || pickupPos || deliveryPos || { lat: 20.67, lng: -103.35 };
  }, []);

  useEffect(() => {
    const id = ++routeFetchRef.current;
    async function calc() {
      if (driverPos && pickupPos && showPickup) {
        const r = await fetchRoute(driverPos, pickupPos);
        if (id === routeFetchRef.current) setRouteToPickup(r);
      }
      if (driverPos && deliveryPos) {
        const r = await fetchRoute(driverPos, deliveryPos);
        if (id === routeFetchRef.current) setRouteToDelivery(r);
      }
    }
    calc();
  }, [driverPos?.lat, driverPos?.lng]);

  const allPoints = [driverPos, pickupPos, deliveryPos]
    .filter(Boolean)
    .map(p => [p.lat, p.lng]);

  const eta = showPickup && routeToPickup
    ? routeToPickup.durationSeconds
    : routeToDelivery?.durationSeconds;

  return (
    <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid #e5e7eb' }}>
      {eta != null && (
        <div style={{ padding: '0.4rem 0.75rem', background: '#f0fdf4', fontSize: '0.875rem', borderBottom: '1px solid #e5e7eb', display: 'flex', gap: '1rem' }}>
          <span>🕐 ETA: <strong>{formatETA(eta)}</strong></span>
          {(showPickup ? routeToPickup : routeToDelivery)?.distanceMeters != null && (
            <span>📏 {((showPickup ? routeToPickup : routeToDelivery).distanceMeters / 1000).toFixed(1)} km</span>
          )}
        </div>
      )}
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={14}
        style={{ height, width: '100%' }}
        zoomControl={true}
      >
        {/* Tiles progresivos en lugar de un TileLayer fijo */}
        <AdaptiveTiles />
        <FitBounds points={allPoints} />

        {driverPos && (
          <Marker position={[driverPos.lat, driverPos.lng]} icon={driverIcon}>
            <Popup>🛵 Driver</Popup>
          </Marker>
        )}
        {showPickup && pickupPos && (
          <Marker position={[pickupPos.lat, pickupPos.lng]} icon={restIcon}>
            <Popup>🍽 Restaurante</Popup>
          </Marker>
        )}
        {deliveryPos && (
          <Marker position={[deliveryPos.lat, deliveryPos.lng]} icon={destIcon}>
            <Popup>📍 Entrega</Popup>
          </Marker>
        )}

        {showPickup && routeToPickup?.route && (
          <Polyline positions={routeToPickup.route} color="#2563eb" weight={3} opacity={0.7} />
        )}
        {!showPickup && routeToDelivery?.route && (
          <Polyline positions={routeToDelivery.route} color="#16a34a" weight={3} opacity={0.7} />
        )}
      </MapContainer>
    </div>
  );
}
