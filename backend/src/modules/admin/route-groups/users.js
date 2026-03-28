// backend/src/modules/admin/route-groups/users.js
//
// Rutas de gestión de usuarios del panel admin:
//   GET    /admin/users
//   PATCH  /admin/users/:id/status
//   POST   /admin/register
//   PATCH  /admin/orders/:id/status
//   POST   /admin/users/:id/clear-penalties

import { Router } from 'express';
import { query } from '../../../config/db.js';
import { authenticate, authorize } from '../../../middlewares/auth.js';
import { AppError } from '../../../utils/errors.js';
import { registerUser } from '../../auth/service.js';
import { sseHub } from '../../events/hub.js';

const router = Router();

/* ── GET /admin/users ── */
router.get('/users', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const result = await query(`
    SELECT u.id, u.full_name, u.email, u.role, u.status, u.created_at,
    dp.is_available, dp.vehicle_type, dp.is_verified,
    r.name AS restaurant_name, r.is_open AS restaurant_is_open
    FROM users u
    LEFT JOIN driver_profiles dp ON dp.user_id=u.id
    LEFT JOIN restaurants r ON r.owner_user_id=u.id
    ORDER BY u.created_at DESC`);
    return res.json({ users: result.rows });
  } catch (error) { return next(error); }
});

/* ── PATCH /admin/users/:id/status ── */
router.patch('/users/:id/status', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['active','suspended'].includes(status))
      return next(new AppError(400, 'Estado inválido, debe ser active o suspended'));
    await query('UPDATE users SET status=$1 WHERE id=$2', [status, req.params.id]);
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

/* ── POST /admin/register — solo admins crean admins ── */
router.post('/register', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const user = await registerUser({ ...req.body, role: 'admin' });
    return res.status(201).json({ user });
  } catch (error) { return next(error); }
});

/* ── PATCH /admin/orders/:id/status — override de emergencia ── */
router.patch('/orders/:id/status', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const { status, note } = req.body || {};
    if (!status) return next(new AppError(400, 'El campo status es requerido'));
    const tsCol = {
      accepted: 'accepted_at', preparing: 'preparing_at', ready: 'ready_at',
      on_the_way: 'picked_up_at', delivered: 'delivered_at', cancelled: 'cancelled_at',
    }[status];
    const tsClause = tsCol ? `, ${tsCol} = NOW()` : '';
    await query(
      `UPDATE orders SET status=$1, restaurant_note=COALESCE($2, restaurant_note), updated_at=NOW()${tsClause} WHERE id=$3`,
      [status, note || null, req.params.id]
    );
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

/* ── POST /admin/users/:id/clear-penalties ── */
router.post('/users/:id/clear-penalties', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const result = await query(
      `UPDATE driver_profiles
      SET disconnect_penalties = 0, updated_at = NOW()
      WHERE user_id = $1
      RETURNING user_id, disconnect_penalties`,
      [req.params.id]
    );
    if (result.rowCount === 0) return next(new AppError(404, 'Driver no encontrado'));
    sseHub.sendToUser(req.params.id, 'penalties_cleared', { message: 'Tus penalizaciones han sido eliminadas.' });
    console.log(`[admin.emergency] clear-penalties driver=${req.params.id.slice(0,8)}`);
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

export default router;
