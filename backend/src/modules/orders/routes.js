// backend/modules/orders/routes.js
import { Router } from 'express';
import { query } from '../../config/db.js';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { orderEvents } from '../../events/orderEvents.js';
import { logEvent } from '../../utils/logger.js';
import { validate } from '../../middlewares/validate.js';
import { createOrderSchema, suggestionResponseSchema, suggestionSchema, updateOrderStatusSchema } from './schemas.js';
import { AppError } from '../../utils/errors.js';
import { offerNextDrivers, expireTimedOutOffers } from './assignment.js';
import { sseHub } from '../events/hub.js';

const router = Router();

function isMissingColumnError(e) { return e?.code === '42703'; }
function isMissingRelationError(e) { return e?.code === '42P01'; }

/** Emite SSE a todas las partes de un pedido */
async function notifyOrderParties(orderId, event, data) {
  try {
    const r = await query(
      `SELECT o.customer_id, o.driver_id, rest.owner_user_id AS restaurant_owner_id
       FROM orders o JOIN restaurants rest ON rest.id = o.restaurant_id WHERE o.id = $1`,
      [orderId]
    );
    if (r.rowCount === 0) return;
    const { customer_id, driver_id, restaurant_owner_id } = r.rows[0];
    sseHub.sendToUser(customer_id, event, data);
    sseHub.sendToUser(restaurant_owner_id, event, data);
    if (driver_id) sseHub.sendToUser(driver_id, event, data);
  } catch (_) {}
}

/** Columna de timestamp que corresponde a cada transición */
const STATUS_TS = {
  accepted:  'accepted_at',
  preparing: 'preparing_at',
  ready:     'ready_at',
  on_the_way:'picked_up_at',
  delivered: 'delivered_at',
  cancelled: 'cancelled_at',
};

function parseSuggestionItems(raw) {
  if (!raw) return [];
  try { const p = JSON.parse(raw); return Array.isArray(p?.items) ? p.items : []; } catch { return []; }
}
function parseSuggestionNote(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw)?.note || null; } catch { return null; }
}

async function getOrderItems(orderIds = []) {
  if (orderIds.length === 0) return new Map();
  let result;
  try {
    result = await query(
      `SELECT oi.order_id, oi.menu_item_id, oi.quantity, oi.unit_price_cents,
              COALESCE(mi.name,'Producto') AS name
       FROM order_items oi LEFT JOIN menu_items mi ON mi.id = oi.menu_item_id
       WHERE oi.order_id = ANY($1::uuid[]) ORDER BY oi.order_id, oi.id`,
      [orderIds]
    );
  } catch (e) { if (isMissingRelationError(e)) return new Map(); throw e; }
  const map = new Map();
  for (const row of result.rows) {
    if (!map.has(row.order_id)) map.set(row.order_id, []);
    map.get(row.order_id).push({ menuItemId: row.menu_item_id, name: row.name, quantity: row.quantity, unitPriceCents: row.unit_price_cents });
  }
  return map;
}

/* ── POST / ── */
router.post('/', authenticate, authorize(['customer']), validate(createOrderSchema), async (req, res, next) => {
  const { restaurantId, items } = req.validatedBody;
  try {
    let deliveryAddress = 'address-pending';
    try {
      const c = await query('SELECT address FROM users WHERE id=$1', [req.user.userId]);
      deliveryAddress = c.rows[0]?.address || 'address-pending';
    } catch (e) { if (!isMissingColumnError(e)) throw e; }
    if (!deliveryAddress || deliveryAddress === 'address-pending') return next(new AppError(400, 'Debes guardar tu dirección antes de hacer un pedido'));

    let totalCents = 0;
    for (const item of items) {
      const m = await query('SELECT price_cents FROM menu_items WHERE id=$1 AND restaurant_id=$2', [item.menuItemId, restaurantId]);
      if (m.rowCount === 0) return next(new AppError(400, 'Producto del menú no encontrado'));
      totalCents += m.rows[0].price_cents * item.quantity;
    }

    const orderResult = await query(
      'INSERT INTO orders(customer_id, restaurant_id, status, total_cents, delivery_address) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [req.user.userId, restaurantId, 'created', totalCents, deliveryAddress]
    );
    const order = orderResult.rows[0];

    for (const item of items) {
      const m = await query('SELECT price_cents FROM menu_items WHERE id=$1', [item.menuItemId]);
      await query('INSERT INTO order_items(order_id, menu_item_id, quantity, unit_price_cents) VALUES($1,$2,$3,$4)',
        [order.id, item.menuItemId, item.quantity, m.rows[0].price_cents]);
    }

    try { await offerNextDrivers(order.id); } catch (e) {
      if (!isMissingRelationError(e) && !isMissingColumnError(e)) throw e;
    }

    const updated = await query('SELECT * FROM orders WHERE id=$1', [order.id]);
    orderEvents.emitOrderUpdate(order.id, updated.rows[0].status);

    try {
      const restInfo = await query('SELECT owner_user_id FROM restaurants WHERE id=$1', [restaurantId]);
      if (restInfo.rowCount > 0) sseHub.sendToUser(restInfo.rows[0].owner_user_id, 'order_update', { orderId: order.id, status: 'created', action: 'new_order' });
    } catch (_) {}

    logEvent('order.created', { orderId: order.id, customerId: req.user.userId });
    return res.status(201).json({ order: updated.rows[0] });
  } catch (error) { return next(error); }
});

