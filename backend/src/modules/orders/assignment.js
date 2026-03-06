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
 * e intenta ofrecer a los siguientes conductores disponibles.
 */
export async function expireTimedOutOffers() {
  const expired = await query(
    `UPDATE order_driver_offers
     SET status = 'expired', updated_at = NOW()
     WHERE status = 'pending'
       AND created_at < NOW() - ($1 || ' seconds')::interval
     RETURNING order_id`,
    [OFFER_TIMEOUT_SECONDS]
  );

  if (expired.rowCount === 0) return;

  const affectedOrderIds = [...new Set(expired.rows.map(r => r.order_id))];

  for (const orderId of affectedOrderIds) {
    const orderCheck = await query(
      `SELECT id FROM orders WHERE id = $1 AND driver_id IS NULL AND status NOT IN ('delivered','cancelled')`,
      [orderId]
    );
    if (orderCheck.rowCount === 0) continue;

    const pending = await query(
      `SELECT COUNT(*)::int AS count FROM order_driver_offers WHERE order_id = $1 AND status = 'pending'`,
      [orderId]
    );

    if (pending.rows[0].count === 0) {
      await offerNextDrivers(orderId);
    }
  }
}

/**
 * Proceso principal para ofrecer un pedido a nuevos candidatos.
 */
export async function offerNextDrivers(orderId) {
  try { await expireTimedOutOffers(); } catch (_) {}

  const offered = await query(
    `SELECT COUNT(*)::int AS count FROM order_driver_offers WHERE order_id = $1`,
    [orderId]
  );
  const offeredCount = offered.rows[0].count;
  const limit = batchSize(offeredCount);

  // Buscamos candidatos que no tengan una oferta 'pending' actualmente
  const candidates = await query(
    `SELECT dp.user_id
     FROM driver_profiles dp
     WHERE dp.is_available = true
       AND NOT EXISTS (
         SELECT 1 FROM order_driver_offers od
         WHERE od.order_id = $1 AND od.driver_id = dp.user_id AND od.status = 'pending'
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
       ON CONFLICT(order_id, driver_id) 
       DO UPDATE SET status = 'pending', updated_at = NOW(), created_at = NOW()
       WHERE order_driver_offers.status IN ('expired', 'rejected')`,
      [orderId, row.user_id]
    );
  }

  if (candidates.rowCount === 0) {
    await query(
      `UPDATE orders SET status = 'pending_driver', updated_at = NOW()
       WHERE id = $1 AND driver_id IS NULL`,
      [orderId]
    );
  } else {
    // Si encontramos nuevos candidatos, aseguramos que el pedido no esté marcado como estancado
    await query(
        `UPDATE orders SET updated_at = NOW() WHERE id = $1 AND status = 'pending_driver'`,
        [orderId]
    );
  }

  return candidates.rowCount;
}

/**
 * Llamado cuando un repartidor consulta por pedidos (polling) o se pone disponible.
 */
export async function offerOrdersToDriver(driverId) {
  const canTake = await driverHasCapacity(driverId);
  if (!canTake) return 0;

  try { await expireTimedOutOffers(); } catch (_) {}

  const pendingOrders = await query(
    `SELECT o.id
     FROM orders o
     WHERE o.driver_id IS NULL
       AND o.status IN ('created', 'pending_driver', 'preparing', 'ready')
       AND NOT EXISTS (
         SELECT 1 FROM order_driver_offers od
         WHERE od.order_id = o.id AND od.driver_id = $1 AND od.status = 'pending'
       )
     ORDER BY 
       CASE WHEN o.status = 'pending_driver' THEN 0 ELSE 1 END,
       o.created_at ASC
     LIMIT 3`,
    [driverId]
  );

  let offered = 0;
  for (const row of pendingOrders.rows) {
    await query(
      `INSERT INTO order_driver_offers(order_id, driver_id, status)
       VALUES($1, $2, 'pending')
       ON CONFLICT(order_id, driver_id) 
       DO UPDATE SET status = 'pending', updated_at = NOW(), created_at = NOW()
       WHERE order_driver_offers.status IN ('expired', 'rejected')`,
      [row.id, driverId]
    );
    offered++;
  }

  return offered;
}

/**
 * Función de rescate proactiva para pedidos que llevan tiempo sin conductor.
 */
export async function retryPendingDriverOrders() {
    const pendingOrders = await query(
      `SELECT id FROM orders 
       WHERE status = 'pending_driver' 
         AND driver_id IS NULL 
         AND updated_at < NOW() - INTERVAL '1 minute'`
    );
  
    for (const order of pendingOrders.rows) {
      await offerNextDrivers(order.id);
    }
}
