import { Router } from 'express';
import { validate } from '../../middlewares/validate.js';
import { authRateLimit } from '../../middlewares/rateLimit.js';
import { loginSchema, registerSchema } from './schemas.js';
import { loginUser, registerUser } from './service.js';
import { logEvent } from '../../utils/logger.js';

const router = Router();

router.post('/register', authRateLimit, validate(registerSchema), async (req, res, next) => {
  try {
    const user = await registerUser(req.validatedBody);
    logEvent('auth.register', { userId: user.id, role: user.role });
    res.status(201).json({ user });
  } catch (error) {
    next(error);
  }
});

router.post('/login', authRateLimit, validate(loginSchema), async (req, res, next) => {
  try {
    const data = await loginUser(req.validatedBody);
    logEvent('auth.login', { userId: data.user.id });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

export default router;