/* ── PATCH /:id/status ── */
router.patch('/:id/status', authenticate, authorize(['restaurant','driver','admin']), validate(updateOrderStatusSchema), async (req, res, next) => {
  try {
    const current = await query('SELECT * FROM orders WHERE id=$1', [req.params.id]);
    if (current.rowCount === 0) return next(new AppError(404, 'Pedido no encontrado'));

    const order = current.rows[0];
    const nextStatus = req.validatedBody.status;

    // ── Validación de ownership por rol ──────────────────────────────────────
    if (req.user.role === 'driver') {
      if (order.driver_id !== req.user.userId)
        return next(new AppError(403, 'No tienes permiso para modificar este pedido'));
    }
    if (req.user.role === 'restaurant') {
      // Verificar que el restaurante pertenece al usuario
      const restCheck = await query(
        'SELECT 1 FROM restaurants WHERE id=$1 AND owner_user_id=$2',
        [order.restaurant_id, req.user.userId]
      );
      if (restCheck.rowCount === 0)
        return next(new AppError(403, 'No tienes permiso para modificar este pedido'));
    }

    // ── Máquina de estados: transiciones válidas por rol ─────────────────────
    // Tabla de transiciones por rol — '*' significa desde cualquier estado no terminal
    const ACTIVE = ['created','pending_driver','assigned','accepted','preparing','ready','on_the_way'];
    const VALID = {
      restaurant: {
        preparing: ACTIVE, // puede marcar "en preparación" desde cualquier estado activo
        ready:     ACTIVE, // puede marcar "listo" directamente, sin depender de "en preparación"
      },
      driver: {
        accepted:  ['assigned','pending_driver'],
        on_the_way:['ready'],
        delivered: ['on_the_way'],
      },
      admin: { assigned:'*', accepted:'*', preparing:'*', ready:'*', on_the_way:'*', delivered:'*', cancelled:'*' },
    };
    const STATUS_ES = {
      created:'Recibido', pending_driver:'Buscando conductor', assigned:'Asignado',
      accepted:'Aceptado', preparing:'En preparación', ready:'Listo',
      on_the_way:'En camino', delivered:'Entregado', cancelled:'Cancelado',
    };
    const allowed = VALID[req.user.role]?.[nextStatus];
    if (!allowed) return next(new AppError(403, `El rol '${req.user.role}' no puede establecer el estado '${STATUS_ES[nextStatus] || nextStatus}'`));
    if (allowed !== '*' && !allowed.includes(order.status))
      return next(new AppError(409, `No se puede cambiar de '${STATUS_ES[order.status] || order.status}' a '${STATUS_ES[nextStatus] || nextStatus}'`));

    let driverNote     = order.driver_note;
    let restaurantNote = order.restaurant_note;
    if (req.user.role === 'restaurant' && nextStatus === 'preparing') driverNote     = 'Restaurante: pedido en preparación';
    if (req.user.role === 'restaurant' && nextStatus === 'ready')     driverNote     = 'Restaurante: pedido listo para retiro';
    if (req.user.role === 'driver'     && nextStatus === 'on_the_way') restaurantNote = 'Driver: pedido en camino';
    if (req.user.role === 'driver'     && nextStatus === 'delivered')  restaurantNote = 'Driver: pedido entregado';

    // Timestamp de la etapa
    const tsCol = STATUS_TS[nextStatus];
    const tsClause = tsCol ? `, ${tsCol} = NOW()` : '';

    const result = await query(
      `UPDATE orders SET status=$1, driver_note=$2, restaurant_note=$3, updated_at=NOW()${tsClause} WHERE id=$4 RETURNING *`,
      [nextStatus, driverNote, restaurantNote, req.params.id]
    );
    const updated = result.rows[0];
    orderEvents.emitOrderUpdate(updated.id, updated.status);
    await notifyOrderParties(updated.id, 'order_update', { orderId: updated.id, status: updated.status });
    logEvent('order.status_changed', { orderId: updated.id, status: updated.status, actor: req.user.userId });
    return res.json({ order: updated });
  } catch (error) { return next(error); }
});

