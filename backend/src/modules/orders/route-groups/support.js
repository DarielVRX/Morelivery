import { authenticate, authorize } from '../../../middlewares/auth.js';
import { isMissingRelationError, notifyOrderParties } from '../shared.js';

// ── Tiempos ───────────────────────────────────────────────────────────────────
const CUSTOMER_GRACE_MS    = 30 * 60 * 1000; // 30 min post-entrega para escribir
const CUSTOMER_COOLDOWN_MS = 30 * 1000;      // 30 s de enfriamiento antes de poder reintegrar

// ── Reglas de escritura por rol y estado ─────────────────────────────────────
// Devuelve null si está permitido, o un string con el motivo del bloqueo.
// 'COOLDOWN' es una señal especial: customer puede ver el chat pero aún no escribir
//   (primeros 30s post-entrega), y se le muestra el botón de reintegrar.
function writeDeniedReason({ role, status, deliveredAt, chatReopenedAt, isAdmin }) {
  if (isAdmin) return null;

  const isOnTheWay = status === 'on_the_way';
  const isTerminal = status === 'delivered' || status === 'cancelled';

  // ── En camino ─────────────────────────────────────────────────────────────
  // restaurant bloqueado; customer y driver pueden escribir.
  // driver puede reintegrar a restaurant (gestionado en /reopen).
  if (isOnTheWay) {
    if (role === 'restaurant') return 'El pedido está en camino. El chat está cerrado para la tienda.';
    return null;
  }

  // ── Pedido terminado ──────────────────────────────────────────────────────
  if (isTerminal) {
    if (role === 'restaurant') return 'El pedido ya fue entregado. El chat está cerrado para la tienda.';
    if (role === 'driver')     return 'El pedido ya fue entregado. El chat está cerrado para el conductor.';
    if (role === 'customer') {
      const base = chatReopenedAt
        ? new Date(chatReopenedAt).getTime()
        : deliveredAt
          ? new Date(deliveredAt).getTime()
          : null;
      if (!base) return 'El chat está cerrado.';
      const elapsed = Date.now() - base;
      if (elapsed > CUSTOMER_GRACE_MS)    return 'La ventana de chat post-entrega expiró (30 min).';
      if (elapsed < CUSTOMER_COOLDOWN_MS) return 'COOLDOWN'; // frontend muestra botón de reintegrar
      return null;
    }
  }

  return null; // cualquier otro estado activo → todos pueden escribir
}

