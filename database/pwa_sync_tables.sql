-- migrations/XXXX_pwa_sync_tables.sql
-- Tablas requeridas por los nuevos endpoints PWA.
-- Ejecutar una sola vez en el orden indicado.

-- ── driver_locations ──────────────────────────────────────────────────────────
-- Almacena pings de GPS individuales, incluyendo los enviados en batch offline.
-- La constraint UNIQUE (driver_id, recorded_at) evita duplicados cuando el SW
-- reintenta el mismo lote por fallo de red.

CREATE TABLE IF NOT EXISTS driver_locations (
  id          BIGSERIAL    PRIMARY KEY,
  driver_id   UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  recorded_at TIMESTAMPTZ  NOT NULL,                 -- hora real en el dispositivo
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),   -- hora de inserción en el servidor

  CONSTRAINT driver_locations_unique_ping UNIQUE (driver_id, recorded_at)
);

CREATE INDEX IF NOT EXISTS idx_driver_locations_driver_time
  ON driver_locations (driver_id, recorded_at DESC);

-- ── Nota sobre driver_id ──────────────────────────────────────────────────────
-- Si tu tabla de repartidores es "drivers" con columna "user_id" en lugar de
-- referenciar users(id) directamente, ajusta el REFERENCES arriba.
-- Alternativa sin FK estricta (más flexible):
--   driver_id UUID NOT NULL,
