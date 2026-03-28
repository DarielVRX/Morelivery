// backend/src/modules/admin/route-groups/engine.js
//
// Rutas del motor de asignación y notificaciones del panel admin:
//   GET   /admin/engine-params
//   PATCH /admin/engine-params/:key
//   POST  /admin/test-push
//   POST  /admin/schedule-voice-reminders

import { Router } from 'express';
import { authenticate, authorize } from '../../../middlewares/auth.js';
import { AppError } from '../../../utils/errors.js';
import { getParamsWithMeta, saveParam } from '../../../engine/params.js';
import { sendPushToUser } from '../../notifications/pushSubscription.js';
import { query } from '../../../config/db.js';

const router = Router();

/* ── GET /admin/engine-params ── */
router.get('/engine-params', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const params = await getParamsWithMeta();
    return res.json({ params });
  } catch (error) { return next(error); }
});

/* ── PATCH /admin/engine-params/:key ── */
router.patch('/engine-params/:key', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const { value } = req.body;
    if (value === undefined || value === null)
      return next(new AppError(400, 'Se requiere el campo value'));
    await saveParam(req.params.key, value, req.user.userId);
    const params = await getParamsWithMeta();
    return res.json({ ok: true, params });
  } catch (error) {
    if (error.message?.startsWith('Parámetro desconocido') ||
        error.message?.startsWith('Valor inválido')) {
      return next(new AppError(400, error.message));
    }
    return next(error);
  }
});

/* ── POST /admin/test-push ── */
router.post('/test-push', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const results = await sendPushToUser(req.user.userId, {
      title: '🔔 Notificación de prueba',
      body: 'Esta es una notificación push de alta prioridad.',
      tag: 'test', group: 'test', priority: 'high',
      url: '/admin', vibrate: [300, 100, 300, 100, 300],
      requireInteraction: true,
    });
    const sent = results.filter(r => r.status === 'fulfilled').length;
    if (sent === 0) return next(new AppError(400, 'No hay suscripciones push activas para este usuario'));
    return res.json({ ok: true, sent });
  } catch (error) {
    console.error('Error enviando push test:', error);
    return next(new AppError(500, 'Error al enviar notificación push'));
  }
});

/* ── POST /admin/schedule-voice-reminders ── */
router.post('/schedule-voice-reminders', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const userId = req.user.userId;

    const check = await query(
      `SELECT 1 FROM push_subscriptions WHERE user_id = $1 LIMIT 1`, [userId]
    );
    if (check.rowCount === 0)
      return res.status(400).json({ error: 'No hay suscripción push registrada para este usuario' });

    setTimeout(async () => {
      try {
        await sendPushToUser(userId, {
          title: '🔔 Recordatorio de prueba (30s)', body: 'Han pasado 30 segundos.',
          priority: 'high', tag: 'test-reminder-30s', url: '/admin',
          vibrate: [500, 150, 500, 150, 500, 300, 100, 100, 150, 100, 150, 100, 100],
        });
        console.log('[admin] Push 30s enviado');
      } catch (e) { console.error('Error en push 30s:', e); }
    }, 30000);

    setTimeout(async () => {
      try {
        await sendPushToUser(userId, {
          title: '⏰ Recordatorio de prueba (5 min)', body: 'Han pasado 5 minutos.',
          priority: 'high', tag: 'test-reminder-5min', url: '/admin',
          vibrate: [500, 150, 500, 150, 500, 300, 100, 100, 150, 100, 150, 100, 100],
          requireInteraction: true,
        });
        console.log('[admin] Push 5min enviado');
      } catch (e) { console.error('Error en push 5min:', e); }
    }, 300000);

    return res.json({ ok: true, message: 'Recordatorios programados' });
  } catch (error) {
    console.error('Error en schedule-voice-reminders:', error);
    return next(error);
  }
});

export default router;
