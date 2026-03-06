// backend/modules/drivers/routes.js
import { Router } from 'express';
import { query } from '../../config/db.js';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { offerOrdersToDriver, expireTimedOutOffers } from '../orders/assignment.js';
import { sseHub } from '../events/hub.js';
import { AppError } from '../../utils/errors.js';

const router = Router();

function isMissingColumnError(e) { return e?.code === '42703'; }
function isMissingRelationError(e) { return e?.code === '42P01'; }

/* \u2500\u2500 POST /drivers/listener \u2014 driver anuncia presencia, recibe ofertas pendientes \u2500\u2500 */
router.post('/listener', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    await expireTimedOutOffers();
    await offerOrdersToDriver(req.user.userId);
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

/* \u2500\u2500 PATCH /drivers/availability \u2500\u2500 */
router.patch('/availability', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const { isAvailable } = req.body;
    const result = await query(
      'UPDATE driver_profiles SET is_available = $1 WHERE user_id = $2 RETURNING *',
      [Boolean(isAvailable), req.user.userId]
    );
    if (result.rowCount === 0) return next(new AppError(404, 'Driver profile not found'));

    if (isAvailable) {
      // Al volver disponible, intentar asignar pedidos en espera
      await offerOrdersToDriver(req.user.userId);
    }

    return res.json({ profile: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

/* \u2500\u2500 GET /drivers/offers \u2014 pedidos ofertados al driver \u2500\u2500 */
router.get('/offers', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    let result;
    try {
      result = await query(
        `SELECT o.id, o.total_cents, o.status, o.delivery_address AS customer_address,
                r.name AS restaurant_name, r.address AS restaurant_address,
                split_part(c.full_name, '_', 1) AS customer_first_name,
                od.created_at AS offer_created_at
         FROM order_driver_offers od
         JOIN orders o ON o.id = od.order_id
         JOIN restaurants r ON r.id = o.restaurant_id
         JOIN users c ON c.id = o.customer_id
         WHERE od.driver_id = $1 AND od.status = 'pending' AND o.driver_id IS NULL
         ORDER BY od.created_at ASC`,
        [req.user.userId]
      );
    } catch (e) {
      if (!isMissingColumnError(e) && !isMissingRelationError(e)) throw e;
      result = { rows: [] };
    }

    // Obtener items para cada oferta
    const orderIds = result.rows.map(r => r.id);
    let itemsByOrder = new Map();
    if (orderIds.length > 0) {
      try {
        const items = await query(
          `SELECT oi.order_id, oi.menu_item_id, oi.quantity, oi.unit_price_cents,
                  COALESCE(mi.name, 'Producto') AS name
           FROM order_items oi
           LEFT JOIN menu_items mi ON mi.id = oi.menu_item_id
           WHERE oi.order_id = ANY($1::uuid[])`,
          [orderIds]
        );
        for (const row of items.rows) {
          if (!itemsByOrder.has(row.order_id)) itemsByOrder.set(row.order_id, []);
          itemsByOrder.get(row.order_id).push({
            menuItemId: row.menu_item_id, name: row.name,
            quantity: row.quantity, unitPriceCents: row.unit_price_cents
          });
        }
      } catch (_) {}
    }

    const offers = result.rows.map(r => ({ ...r, items: itemsByOrder.get(r.id) || [] }));
    return res.json({ offers });
  } catch (error) {
    return next(error);
  }
});

/* \u2500\u2500 POST /drivers/offers/:orderId/accept \u2500\u2500 */
router.post('/offers/:orderId/accept', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    // Verificar que la oferta existe y sigue pendiente
    const offer = await query(
      `SELECT * FROM order_driver_offers WHERE order_id = $1 AND driver_id = $2 AND status = 'pending'`,
      [req.params.orderId, req.user.userId]
    );
    if (offer.rowCount === 0) return next(new AppError(404, 'Offer not found or already taken'));

    // Asignar driver al pedido
    await query(
      `UPDATE orders SET driver_id = $1, status = 'assigned', updated_at = NOW() WHERE id = $2 AND driver_id IS NULL`,
      [req.user.userId, req.params.orderId]
    );

    // Marcar oferta como aceptada, rechazar las dem\u00e1s para este pedido
    await query(`UPDATE order_driver_offers SET status = 'accepted' WHERE order_id = $1 AND driver_id = $2`, [req.params.orderId, req.user.userId]);
    await query(`UPDATE order_driver_offers SET status = 'rejected' WHERE order_id = $1 AND driver_id != $2`, [req.params.orderId, req.user.userId]);

    // Notificar por SSE al restaurante y al cliente
    const orderInfo = await query(
      `SELECT o.*, r.owner_user_id AS restaurant_owner_id
       FROM orders o JOIN restaurants r ON r.id = o.restaurant_id
       WHERE o.id = $1`,
      [req.params.orderId]
    );
    if (orderInfo.rowCount > 0) {
      const ord = orderInfo.rows[0];
      const payload = { orderId: ord.id, status: 'assigned', driverId: req.user.userId };
      sseHub.sendToUser(ord.customer_id, 'order_update', payload);
      sseHub.sendToUser(ord.restaurant_owner_id, 'order_update', payload);
    }

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

/* \u2500\u2500 POST /drivers/offers/:orderId/reject \u2500\u2500 */
router.post('/offers/:orderId/reject', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const { note } = req.body || {};
    await query(
      `UPDATE order_driver_offers SET status = 'rejected', updated_at = NOW() WHERE order_id = $1 AND driver_id = $2`,
      [req.params.orderId, req.user.userId]
    );
    // Intentar ofrecer al siguiente
    await expireTimedOutOffers();
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

/* ── POST /drivers/orders/:orderId/release ── */
router.post('/orders/:orderId/release', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const { note } = req.body || {};
    const orderId = req.params.orderId;
    const driverId = req.user.userId;

    const r = await query(
      `UPDATE orders SET driver_id = NULL, status = 'pending_driver',
       driver_note = $1, updated_at = NOW()
       WHERE id = $2 AND driver_id = $3 RETURNING id`,
      [note || null, orderId, driverId]
    );
    if (r.rowCount === 0) return next(new AppError(404, 'Pedido no encontrado o no asignado a ti'));

    // Marcar como released para no re-ofrecer al mismo driver
    await query(
      `UPDATE order_driver_offers SET status = 'released', updated_at = NOW()
       WHERE order_id = $1 AND driver_id = $2`,
      [orderId, driverId]
    );

    // Re-ofrecer a otros drivers
    try { await expireTimedOutOffers(); } catch (_) {}

    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

/* \u2500\u2500 PATCH /drivers/location \u2014 driver env\u00eda posici\u00f3n GPS \u2500\u2500 */
router.patch('/location', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const { lat, lng } = req.body || {};
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return next(new AppError(400, 'lat y lng son requeridos'));
    }

    // Guardar en driver_profiles
    try {
      await query(
        'UPDATE driver_profiles SET last_lat = $1, last_lng = $2 WHERE user_id = $3',
        [lat, lng, req.user.userId]
      );
    } catch (e) {
      if (!isMissingColumnError(e)) throw e;
    }

    // Buscar pedidos activos del driver para notificar a clientes y restaurantes
    const activeOrders = await query(
      `SELECT o.id, o.customer_id, r.owner_user_id AS restaurant_owner_id
       FROM orders o
       JOIN restaurants r ON r.id = o.restaurant_id
       WHERE o.driver_id = $1 AND o.status IN ('assigned','accepted','preparing','ready','on_the_way')`,
      [req.user.userId]
    );

    for (const ord of activeOrders.rows) {
      const locationPayload = { orderId: ord.id, driverId: req.user.userId, lat, lng };
      sseHub.sendToUser(ord.customer_id, 'driver_location', locationPayload);
      sseHub.sendToUser(ord.restaurant_owner_id, 'driver_location', locationPayload);
    }

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

export default router;
