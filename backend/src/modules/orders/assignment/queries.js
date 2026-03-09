// backend/src/modules/orders/assignment/queries.js
// Capa de acceso a datos. Sin lógica de negocio.
import { query } from '../../../config/db.js';
import { ACTIVE_STATUSES, MAX_ACTIVE_ORDERS_PER_DRIVER, OFFER_TIMEOUT_SECONDS } from './constants.js';

// ─── Pedidos ──────────────────────────────────────────────────────────────────

/** Pedido abierto sin driver asignado */
export async function getOpenOrder(orderId) {
  const r = await query(
    `SELECT id, created_at FROM orders
     WHERE id=$1 AND driver_id IS NULL
       AND status NOT IN ('delivered','cancelled')`,
    [orderId]
  );
  return r.rows[0] ?? null;
}

/**
 * Cola de pedidos abiertos, ordenada con prioridad:
 *   1. Pedidos con candidatos disponibles (sin cooldown para todos)
 *   2. Pedidos sin candidatos (todos en cooldown)
 * Dentro de cada grupo: created_at ASC
 */
export async function getQueuedOrders(driverId = null) {
  // Todos los pedidos abiertos sin oferta pending activa
  const r = await query(
    `SELECT o.id, o.created_at,
            -- ¿Tiene al menos un driver disponible sin cooldown para este pedido?
            EXISTS (
              SELECT 1 FROM driver_profiles dp
              JOIN users u ON u.id = dp.user_id
              WHERE dp.is_available = true AND u.status = 'active'
                AND (SELECT COUNT(*) FROM orders oo
                     WHERE oo.driver_id=dp.user_id AND oo.status=ANY($1::text[])
                    ) < $2
                AND NOT EXISTS (
                  SELECT 1 FROM order_driver_offers od2
                  WHERE od2.driver_id=dp.user_id AND od2.status='pending')
                AND NOT EXISTS (
                  SELECT 1 FROM order_driver_offers od3
                  WHERE od3.order_id=o.id AND od3.driver_id=dp.user_id
                    AND od3.status IN ('rejected','released','expired')
                    AND od3.wait_until > NOW())
            ) AS has_candidates
     FROM orders o
     WHERE o.driver_id IS NULL
       AND o.status NOT IN ('delivered','cancelled')
       AND NOT EXISTS (
         SELECT 1 FROM order_driver_offers od
         WHERE od.order_id=o.id AND od.status='pending')
     ORDER BY has_candidates DESC, o.created_at ASC`,
    [ACTIVE_STATUSES, MAX_ACTIVE_ORDERS_PER_DRIVER]
  );
  return r.rows; // [{id, created_at, has_candidates}]
}


/**
 * El primer pedido disponible para un driver específico.
 * "Disponible" = 
 *   - Pedido sin driver asignado
 *   - Sin oferta pending activa (ni para este driver ni de otro — libre para ofrecer)
 *   - El driver no tiene cooldown para este pedido
 *   - El driver no lo ha aceptado ya
 *   - El driver no tiene ya una pending offer activa en ningún pedido
 *
 * Prioridad: pedidos con has_candidates=true primero (los más "urgentes"),
 *            luego por created_at ASC.
 */
