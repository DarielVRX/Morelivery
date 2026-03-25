import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.js';
import { query } from '../../config/db.js';

const router = Router();

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
        next(error);
    }
});

export default router;
