// backend/src/modules/admin/route-groups/analytics.js
//
// Rutas de consulta y métricas del panel admin:
//   GET /admin/orders
//   GET /admin/metrics
//   GET /admin/offer-stats
//   GET /admin/assignment-live
//   GET /admin/ratings
//   GET /admin/order-notes
//   GET /admin/reports
//   PATCH /admin/reports/:id/review

import { Router } from 'express';
import { query } from '../../../config/db.js';
import { authenticate, authorize } from '../../../middlewares/auth.js';
import { sseHub } from '../../events/hub.js';

const router = Router();

/* ── GET /admin/orders ── */
router.get('/orders', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const { status, limit = 200, offset = 0 } = req.query;
    const whereClause = status ? `WHERE o.status = $3` : '';
    const params = status ? [Number(limit), Number(offset), status] : [Number(limit), Number(offset)];
    const where = whereClause;

    const result = await query(`
    SELECT
    o.id, o.status, o.total_cents, o.delivery_address,
    o.created_at, o.updated_at,
    o.accepted_at, o.preparing_at, o.ready_at,
    o.picked_up_at, o.delivered_at, o.cancelled_at,
    o.suggestion_status, o.driver_note, o.restaurant_note,
    c.id AS customer_id, c.full_name AS customer_name,
    r.id AS restaurant_id, r.name AS restaurant_name,
    d.id AS driver_id, d.full_name AS driver_name,
    dp.is_available AS driver_available, dp.vehicle_type,
    (SELECT COUNT(*)::int FROM order_driver_offers od WHERE od.order_id=o.id AND od.status='pending')  AS pending_offers,
    (SELECT COUNT(*)::int FROM order_driver_offers od WHERE od.order_id=o.id AND od.status='rejected') AS rejected_offers,
    (SELECT COUNT(*)::int FROM order_driver_offers od WHERE od.order_id=o.id AND od.status='expired')  AS expired_offers
    FROM orders o
    JOIN restaurants r ON r.id = o.restaurant_id
    JOIN users c ON c.id = o.customer_id
    LEFT JOIN users d ON d.id = o.driver_id
    LEFT JOIN driver_profiles dp ON dp.user_id = o.driver_id
    ${where}
    ORDER BY o.created_at DESC
    LIMIT $1 OFFSET $2`, params);

    const orderIds = result.rows.map(r => r.id);
    let itemsByOrder = new Map();
    if (orderIds.length > 0) {
      try {
        const items = await query(
          `SELECT oi.order_id, COALESCE(mi.name,'Producto') AS name, oi.quantity, oi.unit_price_cents
          FROM order_items oi LEFT JOIN menu_items mi ON mi.id = oi.menu_item_id
          WHERE oi.order_id = ANY($1::uuid[])`, [orderIds]);
        for (const row of items.rows) {
          if (!itemsByOrder.has(row.order_id)) itemsByOrder.set(row.order_id, []);
          itemsByOrder.get(row.order_id).push({ name: row.name, quantity: row.quantity, unitPriceCents: row.unit_price_cents });
        }
      } catch (_) {}
    }

    const orders = result.rows.map(o => ({ ...o, items: itemsByOrder.get(o.id) || [] }));
    const countResult = await query(`SELECT COUNT(*)::int AS n FROM orders ${status ? 'WHERE status = $1' : ''}`, status ? [status] : []);
    return res.json({ orders, total: countResult.rows[0].n });
  } catch (error) { return next(error); }
});

