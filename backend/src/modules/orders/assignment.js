import { query } from '../../config/db.js';

export const MAX_ACTIVE_ORDERS_PER_DRIVER = 4;
export const OFFER_TIMEOUT_SECONDS = 60;

/**
 * Lógica de lotes: 1 a 1 hasta 5 intentos fallidos, luego de 5 en 5.
 */
function getBatchSize(attemptsCount) {
  if (attemptsCount < 5) return 1;
  return 5;
}

const ACTIVE_DRIVER_STATUSES = ['assigned', 'accepted', 'preparing', 'ready', 'on_the_way'];

/**
 * Verifica si el conductor tiene espacio para más pedidos.
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
 * EXPIRA Y RE-OFERTA: Esta es la clave del Timeout.
 */
export async function expireTimedOutOffers() {
  // 1. Buscamos y expiramos
  const expired = await query(
    `UPDATE order_driver_offers
     SET status = 'expired', updated_at = NOW()
     WHERE status = 'pending'
       AND created_at < NOW() - ($1 || ' seconds')::interval
     RETURNING order_id`,
    [OFFER_TIMEOUT_SECONDS]
  );

  // 2. Si algo expiró, llamamos a buscar al siguiente driver de inmediato
  if (expired.rowCount > 0) {
    const uniqueOrderIds = [...new Set(expired.rows.map(r => r.order_id))];
    for (const orderId of uniqueOrderIds) {
      // Solo re-ofertamos si el pedido sigue sin dueño
      const orderStillOpen = await query(
        `SELECT id FROM orders WHERE id = $1 AND driver_id IS NULL AND status NOT IN ('delivered', 'cancelled')`,
        [orderId]
      );
      if (orderStillOpen.rowCount > 0) {
        await offerNextDrivers(orderId);
      }
    }
  }
}

/**
 * LÓGICA DE ASIGNACIÓN SECUENCIAL
 */
export async function offerNextDrivers(orderId) {
  // Limpieza inicial
  await expireTimedOutOffers();

  // 1. ¿Cuántos intentos fallidos van (Rechazados, Expirados, Liberados)?
  // Esto define el "puntero" de la secuencia para no repetir conductores.
  const history = await query(
    `SELECT COUNT(*)::int as count FROM order_driver_offers 
     WHERE order_id = $1 AND status IN ('expired', 'rejected', 'released')`,
    [orderId]
  );
  const attempts = history.rows[0].count;
  const limit = getBatchSize(attempts);

  // 2. ¿Hay una oferta PENDIENTE actualmente?
  const currentPending = await query(
    `SELECT 1 FROM order_driver_offers WHERE order_id = $1 AND status = 'pending'`,
    [orderId]
  );

  // Si es fase 1x1 y ya hay uno esperando, NO saltar al siguiente todavía.
  if (limit === 1 && currentPending.rowCount > 0) return 0;

  // 3. Buscar candidatos que NO tengan historial previo en este pedido
  // Esto evita que vuelva a Driver 1 si Driver 1 ya rechazó o expiró.
  const candidates = await query(
    `SELECT dp.user_id
     FROM driver_profiles dp
     WHERE dp.is_available = true
       AND NOT EXISTS (
         SELECT 1 FROM order_driver_offers od
         WHERE od.order_id = $1 AND od.driver_id = dp.user_id
         AND od.status IN ('pending', 'rejected', 'expired', 'accepted', 'released')
       )
       AND (
         SELECT COUNT(*)::int FROM orders o
         WHERE o.driver_id = dp.user_id AND o.status = ANY($3::text[])
       ) < $4
     ORDER BY dp.driver_number ASC
     LIMIT $2`,
    [orderId, limit, ACTIVE_DRIVER_STATUSES, MAX_ACTIVE_ORDERS_PER_DRIVER]
  );

  // --- LÓGICA DE REINICIO ---
  // Si no hay candidatos nuevos Y no hay nadie pendiente, REINICIAMOS el ciclo
  if (candidates.rowCount === 0 && currentPending.rowCount === 0) {
    console.log(`[REINICIO] Sin conductores nuevos para pedido ${orderId}. Reiniciando ciclo...`);
    
    // Borramos el historial de ofertas para este pedido para que el NOT EXISTS no los bloquee
    await query(
      `DELETE FROM order_driver_offers WHERE order_id = $1 AND status IN ('expired', 'rejected')`,
      [orderId]
    );

    // Intentamos buscar de nuevo (ahora la tabla está limpia)
    candidates = await query(
      `SELECT dp.user_id FROM driver_profiles dp
       WHERE dp.is_available = true
       ORDER BY dp.driver_number ASC LIMIT $1`,
      [limit]
    );
  }

  // 4. Insertar las nuevas ofertas
  for (const row of candidates.rows) {
    await query(
      `INSERT INTO order_driver_offers(order_id, driver_id, status)
       VALUES($1, $2, 'pending')
       ON CONFLICT(order_id, driver_id) 
       DO UPDATE SET status = 'pending', created_at = NOW(), updated_at = NOW()`,
      [orderId, row.user_id]
    );
  }

  // Si es un pedido nuevo y no hay nadie, marcar estado
  if (candidates.rowCount === 0 && attempts === 0 && currentPending.rowCount === 0) {
    await query(`UPDATE orders SET status = 'pending_driver' WHERE id = $1`, [orderId]);
  }

  return candidates.rowCount;
}

/**
 * Listener/Polling del Driver
 */
export async function offerOrdersToDriver(driverId) {
  const isEligible = await driverIsEligible(driverId);
  if (!isEligible) return 0;

  await expireTimedOutOffers();

  const pendingOrders = await query(
    `SELECT o.id FROM orders o
     WHERE o.driver_id IS NULL
       AND o.status IN ('created', 'pending_driver', 'preparing', 'ready')
     ORDER BY o.created_at ASC LIMIT 3`
  );

  let offered = 0;
  for (const row of pendingOrders.rows) {
    const ok = await offerNextDrivers(row.id);
    if (ok > 0) offered++;
  }
  return offered;
}
