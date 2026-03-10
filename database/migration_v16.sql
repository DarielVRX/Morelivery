-- migration_v16.sql
-- Asegurar que restaurants.lat y restaurants.lng existen.
-- (Ya deberían estar de migration_v4 pero se garantiza aquí)
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS lat NUMERIC(9,6);
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS lng NUMERIC(9,6);

-- Backfill: copiar lat/lng de users a restaurants para dueños de tienda
-- que hayan guardado su pin antes de este fix (cuando se guardaba en users)
UPDATE restaurants r
SET lat = u.lat, lng = u.lng
FROM users u
WHERE r.owner_user_id = u.id
  AND r.lat IS NULL AND r.lng IS NULL
  AND u.lat IS NOT NULL AND u.lng IS NOT NULL;
