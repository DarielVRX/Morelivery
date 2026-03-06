// frontend/src/components/OrderMap.jsx
// Mapa de seguimiento con OpenStreetMap (Leaflet) + tiempo estimado (OSRM público)
// Sin API key, sin costo.
// Instalar: npm install leaflet react-leaflet

import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix icono default de Leaflet con bundlers
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const driverIcon = new L.DivIcon({
  html: '<div style="font-size:1.5rem;line-height:1">🛵</div>',
  className: '',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});
const destIcon = new L.DivIcon({
  html: '<div style="font-size:1.5rem;line-height:1">📍</div>',
  className: '',
  iconSize: [28, 28],
  iconAnchor: [14, 28],
});
const restIcon = new L.DivIcon({
  html: '<div style="font-size:1.5rem;line-height:1">🍽</div>',
  className: '',
  iconSize: [28, 28],
  iconAnchor: [14, 28],
});

/** Mueve el mapa para encuadrar todos los puntos */
function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points.length < 2) return;
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40] });
  }, [JSON.stringify(points)]);
  return null;
}

/**
 * Obtiene ruta real desde OSRM (instancia pública gratuita de OpenStreetMap)
 * Devuelve { route: [[lat,lng],...], durationSeconds: number, distanceMeters: number }
 */
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
      distanceMeters: Math.round(route.distance),
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

/**
 * Props:
 *  driverPos  = { lat, lng } | null
 *  pickupPos  = { lat, lng } | null  (restaurante)
 *  deliveryPos = { lat, lng } | null (dirección del cliente)
 *  showPickup = boolean (mostrar punto de recogida)
 *  height     = string (default '280px')
 */
export default function OrderMap({ driverPos, pickupPos, deliveryPos, showPickup = true, height = '280px' }) {
  const [routeToPickup, setRouteToPickup] = useState(null);
  const [routeToDelivery, setRouteToDelivery] = useState(null);
  const routeFetchRef = useRef(0);

  // Centro inicial: primer punto disponible
  const center = useMemo(() => {
    return driverPos || pickupPos || deliveryPos || { lat: 20.67, lng: -103.35 }; // Guadalajara fallback
  }, []);

  // Calcular rutas cuando cambia la posición del driver
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
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='© <a href="https://openstreetmap.org">OpenStreetMap</a>'
        />
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

        {/* Ruta driver → restaurante (azul) */}
        {showPickup && routeToPickup?.route && (
          <Polyline positions={routeToPickup.route} color="#2563eb" weight={3} opacity={0.7} />
        )}
        {/* Ruta driver → entrega (verde) */}
        {!showPickup && routeToDelivery?.route && (
          <Polyline positions={routeToDelivery.route} color="#16a34a" weight={3} opacity={0.7} />
        )}
      </MapContainer>
    </div>
  );
}
