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

/**
 * Verifica si el repartidor está disponible y tiene espacio para más pedidos.
 *
 */
export async function driverIsEligible(driverId) {
  const result = await query(
    `SELECT 
        dp.is_available,
        (SELECT COUNT(*)::int FROM orders WHERE driver_id = $1 AND status = ANY($2::text[])) as active_count
     FROM driver_profiles dp
     WHERE dp.user_id = $1`,
    [driverId, ACTIVE_DRIVER_STATUSES]
  );

  if (result.rowCount === 0) return false;
  
  const { is_available, active_count } = result.rows[0];
  // Solo es elegible si está marcado como disponible Y no ha superado el límite
  return is_available === true && active_count < MAX_ACTIVE_ORDERS_PER_DRIVER;
}

/**
 * Expira ofertas vencidas.
 *
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
 * Ofrece el pedido a nuevos candidatos disponibles.
 *
 */
export async function offerNextDrivers(orderId) {
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
     WHERE dp.is_available = true -- Solo conductores activos
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
       WHERE order_driver_offers.status IN ('expired', 'rejected')`, // Permite re-ofertar
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

/**
 * Función principal para que el repartidor reciba pedidos.
 *
 */
// En assignment.js (Backend)
export async function offerOrdersToDriver(driverId) {
  const isEligible = await driverIsEligible(driverId);
  if (!isEligible) return 0; // Aquí es donde el backend te bloquea si marcaste "No disponible"

  try { await expireTimedOutOffers(); } catch (_) {}

  const pendingOrders = await query(
    `SELECT o.id
     FROM orders o
     WHERE o.driver_id IS NULL
       AND o.status IN ('created', 'pending_driver', 'preparing', 'ready')
       AND NOT EXISTS (
         SELECT 1 FROM order_driver_offers od
         WHERE od.order_id = o.id 
           AND od.driver_id = $1 
           AND od.status = 'pending' -- Solo ignoramos si ya hay una oferta PENDIENTE
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
       ON CONFLICT(order_id, driver_id) 
       DO UPDATE SET 
          status = 'pending', 
          updated_at = NOW(), 
          created_at = NOW()
       WHERE order_driver_offers.status IN ('expired', 'rejected')`, // Esto permite el re-offer
      [row.id, driverId]
    );
    offered++;
  }
  return offered;
}
