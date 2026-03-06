-- migration_v7.sql
-- Correcciones: índices de rendimiento y ajuste de upsert en ofertas

-- ── Índice parcial en orders.status ─────────────────────────────────────────
-- Acelera las queries frecuentes de offerNextDrivers, offerOrdersToDriver y
-- el dashboard admin que filtran por status excluyendo estados terminales.
CREATE INDEX IF NOT EXISTS idx_orders_status_active
  ON orders(status)
  WHERE status NOT IN ('delivered', 'cancelled');

-- ── Índice en orders.driver_id ───────────────────────────────────────────────
-- Acelera el conteo de pedidos activos por driver (usado en cada ciclo de asignación).
CREATE INDEX IF NOT EXISTS idx_orders_driver_id
  ON orders(driver_id)
  WHERE driver_id IS NOT NULL;

-- ── Índice en order_driver_offers (order_id, status) ────────────────────────
-- Acelera la query de ofertas pendientes por pedido (re-entrada check en offerNextDrivers).
CREATE INDEX IF NOT EXISTS idx_offers_order_status
  ON order_driver_offers(order_id, status);
