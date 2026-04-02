-- migration: add active_orders_count to driver_profiles
-- Ejecutar una sola vez. Idempotente por el IF NOT EXISTS.

ALTER TABLE driver_profiles
  ADD COLUMN IF NOT EXISTS active_orders_count INTEGER NOT NULL DEFAULT 0;

-- Sincronizar con el estado actual de la DB antes de activar la columna
UPDATE driver_profiles dp
SET active_orders_count = (
  SELECT COUNT(*)::int
  FROM orders o
  WHERE o.driver_id = dp.user_id
    AND o.status = ANY(ARRAY['assigned','accepted','preparing','ready','on_the_way'])
);

-- Verificación post-migración (opcional, para confirmar)
-- SELECT user_id, active_orders_count FROM driver_profiles ORDER BY active_orders_count DESC LIMIT 10;
