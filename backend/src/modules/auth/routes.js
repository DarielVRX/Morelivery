// backend/modules/auth/routes.js
import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { registerSchema, loginSchema } from './schemas.js';
import { registerUser, loginUser, updateProfileAddress, changePassword, deleteAccount, updateLoginUsername } from './service.js';
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


/* ── GET /auth/postal/:cp ── proxy CP/colonias para evitar problemas CORS ── */
router.get('/postal/:cp', authenticate, async (req, res, next) => {
  try {
    const cp = String(req.params.cp || '').trim();
    if (!/^\d{5}$/.test(cp)) return next(new AppError(400, 'Código postal inválido'));

    const normalize = (estado, ciudad, colonias) => ({
      estado: estado || '',
      ciudad: ciudad || '',
      colonias: [...new Set((colonias || []).filter(Boolean).map(c => String(c).trim()))].sort(),
    });

    try {
      const r = await fetch(`https://api-sepomex.hckdrk.mx/query/info_cp/${cp}?type=simplified`);
      if (r.ok) {
        const data = await r.json();
        const rows = Array.isArray(data?.response) ? data.response : [];
        if (rows.length > 0) {
          return res.json(normalize(
            rows[0]?.estado || rows[0]?.d_estado || '',
            rows[0]?.municipio || rows[0]?.ciudad || rows[0]?.D_mnpio || '',
            rows.map(i => i?.asentamiento || i?.colonia || i?.d_asenta)
          ));
        }
      }
    } catch (_) {}

    try {
      const r2 = await fetch(`https://mexico-api.devaleff.com/api/codigo-postal/${cp}`);
      if (r2.ok) {
        const data2 = await r2.json();
        const items = Array.isArray(data2?.data) ? data2.data : [];
        if (items.length > 0) {
          return res.json(normalize(
            items[0]?.d_estado || '',
            items[0]?.D_mnpio || items[0]?.d_ciudad || '',
            items.map(i => i?.d_asenta)
          ));
        }
      }
    } catch (_) {}

    return next(new AppError(404, 'CP no encontrado'));
  } catch (error) { return next(error); }
});

/* ── PATCH /auth/profile ── */
router.patch('/profile', authenticate, async (req, res, next) => {
  try {
    const { address, displayName, lat, lng, homeLat, homeLng, postalCode, colonia, estado, ciudad } = req.body || {};
    const profile = await updateProfileAddress(req.user.userId, req.user.role, address, displayName, lat, lng, homeLat, homeLng, postalCode, colonia, estado, ciudad);
    return res.json({ profile });
  } catch (error) { return next(error); }
});

/* ── PATCH /auth/password ── */
/* ── PATCH /auth/login-username ── */
router.patch('/login-username', authenticate, async (req, res, next) => {
  try {
    const { currentPassword, newUsername } = req.body || {};
    if (!newUsername?.trim()) return next(new AppError(400, 'El nuevo usuario de acceso no puede estar vacío'));
    if (!currentPassword)     return next(new AppError(400, 'La contraseña actual es requerida'));
    const result = await updateLoginUsername(req.user.userId, req.user.role, currentPassword, newUsername.trim());
    return res.json({ ok: true, username: result.username });
  } catch (error) { return next(error); }
});

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
