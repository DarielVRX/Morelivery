// backend/src/modules/orders/assignment.js
import { query } from '../../config/db.js';

export const MAX_ACTIVE_ORDERS_PER_DRIVER = 4;
export const OFFER_TIMEOUT_SECONDS        = 60;   // 60 s para aceptar/rechazar
export const COOLDOWN_SECONDS             = 300;  // 5 min cooldown tras rechazo/liberación

const ACTIVE_STATUSES = ['assigned','accepted','preparing','ready','on_the_way'];

// ─── Tamaño de lote según ronda ──────────────────────────────────────────────
// Rondas 1-5  : 1 driver  a la vez
// Rondas 6-10 : 5 drivers al mismo tiempo
// Ronda 11+   : 10 drivers al mismo tiempo
function batchForRound(round) {
  if (round <= 5)  return 1;
  if (round <= 10) return 5;
  return 10;
}

// ─── Expirar ofertas vencidas ────────────────────────────────────────────────
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

  const ids = [...new Set(expired.rows.map(r => r.order_id))];
  for (const orderId of ids) {
    // Timeout NO aplica cooldown — driver puede ver el pedido inmediatamente
    const still = await query(
      `SELECT id FROM orders
       WHERE id=$1 AND driver_id IS NULL
         AND status NOT IN ('delivered','cancelled')`,
      [orderId]
    );
    if (still.rowCount > 0) await offerNextDrivers(orderId);
  }
}

// ─── Núcleo: ofrecer pedido al siguiente lote de drivers ─────────────────────
export async function offerNextDrivers(orderId) {
  // Evitar re-entrada: si ya hay oferta pending, no crear otra
  const alreadyPending = await query(
    `SELECT 1 FROM order_driver_offers WHERE order_id=$1 AND status='pending'`,
    [orderId]
  );
  if (alreadyPending.rowCount > 0) return 0;

  // ¿Pedido aún abierto?
  const open = await query(
    `SELECT id FROM orders
     WHERE id=$1 AND driver_id IS NULL
       AND status NOT IN ('delivered','cancelled')`,
    [orderId]
  );
  if (open.rowCount === 0) return 0;

  // Cuántos drivers distintos ya procesaron este pedido (cualquier estado final)
  const hist = await query(
    `SELECT COUNT(DISTINCT driver_id)::int AS n
     FROM order_driver_offers
     WHERE order_id=$1 AND status IN ('rejected','expired','released')`,
    [orderId]
  );
  const processed = hist.rows[0].n;
  const round      = processed + 1;
  const batchSize  = batchForRound(round);

  // Candidatos: disponibles, con cupo, sin oferta activa en este pedido,
  // y sin cooldown vigente (rechazo/liberación).
  // Los que tuvieron timeout pueden volver sin espera.
  let candidates = await query(
    `SELECT dp.user_id
     FROM driver_profiles dp
     WHERE dp.is_available = true
       AND (
         SELECT COUNT(*)::int FROM orders o
         WHERE o.driver_id = dp.user_id AND o.status = ANY($3::text[])
       ) < $4
       AND NOT EXISTS (
         SELECT 1 FROM order_driver_offers od
         WHERE od.order_id = $1
           AND od.driver_id = dp.user_id
           AND od.status IN ('pending','accepted')
       )
       AND NOT EXISTS (
         SELECT 1 FROM order_driver_offers od
         WHERE od.order_id = $1
           AND od.driver_id = dp.user_id
           AND od.status IN ('rejected','released')
           AND od.wait_until IS NOT NULL
           AND od.wait_until > NOW()
       )
     ORDER BY dp.driver_number ASC
     LIMIT $2`,
    [orderId, batchSize, ACTIVE_STATUSES, MAX_ACTIVE_ORDERS_PER_DRIVER]
  );

  // ── Reinicio de ciclo ────────────────────────────────────────────────────
  if (candidates.rowCount === 0) {
    const anyAvail = await query(
      `SELECT 1 FROM driver_profiles WHERE is_available=true LIMIT 1`
    );
    if (anyAvail.rowCount === 0) {
      // No hay ningún driver — marcar como pendiente y salir
      await query(
        `UPDATE orders SET status='pending_driver', updated_at=NOW()
         WHERE id=$1 AND driver_id IS NULL`,
        [orderId]
      );
      return 0;
    }
    // Limpiar historial y reiniciar desde el primer driver
    await query(
      `DELETE FROM order_driver_offers
       WHERE order_id=$1 AND status IN ('rejected','expired','released')`,
      [orderId]
    );
    await query(
      `UPDATE orders SET status='pending_driver', updated_at=NOW()
       WHERE id=$1 AND driver_id IS NULL`,
      [orderId]
    );
    candidates = await query(
      `SELECT dp.user_id
       FROM driver_profiles dp
       WHERE dp.is_available=true
         AND (
           SELECT COUNT(*)::int FROM orders o
           WHERE o.driver_id=dp.user_id AND o.status=ANY($2::text[])
         ) < $3
       ORDER BY dp.driver_number ASC
       LIMIT 1`,
      [ACTIVE_STATUSES, MAX_ACTIVE_ORDERS_PER_DRIVER]
    );
  }

  for (const row of candidates.rows) {
    await upsertOffer(orderId, row.user_id);
  }
  return candidates.rowCount;
}

