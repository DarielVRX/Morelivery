-- migration_v24_bag_volume.sql
-- Agrega capacidad de mochila al driver y volumen estimado por producto/pedido.

-- 1. Capacidad de mochila del driver (litros, default 25)
ALTER TABLE driver_profiles
  ADD COLUMN IF NOT EXISTS bag_capacity_liters NUMERIC(6,2) NOT NULL DEFAULT 25;

-- 2. Volumen por producto en el menú
--    pkg_units:        unidades por empaque (ej: 1 burger, 6 nuggets)
--    pkg_volume_liters: volumen de ese empaque en litros (ej: 0.5)
ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS pkg_units         SMALLINT      NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS pkg_volume_liters NUMERIC(6,3)  NOT NULL DEFAULT 0;

-- 3. Volumen total estimado del pedido (calculado al crear, guardado para el motor)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS estimated_volume_liters NUMERIC(8,3) NOT NULL DEFAULT 0;

-- 4. Pico de ocupación de mochila calculado por el simulador al momento de la oferta
ALTER TABLE order_driver_offers
  ADD COLUMN IF NOT EXISTS bag_overflow_pct SMALLINT NOT NULL DEFAULT 0;
