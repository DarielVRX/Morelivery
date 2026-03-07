// backend/src/modules/orders/assignment.js
import { query } from '../../config/db.js';

export const MAX_ACTIVE_ORDERS_PER_DRIVER = 4;
export const OFFER_TIMEOUT_SECONDS        = 60;
export const COOLDOWN_SECONDS             = 300;
const COOLDOWN_DIVISOR                    = 5;   // reducción real: wait_restante / 5

const ACTIVE_STATUSES = ['assigned','accepted','preparing','ready','on_the_way'];
const assignmentQueue = [];
const processingOrders = new Set();
let queueRunning = false;

function enqueueAssignment(orderId, onOffer) {
  if (!processingOrders.has(orderId)) {
    assignmentQueue.push({ orderId, onOffer });
    processingOrders.add(orderId);
  }
  processQueue();
}

async function processQueue() {
  if (queueRunning) return;
  queueRunning = true;

  while (assignmentQueue.length > 0) {
    const job = assignmentQueue.shift();
    try {
      await offerNextDrivers(job.orderId, job.onOffer);
    } catch (e) {
      console.error("assignment queue error", e);
    }
    processingOrders.delete(job.orderId);
  }

  queueRunning = false;
}

function batchForRound(round) {
  if (round <= 5)  return 1;
  if (round <= 10) return 5;
  return 10;
}

// ─── Expirar ofertas vencidas ─────────────────────────────────────────────────
export async function expireTimedOutOffers(onOffer) {
  const expired = await query(
    `UPDATE order_driver_offers
     SET status     = 'expired',
         wait_until = NOW() + ($2::int * INTERVAL '1 second'),
         updated_at = NOW()
     WHERE status = 'pending'
       AND created_at < NOW() - ($1::int * INTERVAL '1 second')
     RETURNING order_id`,
    [OFFER_TIMEOUT_SECONDS, COOLDOWN_SECONDS]
  );
  if (expired.rowCount === 0) return;

  const ids = [...new Set(expired.rows.map(r => r.order_id))];
  for (const orderId of ids) {
    const still = await query(
      `SELECT id FROM orders WHERE id=$1 AND driver_id IS NULL
         AND status NOT IN ('delivered','cancelled')`,
      [orderId]
    );
    if (still.rowCount > 0) enqueueAssignment(orderId, onOffer);
  }
}

// ─── Reducir wait_until del driver más cercano a vencer para este pedido ──────
// Se aplica siempre que no hay candidatos: tanto en la primera vez (triggered=false)
// como en las siguientes (triggered=true), pero el flag no vuelve a cambiar.
// Devuelve true si encontró un driver al que reducirle el cooldown.
async function applyOrderCooldownReduction(orderId) {
  // Buscar el driver con menor tiempo restante de cooldown para este pedido
  // (excluir los que ya vencieron — esos ya son candidatos normales)
  const nearest = await query(
    `SELECT od.driver_id,
            EXTRACT(EPOCH FROM (od.wait_until - NOW()))::int AS secs_remaining
     FROM order_driver_offers od
     WHERE od.order_id = $1
       AND od.status IN ('rejected', 'expired', 'released')
       AND od.wait_until > NOW()
     ORDER BY od.wait_until ASC
     LIMIT 1`,
    [orderId]
  );

  if (nearest.rowCount === 0) return false;

  const { driver_id, secs_remaining } = nearest.rows[0];

  // Reducción real: restar el 80% del tiempo restante (equivale a wait/5)
  // Ej: 200s restantes → restar 160s → queda en 40s (= 200/5)
  const reduction = Math.floor(secs_remaining * (1 - 1 / COOLDOWN_DIVISOR));

  await query(
    `UPDATE order_driver_offers
     SET wait_until = wait_until - ($1 * INTERVAL '1 second'),
         updated_at = NOW()
     WHERE order_id = $2
       AND driver_id = $3
       AND status IN ('rejected', 'expired', 'released')
       AND wait_until > NOW()`,
    [reduction, orderId, driver_id]
  );

  console.log(
    `[assignment] cooldown reduction: order=${orderId} driver=${driver_id} ` +
    `reduced by ${reduction}s (was ${secs_remaining}s remaining)`
  );

  return true;
}

