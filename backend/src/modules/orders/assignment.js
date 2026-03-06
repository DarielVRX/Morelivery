import { query } from '../../config/db.js';

export const MAX_ACTIVE_ORDERS_PER_DRIVER = 4;
export const OFFER_TIMEOUT_SECONDS = 60;

/**
 * Mantiene la progresión: 1 a 1 hasta que se haya intentado con 5 conductores distintos.
 */
function getBatchSize(totalOfferedSoFar) {
  if (totalOfferedSoFar < 5) return 1;
  if (totalOfferedSoFar < 20) return 5;
  return 10;
}

const ACTIVE_DRIVER_STATUSES = ['assigned', 'accepted', 'preparing', 'ready', 'on_the_way'];

/**
 * Verifica disponibilidad y capacidad (Máximo 4 pedidos activos)
 */
export async function driverIsEligible(driverId) {
  const result = await query(
    `SELECT dp.is_available,
        (SELECT COUNT(*)::int FROM orders WHERE driver_id = $1 AND status = ANY($2::text[])) as active_count
     FROM driver_profiles dp
     WHERE dp.user_id = $1`,
    [driverId, ACTIVE_DRIVER_STATUSES]
  );
  if (result.rowCount === 0) return false;
  const { is_available, active_count } = result.rows[0];
  return is_available === true && active_count < MAX_ACTIVE_ORDERS_PER_DRIVER;
}

/**
 * Expira ofertas y RE-OFERTA automáticamente si el pedido quedó sin candidatos pendientes.
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

  const uniqueOrderIds = [...new Set(expired.rows.map(r => r.order_id))];
  for (const orderId of uniqueOrderIds) {
    const orderCheck = await query(
      `SELECT id FROM orders WHERE id = $1 AND driver_id IS NULL AND status NOT IN ('delivered','cancelled')`,
      [orderId]
    );
    if (orderCheck.rowCount > 0) {
      await offerNextDrivers(orderId);
    }
  }
}

/**
 * Lógica principal de asignación (1x1 -> 5x5)
 */
export async function offerNextDrivers(orderId) {
  await expireTimedOutOffers();

  // 1. ¿Hay alguien con una oferta PENDIENTE ahora mismo?
  const currentPending = await query(
    `SELECT COUNT(*)::int as count FROM order_driver_offers WHERE order_id = $1 AND status = 'pending'`,
    [orderId]
  );

  // 2. ¿A cuántos conductores DISTINTOS les hemos mostrado ya este pedido?
  const countRes = await query(
    `SELECT COUNT(DISTINCT driver_id)::int as count FROM order_driver_offers WHERE order_id = $1`,
    [orderId]
  );
  
  const totalOfferedSoFar = countRes.rows[0].count;
  const limit = getBatchSize(totalOfferedSoFar);

  // SI ES 1x1 Y YA HAY ALGUIEN PENDIENTE, NO HACEMOS NADA (Seguridad total)
  if (limit === 1 && currentPending.rows[0].count > 0) return 0;

  // 3. Buscar candidatos que no hayan rechazado NI tengan ofertas pendientes
  const candidates = await query(
    `SELECT dp.user_id
     FROM driver_profiles dp
     WHERE dp.is_available = true
       AND NOT EXISTS (
         SELECT 1 FROM order_driver_offers od
         WHERE od.order_id = $1 AND od.driver_id = dp.user_id 
         AND od.status IN ('pending', 'rejected') 
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
       WHERE order_driver_offers.status IN ('expired', 'released', 'accepted')`,
      [orderId, row.user_id]
    );
  }

  if (candidates.rowCount === 0 && totalOfferedSoFar === 0) {
    await query(
      `UPDATE orders SET status = 'pending_driver', updated_at = NOW() 
       WHERE id = $1 AND driver_id IS NULL`,
      [orderId]
    );
  }
  return candidates.rowCount;
}

/**
 * Polling/Listener del driver
 */
export async function offerOrdersToDriver(driverId) {
  const isEligible = await driverIsEligible(driverId);
  if (!isEligible) return 0;

  await expireTimedOutOffers();

  // Buscar pedidos sin driver
  const pendingOrders = await query(
    `SELECT o.id FROM orders o
     WHERE o.driver_id IS NULL
       AND o.status IN ('created', 'pending_driver', 'preparing', 'ready')
     ORDER BY o.created_at ASC LIMIT 3`
  );

  let offeredCount = 0;
  for (const row of pendingOrders.rows) {
    // Intentamos ofrecer siguiendo la lógica de turnos
    const success = await offerNextDrivers(row.id);
    if (success > 0) offeredCount++;
  }
  return offeredCount;
}
