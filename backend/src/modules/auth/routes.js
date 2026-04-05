// backend/modules/auth/routes.js
import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import {
  registerSchema, loginSchema, profileSchema,
  forgotPasswordSchema, resetPasswordSchema, googleAuthSchema,
} from './schemas.js';
import {
  registerUser, loginUser, updateProfileAddress, changePassword,
  deleteAccount, updateLoginUsername,
  googleLogin, forgotPassword, resetPassword, verifyEmail, resendVerificationEmail,
  unlockAccount, verifyTwoFaCode, toggleTwoFa, refreshToken,
} from './service.js';
import { AppError } from '../../utils/errors.js';
import { authRateLimit } from '../../middlewares/rateLimit.js';
import { query } from '../../config/db.js';

const router = Router();

async function fetchWithTimeout(url, timeoutMs = 1800) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/* ── POST /auth/register ─────────────────────────────────────────────────── */
router.post('/register', authRateLimit, validate(registerSchema), async (req, res, next) => {
  try {
    if (req.body.role === 'admin')
      return next(new AppError(403, 'El registro de administradores no está disponible públicamente'));
    if (req.body.role === 'restaurant' && !req.body.postalCode && !req.body.calle && !req.body.address)
      return next(new AppError(400, 'La dirección de la tienda es requerida'));
    const user = await registerUser(req.body);
    return res.status(201).json({ user });
  } catch (error) { return next(error); }
});

/* ── POST /auth/login ────────────────────────────────────────────────────── */
router.post('/login', authRateLimit, validate(loginSchema), async (req, res, next) => {
  try {
    const result = await loginUser(req.body);
    return res.json(result);
  } catch (error) { return next(error); }
});

/* ── POST /auth/google ───────────────────────────────────────────────────── */
router.post('/google', authRateLimit, validate(googleAuthSchema), async (req, res, next) => {
  try {
    const role            = ['customer', 'restaurant', 'driver'].includes(req.body.role) ? req.body.role : 'customer';
    const confirmRegister = req.body.confirmRegister === true;
    const result = await googleLogin(req.body.credential, role, confirmRegister);
    return res.json(result);
  } catch (error) {
    // Propagar el extra de requiresConfirmation al cliente
    if (error.status === 404 && error.extra?.requiresConfirmation) {
      return res.status(404).json({ requiresConfirmation: true, email: error.extra.email, role: error.extra.role });
    }
    return next(error);
  }
});

