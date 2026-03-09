// ── ADD THESE TWO ROUTES to backend/src/modules/admin/routes.js ──────────────
// Place them after the existing /offer-stats route.

/* ── GET /admin/order-drivers/:id ──────────────────────────────────────────
 * Returns all drivers with their state relative to a specific order:
 *   - is_available, user_status, vehicle_type, driver_number, active_orders
 *   - offer_status: 'pending' | 'rejected' | 'expired' | 'released' | null
 *   - cooldown_secs: remaining cooldown seconds (0 if none)
 *
 * Used by the admin dashboard to show the per-order driver breakdown panel.
 */
router.get('/order-drivers/:id', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const orderId = req.params.id;

    const result = await query(`
      SELECT
        u.id         AS user_id,
        u.full_name  AS name,
        u.status     AS user_status,
        dp.is_available,
        dp.vehicle_type,
        dp.driver_number,
        -- Active orders count
        (SELECT COUNT(*)::int FROM orders o
         WHERE o.driver_id = u.id
           AND o.status IN ('assigned','accepted','preparing','ready','on_the_way')
        ) AS active_orders,
        -- Most recent offer for THIS order
        od.status    AS offer_status,
        -- Remaining cooldown seconds (0 if no cooldown or already expired)
        GREATEST(0, EXTRACT(EPOCH FROM (od.wait_until - NOW()))::int) AS cooldown_secs
      FROM users u
      JOIN driver_profiles dp ON dp.user_id = u.id
      LEFT JOIN LATERAL (
        SELECT status, wait_until
        FROM order_driver_offers
        WHERE order_id = $1 AND driver_id = u.id
        ORDER BY updated_at DESC
        LIMIT 1
      ) od ON true
      WHERE u.role = 'driver'
      ORDER BY
        -- Sort: active+available first, then available, then pending offer (no cooldown), then cooldown
        CASE
          WHEN dp.is_available AND u.status = 'active' AND od.status = 'pending' THEN 0
          WHEN dp.is_available AND u.status = 'active'
               AND (od.wait_until IS NULL OR od.wait_until <= NOW()) THEN 1
          WHEN dp.is_available AND (od.wait_until IS NULL OR od.wait_until <= NOW()) THEN 2
          WHEN od.wait_until > NOW() THEN 3
          ELSE 4
        END ASC,
        dp.driver_number ASC NULLS LAST
    `, [orderId]);

    return res.json({ drivers: result.rows });
  } catch (error) {
    return next(error);
  }
});

/* ── Enhanced GET /admin/offer-stats ────────────────────────────────────────
 * Replace the existing /offer-stats route with this version that includes
 * extra fields used by the dashboard detail panel.
 *
 * NOTE: This replaces the existing offer-stats route entirely.
 */
// REPLACE existing router.get('/offer-stats', ...) with:
router.get('/offer-stats', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const result = await query(`
      SELECT
        o.id                                           AS order_id,
        o.status,
        o.created_at,
        o.accepted_at,
        o.preparing_at,
        o.ready_at,
        o.picked_up_at,
        o.total_cents,
        o.payment_method,
        r.name                                         AS restaurant_name,
        c.full_name                                    AS customer_name,
        -- Round = distinct drivers processed + 1
        (SELECT COUNT(DISTINCT driver_id)::int
           FROM order_driver_offers
           WHERE order_id = o.id
             AND status IN ('rejected','expired','released')) + 1  AS round,
        -- Pending offers right now
        (SELECT COUNT(*)::int FROM order_driver_offers
           WHERE order_id = o.id AND status = 'pending')           AS pending,
        -- Total rejections
        (SELECT COUNT(*)::int FROM order_driver_offers
           WHERE order_id = o.id AND status = 'rejected')          AS rejected,
        -- Total expired
        (SELECT COUNT(*)::int FROM order_driver_offers
           WHERE order_id = o.id AND status = 'expired')           AS expired,
        -- Driver with active pending offer right now
        (SELECT u.full_name
           FROM order_driver_offers od2
           JOIN users u ON u.id = od2.driver_id
           WHERE od2.order_id = o.id AND od2.status = 'pending'
           LIMIT 1)                                                AS current_driver
      FROM orders o
      JOIN restaurants r ON r.id = o.restaurant_id
      JOIN users c ON c.id = o.customer_id
      WHERE o.driver_id IS NULL
        AND o.status NOT IN ('delivered','cancelled')
      ORDER BY o.created_at ASC
      LIMIT 50
    `);
    return res.json({ stats: result.rows });
  } catch (error) {
    return next(error);
  }
});
