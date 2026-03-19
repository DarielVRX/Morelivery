// backend/src/utils/geo.js
// Utilidades geográficas para el backend.
// haversineMeters: distancia en metros entre dos puntos {lat, lng}.
// shortId: versión legible de un UUID para logs (primeros N chars del hex sin guiones).

/**
 * Distancia en metros entre dos puntos geográficos usando la fórmula de Haversine.
 * @param {{ lat: number, lng: number }} a
 * @param {{ lat: number, lng: number }} b
 * @returns {number} distancia en metros
 */
export function haversineMeters(a, b) {
  const R  = 6371000;
  const φ1 = a.lat * Math.PI / 180;
  const φ2 = b.lat * Math.PI / 180;
  const Δφ = (b.lat - a.lat) * Math.PI / 180;
  const Δλ = (b.lng - a.lng) * Math.PI / 180;
  const s  = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Versión corta de un UUID para logs y SSE payloads (sin guiones, primeros N chars).
 * Seguro: no expone el UUID completo, es solo para display/debug.
 * @param {string} uuid
 * @param {number} [len=8]  longitud deseada (5-10 recomendado)
 * @returns {string}
 */
export function shortId(uuid, len = 8) {
  if (!uuid) return '—';
  return uuid.replace(/-/g, '').slice(0, len);
}

/**
 * Verifica si dos posiciones están dentro de un radio en metros.
 * @param {{ lat: number, lng: number }} a
 * @param {{ lat: number, lng: number }} b
 * @param {number} radiusMeters
 * @returns {boolean}
 */
export function withinRadius(a, b, radiusMeters) {
  return haversineMeters(a, b) < radiusMeters;
}