/* ── PATCH /:id/cancel ── */
router.patch('/:id/cancel', authenticate, authorize(['customer']), async (req, res, next) => {
  try {
    const { note } = req.body || {};
    if (!note?.trim()) return next(new AppError(400, 'El motivo de cancelación es obligatorio'));
    // Solo cancelable en estados antes de que el restaurante comience a preparar
    const check = await query(
      `SELECT id, status FROM orders WHERE id=$1 AND customer_id=$2`,
      [req.params.id, req.user.userId]
    );
    if (check.rowCount === 0) return next(new AppError(404, 'Pedido no encontrado'));
    const cancellable = ['created','pending_driver','assigned','accepted'];
    if (!cancellable.includes(check.rows[0].status))
      return next(new AppError(409, 'El pedido ya no puede cancelarse en este estado'));
    const result = await query(
      `UPDATE orders SET status='cancelled', restaurant_note=$3, cancelled_at=NOW(), updated_at=NOW()
       WHERE id=$1 AND customer_id=$2 RETURNING *`,
      [req.params.id, req.user.userId, `[CANCELADO POR CLIENTE] ${note.trim()}`]
    );
    await notifyOrderParties(req.params.id, 'order_update', { orderId: req.params.id, status: 'cancelled' });
    return res.json({ order: result.rows[0] });
  } catch (error) { return next(error); }
});

/* ── PATCH /:id/suggest ── */
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
        unitPriceCents: menuMap.get(item.menuItemId)?.price_cents || 0
      })),
      note: req.validatedBody.note || null
    };

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

/* ── PATCH /:id/suggestion-response ── */
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
          await query('INSERT INTO order_items(order_id, menu_item_id, quantity, unit_price_cents) VALUES($1,$2,$3,$4)',
            [req.params.id, item.menuItemId, item.quantity, item.unitPriceCents]);
          newTotal += item.unitPriceCents * item.quantity;
        }
        await query(`UPDATE orders SET total_cents=$1, suggestion_text=NULL, updated_at=NOW() WHERE id=$2`, [newTotal, req.params.id]);
      }
      await query('COMMIT');
    } catch (txError) { await query('ROLLBACK'); throw txError; }

    logEvent('order.suggestion_processed', { orderId: req.params.id, accepted, customerId: req.user.userId });
    await notifyOrderParties(req.params.id, 'order_update', { orderId: req.params.id, action: accepted ? 'suggestion_accepted' : 'suggestion_rejected' });

    const updatedOrder = await query('SELECT * FROM orders WHERE id=$1', [req.params.id]);
    return res.json({ order: updatedOrder.rows[0] });
  } catch (error) { return next(error); }
});

/* ── POST /:id/complaint ── */
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

