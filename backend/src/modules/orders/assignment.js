// backend/src/modules/orders/assignment.js
import { query } from '../../config/db.js';

export const MAX_ACTIVE_ORDERS_PER_DRIVER = 4;
export const OFFER_TIMEOUT_SECONDS        = 60;
export const COOLDOWN_SECONDS             = 300;
const COOLDOWN_DIVISOR                    = 5;

const ACTIVE_STATUSES = ['assigned','accepted','preparing','ready','on_the_way'];

// ─── Logger ───────────────────────────────────────────────────────────────────
function log(orderId, msg, data = {}) {
  const ts = new Date().toISOString();
  const extras = Object.keys(data).length ? ' ' + JSON.stringify(data) : '';
  console.log(`[assignment ${ts}] order=${orderId} ${msg}${extras}`);
}
function logWarn(orderId, msg, data = {}) {
  const ts = new Date().toISOString();
  const extras = Object.keys(data).length ? ' ' + JSON.stringify(data) : '';
  console.warn(`[assignment ${ts}] order=${orderId} WARN: ${msg}${extras}`);
}

// ─── Cola serializada por pedido ──────────────────────────────────────────────
// Garantiza que para un mismo orderId solo hay UNA ejecución activa a la vez.
// Todas las rutas de entrada (expiración, rechazo, liberación, listener) deben
// pasar por aquí — nunca llamar offerNextDrivers directamente desde fuera.

const orderQueues = new Map(); // orderId → Promise (la ejecución actual)