// ─── Núcleo: una oferta activa a la vez ──────────────────────────────────────
export async function offerNextDrivers(orderId, _onOffer) {
  // Lock para evitar race condition entre pedidos concurrentes
  const lockResult = await query(
    `SELECT id, offer_cooldown_triggered FROM orders
     WHERE id=$1 AND driver_id IS NULL
       AND status NOT IN ('delivered','cancelled')
     FOR UPDATE SKIP LOCKED`,
    [orderId]
  );
  if (lockResult.rowCount === 0) return 0;

  const cooldownTriggered = lockResult.rows[0].offer_cooldown_triggered;

  // Si ya hay oferta pending activa, no crear otra
  const alreadyPending = await query(
    `SELECT 1 FROM order_driver_offers WHERE order_id=$1 AND status='pending'`,
    [orderId]
  );
  if (alreadyPending.rowCount > 0) return 0;

  const hist = await query(
    `SELECT COUNT(DISTINCT driver_id)::int AS n
     FROM order_driver_offers
     WHERE order_id=$1 AND status IN ('rejected','expired','released')`,
    [orderId]
  );
  const processed = hist.rows[0].n;
  const round     = processed + 1;
  const batchSize = batchForRound(round);

  let candidates = await queryCandidates(orderId, batchSize);

  // ── Sin candidatos: activar reducción de cooldown por pedido ────────────────
  if (candidates.rowCount === 0) {
    const anyAvail = await query(
      `SELECT 1 FROM driver_profiles WHERE is_available=true LIMIT 1`
    );
    if (anyAvail.rowCount === 0) {
      // No hay ningún driver disponible en el sistema — esperar
      await query(
        `UPDATE orders SET status='pending_driver', updated_at=NOW()
         WHERE id=$1 AND driver_id IS NULL`, [orderId]
      );
      return 0;
    }

    // Aplicar reducción al driver más cercano a vencer
    const reduced = await applyOrderCooldownReduction(orderId);

    if (!reduced) {
      // No hay drivers con cooldown activo — todos libres pero ninguno cumple
      // otros criterios (cupo lleno, etc.). Esperar.
      await query(
        `UPDATE orders SET status='pending_driver', updated_at=NOW()
         WHERE id=$1 AND driver_id IS NULL`, [orderId]
      );
      return 0;
    }

    // Marcar el pedido la primera vez (no acumula)
    if (!cooldownTriggered) {
      await query(
        `UPDATE orders SET offer_cooldown_triggered=true, updated_at=NOW()
         WHERE id=$1`, [orderId]
      );
    }

    // Reintentar candidatos tras la reducción
    candidates = await queryCandidates(orderId, 1);

    if (candidates.rowCount === 0) {
      // La reducción no fue suficiente todavía — el driver reducido aún tiene algo
      // de wait. El siguiente tick de expireTimedOutOffers lo activará.
      await query(
        `UPDATE orders SET status='pending_driver', updated_at=NOW()
         WHERE id=$1 AND driver_id IS NULL`, [orderId]
      );
      return 0;
    }
  }

  for (const row of candidates.rows) {
    await upsertOffer(orderId, row.user_id, _onOffer);
  }
  return candidates.rowCount;
}

// ─── Query de candidatos (extraída para reutilizar) ───────────────────────────
async function queryCandidates(orderId, batchSize) {
  return query(
    `SELECT dp.user_id
     FROM driver_profiles dp
     WHERE dp.is_available = true
       AND (
         SELECT COUNT(*)::int FROM orders o
         WHERE o.driver_id = dp.user_id AND o.status = ANY($3::text[])
       ) < $4
       -- NO tiene oferta pending en ningún pedido
       AND NOT EXISTS (
         SELECT 1 FROM order_driver_offers od
         WHERE od.driver_id = dp.user_id AND od.status = 'pending'
       )
       -- no aceptó ya este pedido
       AND NOT EXISTS (
         SELECT 1 FROM order_driver_offers od
         WHERE od.order_id = $1 AND od.driver_id = dp.user_id
           AND od.status IN ('pending','accepted')
       )
       -- no cooldown vigente en este pedido
       AND NOT EXISTS (
         SELECT 1 FROM order_driver_offers od
         WHERE od.order_id = $1 AND od.driver_id = dp.user_id
           AND od.status IN ('rejected','released','expired')
           AND od.wait_until IS NOT NULL AND od.wait_until > NOW()
       )
     ORDER BY dp.driver_number ASC
     LIMIT $2`,
    [orderId, batchSize, ACTIVE_STATUSES, MAX_ACTIVE_ORDERS_PER_DRIVER]
  );
}

