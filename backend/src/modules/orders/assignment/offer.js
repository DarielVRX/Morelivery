// backend/src/modules/orders/assignment/offer.js
// Envía una oferta a un driver con advisory lock para evitar duplicados.
import { query } from '../../../config/db.js';
import { log, logWarn } from './constants.js';
import { upsertPendingOffer, driverHasPendingOffer, getOfferPayload } from './queries.js';

export async function upsertOffer(orderId, driverId, onOffer, bagOverflowPct = 0) {
  // Advisory lock por driver (transaccional) — evita race condition entre pedidos
  const lockKey = Buffer.from(driverId.replace(/-/g, '')).readBigUInt64BE(0);
  const lockResult = await query(
    `SELECT pg_try_advisory_xact_lock($1::bigint) AS acquired`,
    [lockKey.toString()]
  );
  if (!lockResult.rows[0].acquired) {
    log(`order=${orderId}`, `advisory lock ocupado driver=${driverId} — skip`);
    return false;
  }

  // Double-check post-lock
  if (await driverHasPendingOffer(driverId)) {
    log(`order=${orderId}`, `driver=${driverId} ya tiene pending (post-lock) — skip`);
    return false;
  }

  await upsertPendingOffer(orderId, driverId, bagOverflowPct);
  log(`order=${orderId}`, `oferta guardada driver=${driverId}`);

  if (!onOffer) {
    logWarn(`order=${orderId}`, `sin onOffer callback — SSE no disparado driver=${driverId}`);
    return true;
  }

  try {
    const row = await getOfferPayload(orderId, driverId);
    if (!row) {
      logWarn(`order=${orderId}`, `payload vacío driver=${driverId}`);
      return true;
    }
    const svc = row.service_fee_cents  || 0;
    const del = row.delivery_fee_cents || 0;
    const tip = row.tip_cents          || 0;
    onOffer(driverId, orderId, {
      orderId,
      restaurantName:    row.restaurant_name,
      restaurantAddress: row.restaurant_address,
      restaurantLat:     row.restaurant_lat     ?? null,
      restaurantLng:     row.restaurant_lng     ?? null,
      customerAddress:   row.customer_address,
      customerLat:       row.customer_lat       ?? null,
      customerLng:       row.customer_lng       ?? null,
      totalCents:        row.total_cents,
      serviceFee:        svc,
      deliveryFee:       del,
      tipCents:          tip,
      driverEarning:     del + Math.round(svc * 0.5) + tip,
      paymentMethod:     row.payment_method,
      secondsLeft:       row.seconds_left,
      bagOverflowPct:    row.bag_overflow_pct ?? 0,
    });
    log(`order=${orderId}`, `SSE disparado driver=${driverId} secs=${row.seconds_left}`);
  } catch (e) {
    logWarn(`order=${orderId}`, `SSE error driver=${driverId}`, { error: e.message });
  }
  return true;
}
