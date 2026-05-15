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
  // ── Asignación / oferta ────────────────────────────────────────────────
  offer_timeout_s:                    60,
  cooldown_s:                         300,
  max_active_orders_per_driver:       4,
  assignment_retry_base_s:            2,
  assignment_retry_max_s:             60,
  assignment_hard_top_k:              5,
  max_pickup_radius_km:               5,
  simulation_budget_per_tick:         75,   // máximo de simulaciones por ciclo de asignación
  max_customer_restaurant_distance_km:8,    // cancela pedidos con distancia restaurante→cliente mayor a esto

  // ── Scoring ────────────────────────────────────────────────────────────
  fairness_penalty_per_order_s:       120,
  soft_sla_penalty_factor:            2,
  hard_sla_penalty_s:                 3000,
  pickup_proximity_penalty_factor:    0.35,
  pickup_bridge_penalty_factor:       1,    // multiplicador sobre bridgePenaltyS en scoring
  nearby_driver_preference_m:         250,
  max_delivery_time_s:                1800,
  disconnect_penalty_max:             3,
  disconnect_penalty_s:               300,
  reconnect_window_s:                 600,

  // ── Ruteo / secuenciación ──────────────────────────────────────────────
  sla_critical_threshold_s:           600,   // margen bajo el cual el SLA sobreescribe distancia completamente
  sla_warning_threshold_s:            1200,  // margen bajo el cual el SLA entra como criterio de desempate
  reroute_lock_radius_m:              200,  // radio en metros — si el driver está dentro, el próximo stop es intocable

  // ── Rebalanceo ─────────────────────────────────────────────────────────
  rebalancer_interval_s:              300,
  transfer_min_gain_s:                10,
  transfer_cooldown_s:                60,
  transfer_max_route_eta_s:           180,  // ruta máxima en s para disparar rebalanceo

  // ── Cocina ─────────────────────────────────────────────────────────────
  kitchen_wait_threshold_s:           120,
  kitchen_estimate_diff_threshold_s:  90,
  kitchen_gap_threshold_s:            600,  // gap máximo entre kitchenReadyAt de pedidos para agruparlos en el mismo stop
  kitchen_wait_tolerance_s:           180,  // descuento de tolerancia aplicado al wait de cocina en el greedy

  // ── Volumen / mochila ──────────────────────────────────────────────────
  default_bag_capacity_liters:        60,   // litros de mochila si driver no especificó
};

