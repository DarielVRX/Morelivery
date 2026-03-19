-- migration_v25_rebalance_manual.sql
-- Rebalanceo manual por driver + contadores de acciones por sesión e histórico.

-- 1. Estado de disputa en pedidos
--    is_disputed:    el driver solicitó rebalanceo — pedido en disputa
--    disputed_until: si nadie lo toma antes de este timestamp, se cancela la disputa
--    disputed_by:    driver que solicitó el rebalanceo (para cooldown largo)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS is_disputed     BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS disputed_until  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS disputed_by     UUID REFERENCES users(id);

-- 2. Contadores históricos acumulados en driver_profiles
ALTER TABLE driver_profiles
  ADD COLUMN IF NOT EXISTS total_rebalances  INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_releases    INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_cancels     INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_expires     INT NOT NULL DEFAULT 0;

-- 3. Contadores de sesión (se resetean cuando el driver cambia a disponible)
--    Guardados en DB para sobrevivir reconexiones dentro de la misma sesión operativa.
ALTER TABLE driver_profiles
  ADD COLUMN IF NOT EXISTS session_rebalances  INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS session_releases    INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS session_cancels     INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS session_expires     INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS session_started_at  TIMESTAMPTZ;

-- Índice para el ticker de disputas expiradas
CREATE INDEX IF NOT EXISTS idx_orders_disputed
  ON orders(disputed_until)
  WHERE is_disputed = true;
