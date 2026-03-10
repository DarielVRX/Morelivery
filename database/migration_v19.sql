-- migration_v19.sql
-- Guarda la ubicación de entrega por pedido en el momento de creación.
-- Evita que cambios posteriores en el perfil del customer afecten pedidos en curso.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_lat   DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS delivery_lng   DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS delivery_address TEXT;
