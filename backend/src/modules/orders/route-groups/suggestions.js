import { authenticate, authorize } from '../../../middlewares/auth.js';
import { validate } from '../../../middlewares/validate.js';
import { DELIVERY_FEE_PCT, RESTAURANT_FEE_PCT, SERVICE_FEE_PCT, notifyOrderParties } from '../shared.js';

export function registerSuggestionRoutes(router, deps) {
  const { query, AppError, sseHub, logEvent, suggestionSchema, suggestionResponseSchema } = deps;

  router.patch('/:id/suggest', authenticate, authorize(['restaurant']), validate(suggestionSchema), async (req, res, next) => {
    try {
      const menuIds = req.validatedBody.items.map(i => i.menuItemId);
      const menuResult = await query(
        `SELECT mi.id, mi.name, mi.price_cents FROM menu_items mi
         JOIN restaurants r ON r.id = mi.restaurant_id
         WHERE mi.id = ANY($1::uuid[]) AND r.owner_user_id = $2`,
        [menuIds, req.user.userId]
      );
      if (menuResult.rowCount !== menuIds.length) return next(new AppError(400, 'Productos de la sugerencia no válidos'));

      const menuMap = new Map(menuResult.rows.map(r => [r.id, r]));
      const suggestion = {
        items: req.validatedBody.items.map(item => ({
          menuItemId: item.menuItemId,
          name: menuMap.get(item.menuItemId)?.name || 'Producto',
          quantity: item.quantity,
          unitPriceCents: menuMap.get(item.menuItemId)?.price_cents || 0,
        })),
        note: req.validatedBody.note || null,
      };

      const orderCheck = await query(
        `SELECT status FROM orders WHERE id=$1 AND restaurant_id IN (SELECT id FROM restaurants WHERE owner_user_id=$2)`,
        [req.params.id, req.user.userId]
      );
      if (orderCheck.rowCount === 0) return next(new AppError(404, 'Pedido no encontrado'));
      if (['ready', 'on_the_way', 'delivered', 'cancelled'].includes(orderCheck.rows[0].status)) {
        return next(new AppError(409, 'No se pueden hacer sugerencias una vez el pedido está listo'));
      }

      const result = await query(
        `UPDATE orders SET suggestion_text=$1, suggestion_status='pending_customer', updated_at=NOW()
         WHERE id=$2 AND restaurant_id IN (SELECT id FROM restaurants WHERE owner_user_id=$3) RETURNING *`,
        [JSON.stringify(suggestion), req.params.id, req.user.userId]
      );
      if (result.rowCount === 0) return next(new AppError(404, 'Pedido no encontrado'));
      sseHub.sendToUser(result.rows[0].customer_id, 'order_update', { orderId: req.params.id, action: 'suggestion_received' });
      return res.json({ order: result.rows[0] });
    } catch (error) { return next(error); }
  });

  router.patch('/:id/suggestion-response', authenticate, authorize(['customer']), validate(suggestionResponseSchema), async (req, res, next) => {
    try {
      const { accepted, items: clientItems } = req.validatedBody;
      const status = accepted ? 'accepted' : 'rejected';

      const orderResult = await query('SELECT * FROM orders WHERE id=$1 AND customer_id=$2', [req.params.id, req.user.userId]);
      if (orderResult.rowCount === 0) return next(new AppError(404, 'Pedido no encontrado'));
      const order = orderResult.rows[0];

      try {
        await query('BEGIN');
        await query(`UPDATE orders SET suggestion_status=$1, updated_at=NOW() WHERE id=$2`, [status, req.params.id]);

        if (accepted) {
          let finalItems = [];
          if (clientItems && clientItems.length > 0) {
            const menuResult = await query(`SELECT id, price_cents FROM menu_items WHERE id = ANY($1::uuid[])`, [clientItems.map(i => i.menuItemId)]);
            const priceMap = new Map(menuResult.rows.map(r => [r.id, r.price_cents]));
            finalItems = clientItems.filter(i => priceMap.has(i.menuItemId)).map(i => ({ menuItemId: i.menuItemId, quantity: Number(i.quantity), unitPriceCents: priceMap.get(i.menuItemId) }));
          } else {
            const parsed = typeof order.suggestion_text === 'string' ? JSON.parse(order.suggestion_text) : order.suggestion_text;
            if (parsed?.items) finalItems = parsed.items.map(i => ({ menuItemId: i.menuItemId, quantity: Number(i.quantity), unitPriceCents: Number(i.unitPriceCents) }));
          }
          if (finalItems.length === 0) throw new AppError(400, 'No se encontraron productos válidos');

          await query('DELETE FROM order_items WHERE order_id=$1', [req.params.id]);
          let newTotal = 0;
          for (const item of finalItems) {
            await query('INSERT INTO order_items(order_id, menu_item_id, quantity, unit_price_cents) VALUES($1,$2,$3,$4)', [req.params.id, item.menuItemId, item.quantity, item.unitPriceCents]);
            newTotal += item.unitPriceCents * item.quantity;
          }
          const newServiceFee = Math.round(newTotal * SERVICE_FEE_PCT);
          const newDeliveryFee = Math.round(newTotal * DELIVERY_FEE_PCT);
          const newRestaurantFee = Math.round(newTotal * RESTAURANT_FEE_PCT);
          await query(
            `UPDATE orders SET total_cents=$1, service_fee_cents=$2, delivery_fee_cents=$3, restaurant_fee_cents=$4, suggestion_text=NULL, updated_at=NOW() WHERE id=$5`,
            [newTotal, newServiceFee, newDeliveryFee, newRestaurantFee, req.params.id]
          );
        }
        await query('COMMIT');
      } catch (txError) {
        await query('ROLLBACK');
        throw txError;
      }

      logEvent('order.suggestion_processed', { orderId: req.params.id, accepted, customerId: req.user.userId });
      await notifyOrderParties(req.params.id, 'order_update', { orderId: req.params.id, action: accepted ? 'suggestion_accepted' : 'suggestion_rejected' });

      const updatedOrder = await query('SELECT * FROM orders WHERE id=$1', [req.params.id]);
      return res.json({ order: updatedOrder.rows[0] });
    } catch (error) { return next(error); }
  });
}
