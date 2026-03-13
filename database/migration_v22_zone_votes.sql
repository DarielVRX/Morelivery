-- migration_v22_zone_votes.sql
-- Tablas para sistema de votación de zonas de alerta y ediciones pendientes

-- Columna confirmed en road_zones (si no existe)
ALTER TABLE road_zones ADD COLUMN IF NOT EXISTS confirmed BOOLEAN DEFAULT false;

-- Votos por zona: un conductor puede votar confirm o dismiss una vez por zona
CREATE TABLE IF NOT EXISTS zone_votes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id     UUID        NOT NULL REFERENCES road_zones(id) ON DELETE CASCADE,
  driver_id   UUID        NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  vote        VARCHAR(10) NOT NULL CHECK (vote IN ('confirm', 'dismiss')),
  voted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (zone_id, driver_id)
);

CREATE INDEX IF NOT EXISTS idx_zone_votes_zone ON zone_votes(zone_id);

-- Edición pendiente sugerida por un conductor (una por zona, upsert)
CREATE TABLE IF NOT EXISTS zone_pending_edits (
  zone_id          UUID        PRIMARY KEY REFERENCES road_zones(id) ON DELETE CASCADE,
  type             VARCHAR(20),
  estimated_hours  INTEGER,
  suggested_by     UUID        REFERENCES users(id) ON DELETE SET NULL,
  confirm_count    INTEGER     NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