// ─── Aceptar con mutex ────────────────────────────────────────────────────────
export async function acceptOffer(orderId, driverId) {
  const result = await query(
    `WITH lock AS (
       SELECT id FROM orders
       WHERE id=$1 AND driver_id IS NULL
         AND status NOT IN ('delivered','cancelled')
       FOR UPDATE SKIP LOCKED
     )
     UPDATE orders SET driver_id=$2, status='assigned', updated_at=NOW()
     FROM lock WHERE orders.id = lock.id
     RETURNING orders.id`,
    [orderId, driverId]
  );
  if (result.rowCount === 0) return false;

  await query(
    `UPDATE order_driver_offers SET status='accepted', updated_at=NOW()
     WHERE order_id=$1 AND driver_id=$2`, [orderId, driverId]
  );
  await query(
    `UPDATE order_driver_offers SET status='expired', updated_at=NOW()
     WHERE order_id=$1 AND driver_id<>$2 AND status='pending'`, [orderId, driverId]
  );
  return true;
}

// ─── Rechazar (con cooldown) ──────────────────────────────────────────────────
export async function rejectOffer(orderId, driverId, onOffer) {
  await query(
    `UPDATE order_driver_offers
     SET status='rejected',
         wait_until = NOW() + ($3 * INTERVAL '1 second'),
         updated_at = NOW()
     WHERE order_id=$1 AND driver_id=$2 AND status='pending'`,
    [orderId, driverId, COOLDOWN_SECONDS]
  );

  await query(
    `UPDATE order_driver_offers
     SET status='expired', updated_at=NOW()
     WHERE driver_id=$1 AND status='pending' AND order_id <> $2`,
    [driverId, orderId]
  );

  enqueueAssignment(orderId, onOffer);
}

// ─── Liberar (con cooldown) ───────────────────────────────────────────────────
export async function releaseOrder(orderId, driverId, onOffer) {
  await query(
    `UPDATE order_driver_offers
     SET status='released',
         wait_until = NOW() + ($1 * INTERVAL '1 second'),
         updated_at = NOW()
     WHERE order_id=$2 AND driver_id=$3`,
    [COOLDOWN_SECONDS, orderId, driverId]
  );
  await query(
    `UPDATE orders SET driver_id=NULL, status='pending_driver', updated_at=NOW()
     WHERE id=$1 AND driver_id=$2`, [orderId, driverId]
  );
  await query(
    `UPDATE order_driver_offers
     SET status='expired', updated_at=NOW()
     WHERE driver_id=$1 AND status='pending'`,
    [driverId]
  );
  enqueueAssignment(orderId, onOffer);
}

// ─── Listener del driver ──────────────────────────────────────────────────────
export async function offerOrdersToDriver(driverId, _onOffer) {
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

  await expireTimedOutOffers(_onOffer);

  const open = await query(
    `SELECT id FROM orders
     WHERE driver_id IS NULL AND status IN ('created','pending_driver')
     ORDER BY created_at ASC LIMIT 5`
  );
  let offered = 0;
  for (const row of open.rows) {
    const n = await offerNextDrivers(row.id, _onOffer);
    if (n > 0) offered++;
  }
  return offered;
}

// ─── Helper interno ───────────────────────────────────────────────────────────
async function upsertOffer(orderId, driverId, onOffer) {
  await query(
    `INSERT INTO order_driver_offers(order_id, driver_id, status, wait_until)
     VALUES($1, $2, 'pending', NULL)
     ON CONFLICT(order_id, driver_id)
     DO UPDATE SET status='pending', updated_at=NOW(), wait_until=NULL`,
    [orderId, driverId]
  );
  if (onOffer) {
    try {
      const info = await query(
        `SELECT o.total_cents, r.name AS restaurant_name, r.address AS restaurant_address,
                o.delivery_address AS customer_address,
                split_part(d.full_name,'_',1) AS driver_name,
                od.created_at AS offer_created_at
         FROM orders o
         JOIN restaurants r ON r.id=o.restaurant_id
         LEFT JOIN users d ON d.id=$2
         JOIN order_driver_offers od ON od.order_id=o.id AND od.driver_id=$2
         WHERE o.id=$1`,
        [orderId, driverId]
      );
      if (info.rowCount > 0) {
        const row = info.rows[0];
        onOffer(driverId, orderId, {
          orderId,
          driverName:        row.driver_name,
          restaurantName:    row.restaurant_name,
          restaurantAddress: row.restaurant_address,
          customerAddress:   row.customer_address,
          totalCents:        row.total_cents,
          offerCreatedAt:    row.offer_created_at,
        });
      }
    } catch (_) {}
  }
}
