import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.js';
import { query } from '../../config/db.js';

const router = Router();

// POST /api/push/subscribe
router.post('/subscribe', authenticate, async (req, res, next) => {
    try {
        const { endpoint, keys } = req.body;
        const userId = req.user.userId;

        await query(
            `INSERT INTO push_subscriptions (user_id, endpoint, keys)
            VALUES ($1, $2, $3)
            ON CONFLICT (endpoint) DO UPDATE
            SET keys = EXCLUDED.keys, updated_at = NOW()`,
                    [userId, endpoint, keys]
        );

        res.json({ ok: true });
    } catch (error) {
        console.error('Error en push/subscribe:', error);
        next(error);
    }
});

export default router;