// Catálogo completo con descripción — fuente de verdad para el panel de admin
// El admin muestra TODOS estos params aunque no existan en DB todavía
const PARAM_CATALOG = {
  offer_timeout_s:                    { default: 60,   description: 'Segundos antes de expirar una oferta sin respuesta' },
  cooldown_s:                         { default: 300,  description: 'Penalización en segundos tras rechazar o expirar oferta' },
  max_active_orders_per_driver:       { default: 4,    description: 'Límite de pedidos simultáneos por driver' },
  assignment_retry_base_s:            { default: 2,    description: 'Delay base en segundos entre reintentos de asignación' },
  assignment_retry_max_s:             { default: 60,   description: 'Delay máximo en segundos entre reintentos de asignación' },
  assignment_hard_top_k:              { default: 5,    description: 'Número máximo de candidatos a evaluar por ronda' },
  max_pickup_radius_km:               { default: 5,    description: 'Radio máximo en km para considerar un driver como candidato' },
  simulation_budget_per_tick:         { default: 75,   description: 'Número máximo de simulaciones de ruta por ciclo de asignación' },
  max_customer_restaurant_distance_km:{ default: 8,    description: 'Distancia máxima km entre restaurante y cliente — pedidos más lejanos se cancelan automáticamente' },
  fairness_penalty_per_order_s:       { default: 120,  description: 'Penalización de scoring por pedido activo adicional del driver' },
  soft_sla_penalty_factor:            { default: 2,    description: 'Multiplicador de penalización por retraso sobre SLA' },
  hard_sla_penalty_s:                 { default: 3000, description: 'Penalización fija (segundos) cuando se excede el SLA' },
  pickup_proximity_penalty_factor:    { default: 0.35, description: 'Factor de penalización por distancia driver→restaurante' },
  pickup_bridge_penalty_factor:       { default: 1,    description: 'Multiplicador sobre el costo de desvío (bridgePenaltyS) en el scoring' },
  nearby_driver_preference_m:         { default: 250,  description: 'Metros de preferencia para drivers cercanos al restaurante' },
  max_delivery_time_s:                { default: 1800, description: 'SLA máximo de entrega en segundos (30 min default)' },
  disconnect_penalty_max:             { default: 3,    description: 'Penalizaciones acumuladas antes de excluir al driver de asignaciones' },
  disconnect_penalty_s:               { default: 300,  description: 'Penalización de scoring (segundos) por cada desconexión previa' },
  reconnect_window_s:                 { default: 600,  description: 'Ventana en segundos para que un driver reconecte tras desconexión' },
  sla_critical_threshold_s:           { default: 600,  description: 'Segundos restantes de SLA bajo los cuales el SLA sobreescribe distancia completamente en el greedy' },
  sla_warning_threshold_s:            { default: 1200, description: 'Segundos restantes de SLA bajo los cuales el SLA entra como criterio de desempate sobre distancia' },
  reroute_lock_radius_m:              { default: 200,  description: 'Radio en metros dentro del cual el próximo stop del driver queda bloqueado y el secuenciador no puede reordenarlo' },
  rebalancer_interval_s:              { default: 300,  description: 'Cada cuántos segundos corre el motor de rebalanceo automático' },
  transfer_min_gain_s:                { default: 10,   description: 'Ganancia mínima en segundos para aplicar rebalanceo automático' },
  transfer_cooldown_s:                { default: 60,   description: 'Tiempo mínimo entre transferencias del mismo pedido' },
  transfer_max_route_eta_s:           { default: 180,  description: 'ETA de ruta máximo (s) para disparar rebalanceo en un driver' },
  kitchen_wait_threshold_s:           { default: 120,  description: 'Segundos de espera en restaurante que activan sugerencia de ajuste' },
  kitchen_estimate_diff_threshold_s:  { default: 90,   description: 'Diferencia mínima entre estimado y real para sugerir cambio de prep' },
  kitchen_gap_threshold_s:            { default: 600,  description: 'Gap máximo en segundos entre kitchenReadyAt de pedidos para agruparlos en el mismo stop de pickup' },
  kitchen_wait_tolerance_s:           { default: 180,  description: 'Descuento de tolerancia en segundos aplicado al wait de cocina en el greedy — solo penaliza el exceso' },
  default_bag_capacity_liters:        { default: 60,   description: 'Litros de capacidad de mochila si el driver no especificó la suya' },
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
    console.warn('[engine-params] error cargando params, usando defaults:', e.message);
    _loadedAt = Date.now();
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
 * Incluye TODOS los parámetros del catálogo aunque no existan en DB todavía —
 * en ese caso muestra el default del código con updatedAt/updatedBy nulos.
 */
export async function getParamsWithMeta() {
  await _ensureLoaded();

  const r = await query(
    'SELECT key, value, description, updated_at, updated_by FROM engine_params ORDER BY key'
  ).catch(() => ({ rows: [] }));

  const dbMap = {};
  for (const row of r.rows) {
    dbMap[row.key] = row;
  }

  return Object.entries(PARAM_CATALOG).map(([key, meta]) => {
    const row = dbMap[key];
    return {
      key,
      value:       row ? Number(row.value) : meta.default,
      description: row?.description || meta.description,
      updatedAt:   row?.updated_at   || null,
      updatedBy:   row?.updated_by   || null,
      default:     meta.default,
      inDb:        Boolean(row),
    };
  });
}

/**
 * Siembra en DB todos los params del catálogo que aún no existan.
 * Idempotente — usa ON CONFLICT DO NOTHING.
 * Llamar al arrancar el servidor para garantizar que el admin siempre ve todo.
 */
export async function seedDefaultParams() {
  try {
    const entries = Object.entries(PARAM_CATALOG);
    if (entries.length === 0) return;
    const placeholders = entries.map((_, i) => `($${i*3+1}, $${i*3+2}, $${i*3+3})`).join(', ');
    const values = entries.flatMap(([key, meta]) => [key, meta.default, meta.description]);
    await query(
      `INSERT INTO engine_params (key, value, description)
       VALUES ${placeholders}
       ON CONFLICT (key) DO NOTHING`,
      values
    );
  } catch (e) {
    console.warn('[engine-params] seedDefaultParams falló (no crítico):', e.message);
  }
}
