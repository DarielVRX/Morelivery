import { Router } from 'express';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { query } from '../../config/db.js';
import { validate } from '../../middlewares/validate.js';
import { suspendUserSchema } from './schemas.js';
import { logEvent } from '../../utils/logger.js';

const router = Router();
router.use(authenticate, authorize(['admin']));

router.get('/orders', async (_req, res, next) => {
  try {
    const result = await query('SELECT id, status, total_cents, created_at FROM orders ORDER BY created_at DESC LIMIT 100');
    return res.json({ orders: result.rows });
  } catch (error) {
    return next(error);
  }
});

router.get('/users', async (_req, res, next) => {
  try {
    const result = await query('SELECT id, full_name, email, role, status FROM users ORDER BY created_at DESC LIMIT 100');
    return res.json({ users: result.rows });
  } catch (error) {
    return next(error);
  }
});

router.patch('/users/:id/suspend', validate(suspendUserSchema), async (req, res, next) => {
  try {
    const result = await query('UPDATE users SET status = $1 WHERE id = $2 RETURNING id, status', ['suspended', req.params.id]);
    if (result.rowCount > 0) {
      logEvent('admin.user_suspended', { adminId: req.user.userId, userId: req.params.id, reason: req.validatedBody.reason });
    }
    return res.json({ user: result.rows[0] || null });
  } catch (error) {
    return next(error);
  }
});

export default router;