function serializedOffer(orderId, onOffer) {
  // Encadena la nueva ejecución al final de la anterior para ese pedido.
  // Si no hay ejecución activa, arranca de inmediato.
  const prev = orderQueues.get(orderId) ?? Promise.resolve();
  const next = prev
  .then(() => offerNextDrivers(orderId, onOffer))
  .catch(e => console.error(`[assignment] serializedOffer error order=${orderId}`, e))
  .finally(() => {
    // Limpiar si nadie más se encadenó
    if (orderQueues.get(orderId) === next) orderQueues.delete(orderId);
  });
    orderQueues.set(orderId, next);
    log(orderId, `queued (active chains=${orderQueues.size})`);
    return next;
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
                              RETURNING order_id, driver_id`,
                              [OFFER_TIMEOUT_SECONDS, COOLDOWN_SECONDS]
  );
  if (expired.rowCount === 0) return;

  console.log(`[assignment] expireTimedOutOffers: expired ${expired.rowCount} offer(s):`,
              expired.rows.map(r => `order=${r.order_id} driver=${r.driver_id}`).join(', ')
  );

  const ids = [...new Set(expired.rows.map(r => r.order_id))];
  for (const orderId of ids) {
    const still = await query(
      `SELECT id FROM orders WHERE id=$1 AND driver_id IS NULL
      AND status NOT IN ('delivered','cancelled')`,
                              [orderId]
    );
    if (still.rowCount > 0) {
      log(orderId, 'offer expired — enqueuing');
      serializedOffer(orderId, onOffer);
    } else {
      log(orderId, 'offer expired — order no longer needs driver, skipping');
    }
  }
}

// ─── Reducción de cooldown por pedido ────────────────────────────────────────
// Reduce wait_until del driver más próximo a vencer a (secs_remaining / 5).
// Guard de idempotencia: updated_at < NOW() - 1s evita doble reducción.
async function applyOrderCooldownReduction(orderId) {
  const nearest = await query(
    `SELECT od.driver_id,
    EXTRACT(EPOCH FROM (od.wait_until - NOW()))::float AS secs_remaining
    FROM order_driver_offers od
    WHERE od.order_id = $1
    AND od.status IN ('rejected','expired','released')
    AND od.wait_until > NOW()
    ORDER BY od.wait_until ASC
    LIMIT 1`,
    [orderId]
  );

  if (nearest.rowCount === 0) {
    log(orderId, 'cooldown reduction: no driver with active cooldown');
    return false;
  }

  const { driver_id, secs_remaining } = nearest.rows[0];
  const newWaitSecs = secs_remaining / COOLDOWN_DIVISOR;

  // Si el resultado es < 1s, ponemos wait_until en el pasado:
  // el driver queda elegible INMEDIATAMENTE en el próximo queryCandidates.
  // Usamos -2s para asegurar que wait_until > NOW() sea falso.
  const waitExpr = newWaitSecs < 1
  ? `NOW() - INTERVAL '2 seconds'`
  : `NOW() + ($1::float * INTERVAL '1 second')`;

  const result = await query(
    `UPDATE order_driver_offers
    SET wait_until = ${waitExpr},
    updated_at = NOW()
    WHERE order_id  = $2
    AND driver_id = $3
    AND status IN ('rejected','expired','released')
    AND wait_until > NOW()
    AND updated_at < NOW() - INTERVAL '1 second'`,
                             [newWaitSecs, orderId, driver_id]
  );

  if (result.rowCount === 0) {
    log(orderId, 'cooldown reduction skipped — already reduced recently', { driver_id });
    return false;
  }

  log(orderId, 'cooldown reduction applied', {
    driver_id,
    secs_remaining: Math.round(secs_remaining),
      new_wait_secs:  Math.round(newWaitSecs * 10) / 10,
  });
  return true;
}

// ─── Núcleo ───────────────────────────────────────────────────────────────────
// SOLO se llama desde serializedOffer — nunca directamente desde fuera.
export async function offerNextDrivers(orderId, _onOffer) {
  log(orderId, 'offerNextDrivers: start');

  // Verificar que el pedido sigue sin driver
  const orderRow = await query(
    `SELECT id, offer_cooldown_triggered FROM orders
    WHERE id=$1 AND driver_id IS NULL
    AND status NOT IN ('delivered','cancelled')`,
                               [orderId]
  );
  if (orderRow.rowCount === 0) {
    log(orderId, 'order not found or already assigned — abort');
    return 0;
  }
  const cooldownTriggered = orderRow.rows[0].offer_cooldown_triggered;

  // Si ya hay oferta pending, no crear otra
  const pending = await query(
    `SELECT driver_id FROM order_driver_offers WHERE order_id=$1 AND status='pending'`,
    [orderId]
  );
  if (pending.rowCount > 0) {
    log(orderId, 'already has pending offer — abort', { driver_id: pending.rows[0].driver_id });
    return 0;
  }

  // Diagnóstico completo de drivers
  const allAvail = await query(
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
                               FROM driver_profiles dp WHERE dp.is_available=true`,
                               [ACTIVE_STATUSES, orderId]
  );

  log(orderId, `available drivers: ${allAvail.rowCount}`);
  for (const r of allAvail.rows) {
    log(orderId, `  driver=${r.user_id}`, {
      active_orders:          `${r.active_count}/${MAX_ACTIVE_ORDERS_PER_DRIVER}`,
      has_pending_offer:      r.has_pending_offer,
      offer_status_for_order: r.offer_status_for_order ?? 'none',
      cooldown_secs_remaining: r.cooldown_secs_remaining ?? 0,
    });
  }

  // Ronda y batch
  const hist = await query(
    `SELECT COUNT(DISTINCT driver_id)::int AS n FROM order_driver_offers
    WHERE order_id=$1 AND status IN ('rejected','expired','released')`,
                           [orderId]
  );
  const round     = hist.rows[0].n + 1;
  const batchSize = round <= 5 ? 1 : round <= 10 ? 5 : 10;
  log(orderId, `round=${round} batchSize=${batchSize} cooldownTriggered=${cooldownTriggered}`);

  let candidates = await queryCandidates(orderId, batchSize);
  log(orderId, `candidates: ${candidates.rowCount}`, { drivers: candidates.rows.map(r => r.user_id) });

  if (candidates.rowCount === 0) {
    const anyAvail = await query(`SELECT 1 FROM driver_profiles WHERE is_available=true LIMIT 1`);
    if (anyAvail.rowCount === 0) {
      logWarn(orderId, 'no available drivers in system — pending_driver');
      await query(`UPDATE orders SET status='pending_driver', updated_at=NOW() WHERE id=$1 AND driver_id IS NULL`, [orderId]);
      return 0;
    }

    // Intentar reducción de cooldown
    log(orderId, 'no candidates — attempting cooldown reduction');
    const reduced = await applyOrderCooldownReduction(orderId);

    if (!reduced) {
      // Ningún cooldown que reducir: todos los drivers están bloqueados por
      // capacidad o pending offer en otro pedido — esperar al próximo tick.
      logWarn(orderId, 'no cooldown to reduce — all drivers busy elsewhere');
      await query(`UPDATE orders SET status='pending_driver', updated_at=NOW() WHERE id=$1 AND driver_id IS NULL`, [orderId]);
      return 0;
    }

    // Marcar el pedido la primera vez (no acumula)
    if (!cooldownTriggered) {
      await query(`UPDATE orders SET offer_cooldown_triggered=true, updated_at=NOW() WHERE id=$1`, [orderId]);
      log(orderId, 'offer_cooldown_triggered = true');
    }

    // Si new_wait_secs < 1 el driver quedó elegible de inmediato (wait_until en el pasado).
    // Reintentar la query de candidatos ahora mismo.
    // Si new_wait_secs >= 1 todavía tiene cooldown — esperar al próximo expire tick.
    const newWaitSecs = secs_remaining / COOLDOWN_DIVISOR;
    if (newWaitSecs < 1) {
      candidates = await queryCandidates(orderId, 1);
      log(orderId, `candidates after immediate reduction: ${candidates.rowCount}`, { drivers: candidates.rows.map(r => r.user_id) });
      if (candidates.rowCount === 0) {
        log(orderId, 'still no candidates after immediate reduction — pending_driver');
        await query(`UPDATE orders SET status='pending_driver', updated_at=NOW() WHERE id=$1 AND driver_id IS NULL`, [orderId]);
        return 0;
      }
      // Hay candidatos — continuar al bloque de upsertOffer abajo
    } else {
      log(orderId, `cooldown reduced to ${Math.round(newWaitSecs)}s — will retry on next expire tick`);
      await query(`UPDATE orders SET status='pending_driver', updated_at=NOW() WHERE id=$1 AND driver_id IS NULL`, [orderId]);
      return 0;
    }
  }

  for (const row of candidates.rows) {
    log(orderId, `sending offer to driver=${row.user_id}`);
    await upsertOffer(orderId, row.user_id, _onOffer);
  }
  return candidates.rowCount;
}

