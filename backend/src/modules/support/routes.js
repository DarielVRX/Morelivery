// backend/modules/support/routes.js
import { Router }       from 'express';
import { authenticate } from '../../middlewares/auth.js';
import { query }        from '../../config/db.js';
import { AppError }     from '../../utils/errors.js';
import { sseHub }       from '../events/hub.js';

// Notifica a todos los admins conectados (para cuando un usuario abre/responde ticket)
async function notifyAdmins(event, data) {
  try {
    const admins = await query(`SELECT id FROM users WHERE role = 'admin'`);
    for (const admin of admins.rows) {
      sseHub.sendToUser(admin.id, event, data);
    }
  } catch (_) {}
}

const router = Router();

// ── GET /support/tickets ──────────────────────────────────────────────────────
// Usuario: sus propios tickets. Admin: todos los abiertos/pendientes.
router.get('/tickets', authenticate, async (req, res, next) => {
  try {
    const isAdmin = req.user.role === 'admin';
    let result;
    if (isAdmin) {
      result = await query(
        `SELECT t.id, t.subject, t.status, t.created_at, t.updated_at,
                COALESCE(u.alias, u.full_name) AS user_name, u.role AS user_role,
                (SELECT COUNT(*) FROM support_messages m WHERE m.ticket_id = t.id) AS message_count
         FROM support_tickets t
         JOIN users u ON u.id = t.user_id
         WHERE t.status IN ('open','pending')
         ORDER BY t.updated_at DESC
         LIMIT 100`
      );
    } else {
      result = await query(
        `SELECT t.id, t.subject, t.status, t.created_at, t.updated_at,
                (SELECT COUNT(*) FROM support_messages m WHERE m.ticket_id = t.id) AS message_count
         FROM support_tickets t
         WHERE t.user_id = $1
         ORDER BY t.updated_at DESC
         LIMIT 50`,
        [req.user.userId]
      );
    }
    return res.json({ tickets: result.rows });
  } catch (error) { return next(error); }
});

// ── POST /support/tickets ─────────────────────────────────────────────────────
// Crear ticket nuevo. Solo usuarios no-admin.
router.post('/tickets', authenticate, async (req, res, next) => {
  try {
    if (req.user.role === 'admin') return next(new AppError(403, 'Admin no puede abrir tickets'));
    const { subject, text } = req.body || {};
    if (!subject?.trim()) return next(new AppError(400, 'El asunto es requerido'));
    if (!text?.trim())    return next(new AppError(400, 'El mensaje inicial es requerido'));
    if (subject.trim().length > 120) return next(new AppError(400, 'Asunto demasiado largo (máx. 120 caracteres)'));
    if (text.trim().length > 1000)   return next(new AppError(400, 'Mensaje demasiado largo (máx. 1000 caracteres)'));

    const ticket = await query(
      `INSERT INTO support_tickets (user_id, subject) VALUES ($1, $2) RETURNING *`,
      [req.user.userId, subject.trim()]
    );
    await query(
      `INSERT INTO support_messages (ticket_id, sender_id, text) VALUES ($1, $2, $3)`,
      [ticket.rows[0].id, req.user.userId, text.trim()]
    );
    return res.status(201).json({ ticket: ticket.rows[0] });
  } catch (error) { return next(error); }
});

// ── GET /support/tickets/:id/messages ─────────────────────────────────────────
// Leer mensajes de un ticket. Solo el dueño o admin.
router.get('/tickets/:id/messages', authenticate, async (req, res, next) => {
  try {
    const ticket = await query(
      `SELECT * FROM support_tickets WHERE id = $1`,
      [req.params.id]
    );
    if (ticket.rowCount === 0) return next(new AppError(404, 'Ticket no encontrado'));

    const isOwner = ticket.rows[0].user_id === req.user.userId;
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isAdmin) return next(new AppError(403, 'Sin acceso a este ticket'));

    const msgs = await query(
      `SELECT m.id, m.sender_id, m.text, m.is_system, m.created_at,
              COALESCE(u.alias, u.full_name) AS sender_name, u.role AS sender_role
       FROM support_messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.ticket_id = $1
       ORDER BY m.created_at ASC`,
      [req.params.id]
    );
    return res.json({
      ticket:   ticket.rows[0],
      messages: msgs.rows,
      isAdmin,
    });
  } catch (error) { return next(error); }
});

