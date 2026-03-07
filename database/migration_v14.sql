-- migration_v14.sql
-- 1. Método de pago y tarifa de restaurante
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'cash'
  CHECK (payment_method IN ('cash','card','spei'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS restaurant_fee_cents INTEGER NOT NULL DEFAULT 0;

-- 2. Limpiar cooldowns de pedidos activos que quedaron atascados
--    (provocados por la ausencia de offer_cooldown_triggered antes de migration_v9)
--    Pone wait_until en el pasado para todos los cooldowns aún activos en pedidos
--    que no han sido asignados ni cerrados — los vuelve elegibles en el próximo tick.
UPDATE order_driver_offers
SET    wait_until = NOW() - INTERVAL '1 second'
WHERE  status     IN ('rejected', 'expired', 'released')
  AND  wait_until >  NOW()
  AND  order_id   IN (
    SELECT id FROM orders
    WHERE  driver_id IS NULL
      AND  status NOT IN ('delivered', 'cancelled')
  );

-- También resetear el flag para que el motor no salte la reducción en pedidos huérfanos
UPDATE orders
SET    offer_cooldown_triggered = FALSE
WHERE  driver_id IS NULL
  AND  status NOT IN ('delivered', 'cancelled')
  AND  offer_cooldown_triggered = TRUE;

-- 3. Calcular restaurant_fee_cents para pedidos existentes que no lo tienen
UPDATE orders
SET    restaurant_fee_cents = ROUND(total_cents * 0.10)
WHERE  restaurant_fee_cents = 0
  AND  total_cents > 0
  AND  status NOT IN ('cancelled');
