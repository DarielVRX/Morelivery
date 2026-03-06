import { query } from '../../config/db.js';

export const MAX_ACTIVE_ORDERS_PER_DRIVER = 4;
export const OFFER_TIMEOUT_SECONDS = 60;

/**
 * Define el tamaño del lote según cuántas ofertas ya se hicieron.
 * 1 a 1 hasta que se haya ofertado a 5 conductores.
 * De 5 en 5 hasta que se haya ofertado a 20.
 * De 10 en 10 en adelante.
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
 * Proceso de oferta proactiva (1x1, luego 5, luego 10)
 */
export async function offerNextDrivers(orderId) {
  // 1. Limpiar expirados primero
  await expireTimedOutOffers();

  // 2. Contar cuántos conductores han recibido ya una oferta (sin importar el estado)
  // Esto mantiene la progresión de 1x1 -> 5x5
  const countRes = await query(
    `SELECT COUNT(DISTINCT driver_id)::int as count FROM order_driver_offers WHERE order_id = $1`,
    [orderId]
  );
  const totalOfferedSoFar = countRes.rows[0].count;
  const limit = getBatchSize(totalOfferedSoFar);

  // 3. Buscar candidatos:
  // - Deben estar disponibles (is_available = true)
  // - No deben tener una oferta PENDIENTE actualmente para este pedido
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

  // Si no hay nadie disponible, marcar pedido como pendiente de driver
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
 * Polling del driver: Solo oferta si el driver es elegible y no tiene la oferta ya
 */
export async function offerOrdersToDriver(driverId) {
  const isEligible = await driverIsEligible(driverId);
  if (!isEligible) return 0;

  // IMPORTANTE: Solo mostrar pedidos que NO tengan una oferta pendiente para otros conductores
  // si estamos en la fase 1x1. Para simplificar, el driver "jala" lo que le corresponda.
  
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
    // Validamos si a este driver le toca ver este pedido según la lógica de batch
    const countRes = await query(
      `SELECT COUNT(DISTINCT driver_id)::int as count FROM order_driver_offers WHERE order_id = $1`,
      [row.id]
    );
    const totalOfferedSoFar = countRes.rows[0].count;
    
    // Si ya se ofertó a otros, pero este driver entra en el siguiente "batch", se le permite
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

export async function expireTimedOutOffers() {
  await query(
    `UPDATE order_driver_offers
     SET status = 'expired', updated_at = NOW()
     WHERE status = 'pending'
       AND created_at < NOW() - ($1 || ' seconds')::interval`,
    [OFFER_TIMEOUT_SECONDS]
  );
}
