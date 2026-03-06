-- migration_v6.sql
-- Imagen de producto y etiquetas de espera entre conductor y pedido

-- Imagen por producto (URL o base64 corta)
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS image_url TEXT;

-- wait_until: el conductor no puede ver este pedido antes de esta fecha
-- Aplica solo para rechazados/liberados (no timeout). NULL = sin restricción.
ALTER TABLE order_driver_offers ADD COLUMN IF NOT EXISTS wait_until TIMESTAMPTZ;

-- Índice para consultas de espera
CREATE INDEX IF NOT EXISTS idx_offers_wait ON order_driver_offers(driver_id, wait_until)
  WHERE wait_until IS NOT NULL;