export async function getFirstAvailableOrderForDriver(driverId) {
  const r = await query(
    `SELECT o.id, o.created_at,
            NOT EXISTS (
              SELECT 1 FROM order_driver_offers od
              WHERE od.order_id=o.id AND od.status IN ('rejected','released','expired')
                AND od.wait_until > NOW()
            ) AS has_candidates
     FROM orders o
     WHERE o.driver_id IS NULL
       AND o.status NOT IN ('delivered','cancelled')
       -- Sin oferta pending activa para ningún driver (el pedido está libre)
       AND NOT EXISTS (
         SELECT 1 FROM order_driver_offers od
         WHERE od.order_id=o.id AND od.status='pending')
       -- El driver no tiene cooldown para este pedido
       AND NOT EXISTS (
         SELECT 1 FROM order_driver_offers od
         WHERE od.order_id=o.id AND od.driver_id=$1
           AND od.status IN ('rejected','released','expired')
           AND od.wait_until > NOW())
       -- El driver no lo aceptó ya
       AND NOT EXISTS (
         SELECT 1 FROM order_driver_offers od
         WHERE od.order_id=o.id AND od.driver_id=$1 AND od.status='accepted')
       -- El driver no tiene ya una pending offer activa en otro pedido
       AND NOT EXISTS (
         SELECT 1 FROM order_driver_offers od
         WHERE od.driver_id=$1 AND od.status='pending')
       -- El driver está bajo el límite de capacidad
       AND (SELECT COUNT(*) FROM orders oo
            WHERE oo.driver_id=$1 AND oo.status=ANY($2::text[])
           ) < $3
     ORDER BY
       -- Pedidos sin ningún cooldown activo (más urgentes) primero
       has_candidates DESC,
       o.created_at ASC
     LIMIT 1`,
    [driverId, ACTIVE_STATUSES, MAX_ACTIVE_ORDERS_PER_DRIVER]
  );
  return r.rows[0] ?? null;
}
/** Marca el pedido como pending_driver si sigue sin driver */
export async function markPendingDriver(orderId) {
  await query(
    `UPDATE orders SET status='pending_driver', updated_at=NOW()
     WHERE id=$1 AND driver_id IS NULL`,
    [orderId]
  );
}

/** Asigna el driver con FOR UPDATE SKIP LOCKED para evitar doble asignación */
export async function assignDriverToOrder(orderId, driverId) {
  const r = await query(
    `WITH lock AS (
       SELECT id FROM orders
       WHERE id=$1 AND driver_id IS NULL
         AND status NOT IN ('delivered','cancelled')
       FOR UPDATE SKIP LOCKED
     )
     UPDATE orders SET driver_id=$2, status='assigned', updated_at=NOW()
     FROM lock WHERE orders.id=lock.id RETURNING orders.id`,
    [orderId, driverId]
  );
  return r.rowCount > 0;
}

/** Desasigna el driver y vuelve a pending_driver */
export async function unassignDriverFromOrder(orderId, driverId) {
  await query(
    `UPDATE orders SET driver_id=NULL, status='pending_driver', updated_at=NOW()
     WHERE id=$1 AND driver_id=$2`,
    [orderId, driverId]
  );
}

// ─── Ofertas ──────────────────────────────────────────────────────────────────

/** ¿Cuántos drivers únicos rechazaron/expiraron/liberaron este pedido? (determina la ronda) */
export async function getOfferRound(orderId) {
  const r = await query(
    `SELECT COUNT(DISTINCT driver_id)::int AS n
     FROM order_driver_offers
     WHERE order_id=$1 AND status IN ('rejected','expired','released')`,
    [orderId]
  );
  return r.rows[0]?.n ?? 0;
}

/** Todos los drivers disponibles para este pedido, ordenados por driver_number ASC */
export async function getEligibleDrivers(orderId) {
  const r = await query(
    `SELECT dp.user_id, dp.driver_number
     FROM driver_profiles dp
     JOIN users u ON u.id = dp.user_id
     WHERE dp.is_available = true
       AND u.status = 'active'
       -- Bajo el límite de capacidad
       AND (SELECT COUNT(*) FROM orders o
            WHERE o.driver_id=dp.user_id AND o.status=ANY($1::text[])
           ) < $2
       -- No ya aceptó este pedido
       AND NOT EXISTS (
         SELECT 1 FROM order_driver_offers od
         WHERE od.order_id=$3 AND od.driver_id=dp.user_id AND od.status='accepted')
       -- Sin cooldown activo para este pedido
       AND NOT EXISTS (
         SELECT 1 FROM order_driver_offers od
         WHERE od.order_id=$3 AND od.driver_id=dp.user_id
           AND od.status IN ('rejected','released','expired')
           AND od.wait_until > NOW())
     ORDER BY dp.driver_number ASC`,
    [ACTIVE_STATUSES, MAX_ACTIVE_ORDERS_PER_DRIVER, orderId]
  );
  return r.rows; // [{user_id, driver_number}]
}

