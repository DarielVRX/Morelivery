import { Router } from 'express';
import { query } from '../../config/db.js';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { orderEvents } from '../../events/orderEvents.js';
import { logEvent } from '../../utils/logger.js';

const router = Router();

router.post('/', authenticate, authorize(['customer']), async (req, res, next) => {
  const { restaurantId, totalCents, address, items } = req.body;

  try {
    const orderResult = await query(
      'INSERT INTO orders(customer_id, restaurant_id, status, total_cents, delivery_address) VALUES($1, $2, $3, $4, $5) RETURNING *',
      [req.user.userId, restaurantId, 'created', totalCents, address]
    );

    const order = orderResult.rows[0];

    for (const item of items || []) {
      await query(
        'INSERT INTO order_items(order_id, menu_item_id, quantity, unit_price_cents) VALUES($1, $2, $3, $4)',
        [order.id, item.menuItemId, item.quantity, item.unitPriceCents]
      );
    }

    orderEvents.emitOrderUpdate(order.id, order.status);
    logEvent('order.created', { orderId: order.id, customerId: req.user.userId });
    res.status(201).json({ order });
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/status', authenticate, authorize(['restaurant', 'driver', 'admin']), async (req, res, next) => {
  try {
    const result = await query('UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *', [req.body.status, req.params.id]);
    const order = result.rows[0];
    orderEvents.emitOrderUpdate(order.id, order.status);
    logEvent('order.status_changed', { orderId: order.id, status: order.status, actor: req.user.userId });
    res.json({ order });
  } catch (error) {
    next(error);
  }
});

router.get('/my', authenticate, async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM orders WHERE customer_id = $1 OR driver_id = $1 OR restaurant_id IN (SELECT id FROM restaurants WHERE owner_user_id = $1) ORDER BY created_at DESC', [req.user.userId]);
    res.json({ orders: result.rows });
  } catch (error) {
    next(error);
  }
});

export default router;
