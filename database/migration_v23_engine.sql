-- migration_v23_engine.sql
-- Motor de asignación avanzado: scoring, kitchen engine, rebalanceo,
-- penalizaciones por desconexión, parámetros configurables.
-- Ejecutar con: psql $DATABASE_URL -f migration_v23_engine.sql

-- ── orders: campos de runtime del motor ──────────────────────────────────────

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS last_driver_id          UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reconnect_deadline      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS prep_started_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kitchen_estimated_ready TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pickup_wait_s           INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_transferred_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assignment_score        DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS route_distance_km       DOUBLE PRECISION;

-- ── restaurants: tiempo de preparación estimado y aprendido ─────────────────

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS prep_time_estimate_s    INTEGER NOT NULL DEFAULT 600,
  ADD COLUMN IF NOT EXISTS last_prep_time_s        INTEGER,
  ADD COLUMN IF NOT EXISTS prep_estimate_updated_at TIMESTAMPTZ;

-- ── driver_profiles: penalizaciones por desconexión ─────────────────────────

ALTER TABLE driver_profiles
  ADD COLUMN IF NOT EXISTS disconnect_penalties    INTEGER NOT NULL DEFAULT 0;

-- ── engine_params: parámetros configurables desde admin ─────────────────────
-- Un solo row, siempre upsert por key. Si no existe, usa default del backend.

CREATE TABLE IF NOT EXISTS engine_params (
  key         VARCHAR(80) PRIMARY KEY,
  value       DOUBLE PRECISION NOT NULL,
  description TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Insertar defaults (ON CONFLICT DO NOTHING → no sobreescribe cambios del admin)
INSERT INTO engine_params (key, value, description) VALUES
  ('offer_timeout_s',                  60,   'Segundos antes de expirar una oferta sin respuesta'),
  ('cooldown_s',                       300,  'Penalización en segundos tras rechazar o expirar oferta'),
  ('max_active_orders_per_driver',     4,    'Límite de pedidos simultáneos por driver'),
  ('transfer_min_gain_s',              10,   'Ganancia mínima en segundos para aplicar rebalanceo'),
  ('transfer_cooldown_s',              60,   'Tiempo mínimo entre transferencias del mismo pedido'),
  ('reconnect_window_s',               600,  'Ventana en segundos para que un driver reconecte tras desconexión'),
  ('disconnect_penalty_max',           3,    'Penalizaciones acumuladas antes de excluir al driver de asignaciones'),
  ('disconnect_penalty_s',             300,  'Penalización de scoring (segundos) por cada desconexión previa'),
  ('assignment_retry_base_s',          2,    'Delay base en segundos entre reintentos de asignación'),
  ('assignment_retry_max_s',           60,   'Delay máximo en segundos entre reintentos de asignación'),
  ('max_pickup_radius_km',             5,    'Radio máximo en km para considerar un driver como candidato'),
  ('kitchen_wait_threshold_s',         120,  'Segundos de espera en restaurante que activan sugerencia de ajuste'),
  ('kitchen_estimate_diff_threshold_s',90,   'Diferencia mínima entre estimado y real para sugerir cambio'),
  ('rebalancer_interval_s',            300,  'Cada cuántos segundos corre el motor de rebalanceo'),
  ('nearby_driver_preference_m',       250,  'Metros de preferencia para drivers cercanos al restaurante'),
  ('assignment_hard_top_k',            5,    'Número máximo de candidatos a evaluar por ronda'),
  ('fairness_penalty_per_order_s',     120,  'Penalización de scoring por pedido activo adicional del driver'),
  ('soft_sla_penalty_factor',          2,    'Multiplicador de penalización por retraso sobre SLA'),
  ('hard_sla_penalty_s',               3000, 'Penalización fija (segundos) cuando se excede el SLA'),
  ('pickup_proximity_penalty_factor',  0.35, 'Factor de penalización por distancia driver→restaurante'),
  ('max_delivery_time_s',              1800, 'SLA máximo de entrega en segundos (30 min default)')
ON CONFLICT (key) DO NOTHING;

-- ── Índices para queries del motor ──────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_orders_last_driver
  ON orders(last_driver_id) WHERE last_driver_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_reconnect
  ON orders(reconnect_deadline) WHERE reconnect_deadline IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_kitchen_ready
  ON orders(kitchen_estimated_ready) WHERE kitchen_estimated_ready IS NOT NULL;

-- ── offer_cooldown_triggered ya existe en migrations anteriores ──────────────
-- (añadida en migration relacionada con cooldown.js — no duplicar)
