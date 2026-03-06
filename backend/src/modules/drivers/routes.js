// backend/modules/drivers/routes.js
import { Router } from 'express';
import { query } from '../../config/db.js';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { offerOrdersToDriver, expireTimedOutOffers, acceptOffer, rejectOffer, releaseOrder } from '../orders/assignment.js';
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
    if (result.rowCount === 0) return next(new AppError(404, 'Perfil de driver no encontrado'));

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

/* ── POST /drivers/offers/:orderId/accept ── */
router.post('/offers/:orderId/accept', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    // Verificar que la oferta existe y sigue pendiente antes de intentar el mutex
    const offer = await query(
      `SELECT 1 FROM order_driver_offers WHERE order_id = $1 AND driver_id = $2 AND status = 'pending'`,
      [req.params.orderId, req.user.userId]
    );
    if (offer.rowCount === 0) return next(new AppError(404, 'Oferta no encontrada o ya tomada por otro driver'));

    // acceptOffer usa FOR UPDATE SKIP LOCKED — evita doble asignación si dos drivers aceptan simultáneamente
    const assigned = await acceptOffer(req.params.orderId, req.user.userId);
    if (!assigned) return next(new AppError(409, 'El pedido ya fue tomado por otro driver'));

    // Notificar por SSE al restaurante y al cliente
    const orderInfo = await query(
      `SELECT o.customer_id, r.owner_user_id AS restaurant_owner_id
       FROM orders o JOIN restaurants r ON r.id = o.restaurant_id
       WHERE o.id = $1`,
      [req.params.orderId]
    );
    if (orderInfo.rowCount > 0) {
      const ord = orderInfo.rows[0];
      const payload = { orderId: req.params.orderId, status: 'assigned', driverId: req.user.userId };
      sseHub.sendToUser(ord.customer_id, 'order_update', payload);
      sseHub.sendToUser(ord.restaurant_owner_id, 'order_update', payload);
    }

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});
  }
});

/* \u2500\u2500 POST /drivers/offers/:orderId/reject \u2500\u2500 */
router.post('/offers/:orderId/reject', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    // rejectOffer aplica cooldown de 5 min y busca al siguiente driver
    await rejectOffer(req.params.orderId, req.user.userId);
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

    // Guardar nota si la hay
    if (note) {
      try {
        await query(
          `UPDATE orders SET driver_note=$1, updated_at=NOW() WHERE id=$2 AND driver_id=$3`,
          [note, orderId, driverId]
        );
      } catch (_) {}
    }

    // releaseOrder aplica cooldown, libera el pedido y busca siguiente driver
    await releaseOrder(orderId, driverId);
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
