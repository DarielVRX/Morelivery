-- Migration v21: Navigation features — road zones, preferences, impassable reports
-- Run with: psql $DATABASE_URL -f migration_v21_nav.sql

-- ── road_zones ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS road_zones (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lat            DOUBLE PRECISION NOT NULL,
  lng            DOUBLE PRECISION NOT NULL,
  radius_m       INTEGER     NOT NULL DEFAULT 100,
  type           VARCHAR(20) NOT NULL,
  estimated_hours INTEGER    NOT NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  active         BOOLEAN     NOT NULL DEFAULT true,
  created_by     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_road_zones_expires
  ON road_zones(expires_at) WHERE active = true;

-- ── road_preferences ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS road_preferences (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  way_id      VARCHAR(30) NOT NULL,
  preference  VARCHAR(20) NOT NULL CHECK (preference IN ('preferred', 'difficult', 'avoid')),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(driver_id, way_id)
);

-- ── impassable_reports ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS impassable_reports (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  way_id              VARCHAR(30) NOT NULL,
  lat                 DOUBLE PRECISION NOT NULL,
  lng                 DOUBLE PRECISION NOT NULL,
  description         TEXT,
  estimated_duration  VARCHAR(20) NOT NULL CHECK (estimated_duration IN ('days', 'weeks', 'months', 'permanent')),
  confirmed           BOOLEAN     NOT NULL DEFAULT false,
  consensus_duration  VARCHAR(20),
  reported_by         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_impassable_way
  ON impassable_reports(way_id);

-- Solo un reporte activo no confirmado por segmento a la vez
CREATE UNIQUE INDEX IF NOT EXISTS idx_impassable_one_per_way
  ON impassable_reports(way_id) WHERE confirmed = false;

-- ── impassable_confirmations ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS impassable_confirmations (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  way_id              VARCHAR(30) NOT NULL,
  confirmed_by        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  estimated_duration  VARCHAR(20) NOT NULL CHECK (estimated_duration IN ('days', 'weeks', 'months', 'permanent')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(way_id, confirmed_by)
);
