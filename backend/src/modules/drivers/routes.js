import { Router } from 'express';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { query } from '../../config/db.js';
import { validate } from '../../middlewares/validate.js';
import { availabilitySchema } from './schemas.js';
import { AppError } from '../../utils/errors.js';
import {
  MAX_ACTIVE_ORDERS_PER_DRIVER,
  driverHasCapacity,
  offerNextDrivers,
  offerOrdersToDriver
} from '../orders/assignment.js';

const router = Router();

router.patch('/availability', authenticate, authorize(['driver']), validate(availabilitySchema), async (req, res, next) => {
  try {
    const result = await query('UPDATE driver_profiles SET is_available = $1 WHERE user_id = $2 RETURNING *', [
      req.validatedBody.isAvailable,
      req.user.userId
    ]);
    if (result.rowCount === 0) return next(new AppError(404, 'Perfil de repartidor no encontrado'));

    if (req.validatedBody.isAvailable) {
      await offerOrdersToDriver(req.user.userId);
    }

    return res.json({ profile: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/listener', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const offered = await offerOrdersToDriver(req.user.userId);
    return res.json({ offered });
  } catch (error) {
    return next(error);
  }
});

router.get('/offers', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    // Obtener ofertas pendientes con direcciones de restaurante y cliente
    let offersResult;
    try {
      offersResult = await query(
        `SELECT o.id, o.status, o.total_cents, o.delivery_address, o.customer_address,
                o.restaurant_name, o.customer_first_name,
                o.restaurant_address
         FROM (
           SELECT ord.*, r.name AS restaurant_name,
                  r.address AS restaurant_address,
                  split_part(u.full_name, '_', 1) AS customer_first_name,
                  u.address AS customer_address
           FROM orders ord
           JOIN restaurants r ON r.id = ord.restaurant_id
           JOIN users u ON u.id = ord.customer_id
         ) o
         JOIN order_driver_offers od ON od.order_id = o.id
         WHERE od.driver_id = $1 AND od.status = 'pending'
         ORDER BY o.created_at DESC`,
        [req.user.userId]
      );
    } catch (error) {
      if (error?.code !== '42703') throw error;
      // Fallback si falta columna address en restaurants o users
      offersResult = await query(
        `SELECT o.id, o.status, o.total_cents, o.delivery_address,
                o.restaurant_name, o.customer_first_name,
                o.delivery_address AS customer_address,
                NULL AS restaurant_address
         FROM (
           SELECT ord.*, r.name AS restaurant_name,
                  split_part(u.full_name, '_', 1) AS customer_first_name
           FROM orders ord
           JOIN restaurants r ON r.id = ord.restaurant_id
           JOIN users u ON u.id = ord.customer_id
         ) o
         JOIN order_driver_offers od ON od.order_id = o.id
         WHERE od.driver_id = $1 AND od.status = 'pending'
         ORDER BY o.created_at DESC`,
        [req.user.userId]
      );
    }

    // Obtener items de cada oferta
    const offerIds = offersResult.rows.map((r) => r.id);
    let itemsByOffer = new Map();
    if (offerIds.length > 0) {
      try {
        const itemsResult = await query(
          `SELECT oi.order_id, oi.menu_item_id, oi.quantity, oi.unit_price_cents,
                  COALESCE(mi.name, 'Producto') AS name
           FROM order_items oi
           LEFT JOIN menu_items mi ON mi.id = oi.menu_item_id
           WHERE oi.order_id = ANY($1::uuid[])
           ORDER BY oi.order_id, oi.id`,
          [offerIds]
        );
        for (const row of itemsResult.rows) {
          if (!itemsByOffer.has(row.order_id)) itemsByOffer.set(row.order_id, []);
          itemsByOffer.get(row.order_id).push({
            menuItemId: row.menu_item_id,
            name: row.name,
            quantity: row.quantity,
            unitPriceCents: row.unit_price_cents
          });
        }
      } catch (_) { /* si order_items no existe aún, continúa sin items */ }
    }

    const offers = offersResult.rows.map((row) => ({
      ...row,
      items: itemsByOffer.get(row.id) || []
    }));

    return res.json({ offers });
  } catch (error) {
    return next(error);
  }
});

router.post('/offers/:id/accept', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const hasCapacity = await driverHasCapacity(req.user.userId);
    if (!hasCapacity) {
      return next(new AppError(409, `Máximo ${MAX_ACTIVE_ORDERS_PER_DRIVER} pedidos activos alcanzado`));
    }

    const offer = await query('SELECT * FROM order_driver_offers WHERE order_id = $1 AND driver_id = $2 AND status = $3', [
      req.params.id,
      req.user.userId,
      'pending'
    ]);
    if (offer.rowCount === 0) return next(new AppError(404, 'Oferta no encontrada'));

    const updateOrder = await query(
      'UPDATE orders SET driver_id = $1, status = $2, updated_at = NOW() WHERE id = $3 AND driver_id IS NULL RETURNING *',
      [req.user.userId, 'assigned', req.params.id]
    );

    if (updateOrder.rowCount === 0) return next(new AppError(409, 'Pedido ya asignado'));

    await query('UPDATE order_driver_offers SET status = $1, updated_at = NOW() WHERE order_id = $2 AND driver_id = $3', [
      'accepted',
      req.params.id,
      req.user.userId
    ]);
    await query('UPDATE order_driver_offers SET status = $1, updated_at = NOW() WHERE order_id = $2 AND driver_id <> $3 AND status = $4', [
      'expired',
      req.params.id,
      req.user.userId,
      'pending'
    ]);

    return res.json({ order: updateOrder.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/offers/:id/reject', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    await query('UPDATE order_driver_offers SET status = $1, updated_at = NOW() WHERE order_id = $2 AND driver_id = $3', [
      'rejected',
      req.params.id,
      req.user.userId
    ]);

    const pending = await query('SELECT COUNT(*)::int AS count FROM order_driver_offers WHERE order_id = $1 AND status = $2', [req.params.id, 'pending']);
    const order = await query('SELECT driver_id FROM orders WHERE id = $1', [req.params.id]);
    if (order.rows[0] && !order.rows[0].driver_id && pending.rows[0].count === 0) {
      await offerNextDrivers(req.params.id);
    }

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.post('/orders/:id/release', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const order = await query('UPDATE orders SET driver_id = NULL, status = $1, updated_at = NOW() WHERE id = $2 AND driver_id = $3 RETURNING *', [
      'pending_driver',
      req.params.id,
      req.user.userId
    ]);
    if (order.rowCount === 0) return next(new AppError(404, 'Pedido asignado no encontrado'));

    await query('UPDATE order_driver_offers SET status = $1, updated_at = NOW() WHERE order_id = $2 AND driver_id = $3', ['released', req.params.id, req.user.userId]);
    await offerNextDrivers(req.params.id);
    await offerOrdersToDriver(req.user.userId);
    return res.json({ order: order.rows[0] });
  } catch (error) {
    return next(error);
  }
});

export default router;
