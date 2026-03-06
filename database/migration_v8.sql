-- migration_v8.sql
-- Chat entre participantes del pedido, reportes post-entrega y timestamp de cancelación

-- ── Timestamp de cancelación ─────────────────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

-- ── Chat por pedido ──────────────────────────────────────────────────────────
-- Mensajes entre cliente, restaurante y driver dentro de un pedido
CREATE TABLE IF NOT EXISTS order_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sender_id   UUID NOT NULL REFERENCES users(id),
  text        TEXT NOT NULL CHECK (char_length(text) <= 500),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_order ON order_messages(order_id, created_at);

-- ── Reportes post-pedido ─────────────────────────────────────────────────────
-- Cualquiera de los 3 roles puede reportar tras entrega/cancelación
CREATE TABLE IF NOT EXISTS order_reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  reporter_id   UUID NOT NULL REFERENCES users(id),
  reporter_role VARCHAR(20) NOT NULL,
  reason        VARCHAR(80) NOT NULL DEFAULT 'general',
  text          TEXT NOT NULL,
  reviewed      BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reports_order ON order_reports(order_id);
CREATE INDEX IF NOT EXISTS idx_reports_unreviewed ON order_reports(reviewed) WHERE reviewed = false;
