import { Router } from 'express';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { query } from '../../config/db.js';

const router = Router();
router.use(authenticate, authorize(['admin']));

router.get('/orders', async (_req, res, next) => {
  try {
    const result = await query('SELECT id, status, total_cents, created_at FROM orders ORDER BY created_at DESC LIMIT 100');
    res.json({ orders: result.rows });
  } catch (error) {
    next(error);
  }
});

router.get('/users', async (_req, res, next) => {
  try {
    const result = await query('SELECT id, full_name, email, role, status FROM users ORDER BY created_at DESC LIMIT 100');
    res.json({ users: result.rows });
  } catch (error) {
    next(error);
  }
});

router.patch('/users/:id/suspend', async (req, res, next) => {
  try {
    const result = await query('UPDATE users SET status = $1 WHERE id = $2 RETURNING id, status', ['suspended', req.params.id]);
    res.json({ user: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

export default router;