/**
 * Drivers elegibles que ADEMÁS no tienen oferta pending en ningún pedido.
 * Para ronda 1-5 (batch=1): solo estos pueden recibir oferta inmediata.
 */
export async function getEligibleIdleDrivers(orderId) {
  const r = await query(
    `SELECT dp.user_id, dp.driver_number
     FROM driver_profiles dp
     JOIN users u ON u.id = dp.user_id
     WHERE dp.is_available = true
       AND u.status = 'active'
       AND (SELECT COUNT(*) FROM orders o
            WHERE o.driver_id=dp.user_id AND o.status=ANY($1::text[])
           ) < $2
       AND NOT EXISTS (
         SELECT 1 FROM order_driver_offers od
         WHERE od.order_id=$3 AND od.driver_id=dp.user_id AND od.status='accepted')
       AND NOT EXISTS (
         SELECT 1 FROM order_driver_offers od
         WHERE od.order_id=$3 AND od.driver_id=dp.user_id
           AND od.status IN ('rejected','released','expired')
           AND od.wait_until > NOW())
       -- Sin oferta pending en NINGÚN pedido (libre para recibir)
       AND NOT EXISTS (
         SELECT 1 FROM order_driver_offers od
         WHERE od.driver_id=dp.user_id AND od.status='pending')
     ORDER BY dp.driver_number ASC`,
    [ACTIVE_STATUSES, MAX_ACTIVE_ORDERS_PER_DRIVER, orderId]
  );
  return r.rows;
}

/** ¿El driver tiene oferta pending activa? */
export async function driverHasPendingOffer(driverId) {
  const r = await query(
    `SELECT 1 FROM order_driver_offers WHERE driver_id=$1 AND status='pending' LIMIT 1`,
    [driverId]
  );
  return r.rowCount > 0;
}

/** ¿Hay oferta pending para este pedido? */
export async function getPendingOffer(orderId) {
  const r = await query(
    `SELECT driver_id FROM order_driver_offers
     WHERE order_id=$1 AND status='pending' LIMIT 1`,
    [orderId]
  );
  return r.rows[0] ?? null;
}

/** Upsert a pending — inserta o actualiza a pending con wait_until=NULL */
export async function upsertPendingOffer(orderId, driverId) {
  await query(
    `INSERT INTO order_driver_offers(order_id,driver_id,status,wait_until)
     VALUES($1,$2,'pending',NULL)
     ON CONFLICT(order_id,driver_id)
     DO UPDATE SET status='pending', updated_at=NOW(), wait_until=NULL`,
    [orderId, driverId]
  );
}

export async function acceptPendingOffer(orderId, driverId) {
  await query(
    `UPDATE order_driver_offers SET status='accepted', updated_at=NOW()
     WHERE order_id=$1 AND driver_id=$2`,
    [orderId, driverId]
  );
}

/** Expira las otras ofertas pending del mismo pedido (tras una aceptación) */
export async function expireCompetingOffers(orderId, acceptedDriverId) {
  await query(
    `UPDATE order_driver_offers SET status='expired', updated_at=NOW()
     WHERE order_id=$1 AND driver_id<>$2 AND status='pending'`,
    [orderId, acceptedDriverId]
  );
}

/** Rechaza la oferta de un driver con cooldown */
export async function rejectDriverOffer(orderId, driverId, cooldownSecs) {
  await query(
    `UPDATE order_driver_offers
     SET status='rejected', wait_until=NOW()+($3*INTERVAL '1 second'), updated_at=NOW()
     WHERE order_id=$1 AND driver_id=$2 AND status='pending'`,
    [orderId, driverId, cooldownSecs]
  );
}

/** Marca una oferta como released con cooldown (el driver libera el pedido ya asignado) */
export async function releaseDriverOffer(orderId, driverId, cooldownSecs) {
  await query(
    `UPDATE order_driver_offers
     SET status='released', wait_until=NOW()+($3*INTERVAL '1 second'), updated_at=NOW()
     WHERE order_id=$1 AND driver_id=$2`,
    [cooldownSecs, orderId, driverId]
  );
}