// ─── Aceptar oferta con mutex (evita asignación doble simultánea) ────────────
export async function acceptOffer(orderId, driverId) {
  // FOR UPDATE SKIP LOCKED: si otro proceso ya bloqueó la fila, devuelve 0 filas
  const result = await query(
    `WITH lock AS (
       SELECT id FROM orders
       WHERE id=$1 AND driver_id IS NULL
         AND status NOT IN ('delivered','cancelled')
       FOR UPDATE SKIP LOCKED
     )
     UPDATE orders
       SET driver_id=$2, status='assigned', updated_at=NOW()
     FROM lock
     WHERE orders.id = lock.id
     RETURNING orders.id`,
    [orderId, driverId]
  );

  if (result.rowCount === 0) return false; // otro driver ganó

  // Marcar la oferta del ganador
  await query(
    `UPDATE order_driver_offers
     SET status='accepted', updated_at=NOW()
     WHERE order_id=$1 AND driver_id=$2`,
    [orderId, driverId]
  );

  // Cancelar las demás ofertas pendientes del mismo pedido
  await query(
    `UPDATE order_driver_offers
     SET status='expired', updated_at=NOW()
     WHERE order_id=$1 AND driver_id<>$2 AND status='pending'`,
    [orderId, driverId]
  );

  return true;
}

// ─── Rechazar oferta (con cooldown) ──────────────────────────────────────────
export async function rejectOffer(orderId, driverId) {
  await query(
    `UPDATE order_driver_offers
     SET status='rejected',
         wait_until = NOW() + ($3::text || ' seconds')::interval,
         updated_at = NOW()
     WHERE order_id=$1 AND driver_id=$2 AND status='pending'`,
    [orderId, driverId, COOLDOWN_SECONDS]
  );
  await offerNextDrivers(orderId);
}

// ─── Liberar pedido asignado (con cooldown) ───────────────────────────────────
export async function releaseOrder(orderId, driverId) {
  // Poner cooldown en la oferta
  await query(
    `UPDATE order_driver_offers
     SET status='released',
         wait_until = NOW() + ($1::text || ' seconds')::interval,
         updated_at = NOW()
     WHERE order_id=$2 AND driver_id=$3`,
    [COOLDOWN_SECONDS, orderId, driverId]
  );
  // Devolver el pedido al pool
  await query(
    `UPDATE orders
     SET driver_id=NULL, status='pending_driver', updated_at=NOW()
     WHERE id=$1 AND driver_id=$2`,
    [orderId, driverId]
  );
  await offerNextDrivers(orderId);
}

// ─── Listener del driver (llama al hacer polling) ────────────────────────────
export async function offerOrdersToDriver(driverId) {
  const r = await query(
    `SELECT dp.is_available,
       (SELECT COUNT(*)::int FROM orders o
        WHERE o.driver_id=$1 AND o.status=ANY($2::text[])) AS active_count
     FROM driver_profiles dp WHERE dp.user_id=$1`,
    [driverId, ACTIVE_STATUSES]
  );
  if (r.rowCount === 0) return 0;
  const { is_available, active_count } = r.rows[0];
  if (!is_available || active_count >= MAX_ACTIVE_ORDERS_PER_DRIVER) return 0;

  await expireTimedOutOffers();

  const open = await query(
    `SELECT id FROM orders
     WHERE driver_id IS NULL AND status IN ('created','pending_driver')
     ORDER BY created_at ASC LIMIT 5`
  );
  let offered = 0;
  for (const row of open.rows) {
    const n = await offerNextDrivers(row.id);
    if (n > 0) offered++;
  }
  return offered;
}

// ─── Helper interno ───────────────────────────────────────────────────────────
async function upsertOffer(orderId, driverId) {
  await query(
    `INSERT INTO order_driver_offers(order_id, driver_id, status, wait_until)
     VALUES($1, $2, 'pending', NULL)
     ON CONFLICT(order_id, driver_id)
     DO UPDATE SET status='pending', updated_at=NOW(), wait_until=NULL`,
     // created_at se preserva: no actualizar para que el countdown del driver no se reinicie
    [orderId, driverId]
  );
}
