import { Router } from 'express';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { query } from '../../config/db.js';
import { validate } from '../../middlewares/validate.js';
import { availabilitySchema, driverOrderResponseSchema } from './schemas.js';
import { AppError } from '../../utils/errors.js';

const router = Router();

router.patch('/availability', authenticate, authorize(['driver']), validate(availabilitySchema), async (req, res, next) => {
  try {
    const result = await query('UPDATE driver_profiles SET is_available = $1 WHERE user_id = $2 RETURNING *', [
      req.validatedBody.isAvailable,
      req.user.userId
    ]);
    if (result.rowCount === 0) {
      return next(new AppError(404, 'Driver profile not found'));
    }
    return res.json({ profile: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/orders/:id/respond', authenticate, authorize(['driver']), validate(driverOrderResponseSchema), async (req, res, next) => {
  try {
    if (req.validatedBody.accepted) {
      const result = await query('UPDATE orders SET driver_id = $1, status = $2 WHERE id = $3 RETURNING *', [req.user.userId, 'assigned', req.params.id]);
      if (result.rowCount === 0) {
        return next(new AppError(404, 'Order not found'));
      }
      return res.json({ order: result.rows[0] });
    }
    return res.json({ message: 'Order rejected' });
  } catch (error) {
    return next(error);
  }
});

export default router;
