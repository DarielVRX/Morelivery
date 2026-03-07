-- migration_v12.sql
-- "alias": nombre público visible en la app (respeta mayúsculas, acentos, espacios)
-- Distinto de full_name (uso legal) y de email/username (autenticación interna)
ALTER TABLE users ADD COLUMN IF NOT EXISTS alias TEXT;

-- Inicializar con full_name existente
UPDATE users SET alias = full_name WHERE alias IS NULL AND full_name IS NOT NULL;

-- profile_photo en restaurants (por si la migration v11 no corrió)
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS profile_photo TEXT;
