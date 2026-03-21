import { authenticate, authorize } from '../../../middlewares/auth.js';
import { validate } from '../../../middlewares/validate.js';
import { STATUS_TS, notifyOrderParties } from '../shared.js';

export function registerLifecycleRoutes(router, deps) {
  const { query, AppError, orderEvents, recordPickupWait, evaluatePrepEstimate, sseHub, logEvent, updateOrderStatusSchema } = deps;

  router.patch('/:id/status', authenticate, authorize(['restaurant', 'driver', 'admin']), validate(updateOrderStatusSchema), async (req, res, next) => {
    try {
      const current = await query('SELECT * FROM orders WHERE id=$1', [req.params.id]);
      if (current.rowCount === 0) return next(new AppError(404, 'Pedido no encontrado'));

      const order = current.rows[0];
      const nextStatus = req.validatedBody.status;

      if (req.user.role === 'driver' && order.driver_id !== req.user.userId) {
        return next(new AppError(403, 'No tienes permiso para modificar este pedido'));
      }
      if (req.user.role === 'restaurant') {
        const restCheck = await query('SELECT 1 FROM restaurants WHERE id=$1 AND owner_user_id=$2', [order.restaurant_id, req.user.userId]);
        if (restCheck.rowCount === 0) return next(new AppError(403, 'No tienes permiso para modificar este pedido'));
      }

      const ACTIVE = ['created', 'pending_driver', 'assigned', 'accepted', 'preparing', 'ready', 'on_the_way'];
      const VALID = {
        restaurant: { preparing: ACTIVE, ready: ACTIVE },
        driver: { accepted: ['assigned', 'pending_driver'], on_the_way: ['ready'], delivered: ['on_the_way'] },
        admin: { cancelled: ['created', 'pending_driver', 'assigned', 'accepted', 'preparing', 'ready', 'on_the_way'] },
      };
      const STATUS_ES = {
        created: 'Recibido', pending_driver: 'Buscando conductor', assigned: 'Asignado',
        accepted: 'Aceptado', preparing: 'En preparación', ready: 'Listo',
        on_the_way: 'En camino', delivered: 'Entregado', cancelled: 'Cancelado',
      };
      const allowed = VALID[req.user.role]?.[nextStatus];
      if (!allowed) return next(new AppError(403, `El rol '${req.user.role}' no puede establecer el estado '${STATUS_ES[nextStatus] || nextStatus}'`));
      if (allowed !== '*' && !allowed.includes(order.status)) {
        return next(new AppError(409, `No se puede cambiar de '${STATUS_ES[order.status] || order.status}' a '${STATUS_ES[nextStatus] || nextStatus}'`));
      }

      if (req.user.role === 'driver' && ['on_the_way', 'delivered'].includes(nextStatus)) {
        const driverLat = Number(req.body.lat);
        const driverLng = Number(req.body.lng);
        const MAX_RADIUS_M = 100;
        if (Number.isFinite(driverLat) && Number.isFinite(driverLng)) {
          const refLat = nextStatus === 'on_the_way' ? Number(order.restaurant_lat) : Number(order.delivery_lat);
          const refLng = nextStatus === 'on_the_way' ? Number(order.restaurant_lng) : Number(order.delivery_lng);
          if (Number.isFinite(refLat) && Number.isFinite(refLng)) {
            const toRad = x => x * Math.PI / 180;
            const dLat = toRad(refLat - driverLat);
            const dLng = toRad(refLng - driverLng);
            const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(driverLat)) * Math.cos(toRad(refLat)) * Math.sin(dLng / 2) ** 2;
            const distM = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            if (distM > MAX_RADIUS_M && req.body.grace !== true) {
              return next(new AppError(409, `Debes estar a menos de ${MAX_RADIUS_M}m del ${nextStatus === 'on_the_way' ? 'restaurante' : 'cliente'} para marcar este estado. Distancia actual: ${Math.round(distM)}m`));
            }
          }
        }
      }

      let driverNote = order.driver_note;
      let restaurantNote = order.restaurant_note;
      if (req.user.role === 'restaurant' && nextStatus === 'preparing') driverNote = 'Restaurante: pedido en preparación';
      if (req.user.role === 'restaurant' && nextStatus === 'ready') driverNote = 'Restaurante: pedido listo para retiro';
      if (req.user.role === 'driver' && nextStatus === 'on_the_way') restaurantNote = 'Driver: pedido en camino';
      if (req.user.role === 'driver' && nextStatus === 'delivered') restaurantNote = 'Driver: pedido entregado';

      const tsCol = STATUS_TS[nextStatus];
      const tsClause = tsCol ? `, ${tsCol} = NOW()` : '';

      const result = await query(
        `UPDATE orders SET status=$1, driver_note=$2, restaurant_note=$3, updated_at=NOW()${tsClause}${nextStatus === 'delivered' ? ', delivered_tip_cents=tip_cents' : ''} WHERE id=$4 RETURNING *`,
        [nextStatus, driverNote, restaurantNote, req.params.id]
      );
      const updated = result.rows[0];
      orderEvents.emitOrderUpdate(updated.id, updated.status);
      await notifyOrderParties(updated.id, 'order_update', { orderId: updated.id, status: updated.status });

      if (nextStatus === 'on_the_way' && updated.driver_id) {
        const waitResult = await query(
          `SELECT EXTRACT(EPOCH FROM (NOW() - ready_at))::int AS wait_s
           FROM orders WHERE id=$1 AND ready_at IS NOT NULL`,
          [updated.id]
        );
        const waitSec = waitResult.rows[0]?.wait_s ?? 0;
        if (waitSec > 0) {
          await recordPickupWait(updated.id, waitSec);
          evaluatePrepEstimate(updated.id).catch(() => {});
        }

        try {
          const restOwner = await query(
            `SELECT r.owner_user_id, u.full_name AS driver_name
             FROM orders o
             JOIN restaurants r ON r.id = o.restaurant_id
             JOIN users u ON u.id = o.driver_id
             WHERE o.id = $1`, [updated.id]
          );
          if (restOwner.rowCount > 0) {
            sseHub.sendToUser(restOwner.rows[0].owner_user_id, 'driver_arrival', {
              orderId: updated.id,
              driverName: restOwner.rows[0].driver_name,
              action: 'picked_up',
            });
          }
        } catch (_) {}
      }

      const STATUS_ES_LOG = { created: 'Recibido', pending_driver: 'Sin conductor', assigned: 'Asignado', accepted: 'Aceptado', preparing: 'En preparación', ready: 'Listo para retiro', on_the_way: 'En camino', delivered: 'Entregado', cancelled: 'Cancelado' };
      console.log(`🔄 [pedido.estado] id=${updated.id.slice(0,8)} → "${STATUS_ES_LOG[updated.status] || updated.status}" por rol=${req.user.role} actor=${req.user.userId.slice(0,8)}`);
      logEvent('order.status_changed', { orderId: updated.id, status: updated.status, actor: req.user.userId });
      return res.json({ order: updated });
    } catch (error) { return next(error); }
  });

  router.patch('/:id/cancel', authenticate, authorize(['customer']), async (req, res, next) => {
    try {
      const { note } = req.body || {};
      if (!note?.trim()) return next(new AppError(400, 'El motivo de cancelación es obligatorio'));
      const check = await query(`SELECT id, status FROM orders WHERE id=$1 AND customer_id=$2`, [req.params.id, req.user.userId]);
      if (check.rowCount === 0) return next(new AppError(404, 'Pedido no encontrado'));
      const cancellable = ['created', 'pending_driver', 'assigned', 'accepted'];
      if (!cancellable.includes(check.rows[0].status)) return next(new AppError(409, 'El pedido ya no puede cancelarse en este estado'));
      const result = await query(
        `UPDATE orders SET status='cancelled', restaurant_note=$3, cancelled_at=NOW(), updated_at=NOW()
         WHERE id=$1 AND customer_id=$2 RETURNING *`,
        [req.params.id, req.user.userId, `[CANCELADO POR CLIENTE] ${note.trim()}`]
      );
      await notifyOrderParties(req.params.id, 'order_update', { orderId: req.params.id, status: 'cancelled' });

      const prevStatus = check.rows[0].status;
      if (['accepted', 'preparing'].includes(prevStatus)) {
        try {
          const ri = await query(`SELECT r.owner_user_id FROM orders o JOIN restaurants r ON r.id=o.restaurant_id WHERE o.id=$1`, [req.params.id]);
          if (ri.rowCount > 0) {
            sseHub.sendToUser(ri.rows[0].owner_user_id, 'order_cancelled_preparing', { orderId: req.params.id, prevStatus, note: note.trim() });
          }
        } catch (_) {}
      }
      return res.json({ order: result.rows[0] });
    } catch (error) { return next(error); }
  });
}
