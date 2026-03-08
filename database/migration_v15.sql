-- migration_v15.sql
-- Agrega driver_number para ordenamiento circular en el motor de asignación
-- y accepted_at para saber cuándo el driver aceptó un pedido.

-- driver_number: entero serial por driver para el orden de la cola
ALTER TABLE driver_profiles
  ADD COLUMN IF NOT EXISTS driver_number SERIAL;

-- Backfill: asignar números secuenciales basados en created_at
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM driver_profiles WHERE driver_number > 0 LIMIT 1
  ) THEN
    UPDATE driver_profiles dp
    SET driver_number = sub.rn
    FROM (
      SELECT user_id, ROW_NUMBER() OVER (ORDER BY created_at ASC) AS rn
      FROM driver_profiles
    ) sub
    WHERE dp.user_id = sub.user_id;
  END IF;
END $$;

-- accepted_at en orders: momento en que el driver aceptó
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;

-- Backfill para pedidos ya asignados
UPDATE orders SET accepted_at = updated_at
WHERE accepted_at IS NULL AND status IN ('assigned','on_the_way','delivered')
  AND driver_id IS NOT NULL;

-- Trigger para setear accepted_at automáticamente
CREATE OR REPLACE FUNCTION set_accepted_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'assigned' AND OLD.status != 'assigned' AND NEW.accepted_at IS NULL THEN
    NEW.accepted_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_accepted_at ON orders;
CREATE TRIGGER trg_set_accepted_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_accepted_at();
