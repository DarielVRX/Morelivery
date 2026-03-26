-- migration_auth_hardening.sql
-- Agrega phone, device_fingerprint y tabla de fingerprints bloqueados
-- Ejecutar en producción ANTES de deployar el nuevo service.js y auth/routes.js

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone          TEXT,
  ADD COLUMN IF NOT EXISTS device_fp      TEXT;

CREATE TABLE IF NOT EXISTS blocked_fingerprints (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint TEXT NOT NULL UNIQUE,
  reason      TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blocked_fp    ON blocked_fingerprints(fingerprint);
CREATE INDEX IF NOT EXISTS idx_users_device_fp ON users(device_fp);
