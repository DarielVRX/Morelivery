// backend/src/modules/orders/assignment/queries.js
// ─────────────────────────────────────────────────────────────────────────────
// Capa de acceso a datos para el motor de asignación.
// Todas las queries SQL en un solo lugar → más fácil de depurar y modificar.
// Ninguna lógica de negocio aquí: solo leer/escribir DB.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '../../../config/db.js';
import { ACTIVE_STATUSES, MAX_ACTIVE_ORDERS_PER_DRIVER, OFFER_TIMEOUT_SECONDS } from './constants.js';

// ─── Pedidos ──────────────────────────────────────────────────────────────────

/** Devuelve la fila del pedido si sigue sin driver y no está terminado */
export async function getOpenOrder(orderId) {
  const r = await query(
    `SELECT id, offer_cooldown_triggered
     FROM orders
     WHERE id = $1
       AND driver_id IS NULL
       AND status NOT IN ('delivered','cancelled')`,
    [orderId]
  );
  return r.rows[0] ?? null;
}

/** Pedidos abiertos sin oferta pending activa */
export async function getOpenOrdersWithoutPendingOffer(limit = 5) {
  const r = await query(
    `SELECT id, status
     FROM orders
     WHERE driver_id IS NULL
       AND status IN ('created','pending_driver','preparing','ready')
       AND NOT EXISTS (
         SELECT 1 FROM order_driver_offers od
         WHERE od.order_id = orders.id AND od.status = 'pending'
       )
     ORDER BY created_at ASC
     LIMIT $1`,
    [limit]
  );
  return r.rows;
}

/** Marca el pedido como pending_driver */
export async function markPendingDriver(orderId) {
  await query(
    `UPDATE orders SET status='pending_driver', updated_at=NOW()
     WHERE id=$1 AND driver_id IS NULL`,
    [orderId]
  );
}

/** Activa el flag de cooldown_triggered (solo la primera vez) */
export async function setCooldownTriggered(orderId, value) {
  await query(
    `UPDATE orders SET offer_cooldown_triggered=$2, updated_at=NOW() WHERE id=$1`,
    [orderId, value]
  );
}

/** Asigna el driver al pedido con un FOR UPDATE SKIP LOCKED para evitar doble asignación */
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

/** Libera el driver de un pedido y lo vuelve a pending_driver */
export async function unassignDriverFromOrder(orderId, driverId) {
  await query(
    `UPDATE orders SET driver_id=NULL, status='pending_driver', updated_at=NOW()
     WHERE id=$1 AND driver_id=$2`,
    [orderId, driverId]
  );
}

// ─── Ofertas ──────────────────────────────────────────────────────────────────

/** ¿Hay una oferta pending para este pedido? */
export async function getPendingOffer(orderId) {
  const r = await query(
    `SELECT driver_id FROM order_driver_offers
     WHERE order_id=$1 AND status='pending' LIMIT 1`,
    [orderId]
  );
  return r.rows[0] ?? null;
}

/** ¿Tiene el driver alguna oferta pending en cualquier pedido? */
export async function driverHasPendingOffer(driverId) {
  const r = await query(
    `SELECT 1 FROM order_driver_offers WHERE driver_id=$1 AND status='pending' LIMIT 1`,
    [driverId]
  );
  return r.rowCount > 0;
}

/** Cuántos pedidos se han ofrecido a este pedido ya (para calcular la ronda) */
export async function getOfferRoundCount(orderId) {
  const r = await query(
    `SELECT COUNT(DISTINCT driver_id)::int AS n
     FROM order_driver_offers
     WHERE order_id=$1 AND status IN ('rejected','expired','released')`,
    [orderId]
  );
  return r.rows[0]?.n ?? 0;
}

/** Upsert de oferta: inserta o resetea a 'pending' */
export async function upsertPendingOffer(orderId, driverId) {
  await query(
    `INSERT INTO order_driver_offers(order_id, driver_id, status, wait_until)
     VALUES($1,$2,'pending',NULL)
     ON CONFLICT(order_id, driver_id)
     DO UPDATE SET status='pending', updated_at=NOW(), wait_until=NULL`,
    [orderId, driverId]
  );
}

