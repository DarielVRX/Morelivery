-- Migration: allow_frequent_customers en restaurants
-- Permite al restaurante que clientes frecuentes superen el límite de 1 pedido activo

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS allow_frequent_customers BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN restaurants.allow_frequent_customers IS
  'Si true, clientes con historial calificado pueden tener más de 1 pedido activo simultáneo.';
