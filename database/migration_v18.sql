-- migration_v18.sql
-- Agrega campos de dirección estructurada y pin "Casa" a users y restaurants.
-- postal_code, colonia, estado, ciudad: para el flujo de código postal → colonia.
-- home_lat, home_lng: coordenadas del pin "Casa" (distinto de last_lat/last_lng del driver).

-- Tabla users (customer, driver, admin)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS postal_code  TEXT,
  ADD COLUMN IF NOT EXISTS colonia      TEXT,
  ADD COLUMN IF NOT EXISTS estado       TEXT,
  ADD COLUMN IF NOT EXISTS ciudad       TEXT,
  ADD COLUMN IF NOT EXISTS home_lat     DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS home_lng     DOUBLE PRECISION;

-- Tabla restaurants (role=restaurant guarda dirección aquí)
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS postal_code  TEXT,
  ADD COLUMN IF NOT EXISTS colonia      TEXT,
  ADD COLUMN IF NOT EXISTS estado       TEXT,
  ADD COLUMN IF NOT EXISTS ciudad       TEXT,
  ADD COLUMN IF NOT EXISTS home_lat     DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS home_lng     DOUBLE PRECISION;
