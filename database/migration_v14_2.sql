-- migration_v14.2
-- Snapshot del agradecimiento al momento de la entrega
-- Permite que el cliente pueda editar el tip después pero no bajarlo de este valor

ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_tip_cents INTEGER NOT NULL DEFAULT 0;

-- Poblar para pedidos ya entregados (tip al momento de cerrar = tip actual)
UPDATE orders SET delivered_tip_cents = tip_cents
WHERE  status = 'delivered'
  AND  delivered_tip_cents = 0
  AND  tip_cents > 0;

-- Poblar también restaurant_fee_cents para pedidos sin él (por si no se corrió v14)
UPDATE orders
SET    restaurant_fee_cents = ROUND(total_cents * 0.10)
WHERE  restaurant_fee_cents = 0
  AND  total_cents > 0
  AND  status NOT IN ('cancelled');
