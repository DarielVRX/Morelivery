// backend/modules/admin/routes.js
import { Router } from 'express';
import { query } from '../../config/db.js';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { AppError } from '../../utils/errors.js';
import { registerUser } from '../auth/service.js';

const router = Router();

/* ── GET /admin/orders ── */
router.get('/orders', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const { status, limit = 200, offset = 0 } = req.query;
    const where = status ? `WHERE o.status = $3` : '';
    const params = status ? [Number(limit), Number(offset), status] : [Number(limit), Number(offset)];

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
    const countResult = await query(`SELECT COUNT(*)::int AS n FROM orders ${where}`, status ? [status] : []);
    return res.json({ orders, total: countResult.rows[0].n });
  } catch (error) { return next(error); }
});

/* ── GET /admin/metrics ── */
router.get('/metrics', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const days = Math.max(1, Math.min(90, parseInt(req.query.days) || 7));
    // days está sanitizado con parseInt + clamp (1-90), seguro para interpolar como entero

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

/* ── GET /admin/users ── */
router.get('/users', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const result = await query(`
      SELECT u.id, u.full_name, u.email, u.role, u.status, u.created_at,
             dp.is_available, dp.vehicle_type, dp.is_verified,
             r.name AS restaurant_name, r.is_open AS restaurant_is_open
      FROM users u
      LEFT JOIN driver_profiles dp ON dp.user_id=u.id
      LEFT JOIN restaurants r ON r.owner_user_id=u.id
      ORDER BY u.created_at DESC`);
    return res.json({ users: result.rows });
  } catch (error) { return next(error); }
});

/* ── PATCH /admin/users/:id/status ── */
router.patch('/users/:id/status', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['active','suspended'].includes(status)) return next(new AppError(400, 'Estado inválido, debe ser active o suspended'));
    await query('UPDATE users SET status=$1 WHERE id=$2', [status, req.params.id]);
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

/* ── POST /admin/register — solo admins crean admins ── */
router.post('/register', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const user = await registerUser({ ...req.body, role: 'admin' });
    return res.status(201).json({ user });
  } catch (error) { return next(error); }
});

/* ── PATCH /admin/orders/:id/status — override de emergencia ── */
router.patch('/orders/:id/status', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const { status, note } = req.body || {};
    if (!status) return next(new AppError(400, 'El campo status es requerido'));
    const tsCol = { accepted:'accepted_at', preparing:'preparing_at', ready:'ready_at', on_the_way:'picked_up_at', delivered:'delivered_at', cancelled:'cancelled_at' }[status];
    const tsClause = tsCol ? `, ${tsCol} = NOW()` : '';
    await query(
      `UPDATE orders SET status=$1, restaurant_note=COALESCE($2, restaurant_note), updated_at=NOW()${tsClause} WHERE id=$3`,
      [status, note || null, req.params.id]
    );
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

/* ── GET /admin/offer-stats — estado de asignación de pedidos sin driver ── */
router.get('/offer-stats', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const result = await query(`
      SELECT
        o.id                                          AS order_id,
        o.status,
        o.created_at,
        r.name                                        AS restaurant_name,
        -- Ronda actual = drivers distintos procesados + 1
        (SELECT COUNT(DISTINCT driver_id)::int
           FROM order_driver_offers
           WHERE order_id = o.id
             AND status IN ('rejected','expired','released')) + 1  AS round,
        -- Ofertas pendientes ahora mismo
        (SELECT COUNT(*)::int FROM order_driver_offers
           WHERE order_id = o.id AND status = 'pending')           AS pending,
        -- Total rechazos
        (SELECT COUNT(*)::int FROM order_driver_offers
           WHERE order_id = o.id AND status = 'rejected')          AS rejected,
        -- Total expiradas
        (SELECT COUNT(*)::int FROM order_driver_offers
           WHERE order_id = o.id AND status = 'expired')           AS expired,
        -- Driver con oferta pendiente ahora
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
      LIMIT 50
    `);
    return res.json({ stats: result.rows });
  } catch (error) { return next(error); }
});

export default router;