// ─── Query de candidatos ──────────────────────────────────────────────────────
async function queryCandidates(orderId, batchSize) {
  return query(
    `SELECT dp.user_id
    FROM driver_profiles dp
    WHERE dp.is_available = true
    AND (SELECT COUNT(*)::int FROM orders o
    WHERE o.driver_id=dp.user_id AND o.status=ANY($3::text[])) < $4
    AND NOT EXISTS (
      SELECT 1 FROM order_driver_offers od
      WHERE od.driver_id=dp.user_id AND od.status='pending'
    )
    AND NOT EXISTS (
      SELECT 1 FROM order_driver_offers od
      WHERE od.order_id=$1 AND od.driver_id=dp.user_id
      AND od.status IN ('pending','accepted')
    )
    AND NOT EXISTS (
      SELECT 1 FROM order_driver_offers od
      WHERE od.order_id=$1 AND od.driver_id=dp.user_id
      AND od.status IN ('rejected','released','expired')
      AND od.wait_until IS NOT NULL AND od.wait_until > NOW()
    )
    ORDER BY dp.driver_number ASC
    LIMIT $2`,
    [orderId, batchSize, ACTIVE_STATUSES, MAX_ACTIVE_ORDERS_PER_DRIVER]
  );
}

// ─── Aceptar ──────────────────────────────────────────────────────────────────
export async function acceptOffer(orderId, driverId) {
  log(orderId, `acceptOffer driver=${driverId}`);
  const result = await query(
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
  if (result.rowCount === 0) {
    logWarn(orderId, `acceptOffer: already taken — driver=${driverId}`);
    return false;
  }
  await query(`UPDATE order_driver_offers SET status='accepted', updated_at=NOW()
  WHERE order_id=$1 AND driver_id=$2`, [orderId, driverId]);
  await query(`UPDATE order_driver_offers SET status='expired', updated_at=NOW()
  WHERE order_id=$1 AND driver_id<>$2 AND status='pending'`, [orderId, driverId]);
  log(orderId, `acceptOffer: SUCCESS driver=${driverId}`);
  return true;
}

// ─── Rechazar ─────────────────────────────────────────────────────────────────
export async function rejectOffer(orderId, driverId, onOffer) {
  log(orderId, `rejectOffer driver=${driverId} cooldown=${COOLDOWN_SECONDS}s`);
  await query(
    `UPDATE order_driver_offers
    SET status='rejected', wait_until=NOW()+($3*INTERVAL '1 second'), updated_at=NOW()
    WHERE order_id=$1 AND driver_id=$2 AND status='pending'`,
    [orderId, driverId, COOLDOWN_SECONDS]
  );
  // Limpiar otras pendientes del mismo driver en otros pedidos
  await query(
    `UPDATE order_driver_offers SET status='expired', updated_at=NOW()
    WHERE driver_id=$1 AND status='pending' AND order_id<>$2`,
    [driverId, orderId]
  );
  serializedOffer(orderId, onOffer);
}

// ─── Liberar ──────────────────────────────────────────────────────────────────
export async function releaseOrder(orderId, driverId, onOffer) {
  log(orderId, `releaseOrder driver=${driverId} cooldown=${COOLDOWN_SECONDS}s`);
  await query(
    `UPDATE order_driver_offers
    SET status='released', wait_until=NOW()+($1*INTERVAL '1 second'), updated_at=NOW()
    WHERE order_id=$2 AND driver_id=$3`,
    [COOLDOWN_SECONDS, orderId, driverId]
  );
  await query(`UPDATE orders SET driver_id=NULL, status='pending_driver', updated_at=NOW()
  WHERE id=$1 AND driver_id=$2`, [orderId, driverId]);
  await query(`UPDATE order_driver_offers SET status='expired', updated_at=NOW()
  WHERE driver_id=$1 AND status='pending'`, [driverId]);
  serializedOffer(orderId, onOffer);
}

// ─── Listener del driver ──────────────────────────────────────────────────────
export async function offerOrdersToDriver(driverId, _onOffer) {
  console.log(`[assignment] offerOrdersToDriver: driver=${driverId}`);
  const r = await query(
    `SELECT dp.is_available,
    (SELECT COUNT(*)::int FROM orders o
    WHERE o.driver_id=$1 AND o.status=ANY($2::text[])) AS active_count
    FROM driver_profiles dp WHERE dp.user_id=$1`,
    [driverId, ACTIVE_STATUSES]
  );
  if (r.rowCount === 0) {
    console.warn(`[assignment] offerOrdersToDriver: driver=${driverId} profile not found`);
    return 0;
  }
  const { is_available, active_count } = r.rows[0];
  console.log(`[assignment] offerOrdersToDriver: driver=${driverId} is_available=${is_available} active_orders=${active_count}/${MAX_ACTIVE_ORDERS_PER_DRIVER}`);
  if (!is_available || active_count >= MAX_ACTIVE_ORDERS_PER_DRIVER) return 0;

  await expireTimedOutOffers(_onOffer);

  const open = await query(
    `SELECT id, status FROM orders
    WHERE driver_id IS NULL
    AND status IN ('created','pending_driver','preparing','ready')
    ORDER BY created_at ASC LIMIT 5`
  );
  console.log(`[assignment] offerOrdersToDriver: ${open.rowCount} open order(s)`,
              open.rows.map(r => `order=${r.id} status=${r.status}`)
  );

  let offered = 0;
  for (const row of open.rows) {
    // Encolar en lugar de llamar directo — evita ejecuciones paralelas
    serializedOffer(row.id, _onOffer);
    offered++;
    // Solo encolar el primero: el driver recibirá una oferta y luego
    // el listener volverá a llamarse si sigue disponible.
    break;
  }
  console.log(`[assignment] offerOrdersToDriver: driver=${driverId} done — enqueued ${offered} order(s)`);
  return offered;
}

// ─── Helper: upsert offer + SSE ──────────────────────────────────────────────
async function upsertOffer(orderId, driverId, onOffer) {
  await query(
    `INSERT INTO order_driver_offers(order_id, driver_id, status, wait_until)
    VALUES($1,$2,'pending',NULL)
    ON CONFLICT(order_id, driver_id)
    DO UPDATE SET status='pending', updated_at=NOW(), wait_until=NULL`,
              [orderId, driverId]
  );
  log(orderId, `upsertOffer: DB row upserted driver=${driverId}`);

  if (!onOffer) {
    logWarn(orderId, `upsertOffer: NO onOffer callback — SSE will NOT fire driver=${driverId}`);
    return;
  }
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
      log(orderId, `upsertOffer: firing SSE onOffer driver=${driverId}`);
      onOffer(driverId, orderId, {
        orderId,
        driverName:        row.driver_name,
        restaurantName:    row.restaurant_name,
        restaurantAddress: row.restaurant_address,
        customerAddress:   row.customer_address,
        totalCents:        row.total_cents,
        offerCreatedAt:    row.offer_created_at,
      });
    } else {
      logWarn(orderId, `upsertOffer: info query returned 0 rows driver=${driverId}`);
    }
  } catch (e) {
    logWarn(orderId, `upsertOffer: SSE callback threw driver=${driverId}`, { error: e.message });
  }
}
