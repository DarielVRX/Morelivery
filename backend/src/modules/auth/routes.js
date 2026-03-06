import { Router } from 'express';
// CORRECCIÓN: Eliminamos 'validateBody' y usamos solo 'validate' 
// que es lo que realmente exporta tu middleware.
import { validate } from '../../middlewares/validate.js'; 
import { authRateLimit } from '../../middlewares/rateLimit.js';
import { loginSchema, profileSchema, registerSchema } from './schemas.js';
import { changePassword, deleteAccount, loginUser, registerUser, updateProfileAddress } from './service.js';
import { logEvent } from '../../utils/logger.js';
import { authenticate } from '../../middlewares/auth.js';
import { z } from 'zod';

const router = Router();

router.post('/register', authRateLimit, validate(registerSchema), async (req, res, next) => {
  try {
    const user = await registerUser(req.validatedBody);
    logEvent('auth.register', { userId: user.id, role: user.role });
    res.status(201).json({ user });
  } catch (error) { next(error); }
});

router.post('/login', authRateLimit, validate(loginSchema), async (req, res, next) => {
  try {
    const data = await loginUser(req.validatedBody);
    logEvent('auth.login', { userId: data.user.id });
    res.json(data);
  } catch (error) { next(error); }
});

// Sugerencia: Añadir validación al perfil también
router.patch('/profile', authenticate, validate(profileSchema), async (req, res, next) => {
  try {
    const { address, displayName } = req.validatedBody; // Usar validatedBody para mayor seguridad
    const result = await updateProfileAddress(req.user.userId, req.user.role, address, displayName);
    res.json({ profile: result });
  } catch (error) { next(error); }
});

router.patch('/password', authenticate, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }
    await changePassword(req.user.userId, currentPassword, newPassword);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

router.delete('/account', authenticate, async (req, res, next) => {
  try {
    const data = await deleteAccount(req.user.userId);
    logEvent('auth.account_deleted', { userId: req.user.userId });
    res.json(data);
  } catch (error) { next(error); }
});

export default router;
