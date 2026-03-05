import { Router } from 'express';
import { query } from '../../config/db.js';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { orderEvents } from '../../events/orderEvents.js';
import { logEvent } from '../../utils/logger.js';
import { validate } from '../../middlewares/validate.js';
import { createOrderSchema, suggestionResponseSchema, suggestionSchema, updateOrderStatusSchema } from './schemas.js';
import { AppError } from '../../utils/errors.js';
import { offerNextDrivers } from './assignment.js';

const router = Router();

function isMissingColumnError(error) {
  return error?.code === '42703';
}

router.post('/', authenticate, authorize(['customer']), validate(createOrderSchema), async (req, res, next) => {
  const { restaurantId, items } = req.validatedBody;

  try {
    let totalCents = 0;
    for (const item of items) {
      const menuResult = await query('SELECT price_cents FROM menu_items WHERE id = $1 AND restaurant_id = $2', [item.menuItemId, restaurantId]);
      if (menuResult.rowCount === 0) return next(new AppError(400, 'Invalid menu item'));
      totalCents += menuResult.rows[0].price_cents * item.quantity;
    }

    let deliveryAddress = 'address-pending';
    try {
      const customer = await query('SELECT address FROM users WHERE id = $1', [req.user.userId]);
      deliveryAddress = customer.rows[0]?.address || 'address-pending';
    } catch (error) {
      if (!isMissingColumnError(error)) throw error;
    }

    const orderResult = await query(
      'INSERT INTO orders(customer_id, restaurant_id, status, total_cents, delivery_address) VALUES($1, $2, $3, $4, $5) RETURNING *',
      [req.user.userId, restaurantId, 'created', totalCents, deliveryAddress]
    );

    const order = orderResult.rows[0];

    for (const item of items) {
      const menuResult = await query('SELECT price_cents FROM menu_items WHERE id = $1', [item.menuItemId]);
      await query(
        'INSERT INTO order_items(order_id, menu_item_id, quantity, unit_price_cents) VALUES($1, $2, $3, $4)',
        [order.id, item.menuItemId, item.quantity, menuResult.rows[0].price_cents]
      );
    }

    await offerNextDrivers(order.id);

    const updatedOrder = await query('SELECT * FROM orders WHERE id = $1', [order.id]);
    orderEvents.emitOrderUpdate(order.id, updatedOrder.rows[0].status);
    logEvent('order.created', { orderId: order.id, customerId: req.user.userId });
    return res.status(201).json({ order: updatedOrder.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id/status', authenticate, authorize(['restaurant', 'driver', 'admin']), validate(updateOrderStatusSchema), async (req, res, next) => {
  try {
    const current = await query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    if (current.rowCount === 0) return next(new AppError(404, 'Order not found'));

    const nextStatus = req.validatedBody.status;
    let driverNote = current.rows[0].driver_note;
    let restaurantNote = current.rows[0].restaurant_note;

    if (req.user.role === 'driver' && nextStatus === 'on_the_way' && current.rows[0].status !== 'ready') {
      return next(new AppError(409, 'Restaurant must mark order as ready first'));
    }

    if (req.user.role === 'restaurant' && nextStatus === 'preparing') driverNote = 'Restaurante: pedido en preparación';
    if (req.user.role === 'restaurant' && nextStatus === 'ready') driverNote = 'Restaurante: pedido listo para retiro';
    if (req.user.role === 'driver' && nextStatus === 'on_the_way') restaurantNote = 'Driver: pedido en camino';
    if (req.user.role === 'driver' && nextStatus === 'delivered') restaurantNote = 'Driver: pedido entregado';

    const result = await query(
      'UPDATE orders SET status = $1, driver_note = $2, restaurant_note = $3, updated_at = NOW() WHERE id = $4 RETURNING *',
      [nextStatus, driverNote, restaurantNote, req.params.id]
    );

    const order = result.rows[0];
    orderEvents.emitOrderUpdate(order.id, order.status);
    logEvent('order.status_changed', { orderId: order.id, status: order.status, actor: req.user.userId });
    return res.json({ order });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id/cancel', authenticate, authorize(['customer']), async (req, res, next) => {
  try {
    const result = await query('UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 AND customer_id = $3 RETURNING *', [
      'cancelled',
      req.params.id,
      req.user.userId
    ]);
    if (result.rowCount === 0) return next(new AppError(404, 'Order not found'));
    return res.json({ order: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id/suggest', authenticate, authorize(['restaurant']), validate(suggestionSchema), async (req, res, next) => {
  try {
    const result = await query(
      `UPDATE orders SET suggestion_text = $1, suggestion_status = 'pending_customer', updated_at = NOW()
       WHERE id = $2 AND restaurant_id IN (SELECT id FROM restaurants WHERE owner_user_id = $3)
       RETURNING *`,
      [req.validatedBody.suggestionText, req.params.id, req.user.userId]
    );
    if (result.rowCount === 0) return next(new AppError(404, 'Order not found'));
    return res.json({ order: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id/suggestion-response', authenticate, authorize(['customer']), validate(suggestionResponseSchema), async (req, res, next) => {
  try {
    const status = req.validatedBody.accepted ? 'accepted' : 'rejected';
    const result = await query(
      `UPDATE orders SET suggestion_status = $1, updated_at = NOW()
       WHERE id = $2 AND customer_id = $3
       RETURNING *`,
      [status, req.params.id, req.user.userId]
    );
    if (result.rowCount === 0) return next(new AppError(404, 'Order not found'));
    return res.json({ order: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.get('/my', authenticate, async (req, res, next) => {
  try {
    let result;
    try {
      result = await query(
        `SELECT o.*, r.name AS restaurant_name,
                split_part(c.full_name, '_', 1) AS customer_first_name,
                split_part(d.full_name, '_', 1) AS driver_first_name,
                c.address AS customer_address
         FROM orders o
         JOIN restaurants r ON r.id = o.restaurant_id
         JOIN users c ON c.id = o.customer_id
         LEFT JOIN users d ON d.id = o.driver_id
         WHERE o.customer_id = $1 OR o.driver_id = $1 OR o.restaurant_id IN (SELECT id FROM restaurants WHERE owner_user_id = $1)
         ORDER BY o.created_at DESC`,
        [req.user.userId]
      );
    } catch (error) {
      if (!isMissingColumnError(error)) throw error;
      result = await query(
        `SELECT o.*, r.name AS restaurant_name,
                split_part(c.full_name, '_', 1) AS customer_first_name,
                split_part(d.full_name, '_', 1) AS driver_first_name,
                o.delivery_address AS customer_address
         FROM orders o
         JOIN restaurants r ON r.id = o.restaurant_id
         JOIN users c ON c.id = o.customer_id
         LEFT JOIN users d ON d.id = o.driver_id
         WHERE o.customer_id = $1 OR o.driver_id = $1 OR o.restaurant_id IN (SELECT id FROM restaurants WHERE owner_user_id = $1)
         ORDER BY o.created_at DESC`,
        [req.user.userId]
      );
    }
    return res.json({ orders: result.rows });
  } catch (error) {
    return next(error);
  }
});

export default router;
