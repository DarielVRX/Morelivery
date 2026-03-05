import { query } from '../../config/db.js';

function batchSize(offeredCount) {
  if (offeredCount < 5) return 1;
  if (offeredCount < 10) return 5;
  if (offeredCount < 20) return 10;
  return 10;
}

export async function offerNextDrivers(orderId) {
  const offered = await query('SELECT COUNT(*)::int AS count FROM order_driver_offers WHERE order_id = $1', [orderId]);
  const offeredCount = offered.rows[0].count;
  const limit = batchSize(offeredCount);

  const candidates = await query(
    `SELECT dp.user_id
     FROM driver_profiles dp
     WHERE dp.is_available = true
       AND NOT EXISTS (SELECT 1 FROM order_driver_offers od WHERE od.order_id = $1 AND od.driver_id = dp.user_id)
     ORDER BY dp.driver_number ASC
     LIMIT $2`,
    [orderId, limit]
  );

  for (const row of candidates.rows) {
    await query('INSERT INTO order_driver_offers(order_id, driver_id, status) VALUES($1, $2, $3) ON CONFLICT(order_id, driver_id) DO NOTHING', [
      orderId,
      row.user_id,
      'pending'
    ]);
  }

  if (candidates.rowCount === 0) {
    await query('UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 AND driver_id IS NULL', ['pending_driver', orderId]);
  }

  return candidates.rowCount;
}
