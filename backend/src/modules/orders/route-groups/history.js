import { authenticate, authorize } from '../../../middlewares/auth.js';
import { getOrderItems, isMissingColumnError, parseSuggestionItems, parseSuggestionNote } from '../shared.js';

export function registerHistoryRoutes(router, deps) {
  const { query, AppError } = deps;

  router.patch('/:id/tip', authenticate, authorize(['customer']), async (req, res, next) => {
    const tipCents = Number(req.body.tip_cents);
    console.log(`[tip] PATCH /${req.params.id}/tip userId=${req.user?.userId} body=${JSON.stringify(req.body)} tipCents=${tipCents}`);
    if (!Number.isFinite(tipCents) || tipCents < 0) {
      console.log(`[tip] REJECTED invalid amount: tipCents=${tipCents}`);
      return next(new AppError(400, 'Monto inválido'));
    }
    try {
      const ord = await query('SELECT tip_cents, delivered_tip_cents, status, customer_id FROM orders WHERE id=$1', [req.params.id]);
      if (ord.rowCount === 0) return next(new AppError(404, 'Pedido no encontrado'));
      const o = ord.rows[0];
      console.log(`[tip] DB current: tip_cents=${o.tip_cents} delivered_tip_cents=${o.delivered_tip_cents} status=${o.status}`);
      if (o.customer_id !== req.user.userId) return next(new AppError(403, 'Sin permiso'));
      const isPast = ['delivered', 'cancelled'].includes(o.status);
      const minTip = isPast ? (o.delivered_tip_cents || o.tip_cents || 0) : 0;
      if (isPast && tipCents < minTip) {
        console.log(`[tip] REJECTED below minimum: tipCents=${tipCents} minTip=${minTip}`);
        return next(new AppError(400, `El agradecimiento no puede ser menor a ${minTip}`));
      }
      await query('UPDATE orders SET tip_cents=$1, updated_at=NOW() WHERE id=$2', [tipCents, req.params.id]);
      console.log(`[tip] SUCCESS orderId=${req.params.id} new_tip_cents=${tipCents}`);
      res.json({ tip_cents: tipCents });
    } catch (e) { next(e); }
  });

  router.get('/my', authenticate, async (req, res, next) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const offset = Math.max(Number(req.query.offset) || 0, 0);
      const activeOnly = req.query.active === '1';

      const baseWhere = `WHERE (o.customer_id=$1 OR o.driver_id=$1 OR o.restaurant_id IN (SELECT id FROM restaurants WHERE owner_user_id=$1))`;
      const activeWhere = `${baseWhere} AND o.status NOT IN ('delivered','cancelled')`;
      const paginatedClause = activeOnly ? '' : `LIMIT ${limit} OFFSET ${offset}`;
      const whereClause = activeOnly ? activeWhere : baseWhere;

      let result;
      try {
        result = await query(
          `SELECT o.*, r.name AS restaurant_name, COALESCE(ru.address, r.address) AS restaurant_address,
                  COALESCE(c.alias, c.full_name) AS customer_first_name, c.full_name AS customer_display_name,
                  COALESCE(d.alias, d.full_name) AS driver_first_name,
                  COALESCE(o.delivery_address, c.address) AS customer_address,
                  COALESCE(o.delivery_lat, c.lat) AS customer_lat,
                  COALESCE(o.delivery_lng, c.lng) AS customer_lng,
                  o.delivery_lat, o.delivery_lng
           FROM orders o
           JOIN restaurants r ON r.id = o.restaurant_id
           JOIN users c ON c.id = o.customer_id
           LEFT JOIN users d ON d.id = o.driver_id
           LEFT JOIN users ru ON ru.id = r.owner_user_id
           ${whereClause}
           ORDER BY o.created_at DESC ${paginatedClause}`,
          [req.user.userId]
        );
      } catch (error) {
        if (!isMissingColumnError(error)) throw error;
        result = await query(
          `SELECT o.*, r.name AS restaurant_name, COALESCE(ru.address, r.address) AS restaurant_address,
                  COALESCE(c.alias, c.full_name) AS customer_first_name, c.full_name AS customer_display_name,
                  COALESCE(d.alias, d.full_name) AS driver_first_name, o.delivery_address AS customer_address,
                  NULL::float8 AS customer_lat, NULL::float8 AS customer_lng
           FROM orders o
           JOIN restaurants r ON r.id = o.restaurant_id
           JOIN users c ON c.id = o.customer_id
           LEFT JOIN users d ON d.id = o.driver_id
           LEFT JOIN users ru ON ru.id = r.owner_user_id
           ${whereClause}
           ORDER BY o.created_at DESC ${paginatedClause}`,
          [req.user.userId]
        );
      }
      const orderIds = result.rows.map(r => r.id);
      const itemsByOrder = await getOrderItems(orderIds);
      const orders = result.rows.map(row => ({
        ...row,
        items: itemsByOrder.get(row.id) || [],
        service_fee_cents: Number(row.service_fee_cents || 0),
        delivery_fee_cents: Number(row.delivery_fee_cents || 0),
        tip_cents: Number(row.tip_cents || 0),
        restaurant_fee_cents: Number(row.restaurant_fee_cents || 0),
        delivered_tip_cents: Number(row.delivered_tip_cents || 0),
        payment_method: row.payment_method || 'cash',
        suggestion_items: parseSuggestionItems(row.suggestion_text),
        suggestion_note: parseSuggestionNote(row.suggestion_text),
      }));
      return res.json({ orders, limit, offset, count: orders.length });
    } catch (error) { return next(error); }
  });
}
