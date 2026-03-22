// backend/modules/notifications/routes.js
import { Router }        from 'express';
import { authenticate }  from '../../middlewares/auth.js';
import { savePushSubscription } from './pushSubscription.js';
import { AppError }      from '../../utils/errors.js';
import { query }         from '../../config/db.js';

const router = Router();

// ── POST /push/subscribe ──────────────────────────────────────────────────────
// Guarda o actualiza la suscripción push del dispositivo actual.
// El frontend llama esto después de pushManager.subscribe() con la VAPID key.
router.post('/subscribe', authenticate, async (req, res, next) => {
  try {
    const sub = req.body;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      return next(new AppError(400, 'Suscripción push inválida — faltan campos requeridos'));
    }
    await savePushSubscription(req.user.userId, sub);
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

// ── DELETE /push/subscribe ────────────────────────────────────────────────────
// Elimina la suscripción del dispositivo actual (logout o permiso revocado).
router.delete('/subscribe', authenticate, async (req, res, next) => {
  try {
    const { endpoint } = req.body || {};
    if (!endpoint) return next(new AppError(400, 'endpoint requerido'));
    await query(
      'DELETE FROM push_subscriptions WHERE endpoint=$1 AND user_id=$2',
      [endpoint, req.user.userId]
    );
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

export default router;
