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
  googleLogin, forgotPassword, resetPassword, verifyEmail,
} from './service.js';
import { AppError } from '../../utils/errors.js';
import { authRateLimit } from '../../middlewares/rateLimit.js';

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
    // Dirección obligatoria para restaurant
    if (req.body.role === 'restaurant' && !req.body.postalCode && !req.body.calle && !req.body.address)
      return next(new AppError(400, 'La dirección de la tienda es requerida'));
    const user = await registerUser(req.body);
    return res.status(201).json({ user });
  } catch (error) { return next(error); }
});

// Reemplaza el handler de /auth/google
router.post('/google', authRateLimit, validate(googleAuthSchema), async (req, res, next) => {
  try {
    const role = ['customer', 'restaurant', 'driver'].includes(req.body.role) ? req.body.role : 'customer';
    const result = await googleLogin(req.body.credential, role);
    return res.json(result);
  } catch (error) { return next(error); }
});

/* ── POST /auth/google ───────────────────────────────────────────────────── */
router.post('/google', authRateLimit, validate(googleAuthSchema), async (req, res, next) => {
  try {
    const result = await googleLogin(req.body.credential);
    return res.json(result);
  } catch (error) { return next(error); }
});

/* ── POST /auth/forgot-password ──────────────────────────────────────────── */
// Siempre responde 200 — no revela si el email existe (anti-enumeración)
router.post('/forgot-password', authRateLimit, validate(forgotPasswordSchema), async (req, res, next) => {
  try {
    await forgotPassword(req.body.email); // fire-and-forget del email
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
// Ya funciona. Por ahora el correo no se envía (ver TODO en registerUser).
// Cuando actives EMAIL_VERIFICATION_ENABLED=true en Render, este endpoint
// ya estará listo para recibir los clics del enlace.
router.get('/verify-email', async (req, res, next) => {
  try {
    await verifyEmail(String(req.query.token || ''));
    // Redirige al frontend con mensaje de éxito
    const frontUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    return res.redirect(`${frontUrl}/login?verified=1`);
  } catch (error) { return next(error); }
});

/* ── GET /auth/postal/:cp ────────────────────────────────────────────────── */
// Sin authenticate — se llama desde el registro (sin token aún)
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
    await deleteAccount(req.user.userId, req.user.role);
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

export default router;
