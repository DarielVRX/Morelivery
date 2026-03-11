-- v20: Tabla de calificaciones de pedidos
-- Ejecutar en Render PostgreSQL console

CREATE TABLE IF NOT EXISTS order_ratings (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          UUID        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  customer_id       UUID        NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  restaurant_id     UUID        NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  driver_id         UUID        REFERENCES users(id) ON DELETE SET NULL,
  restaurant_stars  SMALLINT    NOT NULL CHECK (restaurant_stars BETWEEN 1 AND 5),
  driver_stars      SMALLINT    CHECK (driver_stars BETWEEN 1 AND 5),
  comment           TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(order_id)              -- un pedido = una sola calificación
);

CREATE INDEX IF NOT EXISTS idx_ratings_restaurant ON order_ratings(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_ratings_driver     ON order_ratings(driver_id);
CREATE INDEX IF NOT EXISTS idx_ratings_customer   ON order_ratings(customer_id);

-- Columnas de promedio denormalizado en restaurants (para no calcular en cada request)
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS rating_avg   NUMERIC(3,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS rating_count INT          DEFAULT 0;

-- Recalcular promedios si ya hay datos (idempotente)
UPDATE restaurants r SET
  rating_avg   = (SELECT AVG(rating.restaurant_stars)::numeric(3,2) FROM order_ratings rating WHERE rating.restaurant_id = r.id),
  rating_count = (SELECT COUNT(*)::int FROM order_ratings rating WHERE rating.restaurant_id = r.id);
