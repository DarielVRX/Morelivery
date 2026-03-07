-- migration_v11.sql
-- Agrega columna profile_photo a la tabla restaurants

ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS profile_photo TEXT;
