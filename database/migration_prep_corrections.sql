-- ── Migración: sistema de correcciones manuales de tiempo de preparación ─────
-- Ejecutar una sola vez en producción (todos los statements son idempotentes)

-- 1. Tabla de marcas de corrección manual (vigencia 1 hora)
CREATE TABLE IF NOT EXISTS restaurant_prep_corrections (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   UUID        NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  previous_s      INTEGER     NOT NULL,
  new_s           INTEGER     NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 hour'
);

CREATE INDEX IF NOT EXISTS idx_prep_corrections_restaurant
  ON restaurant_prep_corrections(restaurant_id, expires_at);

-- 2. Ajustar kitchen_estimate_diff_threshold_s de 90 → 300 (5 minutos)
UPDATE engine_params
SET value       = 300,
    description = 'Diferencia mínima en segundos entre estimado y real para disparar ajuste automático (5 min)',
    updated_at  = NOW()
WHERE key = 'kitchen_estimate_diff_threshold_s';
