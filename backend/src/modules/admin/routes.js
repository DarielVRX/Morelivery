// backend/src/modules/admin/routes.js
import { Router } from 'express';
import { query } from '../../config/db.js';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { AppError } from '../../utils/errors.js';
import { registerUser } from '../auth/service.js';
import { getParamsWithMeta, saveParam } from '../../engine/params.js';
import { sseHub } from '../events/hub.js';
import webpush from 'web-push';
import { sendPushToUser } from '../notifications/pushSubscription.js';
import exportRoutes from './export.js';

// Configurar VAPID (asegúrate de tener las variables de entorno)
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(
    'mailto:admin@morelivery.com',
    vapidPublicKey,
    vapidPrivateKey
  );
} else {
  console.warn('[admin] VAPID keys no configuradas, push no funcionará');
}

const router = Router();

router.use('/orders', exportRoutes);

/* ── GET /admin/orders ── */
router.get('/orders', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const { status, limit = 200, offset = 0 } = req.query;
    const whereClause = status ? `WHERE o.status = $3` : '';
    const params = status ? [Number(limit), Number(offset), status] : [Number(limit), Number(offset)];
    const where = whereClause; // alias para mantener compatibilidad

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

/* ── GET /admin/assignment-live — estado en vivo de todos los pedidos activos + drivers ── */
router.get('/assignment-live', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    // ── 1. Todos los pedidos activos (no entregados ni cancelados) ─────────
    const ordersResult = await query(`
    SELECT
    o.id, o.status, o.created_at, o.updated_at,
    o.total_cents, o.payment_method, o.tip_cents,
    o.service_fee_cents, o.delivery_fee_cents,
    r.name    AS restaurant_name,
    r.is_open AS restaurant_open,
    r.address AS restaurant_address,
    c.full_name AS customer_name,
    -- Driver asignado
    d.id        AS driver_id,
    d.full_name AS driver_name,
    dp.is_available AS driver_available,
    dp.vehicle_type,
    -- Ronda
    (SELECT COUNT(DISTINCT od.driver_id)::int
    FROM order_driver_offers od
    WHERE od.order_id=o.id
    AND od.status IN ('rejected','expired','released')) + 1  AS round,
                                     -- Oferta pending ahora mismo
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
                                     -- Contadores
                                     (SELECT COUNT(*)::int FROM order_driver_offers od WHERE od.order_id=o.id AND od.status='rejected') AS rejected_count,
                                     (SELECT COUNT(*)::int FROM order_driver_offers od WHERE od.order_id=o.id AND od.status='expired')  AS expired_count
                                     FROM orders o
                                     JOIN restaurants r ON r.id=o.restaurant_id
                                     JOIN users c ON c.id=o.customer_id
                                     LEFT JOIN users d ON d.id=o.driver_id
                                     LEFT JOIN driver_profiles dp ON dp.user_id=o.driver_id
                                     WHERE o.status NOT IN ('delivered','cancelled')
                                     ORDER BY o.created_at ASC
                                     LIMIT 100
                                     `);

    // ── 2. Estado de todos los drivers ─────────────────────────────────────
    const driversResult = await query(`
    SELECT
    u.id, u.full_name, u.status AS user_status,
    dp.is_available, dp.vehicle_type, dp.driver_number,
    dp.last_lat, dp.last_lng,
    -- Pedidos activos asignados
    (SELECT COUNT(*)::int FROM orders o
    WHERE o.driver_id=u.id
    AND o.status IN ('assigned','accepted','preparing','ready','on_the_way')
    ) AS active_orders,
    -- ¿Tiene pending offer ahora mismo?
    (SELECT od.order_id FROM order_driver_offers od
    WHERE od.driver_id=u.id AND od.status='pending'
    ORDER BY od.updated_at DESC LIMIT 1)                    AS pending_offer_order_id,
    (SELECT od.updated_at FROM order_driver_offers od
    WHERE od.driver_id=u.id AND od.status='pending'
    ORDER BY od.updated_at DESC LIMIT 1)                    AS pending_offer_started_at,
    -- Cooldowns activos — pedidos donde tiene wait_until > NOW()
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
    ORDER BY dp.driver_number ASC
    `);

    return res.json({
      orders:  ordersResult.rows,
      drivers: driversResult.rows,
    });
  } catch (error) { return next(error); }
});

// ── GET /admin/engine-params — listar todos los parámetros del motor ──────────
router.get('/engine-params', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const params = await getParamsWithMeta();
    return res.json({ params });
  } catch (error) { return next(error); }
});

