import { authenticate, authorize } from '../../../middlewares/auth.js';
import { isMissingRelationError, notifyOrderParties } from '../shared.js';

export function registerSupportRoutes(router, deps) {
  const { query, AppError, sseHub, logEvent } = deps;

  router.post('/:id/complaint', authenticate, authorize(['customer']), async (req, res, next) => {
    try {
      const { text } = req.body || {};
      if (!text?.trim()) return next(new AppError(400, 'El texto de la queja es requerido'));
      const orderCheck = await query('SELECT id FROM orders WHERE id=$1 AND customer_id=$2', [req.params.id, req.user.userId]);
      if (orderCheck.rowCount === 0) return next(new AppError(404, 'Pedido no encontrado'));
      try {
        await query(`INSERT INTO order_complaints(order_id, customer_id, text, created_at) VALUES($1,$2,$3,NOW())`, [req.params.id, req.user.userId, text.trim()]);
      } catch (e) {
        if (isMissingRelationError(e)) await query('UPDATE orders SET restaurant_note=$1, updated_at=NOW() WHERE id=$2', [`[QUEJA] ${text.trim()}`, req.params.id]);
        else throw e;
      }
      logEvent('order.complaint', { orderId: req.params.id, customerId: req.user.userId });
      return res.json({ ok: true });
    } catch (error) { return next(error); }
  });

  router.get('/:id/messages', authenticate, async (req, res, next) => {
    try {
      const check = await query(
        `SELECT o.customer_id, o.driver_id, r.owner_user_id AS restaurant_owner_id
         FROM orders o JOIN restaurants r ON r.id=o.restaurant_id WHERE o.id=$1`,
        [req.params.id]
      );
      if (check.rowCount === 0) return next(new AppError(404, 'Pedido no encontrado'));
      const { customer_id, driver_id, restaurant_owner_id } = check.rows[0];
      const uid = req.user.userId;
      if (uid !== customer_id && uid !== driver_id && uid !== restaurant_owner_id) return next(new AppError(403, 'No tienes acceso a este pedido'));

      try {
        const msgs = await query(
          `SELECT m.id, m.sender_id, m.text, m.created_at,
                  COALESCE(u.alias, u.full_name) AS sender_name, u.role AS sender_role
           FROM order_messages m JOIN users u ON u.id=m.sender_id
           WHERE m.order_id=$1 ORDER BY m.created_at ASC`,
          [req.params.id]
        );
        return res.json({ messages: msgs.rows });
      } catch (e) {
        if (isMissingRelationError(e)) return res.json({ messages: [] });
        throw e;
      }
    } catch (error) { return next(error); }
  });

  router.post('/:id/messages', authenticate, async (req, res, next) => {
    try {
      const { text } = req.body || {};
      if (!text?.trim()) return next(new AppError(400, 'El mensaje no puede estar vacío'));
      if (text.trim().length > 500) return next(new AppError(400, 'El mensaje es demasiado largo (máx. 500 caracteres)'));

      const check = await query(
        `SELECT o.customer_id, o.driver_id, r.owner_user_id AS restaurant_owner_id
         FROM orders o JOIN restaurants r ON r.id=o.restaurant_id WHERE o.id=$1`,
        [req.params.id]
      );
      if (check.rowCount === 0) return next(new AppError(404, 'Pedido no encontrado'));
      const { customer_id, driver_id, restaurant_owner_id } = check.rows[0];
      const uid = req.user.userId;
      if (uid !== customer_id && uid !== driver_id && uid !== restaurant_owner_id) return next(new AppError(403, 'No tienes acceso a este pedido'));

      try {
        const msg = await query(`INSERT INTO order_messages(order_id, sender_id, text) VALUES($1,$2,$3) RETURNING *`, [req.params.id, uid, text.trim()]);
        const recipients = [customer_id, driver_id, restaurant_owner_id].filter(id => id && id !== uid);
        const senderName = req.user.username || req.user.userId;
        for (const recipId of recipients) {
          sseHub.sendToUser(recipId, 'chat_message', {
            orderId: req.params.id,
            messageId: msg.rows[0].id,
            senderId: uid,
            senderName,
            senderRole: req.user.role,
            text: text.trim(),
            createdAt: msg.rows[0].created_at,
          });
        }
        return res.json({ message: msg.rows[0] });
      } catch (e) {
        if (isMissingRelationError(e)) return next(new AppError(503, 'El chat no está disponible todavía. Ejecuta la migración v8.'));
        throw e;
      }
    } catch (error) { return next(error); }
  });

  router.post('/:id/report', authenticate, async (req, res, next) => {
    try {
      const { text, reason } = req.body || {};
      if (!text?.trim()) return next(new AppError(400, 'El reporte no puede estar vacío'));

      const check = await query(
        `SELECT o.status, o.customer_id, o.driver_id, r.owner_user_id AS restaurant_owner_id
         FROM orders o JOIN restaurants r ON r.id=o.restaurant_id WHERE o.id=$1`,
        [req.params.id]
      );
      if (check.rowCount === 0) return next(new AppError(404, 'Pedido no encontrado'));
      const { status, customer_id, driver_id, restaurant_owner_id } = check.rows[0];
      const uid = req.user.userId;
      if (uid !== customer_id && uid !== driver_id && uid !== restaurant_owner_id) return next(new AppError(403, 'No tienes acceso a este pedido'));
      if (!['delivered', 'cancelled'].includes(status)) return next(new AppError(409, 'Solo se puede reportar un pedido completado o cancelado'));

      try {
        await query(
          `INSERT INTO order_reports(order_id, reporter_id, reporter_role, reason, text)
           VALUES($1,$2,$3,$4,$5)`,
          [req.params.id, uid, req.user.role, reason?.trim() || 'general', text.trim()]
        );
      } catch (e) {
        if (isMissingRelationError(e)) {
          await query(`INSERT INTO order_complaints(order_id, customer_id, text, created_at)
            VALUES($1,$2,$3,NOW()) ON CONFLICT DO NOTHING`, [req.params.id, uid, `[REPORTE ${req.user.role}] ${text.trim()}`]);
        } else throw e;
      }
      logEvent('order.report', { orderId: req.params.id, reporterId: uid, role: req.user.role });
      return res.json({ ok: true });
    } catch (error) { return next(error); }
  });
}
