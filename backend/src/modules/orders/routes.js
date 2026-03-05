import { Router } from 'express';
import { query } from '../../config/db.js';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { orderEvents } from '../../events/orderEvents.js';
import { logEvent } from '../../utils/logger.js';
import { validate } from '../../middlewares/validate.js';
import { createOrderSchema, updateOrderStatusSchema } from './schemas.js';
import { AppError } from '../../utils/errors.js';

const router = Router();

async function assignNextDriver(orderId) {
  const driverResult = await query(
    `SELECT dp.user_id
     FROM driver_profiles dp
     WHERE dp.is_available = true
       AND NOT EXISTS (
         SELECT 1 FROM orders o
         WHERE o.driver_id = dp.user_id
           AND o.status IN ('assigned', 'on_the_way')
       )
     ORDER BY dp.driver_number ASC
     LIMIT 1`
  );

  if (driverResult.rowCount === 0) {
    return null;
  }

  const driverId = driverResult.rows[0].user_id;
  await query('UPDATE orders SET driver_id = $1, status = $2, updated_at = NOW() WHERE id = $3', [driverId, 'assigned', orderId]);
  return driverId;
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

    const orderResult = await query(
      'INSERT INTO orders(customer_id, restaurant_id, status, total_cents, delivery_address) VALUES($1, $2, $3, $4, $5) RETURNING *',
      [req.user.userId, restaurantId, 'created', totalCents, 'beta-test-address']
    );

    const order = orderResult.rows[0];

    for (const item of items) {
      const menuResult = await query('SELECT price_cents FROM menu_items WHERE id = $1', [item.menuItemId]);
      await query(
        'INSERT INTO order_items(order_id, menu_item_id, quantity, unit_price_cents) VALUES($1, $2, $3, $4)',
        [order.id, item.menuItemId, item.quantity, menuResult.rows[0].price_cents]
      );
    }

    const driverId = await assignNextDriver(order.id);
    const updatedOrder = await query('SELECT * FROM orders WHERE id = $1', [order.id]);

    orderEvents.emitOrderUpdate(order.id, updatedOrder.rows[0].status);
    logEvent('order.created', { orderId: order.id, customerId: req.user.userId, driverId });
    return res.status(201).json({ order: updatedOrder.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id/status', authenticate, authorize(['restaurant', 'driver', 'admin']), validate(updateOrderStatusSchema), async (req, res, next) => {
  try {
    const result = await query('UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *', [req.validatedBody.status, req.params.id]);
    if (result.rowCount === 0) {
      return next(new AppError(404, 'Order not found'));
    }
    const order = result.rows[0];
    orderEvents.emitOrderUpdate(order.id, order.status);
    logEvent('order.status_changed', { orderId: order.id, status: order.status, actor: req.user.userId });
    return res.json({ order });
  } catch (error) {
    return next(error);
  }
});

router.get('/my', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      'SELECT * FROM orders WHERE customer_id = $1 OR driver_id = $1 OR restaurant_id IN (SELECT id FROM restaurants WHERE owner_user_id = $1) ORDER BY created_at DESC',
      [req.user.userId]
    );
    return res.json({ orders: result.rows });
  } catch (error) {
    return next(error);
  }
});

export default router;
