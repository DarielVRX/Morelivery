-- Migration: orders_blocked en users
-- Bloquea solo la creación de pedidos, NO el acceso a la app
-- Desbloqueo manual por admin: UPDATE users SET orders_blocked = false, orders_blocked_reason = null WHERE id = '...';

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS orders_blocked        BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS orders_blocked_reason TEXT    DEFAULT NULL;

COMMENT ON COLUMN users.orders_blocked IS
  'Si true, el usuario no puede crear nuevos pedidos. No afecta el acceso a la app.';
COMMENT ON COLUMN users.orders_blocked_reason IS
  'Razón del bloqueo: late_cancellation, manual, etc.';