/** Expira todas las ofertas pending activas del driver (excepto una orden opcional). Devuelve order_ids. */
export async function expireAllPendingForDriver(driverId, exceptOrderId = null) {
  const r = await query(
    `UPDATE order_driver_offers SET status='expired', updated_at=NOW()
     WHERE driver_id=$1 AND status='pending'
       AND ($2::uuid IS NULL OR order_id<>$2)
     RETURNING order_id`,
    [driverId, exceptOrderId]
  );
  return r.rows.map(r => r.order_id);
}

/**
 * Expira ofertas timeout y aplica cooldown.
 * Devuelve [{order_id, driver_id}].
 */
export async function expireTimedOutOffersInDB(timeoutSecs, cooldownSecs) {
  const r = await query(
    `UPDATE order_driver_offers
     SET status='expired',
         wait_until=NOW()+($2::int*INTERVAL '1 second'),
         updated_at=NOW()
     WHERE status='pending'
       AND updated_at < NOW()-($1::int*INTERVAL '1 second')
     RETURNING order_id, driver_id`,
    [timeoutSecs, cooldownSecs]
  );
  return r.rows;
}

// ─── Perfil driver ────────────────────────────────────────────────────────────

export async function getDriverProfile(driverId) {
  const r = await query(
    `SELECT dp.is_available,
            (SELECT COUNT(*)::int FROM orders o
             WHERE o.driver_id=$1 AND o.status=ANY($2::text[])) AS active_count
     FROM driver_profiles dp WHERE dp.user_id=$1`,
    [driverId, ACTIVE_STATUSES]
  );
  return r.rows[0] ?? null;
}

// ─── SSE payload ──────────────────────────────────────────────────────────────

export async function getOfferPayload(orderId, driverId) {
  const r = await query(
    `SELECT o.id,
            o.total_cents, o.service_fee_cents, o.delivery_fee_cents, o.tip_cents,
            o.payment_method,
            r.name    AS restaurant_name,
            r.address AS restaurant_address,
            o.delivery_address AS customer_address,
            GREATEST(0, EXTRACT(EPOCH FROM (
              od.updated_at + ($3::int * INTERVAL '1 second') - NOW()
            )))::int AS seconds_left
     FROM orders o
     JOIN restaurants r ON r.id=o.restaurant_id
     JOIN order_driver_offers od ON od.order_id=o.id AND od.driver_id=$2
     WHERE o.id=$1`,
    [orderId, driverId, OFFER_TIMEOUT_SECONDS]
  );
  return r.rows[0] ?? null;
}

/** Pedidos sin conductor para el panel "en espera" del driver (con su cooldown) */
export async function getPendingAssignmentOrders(driverId) {
  const r = await query(
    `SELECT o.id, o.status, o.total_cents, o.service_fee_cents, o.delivery_fee_cents,
            o.tip_cents, o.payment_method, o.created_at,
            r.name AS restaurant_name, r.address AS restaurant_address,
            o.delivery_address AS customer_address,
            -- segundos de cooldown restante para este driver en este pedido
            GREATEST(0, EXTRACT(EPOCH FROM (
              od.wait_until - NOW()
            )))::int AS cooldown_secs
     FROM orders o
     JOIN restaurants r ON r.id=o.restaurant_id
     LEFT JOIN order_driver_offers od
       ON od.order_id=o.id AND od.driver_id=$1
          AND od.status IN ('rejected','released','expired')
          AND od.wait_until > NOW()
     WHERE o.driver_id IS NULL
       AND o.status IN ('created','pending_driver')
       AND NOT EXISTS (
         SELECT 1 FROM order_driver_offers od2
         WHERE od2.order_id=o.id AND od2.driver_id=$1 AND od2.status='pending'
       )
     ORDER BY o.created_at ASC
     LIMIT 20`,
    [driverId]
  );
  return r.rows;
}
