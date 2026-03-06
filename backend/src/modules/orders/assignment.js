import { query } from '../../config/db.js';

export const MAX_ACTIVE_ORDERS_PER_DRIVER = 4;
export const OFFER_TIMEOUT_SECONDS = 60;

/**
 * Mantiene la progresión: 1x1 hasta 5 intentos, luego lotes de 5.
 */
function getBatchSize(totalOfferedSoFar) {
  if (totalOfferedSoFar < 5) return 1;
  if (totalOfferedSoFar < 20) return 5;
  return 10;
}

const ACTIVE_DRIVER_STATUSES = ['assigned', 'accepted', 'preparing', 'ready', 'on_the_way'];

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

  // Si hubo expiraciones, intentamos ofrecer a los siguientes conductores para esos pedidos
  const uniqueOrderIds = [...new Set(expired.rows.map(r => r.order_id))];
  for (const orderId of uniqueOrderIds) {
    // Solo re-ofertamos si el pedido sigue buscando driver
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
 * Lógica principal de asignación proactiva.
 */
export async function offerNextDrivers(orderId) {
  // 1. Limpieza de seguridad
  await expireTimedOutOffers();

  // 2. Cálculo de lote basado en historial total de intentos
  const countRes = await query(
    `SELECT COUNT(DISTINCT driver_id)::int as count FROM order_driver_offers WHERE order_id = $1`,
    [orderId]
  );
  const totalOfferedSoFar = countRes.rows[0].count;
  const limit = getBatchSize(totalOfferedSoFar);

  // 3. Buscar candidatos disponibles que no tengan una oferta pendiente actual
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
       WHERE order_driver_offers.status IN ('expired', 'rejected', 'released', 'accepted')`,
      [orderId, row.user_id]
    );
  }

  // Si el pedido es nuevo (totalOfferedSoFar === 0) y no hay nadie, marcar estado
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
 * Lógica para cuando el Driver entra a la App o hace pull-to-refresh.
 */
export async function offerOrdersToDriver(driverId) {
  const isEligible = await driverIsEligible(driverId);
  if (!isEligible) return 0;

  await expireTimedOutOffers();

  const pendingOrders = await query(
    `SELECT o.id
     FROM orders o
     WHERE o.driver_id IS NULL
       AND o.status IN ('created', 'pending_driver', 'preparing', 'ready')
       AND NOT EXISTS (
         SELECT 1 FROM order_driver_offers od
         WHERE od.order_id = o.id AND od.driver_id = $1 AND od.status = 'pending'
       )
     ORDER BY o.created_at ASC
     LIMIT 3`,
    [driverId]
  );

  let offered = 0;
  for (const row of pendingOrders.rows) {
    // Antes de insertar, verificamos si por driver_number le toca entrar en el lote actual
    const countRes = await query(
      `SELECT COUNT(DISTINCT driver_id)::int as count FROM order_driver_offers WHERE order_id = $1`,
      [row.id]
    );
    const totalOfferedSoFar = countRes.rows[0].count;

    // Aquí permitimos que el driver "vea" el pedido si cumple con los estados de re-ciclo
    const result = await query(
      `INSERT INTO order_driver_offers(order_id, driver_id, status)
       VALUES($1, $2, 'pending')
       ON CONFLICT(order_id, driver_id) 
       DO UPDATE SET status = 'pending', updated_at = NOW(), created_at = NOW()
       WHERE order_driver_offers.status IN ('expired', 'rejected', 'released', 'accepted')
       RETURNING id`,
      [row.id, driverId]
    );
    
    if (result.rowCount > 0) offered++;
  }
  return offered;
}
