-- migration_confirmation_flow.sql
-- Agrega columnas para el flujo de confirmación paralela restaurante + driver
-- Ejecutar ANTES de deployar los cambios de backend

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS driver_confirmed_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS restaurant_confirmed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS restaurant_confirmed     BOOLEAN NOT NULL DEFAULT false;

-- Índice para queries de pedidos pendientes de confirmación
CREATE INDEX IF NOT EXISTS idx_orders_restaurant_confirmed
  ON orders(restaurant_confirmed)
  WHERE status NOT IN ('delivered', 'cancelled');

-- Retrocompatibilidad: marcar pedidos existentes activos como ya confirmados
-- para no bloquear el flujo actual
UPDATE orders
SET restaurant_confirmed    = true,
    restaurant_confirmed_at = COALESCE(preparing_at, accepted_at, created_at),
    driver_confirmed_at     = COALESCE(accepted_at, created_at)
WHERE status NOT IN ('created', 'pending_driver')
  AND restaurant_confirmed = false;
