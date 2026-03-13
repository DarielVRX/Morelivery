// utils/geo.js — funciones geométricas y geocodificación
// Importado por: DriverMap, useNavFeatures, WayPicker, ZonePlacer

export function normalizeBearing(d) { return (d + 360) % 360; }

export function getBearing(from, to) {
  if (!from || !to) return 0;
  const la1 = from.lat * Math.PI / 180, la2 = to.lat * Math.PI / 180;
  const dL  = (to.lng - from.lng) * Math.PI / 180;
  const y   = Math.sin(dL) * Math.cos(la2);
  const x   = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dL);
  return normalizeBearing(Math.atan2(y, x) * 180 / Math.PI);
}

// Distancia euclidiana aproximada en metros (válida para distancias cortas < 50 km)
export function euclideanMeters(lat1, lng1, lat2, lng2) {
  const dlat = (lat2 - lat1) * 111320;
  const dlng = (lng2 - lng1) * 111320 * Math.cos((lat1 * Math.PI) / 180);
  return Math.sqrt(dlat * dlat + dlng * dlng);
}

// Distancia haversine precisa en metros (para distancias largas o cuando se necesita exactitud)
export function haversineMeters(lat1, lng1, lat2, lng2) {
  const R    = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2
             + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Distancia de un punto [lng, lat] a un segmento definido por dos puntos [lng, lat]
export function distPointToSegment(pt, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return haversineMeters(pt[1], pt[0], a[1], a[0]);
  const t  = Math.max(0, Math.min(1, ((pt[0]-a[0])*dx + (pt[1]-a[1])*dy) / (dx*dx + dy*dy)));
  return haversineMeters(pt[1], pt[0], a[1] + t*dy, a[0] + t*dx);
}

// Distancia mínima de un punto a un polyline (array de [lng, lat])
export function distToPolyline(pt, coords) {
  let min = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const d = distPointToSegment(pt, coords[i], coords[i + 1]);
    if (d < min) min = d;
  }
  return min;
}

// Metros por píxel para el zoom y latitud dados (fórmula estándar de Web Mercator)
export function metersPerPx(lat, zoom) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}

// Verifica si algún punto de una ruta pasa cerca de un polyline (way impassable)
export function routeUsesWay(routeCoords, wayCoords, thresholdM = 30) {
  if (!routeCoords?.length || !wayCoords?.length) return false;
  for (const rp of routeCoords) {
    const lat = rp.lat ?? rp[1];
    const lng = rp.lng ?? rp[0];
    if (distToPolyline([lng, lat], wayCoords) < thresholdM) return true;
  }
  return false;
}

export async function reverseGeocode(lat, lng) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`,
      { headers: { 'Accept-Language': 'es' } }
    );
    if (!r.ok) return null;
    const d = await r.json();
    const a = d.address || {};
    const poi  = a.amenity || a.shop || a.office || a.building || a.tourism || null;
    const road = a.road || a.pedestrian || a.footway || '';
    const num  = a.house_number ? ` ${a.house_number}` : '';
    const col  = a.suburb || a.neighbourhood || a.city_district || '';
    if (poi)  return `${poi}${road ? ` · ${road}${num}` : ''}`;
    if (road) return `${road}${num}${col ? `, ${col}` : ''}`;
    return d.display_name?.split(',').slice(0, 2).join(', ') || null;
  } catch { return null; }
}
