-- migration_v4.sql
-- Coordenadas de restaurante y entrega en el pedido (para el mapa)
-- Se llenan al crear el pedido si el restaurante/cliente tienen coordenadas guardadas

ALTER TABLE orders ADD COLUMN IF NOT EXISTS restaurant_lat NUMERIC(9,6);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS restaurant_lng NUMERIC(9,6);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_lat NUMERIC(9,6);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_lng NUMERIC(9,6);

-- Coordenadas en restaurantes (para mostrar en el mapa y calcular rutas)
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS lat NUMERIC(9,6);
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS lng NUMERIC(9,6);

-- Coordenadas en users (para delivery_lat/lng al crear pedido)
ALTER TABLE users ADD COLUMN IF NOT EXISTS lat NUMERIC(9,6);
ALTER TABLE users ADD COLUMN IF NOT EXISTS lng NUMERIC(9,6);
