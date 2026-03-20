-- migration_auth_email.sql
-- Ejecutar UNA sola vez en tu base de datos PostgreSQL (Railway)
-- Es seguro correr con IF NOT EXISTS — no rompe nada existente

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS real_email            TEXT,
  ADD COLUMN IF NOT EXISTS google_id             TEXT,
  ADD COLUMN IF NOT EXISTS calle                 TEXT,
  ADD COLUMN IF NOT EXISTS numero                TEXT,
  -- Verificación de email (listo para conectar cuando quieras)
  ADD COLUMN IF NOT EXISTS email_verified        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_verify_token    TEXT,
  ADD COLUMN IF NOT EXISTS email_verify_expires  TIMESTAMPTZ;

-- Índice único en real_email (permite NULL múltiples)
CREATE UNIQUE INDEX IF NOT EXISTS users_real_email_idx
  ON users (real_email)
  WHERE real_email IS NOT NULL;

-- Índice en google_id
CREATE INDEX IF NOT EXISTS users_google_id_idx
  ON users (google_id)
  WHERE google_id IS NOT NULL;