/* ── GET /admin/metrics ── */
router.get('/metrics', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const days = Math.max(1, Math.min(90, parseInt(req.query.days) || 7));

    const [summary, timings, byRestaurant, byDriver, byCustomer, byHour] = await Promise.all([
      query(`SELECT
      COUNT(*)::int                                              AS total_orders,
      COUNT(*) FILTER (WHERE status='delivered')::int           AS delivered,
      COUNT(*) FILTER (WHERE status='cancelled')::int           AS cancelled,
      COUNT(*) FILTER (WHERE status NOT IN ('delivered','cancelled'))::int AS active,
      ROUND(AVG(total_cents) FILTER (WHERE status='delivered'))::int       AS avg_ticket_cents,
      COALESCE(SUM(total_cents) FILTER (WHERE status='delivered'),0)::bigint AS revenue_cents
      FROM orders WHERE created_at > NOW() - (${days}::int * INTERVAL '1 day')`),

      query(`SELECT
      ROUND(AVG(EXTRACT(EPOCH FROM (accepted_at   - created_at))  /60))::int AS avg_min_to_accept,
      ROUND(AVG(EXTRACT(EPOCH FROM (preparing_at  - accepted_at)) /60))::int AS avg_min_to_prepare,
      ROUND(AVG(EXTRACT(EPOCH FROM (ready_at      - preparing_at))/60))::int AS avg_min_to_ready,
      ROUND(AVG(EXTRACT(EPOCH FROM (picked_up_at  - ready_at))    /60))::int AS avg_min_to_pickup,
      ROUND(AVG(EXTRACT(EPOCH FROM (delivered_at  - picked_up_at))/60))::int AS avg_min_to_deliver,
      ROUND(AVG(EXTRACT(EPOCH FROM (delivered_at  - created_at))  /60))::int AS avg_total_min
      FROM orders WHERE status='delivered' AND created_at > NOW() - (${days}::int * INTERVAL '1 day')`),

      query(`SELECT r.id, r.name,
      COUNT(o.id)::int                                               AS total_orders,
      COUNT(o.id) FILTER (WHERE o.status='delivered')::int           AS delivered,
      COUNT(o.id) FILTER (WHERE o.status='cancelled')::int           AS cancelled,
      ROUND(AVG(o.total_cents) FILTER (WHERE o.status='delivered'))::int AS avg_ticket_cents,
      COALESCE(SUM(o.total_cents) FILTER (WHERE o.status='delivered'),0)::bigint AS revenue_cents,
      ROUND(AVG(EXTRACT(EPOCH FROM (o.delivered_at - o.created_at))/60) FILTER (WHERE o.status='delivered'))::int AS avg_total_min
      FROM restaurants r LEFT JOIN orders o ON o.restaurant_id=r.id AND o.created_at > NOW() - (${days}::int * INTERVAL '1 day')
      GROUP BY r.id, r.name ORDER BY total_orders DESC`),

      query(`SELECT d.id, d.full_name AS name,
      dp.is_available, dp.vehicle_type,
      COUNT(o.id)::int                                               AS total_orders,
      COUNT(o.id) FILTER (WHERE o.status='delivered')::int           AS delivered,
      COUNT(o.id) FILTER (WHERE o.status='cancelled')::int           AS cancelled,
      ROUND(AVG(EXTRACT(EPOCH FROM (o.delivered_at - o.picked_up_at))/60) FILTER (WHERE o.status='delivered'))::int AS avg_delivery_min,
      COUNT(odo.id) FILTER (WHERE odo.status='rejected')::int        AS total_rejections,
      COUNT(odo.id) FILTER (WHERE odo.status='expired')::int         AS total_expirations
      FROM users d JOIN driver_profiles dp ON dp.user_id=d.id
      LEFT JOIN orders o ON o.driver_id=d.id AND o.created_at > NOW() - (${days}::int * INTERVAL '1 day')
      LEFT JOIN order_driver_offers odo ON odo.driver_id=d.id
      WHERE d.role='driver'
      GROUP BY d.id, d.full_name, dp.is_available, dp.vehicle_type
      ORDER BY delivered DESC`),

      query(`SELECT c.id, c.full_name AS name,
      COUNT(o.id)::int                                               AS total_orders,
      COUNT(o.id) FILTER (WHERE o.status='delivered')::int           AS delivered,
      COUNT(o.id) FILTER (WHERE o.status='cancelled')::int           AS cancelled,
      COALESCE(SUM(o.total_cents) FILTER (WHERE o.status='delivered'),0)::bigint AS total_spent_cents
      FROM users c LEFT JOIN orders o ON o.customer_id=c.id AND o.created_at > NOW() - (${days}::int * INTERVAL '1 day')
      WHERE c.role='customer'
      GROUP BY c.id, c.full_name ORDER BY total_orders DESC LIMIT 50`),

      query(`SELECT EXTRACT(HOUR FROM created_at)::int AS hour, COUNT(*)::int AS orders
      FROM orders WHERE created_at > NOW() - (${days}::int * INTERVAL '1 day')
      GROUP BY hour ORDER BY hour`),
    ]);

    return res.json({
      summary:      summary.rows[0],
      timings:      timings.rows[0],
      byRestaurant: byRestaurant.rows,
      byDriver:     byDriver.rows,
      byCustomer:   byCustomer.rows,
      byHour:       byHour.rows,
    });
  } catch (error) { return next(error); }
});

