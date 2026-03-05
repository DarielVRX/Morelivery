import { Router } from 'express';
import { validate } from '../../middlewares/validate.js';
import { authRateLimit } from '../../middlewares/rateLimit.js';
import { loginSchema, profileSchema, registerSchema } from './schemas.js';
import { deleteAccount, loginUser, registerUser, updateProfileAddress } from './service.js';
import { logEvent } from '../../utils/logger.js';
import { authenticate } from '../../middlewares/auth.js';

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

router.patch('/profile', authenticate, validate(profileSchema), async (req, res, next) => {
  try {
    const data = await updateProfileAddress(req.user.userId, req.user.role, req.validatedBody.address);
    res.json({ profile: data });
  } catch (error) {
    next(error);
  }
});

router.delete('/account', authenticate, async (req, res, next) => {
  try {
    const data = await deleteAccount(req.user.userId);
    logEvent('auth.account_deleted', { userId: req.user.userId });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

export default router;