/** Acepta la oferta del driver */
export async function acceptPendingOffer(orderId, driverId) {
  await query(
    `UPDATE order_driver_offers SET status='accepted', updated_at=NOW()
     WHERE order_id=$1 AND driver_id=$2`,
    [orderId, driverId]
  );
}

/** Expira las otras ofertas pending del mismo pedido (después de que uno aceptó) */
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

/** Libera un pedido del driver con cooldown (el driver se echó para atrás) */
export async function releaseDriverOffer(orderId, driverId, cooldownSecs) {
  await query(
    `UPDATE order_driver_offers
     SET status='released', wait_until=NOW()+($1*INTERVAL '1 second'), updated_at=NOW()
     WHERE order_id=$2 AND driver_id=$3`,
    [cooldownSecs, orderId, driverId]
  );
}

/**
 * Expira todas las ofertas pending activas de un driver (excepto una opcionalmente).
 * Útil cuando el driver rechaza o libera → despertamos esos otros pedidos.
 * Devuelve los order_ids afectados.
 */
export async function expireAllPendingOffersForDriver(driverId, exceptOrderId = null) {
  const r = await query(
    `UPDATE order_driver_offers SET status='expired', updated_at=NOW()
     WHERE driver_id=$1 AND status='pending'
       AND ($2::uuid IS NULL OR order_id <> $2)
     RETURNING order_id`,
    [driverId, exceptOrderId]
  );
  return r.rows.map(r => r.order_id);
}

/**
 * Expira ofertas que llevan más de OFFER_TIMEOUT_SECONDS sin respuesta.
 * Aplica cooldown a esos drivers.
 * Devuelve los order_ids afectados.
 */
export async function expireTimedOutOffersInDB(timeoutSecs, cooldownSecs) {
  const r = await query(
    `UPDATE order_driver_offers
     SET status='expired',
         wait_until = NOW() + ($2::int * INTERVAL '1 second'),
         updated_at = NOW()
     WHERE status = 'pending'
       AND updated_at < NOW() - ($1::int * INTERVAL '1 second')
     RETURNING order_id, driver_id`,
    [timeoutSecs, cooldownSecs]
  );
  return r.rows; // [{order_id, driver_id}, ...]
}

// ─── Candidatos ───────────────────────────────────────────────────────────────

/**
 * Drivers elegibles para recibir oferta de orderId.
 * Criterios:
 *   1. is_available=true y status='active'
 *   2. No excede MAX_ACTIVE_ORDERS_PER_DRIVER
 *   3. No tiene ninguna oferta pending en NINGÚN pedido
 *   4. No tiene cooldown activo específicamente para ESTE pedido
 *   5. No ya aceptó este pedido
 */
export async function queryCandidates(orderId, batchSize) {
  const r = await query(
    `SELECT dp.user_id
     FROM driver_profiles dp
     JOIN users u ON u.id = dp.user_id
     WHERE dp.is_available = true
       AND u.status = 'active'
       -- 1. Bajo el límite de capacidad
       AND (
         SELECT COUNT(*)::int FROM orders o
         WHERE o.driver_id = dp.user_id AND o.status = ANY($3::text[])
       ) < $4
       -- 2. Sin oferta pending activa en ningún pedido
       AND NOT EXISTS (
         SELECT 1 FROM order_driver_offers od
         WHERE od.driver_id = dp.user_id AND od.status = 'pending'
       )
       -- 3. No aceptó ya este pedido
       AND NOT EXISTS (
         SELECT 1 FROM order_driver_offers od
         WHERE od.order_id = $1 AND od.driver_id = dp.user_id AND od.status = 'accepted'
       )
       -- 4. Sin cooldown activo para este pedido específico
       AND NOT EXISTS (
         SELECT 1 FROM order_driver_offers od
         WHERE od.order_id = $1 AND od.driver_id = dp.user_id
           AND od.status IN ('rejected','released','expired')
           AND od.wait_until > NOW()
       )
     ORDER BY dp.driver_number ASC
     LIMIT $2`,
    [orderId, batchSize, ACTIVE_STATUSES, MAX_ACTIVE_ORDERS_PER_DRIVER]
  );
  return r.rows; // [{user_id}, ...]
}

