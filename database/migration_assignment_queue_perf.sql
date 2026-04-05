-- Optimización de cola de asignación (getQueuedOrders / cooldown checks)

CREATE INDEX IF NOT EXISTS idx_offers_driver_pending_status
  ON order_driver_offers(driver_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_offers_order_driver_cooldown
  ON order_driver_offers(order_id, driver_id, wait_until)
  WHERE status IN ('rejected', 'released', 'expired');

CREATE INDEX IF NOT EXISTS idx_orders_assignment_queue
  ON orders(created_at)
  WHERE driver_id IS NULL
    AND status NOT IN ('delivered', 'cancelled');

CREATE INDEX IF NOT EXISTS idx_orders_driver_status_active_count
  ON orders(driver_id, status)
  WHERE status IN ('assigned', 'accepted', 'preparing', 'ready', 'on_the_way');

CREATE INDEX IF NOT EXISTS idx_offers_order_pending_status
  ON order_driver_offers(order_id)
  WHERE status = 'pending';
