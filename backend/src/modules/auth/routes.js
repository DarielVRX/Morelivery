// backend/modules/auth/routes.js
import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { registerSchema, loginSchema } from './schemas.js';
import { registerUser, loginUser, updateProfileAddress, changePassword, deleteAccount } from './service.js';
import { AppError } from '../../utils/errors.js';

const router = Router();

/* ── POST /auth/register ── */
router.post('/register', validate(registerSchema), async (req, res, next) => {
  try {
    // Registro público de admin bloqueado — solo el dashboard de admin puede crear admins
    if (req.body.role === 'admin') return next(new AppError(403, 'El registro de administradores no está disponible públicamente'));
    const user = await registerUser(req.body);
    return res.status(201).json({ user });
  } catch (error) { return next(error); }
});

/* ── POST /auth/login ── */
router.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const result = await loginUser(req.body);
    return res.json(result);
  } catch (error) { return next(error); }
});

/* ── PATCH /auth/profile ── */
router.patch('/profile', authenticate, async (req, res, next) => {
  try {
    const { address, displayName } = req.body || {};
    const profile = await updateProfileAddress(req.user.userId, req.user.role, address, displayName);
    return res.json({ profile });
  } catch (error) { return next(error); }
});

/* ── PATCH /auth/login-username — cambia el username de acceso (email interno) ── */
router.patch('/login-username', authenticate, async (req, res, next) => {
  try {
    const { currentPassword, newUsername } = req.body || {};
    if (!newUsername?.trim()) return next(new AppError(400, 'El nuevo usuario de acceso no puede estar vacío'));
    if (!currentPassword)     return next(new AppError(400, 'La contraseña actual es requerida'));
    // Verificar contraseña actual
    const { changePassword, updateLoginUsername } = await import('./service.js');
    await updateLoginUsername(req.user.userId, req.user.role, currentPassword, newUsername.trim());
    return res.json({ ok: true, username: newUsername.trim().toLowerCase() });
  } catch (error) { return next(error); }
});

/* ── PATCH /auth/password ── */
router.patch('/password', authenticate, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || newPassword.length < 6) return next(new AppError(400, 'La nueva contraseña debe tener al menos 6 caracteres'));
    await changePassword(req.user.userId, currentPassword, newPassword);
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

/* ── DELETE /auth/account — bloqueado si hay pedidos pendientes ── */
router.delete('/account', authenticate, async (req, res, next) => {
  try {
    await deleteAccount(req.user.userId, req.user.role);
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

export default router;