/* ── GET /admin/offer-stats ── */
router.get('/offer-stats', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const result = await query(`
    SELECT
    o.id                                          AS order_id,
    o.status,
    o.created_at,
    r.name                                        AS restaurant_name,
    (SELECT COUNT(DISTINCT driver_id)::int
    FROM order_driver_offers
    WHERE order_id = o.id
    AND status IN ('rejected','expired','released')) + 1  AS round,
    (SELECT COUNT(*)::int FROM order_driver_offers
    WHERE order_id = o.id AND status = 'pending')           AS pending,
    (SELECT COUNT(*)::int FROM order_driver_offers
    WHERE order_id = o.id AND status = 'rejected')          AS rejected,
    (SELECT COUNT(*)::int FROM order_driver_offers
    WHERE order_id = o.id AND status = 'expired')           AS expired,
    (SELECT split_part(u.full_name,'_',1)
    FROM order_driver_offers od2
    JOIN users u ON u.id = od2.driver_id
    WHERE od2.order_id = o.id AND od2.status = 'pending'
    LIMIT 1)                                                AS current_driver
    FROM orders o
    JOIN restaurants r ON r.id = o.restaurant_id
    WHERE o.driver_id IS NULL
    AND o.status NOT IN ('delivered','cancelled')
    ORDER BY o.created_at ASC
    LIMIT 50`);
    return res.json({ stats: result.rows });
  } catch (error) { return next(error); }
});

/* ── GET /admin/assignment-live ── */
router.get('/assignment-live', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const ordersResult = await query(`
    SELECT
    o.id, o.status, o.created_at, o.updated_at,
    o.total_cents, o.payment_method, o.tip_cents,
    o.service_fee_cents, o.delivery_fee_cents,
    r.name    AS restaurant_name,
    r.is_open AS restaurant_open,
    r.address AS restaurant_address,
    c.full_name AS customer_name,
    d.id        AS driver_id,
    d.full_name AS driver_name,
    dp.is_available AS driver_available,
    dp.vehicle_type,
    (SELECT COUNT(DISTINCT od.driver_id)::int
    FROM order_driver_offers od
    WHERE od.order_id=o.id
    AND od.status IN ('rejected','expired','released')) + 1  AS round,
    (SELECT od2.driver_id
    FROM order_driver_offers od2
    WHERE od2.order_id=o.id AND od2.status='pending'
    LIMIT 1)                                                   AS pending_driver_id,
    (SELECT u2.full_name
    FROM order_driver_offers od2
    JOIN users u2 ON u2.id=od2.driver_id
    WHERE od2.order_id=o.id AND od2.status='pending'
    LIMIT 1)                                                   AS pending_driver_name,
    (SELECT od2.updated_at
    FROM order_driver_offers od2
    WHERE od2.order_id=o.id AND od2.status='pending'
    LIMIT 1)                                                   AS offer_started_at,
    (SELECT COUNT(*)::int FROM order_driver_offers od WHERE od.order_id=o.id AND od.status='rejected') AS rejected_count,
    (SELECT COUNT(*)::int FROM order_driver_offers od WHERE od.order_id=o.id AND od.status='expired')  AS expired_count
    FROM orders o
    JOIN restaurants r ON r.id=o.restaurant_id
    JOIN users c ON c.id=o.customer_id
    LEFT JOIN users d ON d.id=o.driver_id
    LEFT JOIN driver_profiles dp ON dp.user_id=o.driver_id
    WHERE o.status NOT IN ('delivered','cancelled')
    ORDER BY o.created_at ASC
    LIMIT 100`);

    const driversResult = await query(`
    SELECT
    u.id, u.full_name, u.status AS user_status,
    dp.is_available, dp.vehicle_type, dp.driver_number,
    dp.last_lat, dp.last_lng,
    (SELECT COUNT(*)::int FROM orders o
    WHERE o.driver_id=u.id
    AND o.status IN ('assigned','accepted','preparing','ready','on_the_way')
    ) AS active_orders,
    (SELECT od.order_id FROM order_driver_offers od
    WHERE od.driver_id=u.id AND od.status='pending'
    ORDER BY od.updated_at DESC LIMIT 1)                    AS pending_offer_order_id,
    (SELECT od.updated_at FROM order_driver_offers od
    WHERE od.driver_id=u.id AND od.status='pending'
    ORDER BY od.updated_at DESC LIMIT 1)                    AS pending_offer_started_at,
    (SELECT json_agg(json_build_object(
      'order_id', od.order_id,
      'wait_until', od.wait_until,
      'secs_left', GREATEST(0, EXTRACT(EPOCH FROM (od.wait_until - NOW()))::int)
    ))
    FROM order_driver_offers od
    WHERE od.driver_id=u.id
    AND od.status IN ('rejected','released','expired')
    AND od.wait_until > NOW()
    )                                                          AS cooldowns
    FROM users u
    JOIN driver_profiles dp ON dp.user_id=u.id
    WHERE u.role='driver'
    ORDER BY dp.driver_number ASC`);

    return res.json({ orders: ordersResult.rows, drivers: driversResult.rows });
  } catch (error) { return next(error); }
});

