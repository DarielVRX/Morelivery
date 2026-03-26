-- Migration: Pack 3 — impassable_votes para sistema de votos confirm/dismiss
-- Ejecutar una sola vez en producción

CREATE TABLE IF NOT EXISTS impassable_votes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  way_id     VARCHAR(30) NOT NULL REFERENCES impassable_reports(way_id) ON DELETE CASCADE,
  driver_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vote       VARCHAR(10) NOT NULL CHECK (vote IN ('confirm', 'dismiss')),
  voted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(way_id, driver_id)
);

CREATE INDEX IF NOT EXISTS idx_impassable_votes_way ON impassable_votes(way_id);
CREATE INDEX IF NOT EXISTS idx_impassable_votes_driver ON impassable_votes(driver_id);

-- La tabla impassable_confirmations queda deprecated pero no se elimina
-- para preservar datos históricos. El nuevo flujo usa impassable_votes.
