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

// ── Grid para agrupación espacial ─────────────────────────────────────────────
// Cuantiza una posición a una celda de GRID_METERS × GRID_METERS.
// Usado por osrm-cache y stop-grouper para agrupar puntos cercanos.
const GRID_METERS = 75;

function _quantizeLatGrid(lat) {
  const meters = lat * 111320;
  return Math.round(meters / GRID_METERS) * GRID_METERS;
}
function _quantizeLngGrid(lat, lng) {
  const meters = lng * 111320 * Math.cos(lat * Math.PI / 180);
  return Math.round(meters / GRID_METERS) * GRID_METERS;
}

/**
 * Devuelve una string clave de celda de grilla para una posición {lat, lng}.
 * Dos posiciones dentro de GRID_METERS metros entre sí producen la misma clave.
 *
 * @param {{ lat: number, lng: number }} pos
 * @returns {string}
 */
export function posToGridKey(pos) {
  return `${_quantizeLatGrid(pos.lat)}:${_quantizeLngGrid(pos.lat, pos.lng)}`;
}
