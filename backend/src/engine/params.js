// backend/src/engine/params.js
//
// Carga y cachea los parámetros del motor desde la tabla engine_params.
// Se recarga automáticamente cada CACHE_TTL_MS para reflejar cambios del admin
// sin necesidad de reiniciar el proceso.
//
// getParam(key, fallback) es la función principal — nunca lanza, siempre devuelve
// un número válido o el fallback.

import { query } from '../config/db.js';

const CACHE_TTL_MS = 60_000; // recargar cada 60 segundos

// Defaults en código como seguro de último recurso
// (se usan si la DB no tiene la fila o si falla la carga)
const DEFAULTS = {
  offer_timeout_s:                  60,
  cooldown_s:                       300,
  max_active_orders_per_driver:     4,
  transfer_min_gain_s:              10,
  transfer_cooldown_s:              60,
  reconnect_window_s:               600,
  disconnect_penalty_max:           3,
  disconnect_penalty_s:             300,
  assignment_retry_base_s:          2,
  assignment_retry_max_s:           60,
  max_pickup_radius_km:             5,
  kitchen_wait_threshold_s:         120,
  kitchen_estimate_diff_threshold_s:90,
  rebalancer_interval_s:            300,
  nearby_driver_preference_m:       250,
  assignment_hard_top_k:            5,
  fairness_penalty_per_order_s:     120,
  soft_sla_penalty_factor:          2,
  hard_sla_penalty_s:               3000,
  pickup_proximity_penalty_factor:  0.35,
  max_delivery_time_s:              1800,
};

let _params     = { ...DEFAULTS };
let _loadedAt   = 0;
let _loadPromise = null;

async function _load() {
  try {
    const r = await query('SELECT key, value FROM engine_params');
    const fresh = { ...DEFAULTS };
    for (const row of r.rows) {
      if (Number.isFinite(Number(row.value))) {
        fresh[row.key] = Number(row.value);
      }
    }
    _params   = fresh;
    _loadedAt = Date.now();
  } catch (e) {
    // Si falla (ej. migración no aplicada aún), seguir con defaults
    console.warn('[engine-params] error cargando params, usando defaults:', e.message);
    _loadedAt = Date.now(); // no reintentar en cada llamada
  } finally {
    _loadPromise = null;
  }
}

/**
 * Recarga forzada de parámetros (útil tras guardar desde admin).
 */
export async function reloadParams() {
  _loadedAt = 0;
  return _ensureLoaded();
}

async function _ensureLoaded() {
  if (Date.now() - _loadedAt < CACHE_TTL_MS) return;
  if (_loadPromise) return _loadPromise;
  _loadPromise = _load();
  return _loadPromise;
}

/**
 * Obtiene el valor de un parámetro del motor.
 * Si no existe o no es numérico, devuelve el fallback.
 * Esta función es síncrona — asegurarse de llamar ensureParamsLoaded() al arrancar.
 *
 * @param {string} key
 * @param {number} [fallback]
 * @returns {number}
 */
export function getParam(key, fallback) {
  const v = _params[key];
  if (Number.isFinite(v)) return v;
  const d = DEFAULTS[key];
  if (Number.isFinite(d)) return d;
  return fallback ?? 0;
}

/**
 * Devuelve todos los parámetros actuales (snapshot).
 */
export function getAllParams() {
  return { ..._params };
}

/**
 * Llama al inicio del servidor para pre-cargar parámetros antes del primer tick.
 * Sin await no bloquea el arranque — simplemente lo encola.
 */
export async function ensureParamsLoaded() {
  return _ensureLoaded();
}

/**
 * Guarda un parámetro en DB y recarga el caché.
 * Lanzado desde el endpoint de admin.
 *
 * @param {string} key
 * @param {number} value
 * @param {string} updatedBy  UUID del admin que hizo el cambio
 */
export async function saveParam(key, value, updatedBy) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
    throw new Error(`Parámetro desconocido: ${key}`);
  }
  if (!Number.isFinite(Number(value))) {
    throw new Error(`Valor inválido para ${key}: ${value}`);
  }
  await query(
    `INSERT INTO engine_params (key, value, updated_by, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (key) DO UPDATE
       SET value      = EXCLUDED.value,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
    [key, Number(value), updatedBy]
  );
  await reloadParams();
}

/**
 * Devuelve todos los parámetros con sus descripciones (para el panel de admin).
 */
export async function getParamsWithMeta() {
  await _ensureLoaded();
  const r = await query(
    'SELECT key, value, description, updated_at, updated_by FROM engine_params ORDER BY key'
  );
  return r.rows.map(row => ({
    key:         row.key,
    value:       Number(row.value),
    description: row.description,
    updatedAt:   row.updated_at,
    updatedBy:   row.updated_by,
    default:     DEFAULTS[row.key] ?? null,
  }));
}