// ── POST /support/tickets/:id/messages ────────────────────────────────────────
// Enviar mensaje. Solo si el ticket está open/pending.
router.post('/tickets/:id/messages', authenticate, async (req, res, next) => {
  try {
    const { text } = req.body || {};
    if (!text?.trim()) return next(new AppError(400, 'El mensaje no puede estar vacío'));
    if (text.trim().length > 1000) return next(new AppError(400, 'Mensaje demasiado largo (máx. 1000 caracteres)'));

    const ticket = await query(
      `SELECT * FROM support_tickets WHERE id = $1`,
      [req.params.id]
    );
    if (ticket.rowCount === 0) return next(new AppError(404, 'Ticket no encontrado'));

    const isOwner = ticket.rows[0].user_id === req.user.userId;
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isAdmin) return next(new AppError(403, 'Sin acceso a este ticket'));
    if (['resolved', 'closed'].includes(ticket.rows[0].status) && !isAdmin) {
      return next(new AppError(403, 'Este ticket está cerrado'));
    }

    const msg = await query(
      `INSERT INTO support_messages (ticket_id, sender_id, text) VALUES ($1, $2, $3) RETURNING *`,
      [req.params.id, req.user.userId, text.trim()]
    );

    // Actualizar updated_at y status del ticket
    const newStatus = isAdmin && ticket.rows[0].status === 'open' ? 'pending' : ticket.rows[0].status;
    await query(
      `UPDATE support_tickets SET updated_at = NOW(), status = $1 WHERE id = $2`,
      [newStatus, req.params.id]
    );

    // SSE — notificar al otro participante
    const ssePayload = {
      ticketId:   req.params.id,
      messageId:  msg.rows[0].id,
      senderId:   req.user.userId,
      senderName: req.user.username || req.user.userId,
      senderRole: req.user.role,
      text:       text.trim(),
      createdAt:  msg.rows[0].created_at,
    };
    if (isAdmin) {
      // Admin respondió — notificar al dueño del ticket
      sseHub.sendToUser(ticket.rows[0].user_id, 'support_message', ssePayload);
    } else {
      // Usuario escribió — notificar a todos los admins
      await notifyAdmins('support_message', ssePayload);
    }

    return res.json({ message: msg.rows[0] });
  } catch (error) { return next(error); }
});

// ── PATCH /support/tickets/:id/status ────────────────────────────────────────
// Cambiar estado del ticket. Admin: cualquier estado. Usuario: solo 'closed'.
router.patch('/tickets/:id/status', authenticate, async (req, res, next) => {
  try {
    const { status } = req.body || {};
    const validAdmin = ['open', 'pending', 'resolved', 'closed'];
    const validUser  = ['closed'];
    const isAdmin = req.user.role === 'admin';

    const allowed = isAdmin ? validAdmin : validUser;
    if (!status || !allowed.includes(status)) {
      return next(new AppError(400, `Estado inválido. Permitidos: ${allowed.join(', ')}`));
    }

    const ticket = await query(
      `SELECT * FROM support_tickets WHERE id = $1`,
      [req.params.id]
    );
    if (ticket.rowCount === 0) return next(new AppError(404, 'Ticket no encontrado'));

    const isOwner = ticket.rows[0].user_id === req.user.userId;
    if (!isOwner && !isAdmin) return next(new AppError(403, 'Sin acceso a este ticket'));

    const resolvedAt = ['resolved', 'closed'].includes(status) ? 'NOW()' : 'NULL';
    const resolvedBy = ['resolved', 'closed'].includes(status) ? req.user.userId : null;

    await query(
      `UPDATE support_tickets
       SET status = $1, updated_at = NOW(),
           resolved_at = ${resolvedAt},
           resolved_by = $2
       WHERE id = $3`,
      [status, resolvedBy, req.params.id]
    );

    // Mensaje de sistema al resolver
    if (['resolved', 'closed'].includes(status)) {
      await query(
        `INSERT INTO support_messages (ticket_id, sender_id, text, is_system)
         VALUES ($1, $2, $3, true)`,
        [req.params.id, req.user.userId,
         status === 'resolved' ? '✓ Ticket marcado como resuelto.' : '🔒 Ticket cerrado.']
      );
    }

    return res.json({ ok: true, status });
  } catch (error) { return next(error); }
});

export default router;
