-- migration_v10.sql
-- Permite el mismo username con roles distintos.
-- La clave única pasa de ser solo `email` a ser `(email, role)`.
-- Esto requiere:
--   1. Eliminar el índice/constraint único actual sobre email
--   2. Crear uno nuevo sobre (email, role)

-- Eliminar el unique constraint original (puede llamarse users_email_key o similar)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
DROP INDEX IF EXISTS users_email_idx;

-- Crear el nuevo unique constraint compuesto
ALTER TABLE users ADD CONSTRAINT users_email_role_key UNIQUE (email, role);

-- Índice para búsquedas por (email, role) — usado en login
CREATE INDEX IF NOT EXISTS idx_users_email_role ON users(email, role);