export function registerSupportRoutes(router, deps) {
  const { query, AppError, sseHub, logEvent, sendPushToUser } = deps;

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

  // ── GET mensajes ────────────────────────────────────────────────────────────
  router.get('/:id/messages', authenticate, async (req, res, next) => {
    try {
      const check = await query(
        `SELECT o.customer_id, o.driver_id, o.status, o.delivered_at, o.chat_reopened_at,
                r.owner_user_id AS restaurant_owner_id
         FROM orders o JOIN restaurants r ON r.id=o.restaurant_id WHERE o.id=$1`,
        [req.params.id]
      );
      if (check.rowCount === 0) return next(new AppError(404, 'Pedido no encontrado'));
      const { customer_id, driver_id, restaurant_owner_id,
              status, delivered_at, chat_reopened_at } = check.rows[0];
      const uid     = req.user.userId;
      const role    = req.user.role;
      const isAdmin = role === 'admin';
      const isParty = uid === customer_id || uid === driver_id || uid === restaurant_owner_id;
      if (!isParty && !isAdmin) return next(new AppError(403, 'No tienes acceso a este pedido'));

      const writeBlocked = writeDeniedReason({
        role, status,
        deliveredAt:    delivered_at,
        chatReopenedAt: chat_reopened_at,
        isAdmin,
      });

      try {
        const msgs = await query(
          `SELECT m.id, m.sender_id, m.text, m.created_at,
                  COALESCE(u.alias, u.full_name) AS sender_name, u.role AS sender_role
           FROM order_messages m JOIN users u ON u.id=m.sender_id
           WHERE m.order_id=$1 ORDER BY m.created_at ASC`,
          [req.params.id]
        );
        return res.json({
          messages:     msgs.rows,
          writeBlocked: writeBlocked || null,
          isAdmin,
        });
      } catch (e) {
        if (isMissingRelationError(e)) return res.json({ messages: [], writeBlocked: null, isAdmin });
        throw e;
      }
    } catch (error) { return next(error); }
  });

  // ── POST mensaje ────────────────────────────────────────────────────────────
  router.post('/:id/messages', authenticate, async (req, res, next) => {
    try {
      const { text } = req.body || {};
      if (!text?.trim()) return next(new AppError(400, 'El mensaje no puede estar vacío'));
      if (text.trim().length > 500) return next(new AppError(400, 'El mensaje es demasiado largo (máx. 500 caracteres)'));

      const check = await query(
        `SELECT o.customer_id, o.driver_id, o.status, o.delivered_at, o.chat_reopened_at,
                r.owner_user_id AS restaurant_owner_id
         FROM orders o JOIN restaurants r ON r.id=o.restaurant_id WHERE o.id=$1`,
        [req.params.id]
      );
      if (check.rowCount === 0) return next(new AppError(404, 'Pedido no encontrado'));
      const { customer_id, driver_id, restaurant_owner_id,
              status, delivered_at, chat_reopened_at } = check.rows[0];
      const uid     = req.user.userId;
      const role    = req.user.role;
      const isAdmin = role === 'admin';
      const isParty = uid === customer_id || uid === driver_id || uid === restaurant_owner_id;
      if (!isParty && !isAdmin) return next(new AppError(403, 'No tienes acceso a este pedido'));

      const denied = writeDeniedReason({
        role, status,
        deliveredAt:    delivered_at,
        chatReopenedAt: chat_reopened_at,
        isAdmin,
      });
      if (denied) return next(new AppError(403, denied));

      try {
        const msg = await query(
          `INSERT INTO order_messages(order_id, sender_id, text) VALUES($1,$2,$3) RETURNING *`,
          [req.params.id, uid, text.trim()]
        );
        const recipients = [customer_id, driver_id, restaurant_owner_id].filter(id => id && id !== uid);
        const senderName = req.user.username || req.user.userId;
        for (const recipId of recipients) {
          sseHub.sendToUser(recipId, 'chat_message', {
            orderId:    req.params.id,
            messageId:  msg.rows[0].id,
            senderId:   uid,
            senderName,
            senderRole: role,
            text:       text.trim(),
            createdAt:  msg.rows[0].created_at,
          });
          sendPushToUser?.(recipId, {
            title: `💬 Mensaje de ${senderName}`,
            body: text.trim(),
            tag: `chat_${req.params.id}`,
            group: 'chat',
            priority: 'normal',
            url: '/driver',
            type: 'chat_message',
            pushType: 'chat_message',
            orderId: req.params.id,
            vibrate: [180, 80, 180],
          }).catch(() => {});
        }
        return res.json({ message: msg.rows[0] });
      } catch (e) {
        if (isMissingRelationError(e)) return next(new AppError(503, 'El chat no está disponible todavía. Ejecuta la migración v8.'));
        throw e;
      }
    } catch (error) { return next(error); }
  });

  // ── POST reabrir chat ───────────────────────────────────────────────────────
  // Customer (post-delivered): reactiva ventana de 30 min, puede reintegrar a cualquiera.
  // Driver (on_the_way): puede reintegrar a restaurant mientras el pedido sigue en ruta.
  router.post('/:id/messages/reopen', authenticate, async (req, res, next) => {
    try {
      const check = await query(
        `SELECT o.customer_id, o.driver_id, o.status, r.owner_user_id AS restaurant_owner_id
         FROM orders o JOIN restaurants r ON r.id=o.restaurant_id WHERE o.id=$1`,
        [req.params.id]
      );
      if (check.rowCount === 0) return next(new AppError(404, 'Pedido no encontrado'));
      const { customer_id, driver_id, restaurant_owner_id, status } = check.rows[0];
      const uid  = req.user.userId;
      const role = req.user.role;

      if (role === 'restaurant') return next(new AppError(403, 'La tienda no puede reabrir el chat.'));
      if (role === 'admin')      return next(new AppError(403, 'Admin no necesita reabrir el chat.'));

      const isParty = uid === customer_id || uid === driver_id;
      if (!isParty) return next(new AppError(403, 'No tienes acceso a este pedido'));

      // Driver solo puede reintegrar mientras el pedido está on_the_way
      if (role === 'driver' && status !== 'on_the_way') {
        return next(new AppError(403, 'El conductor solo puede reintegrar a la tienda mientras el pedido está en camino.'));
      }

      // Customer solo puede reintegrar post-entrega
      if (role === 'customer' && !['delivered', 'cancelled'].includes(status)) {
        return next(new AppError(403, 'Solo puedes reabrir el chat después de recibir el pedido.'));
      }

      await query(
        `UPDATE orders SET chat_reopened_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [req.params.id]
      );

      const recipients = [customer_id, driver_id, restaurant_owner_id].filter(id => id && id !== uid);
      const senderName = req.user.username || uid;
      const systemText = role === 'customer'
        ? '📣 El cliente reabrió el chat.'
        : '📣 El conductor reintegró a la tienda al chat.';

      for (const recipId of recipients) {
        sseHub.sendToUser(recipId, 'chat_message', {
          orderId:    req.params.id,
          messageId:  null,
          senderId:   uid,
          senderName,
          senderRole: role,
          text:       systemText,
          createdAt:  new Date().toISOString(),
          isSystem:   true,
        });
        sendPushToUser?.(recipId, {
          title: '💬 Chat del pedido reabierto',
          body: systemText,
          tag: `chat_${req.params.id}`,
          group: 'chat',
          priority: 'normal',
          url: '/driver',
          type: 'chat_message',
          pushType: 'chat_message',
          orderId: req.params.id,
          vibrate: [180, 80, 180],
        }).catch(() => {});
      }

      logEvent('order.chat_reopened', { orderId: req.params.id, by: uid, role });
      return res.json({ ok: true });
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
