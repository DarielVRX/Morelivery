-- migration_v5.sql
-- Ejecutar en Supabase / Render SQL editor

-- 1. Horario semanal por restaurante
CREATE TABLE IF NOT EXISTS restaurant_schedules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  day_of_week   SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Dom…6=Sáb
  opens_at      TIME,        -- NULL = cerrado ese día
  closes_at     TIME,
  is_closed     BOOLEAN NOT NULL DEFAULT false,
  UNIQUE(restaurant_id, day_of_week)
);

-- 2. Override manual de apertura/cierre (prioridad sobre el horario)
--    NULL = seguir horario, true = forzar abierto, false = forzar cerrado
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS manual_open_override BOOLEAN DEFAULT NULL;

-- 3. Timestamps por etapa del pedido (para métricas de tiempos)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS accepted_at   TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS preparing_at  TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ready_at      TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS picked_up_at  TIMESTAMPTZ;  -- cuando driver marca on_the_way
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at  TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at  TIMESTAMPTZ;

-- 4. Índices útiles para las queries de admin/métricas
CREATE INDEX IF NOT EXISTS idx_orders_created_at  ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status      ON orders(status);
CREATE INDEX IF NOT EXISTS idx_restaurant_sched   ON restaurant_schedules(restaurant_id, day_of_week);