/* ── GET /my ── */
router.get('/my', authenticate, async (req, res, next) => {
  try {
    let result;
    try {
      result = await query(
        `SELECT o.*, r.name AS restaurant_name, r.address AS restaurant_address,
                split_part(c.full_name,'_',1) AS customer_first_name, c.full_name AS customer_display_name,
                split_part(d.full_name,'_',1) AS driver_first_name, c.address AS customer_address
         FROM orders o
         JOIN restaurants r ON r.id = o.restaurant_id
         JOIN users c ON c.id = o.customer_id
         LEFT JOIN users d ON d.id = o.driver_id
         WHERE o.customer_id=$1 OR o.driver_id=$1 OR o.restaurant_id IN (SELECT id FROM restaurants WHERE owner_user_id=$1)
         ORDER BY o.created_at DESC`,
        [req.user.userId]
      );
    } catch (error) {
      if (!isMissingColumnError(error)) throw error;
      result = await query(
        `SELECT o.*, r.name AS restaurant_name, NULL AS restaurant_address,
                split_part(c.full_name,'_',1) AS customer_first_name, c.full_name AS customer_display_name,
                split_part(d.full_name,'_',1) AS driver_first_name, o.delivery_address AS customer_address
         FROM orders o
         JOIN restaurants r ON r.id = o.restaurant_id
         JOIN users c ON c.id = o.customer_id
         LEFT JOIN users d ON d.id = o.driver_id
         WHERE o.customer_id=$1 OR o.driver_id=$1 OR o.restaurant_id IN (SELECT id FROM restaurants WHERE owner_user_id=$1)
         ORDER BY o.created_at DESC`,
        [req.user.userId]
      );
    }
    const orderIds = result.rows.map(r => r.id);
    const itemsByOrder = await getOrderItems(orderIds);
    const orders = result.rows.map(row => ({
      ...row,
      items: itemsByOrder.get(row.id) || [],
      suggestion_items: parseSuggestionItems(row.suggestion_text),
      suggestion_note: parseSuggestionNote(row.suggestion_text),
    }));
    return res.json({ orders });
  } catch (error) { return next(error); }
});

/* ── GET /:id/messages ── chat del pedido ── */
router.get('/:id/messages', authenticate, async (req, res, next) => {
  try {
    // Verificar que el usuario es parte del pedido
    const check = await query(
      `SELECT o.customer_id, o.driver_id, r.owner_user_id AS restaurant_owner_id
       FROM orders o JOIN restaurants r ON r.id=o.restaurant_id WHERE o.id=$1`,
      [req.params.id]
    );
    if (check.rowCount === 0) return next(new AppError(404, 'Pedido no encontrado'));
    const { customer_id, driver_id, restaurant_owner_id } = check.rows[0];
    const uid = req.user.userId;
    if (uid !== customer_id && uid !== driver_id && uid !== restaurant_owner_id)
      return next(new AppError(403, 'No tienes acceso a este pedido'));

    try {
      const msgs = await query(
        `SELECT m.id, m.sender_id, m.text, m.created_at,
                split_part(u.full_name,'_',1) AS sender_name, u.role AS sender_role
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

/* ── POST /:id/messages ── enviar mensaje ── */
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
    if (uid !== customer_id && uid !== driver_id && uid !== restaurant_owner_id)
      return next(new AppError(403, 'No tienes acceso a este pedido'));

    try {
      const msg = await query(
        `INSERT INTO order_messages(order_id, sender_id, text) VALUES($1,$2,$3) RETURNING *`,
        [req.params.id, uid, text.trim()]
      );
      // Notificar en tiempo real a los otros participantes
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

/* ── POST /:id/report ── reporte post-entrega (cualquier rol) ── */
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
    if (uid !== customer_id && uid !== driver_id && uid !== restaurant_owner_id)
      return next(new AppError(403, 'No tienes acceso a este pedido'));
    if (!['delivered','cancelled'].includes(status))
      return next(new AppError(409, 'Solo se puede reportar un pedido completado o cancelado'));

    try {
      await query(
        `INSERT INTO order_reports(order_id, reporter_id, reporter_role, reason, text)
         VALUES($1,$2,$3,$4,$5)`,
        [req.params.id, uid, req.user.role, reason?.trim() || 'general', text.trim()]
      );
    } catch (e) {
      if (isMissingRelationError(e)) {
        // Fallback: guardar como queja
        await query(`INSERT INTO order_complaints(order_id, customer_id, text, created_at)
          VALUES($1,$2,$3,NOW()) ON CONFLICT DO NOTHING`,
          [req.params.id, uid, `[REPORTE ${req.user.role}] ${text.trim()}`]);
      } else throw e;
    }
    logEvent('order.report', { orderId: req.params.id, reporterId: uid, role: req.user.role });
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});


export default router;
