// backend/src/modules/orders/assignment/offer.js
// ─────────────────────────────────────────────────────────────────────────────
// Envío de una oferta a un driver específico.
//
// Responsabilidades:
//   1. Advisory lock por driver — evita que dos pedidos compitan por el
//      mismo driver en paralelo dentro de una transacción.
//   2. Post-lock double-check — el driver puede haber recibido oferta en la
//      ventana entre la decisión de enviarle y la adquisición del lock.
//   3. Upsert en DB.
//   4. Disparo del SSE al driver.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '../../../config/db.js';
import { log, logWarn } from './constants.js';
import { upsertPendingOffer, driverHasPendingOffer, getOfferPayload } from './queries.js';

/**
 * Envía (o re-envía) una oferta al driver para el pedido dado.
 * Debe llamarse desde dentro de la cola serializada (serializedOffer).
 *
 * @param {string}   orderId
 * @param {string}   driverId
 * @param {Function|null} onOffer  Callback SSE (driverId, orderId, payload) => void
 */
export async function upsertOffer(orderId, driverId, onOffer) {
  // ── 1. Advisory lock por driver ───────────────────────────────────────────
  // Convierte los primeros 8 bytes del UUID (sin guiones) en un bigint.
  // pg_try_advisory_xact_lock es por transacción → se libera automáticamente.
  const lockKey = Buffer.from(driverId.replace(/-/g, '')).readBigUInt64BE(0);

  const lockResult = await query(
    `SELECT pg_try_advisory_xact_lock($1::bigint) AS acquired`,
    [lockKey.toString()]
  );

  if (!lockResult.rows[0].acquired) {
    log(orderId, `upsertOffer: advisory lock ocupado driver=${driverId} — skip`);
    return;
  }

  // ── 2. Post-lock double-check ─────────────────────────────────────────────
  const alreadyPending = await driverHasPendingOffer(driverId);
  if (alreadyPending) {
    log(orderId, `upsertOffer: driver=${driverId} ya tiene pending (post-lock) — skip`);
    return;
  }

  // ── 3. Upsert en DB ───────────────────────────────────────────────────────
  await upsertPendingOffer(orderId, driverId);
  log(orderId, `upsertOffer: oferta guardada driver=${driverId}`);

  // ── 4. SSE ────────────────────────────────────────────────────────────────
  if (!onOffer) {
    logWarn(orderId, `upsertOffer: sin callback onOffer — SSE NO disparado driver=${driverId}`);
    return;
  }

  try {
    const row = await getOfferPayload(orderId, driverId);
    if (!row) {
      logWarn(orderId, `upsertOffer: getOfferPayload sin resultado driver=${driverId}`);
      return;
    }

    log(orderId, `upsertOffer: SSE disparado driver=${driverId} secondsLeft=${row.seconds_left}`);
    onOffer(driverId, orderId, {
      orderId,
      driverName:        row.driver_name,
      restaurantName:    row.restaurant_name,
      restaurantAddress: row.restaurant_address,
      customerAddress:   row.customer_address,
      totalCents:        row.total_cents,
      secondsLeft:       row.seconds_left,
    });
  } catch (e) {
    logWarn(orderId, `upsertOffer: SSE callback lanzó error driver=${driverId}`, { error: e.message });
  }
}