/* ── POST /auth/forgot-password ──────────────────────────────────────────── */
router.post('/forgot-password', authRateLimit, validate(forgotPasswordSchema), async (req, res, next) => {
  try {
    await forgotPassword(req.body.email);
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

/* ── POST /auth/reset-password ───────────────────────────────────────────── */
router.post('/reset-password', authRateLimit, validate(resetPasswordSchema), async (req, res, next) => {
  try {
    await resetPassword(req.body.token, req.body.newPassword);
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

/* ── GET /auth/verify-email?token=xxx ────────────────────────────────────── */
router.get('/verify-email', async (req, res, next) => {
  try {
    await verifyEmail(String(req.query.token || ''));
    const frontUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    return res.redirect(`${frontUrl}/login?verified=1`);
  } catch (error) { return next(error); }
});

// POST /auth/resend-verification
router.post('/resend-verification', async (req, res, next) => {
  try {
    const { email } = req.body || {};
    if (!email) return next(new AppError(400, 'El correo es requerido'));
    await resendVerificationEmail(email.trim().toLowerCase());
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

/* ── GET /auth/check-username ────────────────────────────────────────────── */
router.get('/check-username', async (req, res, next) => {
  try {
    const username = String(req.query.username || '').trim().toLowerCase();
    if (!username || username.length < 3) return next(new AppError(400, 'Username muy corto'));
    const pseudoEmail = `${username}@local.test`;
    const r = await query('SELECT 1 FROM users WHERE email=$1 LIMIT 1', [pseudoEmail]);
    if (r.rowCount > 0) return next(new AppError(409, 'Username no disponible'));
    return res.json({ available: true });
  } catch (error) { return next(error); }
});

/* ── GET /auth/check-email — verificar disponibilidad de email en tiempo real ── */
router.get('/check-email', async (req, res, next) => {
  try {
    const email = String(req.query.email || '').trim().toLowerCase();
    const role  = String(req.query.role  || 'customer');
    if (!email || !/\S+@\S+\.\S+/.test(email)) return next(new AppError(400, 'Correo inválido'));
    const r = await query(
      'SELECT 1 FROM users WHERE real_email=$1 AND role=$2 LIMIT 1',
      [email, role]
    ).catch(() => query('SELECT 1 FROM users WHERE email=$1 LIMIT 1', [email]));
    if (r.rowCount > 0) return next(new AppError(409, 'Este correo ya está registrado'));
    return res.json({ available: true });
  } catch (error) { return next(error); }
});

/* ── GET /auth/postal/:cp ────────────────────────────────────────────────── */
router.get('/postal/:cp', async (req, res, next) => {
  try {
    const cp = String(req.params.cp || '').trim();
    if (!/^\d{5}$/.test(cp)) return next(new AppError(400, 'Código postal inválido'));

    const normalize = (estado, ciudad, colonias) => ({
      estado: estado || '',
      ciudad: ciudad || '',
      colonias: [...new Set((colonias || []).filter(Boolean).map(c => String(c).trim()))].sort(),
    });

    // API 1 — Nominatim
    try {
      const r = await fetchWithTimeout(
        `https://nominatim.openstreetmap.org/search?postalcode=${cp}&country=mx&format=json&addressdetails=1&limit=10`,
        4000
      );
      if (r.ok) {
        const data = await r.json();
        if (data?.length > 0) {
          const a = data[0].address || {};
          return res.json(normalize(
            a.state || '',
            a.city || a.town || a.municipality || a.county || '',
            data.map(i => i.address?.suburb || i.address?.neighbourhood || i.address?.quarter).filter(Boolean)
          ));
        }
      }
    } catch (_) {}

    // API 2 — Sepomex
    try {
      const r = await fetchWithTimeout(`https://api-sepomex.hckdrk.mx/query/info_cp/${cp}?type=simplified`, 3000);
      if (r.ok) {
        const data = await r.json();
        const rows = Array.isArray(data?.response) ? data.response : [];
        if (rows.length > 0) return res.json(normalize(
          rows[0]?.estado || rows[0]?.d_estado,
          rows[0]?.municipio || rows[0]?.ciudad || rows[0]?.D_mnpio,
          rows.map(i => i?.asentamiento || i?.colonia || i?.d_asenta)
        ));
      }
    } catch (_) {}

    // API 3 — devaleff
    try {
      const r = await fetchWithTimeout(`https://mexico-api.devaleff.com/api/codigo-postal/${cp}`, 3000);
      if (r.ok) {
        const data = await r.json();
        const items = Array.isArray(data?.data) ? data.data : [];
        if (items.length > 0) return res.json(normalize(
          items[0]?.d_estado,
          items[0]?.D_mnpio || items[0]?.d_ciudad,
          items.map(i => i?.d_asenta)
        ));
      }
    } catch (_) {}

    return next(new AppError(404, 'CP no encontrado'));
  } catch (error) { return next(error); }
});

/* ── POST /auth/refresh ──────────────────────────────────────────────────── */
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken: rt } = req.body || {};
    if (!rt) return next(new AppError(400, 'Refresh token requerido'));
    const result = await refreshToken(rt);
    return res.json(result);
  } catch (error) { return next(error); }
});

/* ── GET /auth/unlock-account?token=xxx ──────────────────────────────────── */
router.get('/unlock-account', async (req, res, next) => {
  try {
    await unlockAccount(String(req.query.token || ''));
    const frontUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    return res.redirect(`${frontUrl}/login?unlocked=1`);
  } catch (error) { return next(error); }
});

/* ── POST /auth/verify-2fa ───────────────────────────────────────────────── */
router.post('/verify-2fa', authRateLimit, async (req, res, next) => {
  try {
    const { userId, code } = req.body || {};
    if (!userId || !code) return next(new AppError(400, 'userId y código son requeridos'));
    const result = await verifyTwoFaCode(userId, String(code).trim());
    return res.json(result);
  } catch (error) { return next(error); }
});

/* ── PATCH /auth/2fa ─────────────────────────────────────────────────────── */
router.patch('/2fa', authenticate, async (req, res, next) => {
  try {
    const { enable } = req.body || {};
    if (typeof enable !== 'boolean') return next(new AppError(400, '"enable" debe ser true o false'));
    const result = await toggleTwoFa(req.user.userId, enable);
    return res.json(result);
  } catch (error) { return next(error); }
});

/* ── PATCH /auth/profile ─────────────────────────────────────────────────── */
router.patch('/profile', authenticate, validate(profileSchema), async (req, res, next) => {
  try {
    const { address, displayName, lat, lng, homeLat, homeLng, postalCode, colonia, estado, ciudad } = req.validatedBody || {};
    const profile = await updateProfileAddress(req.user.userId, req.user.role, address, displayName, lat, lng, homeLat, homeLng, postalCode, colonia, estado, ciudad);
    return res.json({ profile });
  } catch (error) { return next(error); }
});

/* ── PATCH /auth/login-username ──────────────────────────────────────────── */
router.patch('/login-username', authenticate, async (req, res, next) => {
  try {
    const { currentPassword, newUsername } = req.body || {};
    if (!newUsername?.trim()) return next(new AppError(400, 'El nuevo usuario de acceso no puede estar vacío'));
    if (!currentPassword)     return next(new AppError(400, 'La contraseña actual es requerida'));
    const result = await updateLoginUsername(req.user.userId, req.user.role, currentPassword, newUsername.trim());
    return res.json({ ok: true, username: result.username });
  } catch (error) { return next(error); }
});

/* ── PATCH /auth/password ────────────────────────────────────────────────── */
router.patch('/password', authenticate, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || newPassword.length < 6)
      return next(new AppError(400, 'La nueva contraseña debe tener al menos 6 caracteres'));
    await changePassword(req.user.userId, currentPassword, newPassword);
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

/* ── DELETE /auth/account ────────────────────────────────────────────────── */
router.delete('/account', authenticate, async (req, res, next) => {
  try {
    const { password } = req.body || {};
    await deleteAccount(req.user.userId, req.user.role, password || null);
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

export default router;
