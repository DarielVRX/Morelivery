-- migrate_login_attempts.sql
-- Restricción de intentos de login en dos etapas

-- ── Tabla de intentos por (email + fingerprint) ────────────────────────────
CREATE TABLE IF NOT EXISTS login_attempts (
  id           SERIAL PRIMARY KEY,
  email        TEXT        NOT NULL,
  fingerprint  TEXT,
  attempts     INT         NOT NULL DEFAULT 1,
  locked_until TIMESTAMPTZ,
  last_attempt TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_email_fp
  ON login_attempts (email, fingerprint);

-- ── Columnas en users para bloqueo de cuenta y 2FA ────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS account_locked         BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS account_unlock_token   TEXT,
  ADD COLUMN IF NOT EXISTS account_unlock_expires TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS two_fa_enabled         BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS two_fa_code            TEXT,
  ADD COLUMN IF NOT EXISTS two_fa_expires         TIMESTAMPTZ;
