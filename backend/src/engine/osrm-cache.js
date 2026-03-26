// backend/src/engine/osrm-cache.js
//
// Cliente OSRM con caché en memoria por par origen→destino.
// La clave de caché usa una grilla de 75m × 75m (igual que EtaEstimator del simulador)
// para agrupar puntos cercanos y maximizar hits sin perder precisión.
//
// DISEÑO PARA TIER GRATUITO:
//   - Nunca llama OSRM más de una vez por par de grilla en el mismo ciclo.
//   - Cola de pendientes: si llegan N requests al mismo par simultáneamente,
//     solo se lanza una llamada HTTP y los N esperan su resultado.
//   - Backoff automático si OSRM responde 429 o error de red.
//   - TTL de 10 minutos por entrada (el tráfico en una ciudad no cambia tan rápido).
//   - Máximo 2000 entradas en memoria (LRU simple por inserción).

import { haversineMeters } from '../utils/geo.js';

const OSRM_BASE     = process.env.OSRM_URL || 'https://router.project-osrm.org';
const GRID_METERS   = 75;
const TTL_MS        = 10 * 60 * 1000;   // 10 minutos
const MAX_ENTRIES   = 2000;
const MAX_RETRIES   = 2;
const RETRY_BASE_MS = 800;

// cache: key → { distance_m, duration_s, fetchedAt }
const _cache   = new Map();
// pending: key → Promise<result>   (dedup de requests simultáneos al mismo par)
const _pending = new Map();

let _backoffUntil = 0;  // timestamp: no hacer requests hasta este momento

// ─── Cuantización a grilla ────────────────────────────────────────────────────

function _quantizeLat(lat) {
  const meters = lat * 111320;
  return Math.round(meters / GRID_METERS) * GRID_METERS;
}

function _quantizeLng(lat, lng) {
  const meters = lng * 111320 * Math.cos(lat * Math.PI / 180);
  return Math.round(meters / GRID_METERS) * GRID_METERS;
}

function _gridKey(pos) {
  return `${_quantizeLat(pos.lat)}:${_quantizeLng(pos.lat, pos.lng)}`;
}

function _cacheKey(from, to) {
  return `${_gridKey(from)}->${_gridKey(to)}`;
}

// ─── LRU simple ───────────────────────────────────────────────────────────────

function _evictIfNeeded() {
  if (_cache.size < MAX_ENTRIES) return;
  const oldest = _cache.keys().next().value;
  _cache.delete(oldest);
}

// ─── Fetch con retry y backoff ────────────────────────────────────────────────

async function _fetchOSRM(from, to, attempt = 0) {
  if (Date.now() < _backoffUntil) {
    // En backoff: devolver haversine como fallback silencioso
    return null;
  }

  const url = `${OSRM_BASE}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}` +
              `?overview=false&alternatives=false`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(4000),  // timeout 4s
    });

    if (res.status === 429) {
      // Rate limit — backoff exponencial 30s→60s→120s
      _backoffUntil = Date.now() + 30_000 * Math.pow(2, attempt);
      console.warn(`[osrm-cache] rate limited — backoff hasta ${new Date(_backoffUntil).toISOString()}`);
      return null;
    }

    if (!res.ok) {
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_BASE_MS * Math.pow(2, attempt)));
        return _fetchOSRM(from, to, attempt + 1);
      }
      return null;
    }

    const data = await res.json();
    const route = data?.routes?.[0];
    if (!route) return null;

    return {
      distance_m: Math.round(route.distance),
      duration_s: Math.round(route.duration),
    };
  } catch (e) {
    if (attempt < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, RETRY_BASE_MS * Math.pow(2, attempt)));
      return _fetchOSRM(from, to, attempt + 1);
    }
    console.warn(`[osrm-cache] fetch error: ${e.message}`);
    return null;
  }
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Obtiene distancia y duración entre dos puntos.
 * Si hay caché válido lo devuelve directamente.
 * Si la llamada OSRM falla, devuelve estimación por haversine como fallback.
 *
 * @param {{ lat: number, lng: number }} from
 * @param {{ lat: number, lng: number }} to
 * @returns {Promise<{ distance_m: number, duration_s: number, fromCache: boolean }>}
 */
export async function getRoute(from, to) {
  const key  = _cacheKey(from, to);
  const now  = Date.now();

  // 1. Cache hit válido
  const cached = _cache.get(key);
  if (cached && (now - cached.fetchedAt) < TTL_MS) {
    return { ...cached, fromCache: true };
  }

  // 2. Request pendiente al mismo par — esperar en lugar de duplicar
  if (_pending.has(key)) {
    return _pending.get(key);
  }

  // 3. Lanzar nueva request
  const promise = _fetchOSRM(from, to)
    .then(result => {
      _pending.delete(key);

      if (result) {
        _evictIfNeeded();
        _cache.set(key, { ...result, fetchedAt: Date.now() });
        return { ...result, fromCache: false };
      }

      // Fallback haversine (velocidad promedio 30 km/h)
      const dist = haversineMeters(from, to);
      return {
        distance_m: Math.round(dist),
        duration_s: Math.round(dist / (30 * 1000 / 3600)),
        fromCache: false,
        fallback: true,
      };
    })
    .catch(() => {
      _pending.delete(key);
      const dist = haversineMeters(from, to);
      return {
        distance_m: Math.round(dist),
        duration_s: Math.round(dist / (30 * 1000 / 3600)),
        fromCache: false,
        fallback: true,
      };
    });

  _pending.set(key, promise);
  return promise;
}

/**
 * Devuelve solo duration_s, que es lo que necesita EtaEstimator.
 * Si hay driver, usa su speed_kmh para escalar la duración de OSRM.
 *
 * @param {{ lat: number, lng: number }} from
 * @param {{ lat: number, lng: number }} to
 * @param {{ speed_kmh?: number } | null} driver
 * @returns {Promise<number>} duración estimada en segundos
 */
export async function estimateEta(from, to, driver = null) {
  const route = await getRoute(from, to);

  // Si el driver tiene velocidad configurada diferente de 30 km/h, escalar
  const baseSpeedKmh = 30;
  const driverSpeedKmh = Number.isFinite(driver?.speed_kmh) ? driver.speed_kmh : baseSpeedKmh;
  const factor = driverSpeedKmh > 0 ? (baseSpeedKmh / driverSpeedKmh) : 1;

  return Math.round(route.duration_s * factor);
}

/** Estadísticas del caché para monitoring. */
export function cacheStats() {
  return {
    size:         _cache.size,
    pending:      _pending.size,
    inBackoff:    Date.now() < _backoffUntil,
    backoffUntil: _backoffUntil > 0 ? new Date(_backoffUntil).toISOString() : null,
  };
}

/** Limpia el caché (útil en tests). */
export function clearCache() {
  _cache.clear();
  _pending.clear();
  _backoffUntil = 0;
}
