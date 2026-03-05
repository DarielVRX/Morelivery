import { query } from '../../config/db.js';

export const MAX_ACTIVE_ORDERS_PER_DRIVER = 4;
export const OFFER_TIMEOUT_SECONDS = 60;

function batchSize(offeredCount) {
  if (offeredCount < 5) return 1;
  if (offeredCount < 10) return 5;
  if (offeredCount < 20) return 10;
  return 10;
}

const ACTIVE_DRIVER_STATUSES = ['assigned', 'accepted', 'preparing', 'ready', 'on_the_way'];

export async function driverHasCapacity(driverId) {
  const result = await query(
    `SELECT COUNT(*)::int AS count FROM orders
     WHERE driver_id = $1 AND status = ANY($2::text[])`,
    [driverId, ACTIVE_DRIVER_STATUSES]
  );
  return result.rows[0].count < MAX_ACTIVE_ORDERS_PER_DRIVER;
}

/**
 * Expira ofertas que llevan más de OFFER_TIMEOUT_SECONDS sin respuesta
 * y re-ofrece a los siguientes drivers disponibles.
 * Se llama desde /drivers/listener (cuando el driver hace polling)
 * y desde offerNextDrivers.
 */
export async function expireTimedOutOffers() {
  // Marcar como expiradas las ofertas pendientes que superaron el timeout
  const expired = await query(
    `UPDATE order_driver_offers
     SET status = 'expired', updated_at = NOW()
     WHERE status = 'pending'
       AND created_at < NOW() - ($1 || ' seconds')::interval
     RETURNING order_id`,
    [OFFER_TIMEOUT_SECONDS]
  );

  if (expired.rowCount === 0) return;

  // Para cada pedido afectado, verificar si tiene ofertas pendientes restantes
  const affectedOrderIds = [...new Set(expired.rows.map(r => r.order_id))];

  for (const orderId of affectedOrderIds) {
    // Verificar que el pedido siga sin asignar
    const orderCheck = await query(
      `SELECT id FROM orders WHERE id = $1 AND driver_id IS NULL AND status NOT IN ('delivered','cancelled')`,
      [orderId]
    );
    if (orderCheck.rowCount === 0) continue;

    // Contar ofertas pending restantes para este pedido
    const pending = await query(
      `SELECT COUNT(*)::int AS count FROM order_driver_offers WHERE order_id = $1 AND status = 'pending'`,
      [orderId]
    );

    // Si no quedan pendientes, ofrecer al siguiente grupo
    if (pending.rows[0].count === 0) {
      await offerNextDrivers(orderId);
    }
  }
}

export async function offerNextDrivers(orderId) {
  // Expirar ofertas vencidas antes de hacer nuevas
  try { await expireTimedOutOffers(); } catch (_) {}

  const offered = await query(
    `SELECT COUNT(*)::int AS count FROM order_driver_offers WHERE order_id = $1`,
    [orderId]
  );
  const offeredCount = offered.rows[0].count;
  const limit = batchSize(offeredCount);

  const candidates = await query(
    `SELECT dp.user_id
     FROM driver_profiles dp
     WHERE dp.is_available = true
       AND NOT EXISTS (
         SELECT 1 FROM order_driver_offers od
         WHERE od.order_id = $1 AND od.driver_id = dp.user_id
       )
       AND (
         SELECT COUNT(*)::int FROM orders o
         WHERE o.driver_id = dp.user_id AND o.status = ANY($3::text[])
       ) < $4
     ORDER BY dp.driver_number ASC
     LIMIT $2`,
    [orderId, limit, ACTIVE_DRIVER_STATUSES, MAX_ACTIVE_ORDERS_PER_DRIVER]
  );

  for (const row of candidates.rows) {
    await query(
      `INSERT INTO order_driver_offers(order_id, driver_id, status)
       VALUES($1, $2, 'pending')
       ON CONFLICT(order_id, driver_id) DO NOTHING`,
      [orderId, row.user_id]
    );
  }

  if (candidates.rowCount === 0) {
    await query(
      `UPDATE orders SET status = 'pending_driver', updated_at = NOW()
       WHERE id = $1 AND driver_id IS NULL`,
      [orderId]
    );
  }

  return candidates.rowCount;
}

export async function offerOrdersToDriver(driverId) {
  const canTake = await driverHasCapacity(driverId);
  if (!canTake) return 0;

  // También expirar ofertas vencidas al conectarse un driver
  try { await expireTimedOutOffers(); } catch (_) {}

  const pendingOrders = await query(
    `SELECT o.id
     FROM orders o
     WHERE o.driver_id IS NULL
       AND o.status IN ('created', 'pending_driver', 'ready')
       AND NOT EXISTS (
         SELECT 1 FROM order_driver_offers od
         WHERE od.order_id = o.id AND od.driver_id = $1
       )
     ORDER BY o.created_at ASC
     LIMIT 3`,
    [driverId]
  );

  let offered = 0;
  for (const row of pendingOrders.rows) {
    await query(
      `INSERT INTO order_driver_offers(order_id, driver_id, status)
       VALUES($1, $2, 'pending')
       ON CONFLICT(order_id, driver_id) DO NOTHING`,
      [row.id, driverId, ]
    );
    offered++;
  }

  return offered;
}
