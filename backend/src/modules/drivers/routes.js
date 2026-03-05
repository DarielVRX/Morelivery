import { Router } from 'express';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { query } from '../../config/db.js';

const router = Router();

router.patch('/availability', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const result = await query('UPDATE driver_profiles SET is_available = $1 WHERE user_id = $2 RETURNING *', [
      req.body.isAvailable,
      req.user.userId
    ]);
    res.json({ profile: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

router.post('/orders/:id/respond', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    if (req.body.accepted) {
      const result = await query('UPDATE orders SET driver_id = $1, status = $2 WHERE id = $3 RETURNING *', [req.user.userId, 'assigned', req.params.id]);
      return res.json({ order: result.rows[0] });
    }
    return res.json({ message: 'Order rejected' });
  } catch (error) {
    next(error);
  }
});

export default router;
