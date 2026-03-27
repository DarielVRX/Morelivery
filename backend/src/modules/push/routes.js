import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.js';
import { query } from '../../config/db.js';
import { AppError } from '../../utils/errors.js';
import { savePushSubscription } from '../notifications/pushSubscription.js';

const router = Router();

// POST /api/push/subscribe
router.post('/subscribe', authenticate, async (req, res, next) => {
    try {
        const sub = req.body || {};
        if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
            return next(new AppError(400, 'Suscripción push inválida — faltan campos requeridos'));
        }
        await savePushSubscription(req.user.userId, sub);
        res.json({ ok: true });
    } catch (error) {
        console.error('Error en push/subscribe:', error);
        next(error);
    }
});

// DELETE /api/push/subscribe
router.delete('/subscribe', authenticate, async (req, res, next) => {
    try {
        const { endpoint } = req.body || {};
        if (!endpoint) return next(new AppError(400, 'endpoint requerido'));
        await query(
            'DELETE FROM push_subscriptions WHERE endpoint=$1 AND user_id=$2',
            [endpoint, req.user.userId]
        );
        return res.json({ ok: true });
    } catch (error) {
        return next(error);
    }
});

export default router;