// ── PATCH /admin/engine-params/:key — actualizar un parámetro ─────────────────
router.patch('/engine-params/:key', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const { value } = req.body;
    if (value === undefined || value === null) {
      return next(new AppError(400, 'Se requiere el campo value'));
    }
    await saveParam(req.params.key, value, req.user.userId);
    const params = await getParamsWithMeta();
    return res.json({ ok: true, params });
  } catch (error) {
    if (error.message?.startsWith('Parámetro desconocido') ||
      error.message?.startsWith('Valor inválido')) {
      return next(new AppError(400, error.message));
      }
      return next(error);
  }
});

// ── GET /admin/reports — reportes pendientes de revisión ─────────────────────
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
      LIMIT 100`,
      [reviewed]
    );
    return res.json({ reports: r.rows });
  } catch (error) { return next(error); }
});

// ── PATCH /admin/reports/:id/review — marcar reporte como revisado ────────────
router.patch('/reports/:id/review', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    await query('UPDATE order_reports SET reviewed=true WHERE id=$1', [req.params.id]);
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

// ── GET /admin/order-notes — notas de cancelación y liberación ───────────────
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
      LIMIT 100`,
      []
    );
    return res.json({ notes: r.rows });
  } catch (error) { return next(error); }
});

// ── GET /admin/ratings — todas las calificaciones ─────────────────────────────
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
      LIMIT 200`,
      []
    ).catch(() => ({ rows: [] }));
    return res.json({ ratings: r.rows });
  } catch (error) { return next(error); }
});

// ── GET /admin/sse-status — estado de conexiones SSE ─────────────────────────
router.get('/sse-status', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const stats = sseHub.getStats();
    return res.json(stats);
  } catch (error) {
    return next(error);
  }
});

// ── POST /admin/test-push — enviar notificación push de prueba ───────────────
router.post('/test-push', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const results = await sendPushToUser(req.user.userId, {
      title: '🔔 Notificación de prueba',
      body: 'Esta es una notificación push de alta prioridad.',
      tag: 'test',
      group: 'test',
      priority: 'high',
      url: '/admin',
      vibrate: [300, 100, 300, 100, 300],
      requireInteraction: true,
    });
    const sent = results.filter(r => r.status === 'fulfilled').length;
    if (sent === 0) return next(new AppError(400, 'No hay suscripciones push activas para este usuario'));
    res.json({ ok: true, sent });
  } catch (error) {
    console.error('Error enviando push test:', error);
    return next(new AppError(500, 'Error al enviar notificación push'));
  }
});

// POST /admin/schedule-voice-reminders
router.post('/schedule-voice-reminders', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const userId = req.user.userId;

    // Verificar que hay al menos una suscripción antes de programar
    const check = await query(
      `SELECT 1 FROM push_subscriptions WHERE user_id = $1 LIMIT 1`,
      [userId]
    );
    if (check.rowCount === 0) {
      return res.status(400).json({ error: 'No hay suscripción push registrada para este usuario' });
    }

    // Programar primera notificación (30s)
    setTimeout(async () => {
      try {
        await sendPushToUser(userId, {
          title: '🔔 Recordatorio de prueba (30s)',
          body: 'Han pasado 30 segundos.',
          priority: 'high',
          tag: 'test-reminder-30s',
          url: '/admin',
          vibrate: [500, 150, 500, 150, 500, 300, 100, 100, 150, 100, 150, 100, 100],
        });
        console.log('[admin] Push 30s enviado');
      } catch (e) {
        console.error('Error en push 30s:', e);
      }
    }, 30000);

    // Programar segunda notificación (5 minutos)
    setTimeout(async () => {
      try {
        await sendPushToUser(userId, {
          title: '⏰ Recordatorio de prueba (5 min)',
          body: 'Han pasado 5 minutos.',
          priority: 'high',
          tag: 'test-reminder-5min',
          url: '/admin',
          vibrate: [500, 150, 500, 150, 500, 300, 100, 100, 150, 100, 150, 100, 100],
          requireInteraction: true,
        });
        console.log('[admin] Push 5min enviado');
      } catch (e) {
        console.error('Error en push 5min:', e);
      }
    }, 300000);

    res.json({ ok: true, message: 'Recordatorios programados' });
  } catch (error) {
    console.error('Error en schedule-voice-reminders:', error);
    next(error);
  }
});

router.post('/drivers/:id/reset-cooldowns', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const driverId = req.params.id;

    // Solo limpiar cooldowns de pedidos aún abiertos (no entregados/cancelados)
    const result = await query(
      `UPDATE order_driver_offers
      SET wait_until = NOW() - INTERVAL '1 second',
                               updated_at = NOW()
                               WHERE driver_id = $1
                               AND status IN ('rejected', 'released', 'expired')
                               AND wait_until > NOW()
                               AND order_id IN (
                                 SELECT id FROM orders
                                 WHERE status NOT IN ('delivered', 'cancelled')
                               )
                               RETURNING order_id`,
                               [driverId]
    );

    const orderIds = [...new Set(result.rows.map(r => r.order_id))];

    // Notificar via SSE al driver que puede recibir ofertas de nuevo
    sseHub.sendToUser(driverId, 'cooldowns_cleared', { message: 'Tus restricciones han sido eliminadas por el administrador.' });

    console.log(`[admin.emergency] reset-cooldowns driver=${driverId.slice(0,8)} affected=${orderIds.length} orders`);
    return res.json({ ok: true, clearedOrders: orderIds.length });
  } catch (error) { return next(error); }
});

// ── POST /admin/users/:id/clear-penalties ─────────────────────────────────────
// Elimina las penalizaciones de desconexión acumuladas de un driver.
// Las penalizaciones afectan el scoring — un driver penalizado recibe menos ofertas.
router.post('/users/:id/clear-penalties', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const result = await query(
      `UPDATE driver_profiles
      SET disconnect_penalties = 0,
      updated_at = NOW()
      WHERE user_id = $1
      RETURNING user_id, disconnect_penalties`,
      [req.params.id]
    );
    if (result.rowCount === 0) return next(new AppError(404, 'Driver no encontrado'));

    sseHub.sendToUser(req.params.id, 'penalties_cleared', { message: 'Tus penalizaciones han sido eliminadas.' });
    console.log(`[admin.emergency] clear-penalties driver=${req.params.id.slice(0,8)}`);
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

// ── POST /admin/drivers/:id/force-available ───────────────────────────────────
// Fuerza is_available=true en el perfil del driver y re-encola pedidos abiertos.
// Útil si el driver se desconectó sin ponerse en "no disponible" y hay pedidos esperando.
router.post('/drivers/:id/force-available', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const driverId = req.params.id;

    const result = await query(
      `UPDATE driver_profiles
      SET is_available = true,
      session_rebalances = 0,
      session_releases   = 0,
      session_cancels    = 0,
      session_expires    = 0,
      session_started_at = NOW()
      WHERE user_id = $1
      RETURNING user_id`,
      [driverId]
    );
    if (result.rowCount === 0) return next(new AppError(404, 'Driver no encontrado'));

    // Limpiar reconnect_deadline si el driver tenía pedido on_the_way
    await query(
      `UPDATE orders
      SET reconnect_deadline = NULL, updated_at = NOW()
      WHERE driver_id = $1 AND status = 'on_the_way' AND reconnect_deadline IS NOT NULL`,
      [driverId]
    ).catch(() => {});

    // Re-encolar pedidos abiertos para que este driver pueda recibirlos
    try {
      const { getQueuedOrders, serializedOffer } = await import('../orders/assignment/index.js');
      const { offerNextDrivers } = await import('../orders/assignment/core.js');
      const { offerCb } = await import('../events/offerCallback.js');
      const openOrders = await getQueuedOrders();
      for (const ord of openOrders) {
        serializedOffer(ord.id, offerNextDrivers, offerCb);
      }
      console.log(`[admin.emergency] force-available driver=${driverId.slice(0,8)} requeued=${openOrders.length}`);
    } catch (e) {
      console.warn('[admin.emergency] force-available: error re-encolando:', e.message);
    }

    sseHub.sendToUser(driverId, 'forced_available', { message: 'El administrador te ha puesto en modo disponible.' });
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

// ── POST /admin/restaurants/:userId/silent-close ──────────────────────────────
// Cierra un restaurante sin notificar al dueño por SSE.
// Los clientes verán el restaurante como "cerrado" inmediatamente.
router.post('/restaurants/:userId/silent-close', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const result = await query(
      `UPDATE restaurants
      SET is_open = false, updated_at = NOW()
      WHERE owner_user_id = $1
      RETURNING id, name`,
      [req.params.userId]
    );
    if (result.rowCount === 0) return next(new AppError(404, 'Restaurante no encontrado'));
    console.log(`[admin.emergency] silent-close restaurant=${result.rows[0].name} by admin`);
    return res.json({ ok: true, restaurant: result.rows[0] });
  } catch (error) { return next(error); }
});

// ── POST /admin/restaurants/:userId/silent-open ───────────────────────────────
// Abre un restaurante silenciosamente (ej: abrió pero olvidó cambiar el estado).
router.post('/restaurants/:userId/silent-open', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const result = await query(
      `UPDATE restaurants
      SET is_open = true, updated_at = NOW()
      WHERE owner_user_id = $1
      RETURNING id, name`,
      [req.params.userId]
    );
    if (result.rowCount === 0) return next(new AppError(404, 'Restaurante no encontrado'));
    console.log(`[admin.emergency] silent-open restaurant=${result.rows[0].name} by admin`);
    return res.json({ ok: true, restaurant: result.rows[0] });
  } catch (error) { return next(error); }
});


// ── POST /admin/users/:id/create-restaurant ───────────────────────────────────
// FIX: endpoint faltante referenciado en EmergencyTab.jsx fast-register.
// Antes el admin veía ✓ pero el restaurante nunca se creaba.
router.post('/users/:id/create-restaurant', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const { name, address, lat, lng, is_open = false } = req.body || {};
    if (!name) return next(new AppError(400, 'El campo name es requerido'));

    const userCheck = await query('SELECT id, role FROM users WHERE id = $1', [req.params.id]);
    if (userCheck.rowCount === 0) return next(new AppError(404, 'Usuario no encontrado'));

    // Si ya tiene restaurante, actualizar en lugar de duplicar
    const existingRest = await query(
      'SELECT id FROM restaurants WHERE owner_user_id = $1 LIMIT 1',
      [req.params.id]
    );
    if (existingRest.rowCount > 0) {
      const updated = await query(
        `UPDATE restaurants
         SET name=$1, address=COALESCE($2, address),
             lat=COALESCE($3, lat), lng=COALESCE($4, lng),
             updated_at=NOW()
         WHERE owner_user_id=$5
         RETURNING id, name`,
        [name, address || null, lat ? Number(lat) : null, lng ? Number(lng) : null, req.params.id]
      );
      console.log(`[admin.emergency] update-restaurant user=${req.params.id.slice(0,8)} restaurant=${updated.rows[0].id.slice(0,8)}`);
      return res.json({ ok: true, restaurant: updated.rows[0], updated: true });
    }

    const result = await query(
      `INSERT INTO restaurants (owner_user_id, name, address, lat, lng, is_open, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, true, NOW(), NOW())
       RETURNING id, name`,
      [req.params.id, name, address || '', lat ? Number(lat) : null, lng ? Number(lng) : null, Boolean(is_open)]
    );

    await query(
      `UPDATE users SET role='restaurant', updated_at=NOW() WHERE id=$1 AND role != 'restaurant'`,
      [req.params.id]
    ).catch(() => {});

    console.log(`[admin.emergency] create-restaurant user=${req.params.id.slice(0,8)} restaurant=${result.rows[0].id.slice(0,8)}`);
    return res.status(201).json({ ok: true, restaurant: result.rows[0] });
  } catch (error) { return next(error); }
});

// ── POST /admin/drivers/:id/force-unavailable ─────────────────────────────────
// FIX: endpoint faltante referenciado en EmergencyTab.jsx fast-register.
// Antes el driver quedaba available=true por defecto y recibía ofertas inmediatamente.
router.post('/drivers/:id/force-unavailable', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const driverId = req.params.id;

    const result = await query(
      `UPDATE driver_profiles SET is_available=false, updated_at=NOW()
       WHERE user_id=$1 RETURNING user_id`,
      [driverId]
    );

    // Si el perfil aún no existe (driver recién creado), crearlo con is_available=false
    if (result.rowCount === 0) {
      try {
        await query(
          `INSERT INTO driver_profiles (user_id, is_available, vehicle_type, created_at, updated_at)
           VALUES ($1, false, 'motorcycle', NOW(), NOW())
           ON CONFLICT (user_id) DO UPDATE SET is_available=false, updated_at=NOW()`,
          [driverId]
        );
      } catch (insertErr) {
        console.warn(`[admin.emergency] force-unavailable: no se pudo crear perfil driver=${driverId.slice(0,8)}:`, insertErr.message);
        return res.json({ ok: true, skipped: true });
      }
    }

    sseHub.sendToUser(driverId, 'forced_unavailable', {
      message: 'Tu cuenta está pendiente de activación por el administrador.',
    });

    console.log(`[admin.emergency] force-unavailable driver=${driverId.slice(0,8)}`);
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

export default router;
