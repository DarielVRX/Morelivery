import { authenticate, authorize } from '../../../middlewares/auth.js';
import { sendPushToUser } from '../../notifications/pushSubscription.js';
import { validate } from '../../../middlewares/validate.js';
import { STATUS_TS, notifyOrderParties } from '../shared.js';
import { notifyPickup, notifyDelivery, notifyOrderCancelled } from '../assignment/events.js';

export function registerLifecycleRoutes(router, deps) {
  const { query, AppError, orderEvents, recordPickupWait, evaluatePrepEstimate, sseHub, logEvent, updateOrderStatusSchema } = deps;

  // ── PATCH /:id/status ─────────────────────────────────────────────────────
  router.patch('/:id/status', authenticate, authorize(['restaurant', 'driver', 'admin']), validate(updateOrderStatusSchema), async (req, res, next) => {
    try {
      const current = await query('SELECT * FROM orders WHERE id=$1', [req.params.id]);
      if (current.rowCount === 0) return next(new AppError(404, 'Pedido no encontrado'));

      const order = current.rows[0];
      const nextStatus = req.validatedBody.status;

      if (req.user.role === 'driver' && order.driver_id !== req.user.userId)
        return next(new AppError(403, 'No tienes permiso para modificar este pedido'));

      if (req.user.role === 'restaurant') {
        const restCheck = await query('SELECT 1 FROM restaurants WHERE id=$1 AND owner_user_id=$2', [order.restaurant_id, req.user.userId]);
        if (restCheck.rowCount === 0) return next(new AppError(403, 'No tienes permiso para modificar este pedido'));
      }

      const ACTIVE = ['created', 'pending_driver', 'assigned', 'accepted', 'preparing', 'ready', 'on_the_way'];
      const VALID = {
        restaurant: { preparing: ACTIVE, ready: ACTIVE },
        driver:     { accepted: ['assigned', 'pending_driver'], on_the_way: ['ready'], delivered: ['on_the_way'] },
        admin:      { cancelled: ['created', 'pending_driver', 'assigned', 'accepted', 'preparing', 'ready', 'on_the_way'] },
      };
      const STATUS_ES = {
        created: 'Recibido', pending_driver: 'Buscando conductor', assigned: 'Asignado',
        accepted: 'Aceptado', preparing: 'En preparación', ready: 'Listo',
        on_the_way: 'En camino', delivered: 'Entregado', cancelled: 'Cancelado',
      };

      const allowed = VALID[req.user.role]?.[nextStatus];
      if (!allowed) return next(new AppError(403, `El rol '${req.user.role}' no puede establecer el estado '${STATUS_ES[nextStatus] || nextStatus}'`));
      if (allowed !== '*' && !allowed.includes(order.status))
        return next(new AppError(409, `No se puede cambiar de '${STATUS_ES[order.status] || order.status}' a '${STATUS_ES[nextStatus] || nextStatus}'`));

      if (req.user.role === 'driver' && ['on_the_way', 'delivered'].includes(nextStatus)) {
        const driverLat = Number(req.body.lat);
        const driverLng = Number(req.body.lng);
        if (Number.isFinite(driverLat) && Number.isFinite(driverLng)) {
          const refLat = nextStatus === 'on_the_way' ? Number(order.restaurant_lat) : Number(order.delivery_lat);
          const refLng = nextStatus === 'on_the_way' ? Number(order.restaurant_lng) : Number(order.delivery_lng);
          if (Number.isFinite(refLat) && Number.isFinite(refLng)) {
            const toRad = x => x * Math.PI / 180;
            const dLat = toRad(refLat - driverLat);
            const dLng = toRad(refLng - driverLng);
            const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(driverLat)) * Math.cos(toRad(refLat)) * Math.sin(dLng / 2) ** 2;
            const distM = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            if (distM > 100 && req.body.grace !== true)
              return next(new AppError(409, `Debes estar a menos de 100m del ${nextStatus === 'on_the_way' ? 'restaurante' : 'cliente'} para marcar este estado. Distancia actual: ${Math.round(distM)}m`));
          }
        }
      }

      let driverNote     = order.driver_note;
      let restaurantNote = order.restaurant_note;
      if (req.user.role === 'restaurant' && nextStatus === 'preparing') driverNote = 'Restaurante: pedido en preparación';
      if (req.user.role === 'restaurant' && nextStatus === 'ready')     driverNote = 'Restaurante: pedido listo para retiro';
      if (req.user.role === 'driver' && nextStatus === 'on_the_way')    restaurantNote = 'Driver: pedido en camino';
      if (req.user.role === 'driver' && nextStatus === 'delivered')     restaurantNote = 'Driver: pedido entregado';

      const tsCol    = STATUS_TS[nextStatus];
      const tsClause = tsCol ? `, ${tsCol} = NOW()` : '';

      const result = await query(
        `UPDATE orders SET status=$1, driver_note=$2, restaurant_note=$3, updated_at=NOW()${tsClause}${nextStatus === 'delivered' ? ', delivered_tip_cents=tip_cents' : ''} WHERE id=$4 RETURNING *`,
        [nextStatus, driverNote, restaurantNote, req.params.id]
      );
      const updated = result.rows[0];
      orderEvents.emitOrderUpdate(updated.id, updated.status);
      await notifyOrderParties(updated.id, 'order_update', { orderId: updated.id, status: updated.status });

      if (nextStatus === 'on_the_way' && updated.driver_id) {
        // Notificar pickup al motor de asignación → rerouting del driver
        await notifyPickup(updated.id, updated.driver_id).catch(() => {});

        const waitResult = await query(
          `SELECT EXTRACT(EPOCH FROM (NOW() - ready_at))::int AS wait_s FROM orders WHERE id=$1 AND ready_at IS NOT NULL`,
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

      console.log(`[pedido.estado] id=${updated.id.slice(0,8)} → "${nextStatus}" por rol=${req.user.role}`);
      logEvent('order.status_changed', { orderId: updated.id, status: updated.status, actor: req.user.userId });

      // Notificar delivery al motor → rerouting + trigger de asignación pendiente
      if (nextStatus === 'delivered' && updated.driver_id) {
        const onOffer = deps.onOffer ?? null;
        await notifyDelivery(updated.id, updated.driver_id, onOffer).catch(() => {});
      }

      return res.json({ order: updated });
    } catch (error) { return next(error); }
  });

  // ── PATCH /:id/cancel — cancelación por el cliente ────────────────────────
  router.patch('/:id/cancel', authenticate, authorize(['customer']), async (req, res, next) => {
    try {
      const { note } = req.body || {};
      if (!note?.trim()) return next(new AppError(400, 'El motivo de cancelación es obligatorio'));

      const check = await query(
        `SELECT id, status, created_at, restaurant_confirmed, driver_id, customer_id, restaurant_id
         FROM orders WHERE id=$1 AND customer_id=$2`,
        [req.params.id, req.user.userId]
      );
      if (check.rowCount === 0) return next(new AppError(404, 'Pedido no encontrado'));

      const order = check.rows[0];
      const cancellable = ['created', 'pending_driver', 'assigned', 'accepted'];
      if (!cancellable.includes(order.status))
        return next(new AppError(409, 'El pedido ya no puede cancelarse en este estado'));

      const elapsedMs      = Date.now() - new Date(order.created_at).getTime();
      const LATE_CANCEL_MS = 5 * 60 * 1000;
      const restaurantConfirmed = Boolean(order.restaurant_confirmed);
      const driverConfirmed     = order.driver_id ? ['accepted', 'on_the_way'].includes(order.status) : false;
      const bothConfirmed       = restaurantConfirmed && driverConfirmed;
      const isLateCancel        = elapsedMs > LATE_CANCEL_MS && bothConfirmed;

      await query(
        `UPDATE orders SET status='cancelled', restaurant_note=$2, cancelled_at=NOW(), updated_at=NOW()
         WHERE id=$1`,
        [req.params.id, `[CANCELADO POR CLIENTE${isLateCancel ? ' - TARDÍO' : ''}] ${note.trim()}`]
      );

      await notifyOrderParties(req.params.id, 'order_update', { orderId: req.params.id, status: 'cancelled' });

      // Notificar explícitamente al restaurante — FIX: el restaurante no recibía el evento
      try {
        const restInfo = await query('SELECT owner_user_id FROM restaurants WHERE id=$1', [order.restaurant_id]);
        if (restInfo.rowCount > 0) {
          sseHub.sendToUser(restInfo.rows[0].owner_user_id, 'order_cancelled_preparing', {
            orderId: req.params.id,
            prevStatus: order.status,
            note: note.trim(),
            cancelledBy: 'customer',
          });
          sendPushToUser(restInfo.rows[0].owner_user_id, {
            title: 'Pedido cancelado',
            body:  note.trim() ? `Cliente: ${note.trim().slice(0, 60)}` : 'Un cliente canceló su pedido',
            tag:   `cancel_${req.params.id}`, group: 'restaurant', priority: 'high',
            url:   '/restaurant', pushType: 'cancelled', orderId: req.params.id,
          }).catch(() => {});
        }
      } catch (_) {}

      // Notificar al driver si estaba asignado
      if (order.driver_id) {
        sseHub.sendToUser(order.driver_id, 'order_update', { orderId: req.params.id, status: 'cancelled' });
        sendPushToUser(order.driver_id, {
          title: 'Pedido cancelado',
          body:  'El cliente canceló el pedido que llevabas',
          tag:   `cancel_${req.params.id}`, group: 'driver', priority: 'high',
          url:   '/driver', pushType: 'cancelled', orderId: req.params.id,
        }).catch(() => {});
        const onOffer = deps.onOffer ?? null;
        await notifyOrderCancelled(req.params.id, order.driver_id, onOffer).catch(() => {});
      }

      if (isLateCancel) {
        try {
          await query(
            `UPDATE users SET orders_blocked = true, orders_blocked_reason = $2 WHERE id = $1`,
            [req.user.userId, 'late_cancellation']
          );
          sseHub.sendToUser(req.user.userId, 'orders_blocked', {
            reason: 'late_cancellation',
            message: 'Tu cuenta fue suspendida temporalmente por cancelar un pedido en proceso. Contacta a soporte para reactivarla.',
          });
        } catch (blockErr) {
          if (blockErr?.code !== '42703') console.error('[bloqueo] error:', blockErr.message);
        }
      }

      return res.json({
        ok: true,
        late_cancel: isLateCancel,
        both_confirmed: bothConfirmed,
        elapsed_s: Math.round(elapsedMs / 1000),
        ...(isLateCancel ? { orders_blocked: true, block_reason: 'late_cancellation' } : {}),
      });
    } catch (error) { return next(error); }
  });

  // ── PATCH /:id/cancel-restaurant — cancelación por el restaurante ─────────
  router.patch('/:id/cancel-restaurant', authenticate, authorize(['restaurant']), async (req, res, next) => {
    try {
      const { note } = req.body || {};
      if (!note?.trim()) return next(new AppError(400, 'El motivo de cancelación es obligatorio'));

      const restCheck = await query(
        `SELECT r.id FROM restaurants r
         JOIN orders o ON o.restaurant_id = r.id
         WHERE o.id = $1 AND r.owner_user_id = $2`,
        [req.params.id, req.user.userId]
      );
      if (restCheck.rowCount === 0)
        return next(new AppError(404, 'Pedido no encontrado o no pertenece a tu restaurante'));

      const orderRes = await query(
        'SELECT id, status, driver_id, customer_id, restaurant_id FROM orders WHERE id=$1',
        [req.params.id]
      );
      if (orderRes.rowCount === 0) return next(new AppError(404, 'Pedido no encontrado'));

      const order = orderRes.rows[0];
      const cancellable = ['created', 'pending_driver', 'assigned', 'accepted', 'preparing', 'ready'];
      if (!cancellable.includes(order.status))
        return next(new AppError(409, 'El pedido ya no puede cancelarse en este estado'));

      await query(
        `UPDATE orders SET status='cancelled', restaurant_note=$2, cancelled_at=NOW(), updated_at=NOW()
         WHERE id=$1`,
        [req.params.id, `[CANCELADO POR RESTAURANTE] ${note.trim()}`]
      );

      await notifyOrderParties(req.params.id, 'order_update', { orderId: req.params.id, status: 'cancelled' });

      // Notificar al cliente
      sseHub.sendToUser(order.customer_id, 'order_cancelled_preparing', {
        orderId: req.params.id,
        prevStatus: order.status,
        note: note.trim(),
        cancelledBy: 'restaurant',
      });

      // Liberar al driver
      if (order.driver_id) {
        await query('UPDATE orders SET driver_id=NULL, last_driver_id=driver_id WHERE id=$1', [req.params.id]).catch(() => {});
        sseHub.sendToUser(order.driver_id, 'order_update', { orderId: req.params.id, status: 'cancelled' });
        const onOffer = deps.onOffer ?? null;
        await notifyOrderCancelled(req.params.id, order.driver_id, onOffer).catch(() => {});
      }

      console.log(`[pedido.cancelado] id=${req.params.id.slice(0,8)} por restaurante`);
      return res.json({ ok: true });
    } catch (error) { return next(error); }
  });
}
