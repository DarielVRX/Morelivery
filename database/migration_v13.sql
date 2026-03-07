-- migration_v13.sql
-- Tarifas: 5% servicio + 10% envío sobre el subtotal neto
-- Se guardan por separado del total_cents (que sigue siendo el subtotal neto = lo que recibe la tienda)
-- total_with_fees = total_cents + service_fee_cents + delivery_fee_cents

ALTER TABLE orders ADD COLUMN IF NOT EXISTS service_fee_cents  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_fee_cents INTEGER NOT NULL DEFAULT 0;
-- tip opcional del cliente (agradecimiento), visible solo a cliente y conductor
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tip_cents          INTEGER NOT NULL DEFAULT 0;