/** ¿Hay al menos un driver disponible en el sistema? */
export async function anyDriverAvailable() {
  const r = await query(
    `SELECT 1 FROM driver_profiles WHERE is_available=true LIMIT 1`
  );
  return r.rowCount > 0;
}

/** Diagnóstico: todos los drivers disponibles con su estado actual */
export async function getDriverDiagnostics(orderId) {
  const r = await query(
    `SELECT dp.user_id,
            (SELECT COUNT(*)::int FROM orders o
             WHERE o.driver_id=dp.user_id AND o.status=ANY($1::text[])) AS active_count,
            EXISTS (
              SELECT 1 FROM order_driver_offers od
              WHERE od.driver_id=dp.user_id AND od.status='pending'
            ) AS has_pending_offer,
            (SELECT status FROM order_driver_offers od
             WHERE od.order_id=$2 AND od.driver_id=dp.user_id
             ORDER BY updated_at DESC LIMIT 1) AS offer_status_for_order,
            (SELECT EXTRACT(EPOCH FROM (wait_until - NOW()))::int
             FROM order_driver_offers od
             WHERE od.order_id=$2 AND od.driver_id=dp.user_id
               AND wait_until > NOW()
             ORDER BY updated_at DESC LIMIT 1) AS cooldown_secs_remaining
     FROM driver_profiles dp
     WHERE dp.is_available=true`,
    [ACTIVE_STATUSES, orderId]
  );
  return r.rows;
}

// ─── Perfil del driver ────────────────────────────────────────────────────────

/** Perfil del driver (disponibilidad y carga actual) */
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

// ─── Cooldown ─────────────────────────────────────────────────────────────────

/**
 * Driver con el cooldown más próximo a vencer para este pedido
 * (que no tenga ya oferta pending).
 */
export async function getNearestCooldownDriver(orderId) {
  const r = await query(
    `SELECT od.driver_id,
            EXTRACT(EPOCH FROM (od.wait_until - NOW()))::float AS secs_remaining
     FROM order_driver_offers od
     WHERE od.order_id = $1
       AND od.status IN ('rejected','expired','released')
       AND od.wait_until > NOW()
       AND NOT EXISTS (
         SELECT 1 FROM order_driver_offers od2
         WHERE od2.driver_id = od.driver_id AND od2.status = 'pending'
       )
     ORDER BY od.wait_until ASC
     LIMIT 1`,
    [orderId]
  );
  return r.rows[0] ?? null;
}

/** Reduce el wait_until del driver dado para este pedido */
export async function reduceCooldown(orderId, driverId, newWaitSecs) {
  const waitSql    = newWaitSecs < 1
    ? `NOW() - INTERVAL '2 seconds'`
    : `NOW() + ($2::float * INTERVAL '1 second')`;
  const waitParams = newWaitSecs < 1 ? [orderId, driverId] : [orderId, newWaitSecs, driverId];
  const driverIdx  = newWaitSecs < 1 ? '$2' : '$3';

  const r = await query(
    `UPDATE order_driver_offers
     SET wait_until = ${waitSql}, updated_at = NOW()
     WHERE order_id  = $1
       AND driver_id = ${driverIdx}
       AND status    IN ('rejected','expired','released')
       AND wait_until > NOW()
       AND updated_at < NOW() - INTERVAL '1 second'`, // guard idempotencia
    waitParams
  );
  return r.rowCount > 0;
}

// ─── SSE payload ──────────────────────────────────────────────────────────────

/** Info completa para construir el payload SSE de una oferta */
export async function getOfferPayload(orderId, driverId) {
  const r = await query(
    `SELECT o.total_cents,
            r.name    AS restaurant_name,
            r.address AS restaurant_address,
            o.delivery_address AS customer_address,
            COALESCE(d.alias, d.full_name) AS driver_name,
            GREATEST(0, EXTRACT(EPOCH FROM (
              od.updated_at + ($3::int * INTERVAL '1 second') - NOW()
            )))::int AS seconds_left
     FROM orders o
     JOIN restaurants r  ON r.id = o.restaurant_id
     LEFT JOIN users d   ON d.id = $2
     JOIN order_driver_offers od ON od.order_id=o.id AND od.driver_id=$2
     WHERE o.id = $1`,
    [orderId, driverId, OFFER_TIMEOUT_SECONDS]
  );
  return r.rows[0] ?? null;
}
