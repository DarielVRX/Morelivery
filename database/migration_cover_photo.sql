-- ── Agregar columna cover_photo a restaurants ────────────────────────────────
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS cover_photo TEXT;