/* ── GET /admin/ratings ── */
router.get('/ratings', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const r = await query(
      `SELECT rt.id, rt.order_id, rt.restaurant_stars, rt.driver_stars,
      rt.restaurant_rates_driver, rt.driver_rates_restaurant,
      rt.comment, rt.driver_comment, rt.restaurant_comment,
      rt.created_at,
      rest.name AS restaurant_name,
      c.full_name AS customer_name,
      d.full_name AS driver_name
      FROM order_ratings rt
      JOIN restaurants rest ON rest.id = rt.restaurant_id
      JOIN users c ON c.id = rt.customer_id
      LEFT JOIN users d ON d.id = rt.driver_id
      ORDER BY rt.created_at DESC
      LIMIT 200`, []
    ).catch(() => ({ rows: [] }));
    return res.json({ ratings: r.rows });
  } catch (error) { return next(error); }
});

/* ── GET /admin/order-notes ── */
router.get('/order-notes', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const r = await query(
      `SELECT o.id, o.status, o.driver_note, o.restaurant_note, o.cancelled_at,
      o.created_at, o.updated_at,
      rest.name AS restaurant_name,
      c.full_name AS customer_name,
      d.full_name AS driver_name
      FROM orders o
      JOIN restaurants rest ON rest.id = o.restaurant_id
      JOIN users c ON c.id = o.customer_id
      LEFT JOIN users d ON d.id = o.driver_id
      WHERE (o.driver_note IS NOT NULL OR o.restaurant_note IS NOT NULL)
      AND o.status IN ('cancelled', 'delivered')
      ORDER BY o.updated_at DESC
      LIMIT 100`, []
    );
    return res.json({ notes: r.rows });
  } catch (error) { return next(error); }
});

/* ── GET /admin/reports ── */
router.get('/reports', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const reviewed = req.query.reviewed === 'true';
    const r = await query(
      `SELECT rp.id, rp.order_id, rp.reporter_role, rp.reason, rp.text, rp.reviewed, rp.created_at,
      u.full_name AS reporter_name,
      o.status AS order_status,
      rest.name AS restaurant_name
      FROM order_reports rp
      JOIN users u ON u.id = rp.reporter_id
      JOIN orders o ON o.id = rp.order_id
      JOIN restaurants rest ON rest.id = o.restaurant_id
      WHERE rp.reviewed = $1
      ORDER BY rp.created_at DESC
      LIMIT 100`, [reviewed]
    );
    return res.json({ reports: r.rows });
  } catch (error) { return next(error); }
});

/* ── PATCH /admin/reports/:id/review ── */
router.patch('/reports/:id/review', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    await query('UPDATE order_reports SET reviewed=true WHERE id=$1', [req.params.id]);
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

/* ── GET /admin/sse-status ── */
router.get('/sse-status', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const stats = sseHub.getStats();
    return res.json(stats);
  } catch (error) { return next(error); }
});

export default router;
