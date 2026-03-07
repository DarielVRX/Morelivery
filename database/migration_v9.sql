-- migration_v9.sql
-- Cooldown de oferta por pedido: cuando no hay drivers disponibles,
-- se reduce el wait_until del driver más cercano a vencer (x5 de reducción real).
-- El flag evita que se acumule la reducción en la misma "vuelta".

ALTER TABLE orders ADD COLUMN IF NOT EXISTS offer_cooldown_triggered BOOLEAN NOT NULL DEFAULT FALSE;

-- Índice para que la query de reinicio de ciclo sea eficiente
CREATE INDEX IF NOT EXISTS idx_offers_order_wait
  ON order_driver_offers(order_id, wait_until)
  WHERE status IN ('rejected', 'expired', 'released');
