// backend/src/modules/admin/route-groups/emergency.js
//
// Rutas de emergencia del panel admin — acciones directas sobre entidades:
//   POST /admin/drivers/:id/reset-cooldowns
//   POST /admin/drivers/:id/force-available
//   POST /admin/drivers/:id/force-unavailable
//   POST /admin/restaurants/:userId/silent-close
//   POST /admin/restaurants/:userId/silent-open
//   POST /admin/users/:id/create-restaurant

import { Router } from 'express';
import { query } from '../../../config/db.js';
import { authenticate, authorize } from '../../../middlewares/auth.js';
import { AppError } from '../../../utils/errors.js';
import { sseHub } from '../../events/hub.js';

const router = Router();

/* ── POST /admin/drivers/:id/reset-cooldowns ── */
router.post('/drivers/:id/reset-cooldowns', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const driverId = req.params.id;

    const result = await query(
      `UPDATE order_driver_offers
      SET wait_until = NOW() - INTERVAL '1 second', updated_at = NOW()
      WHERE driver_id = $1
        AND status IN ('rejected', 'released', 'expired')
        AND wait_until > NOW()
        AND order_id IN (
          SELECT id FROM orders WHERE status NOT IN ('delivered', 'cancelled')
        )
      RETURNING order_id`, [driverId]
    );

    const orderIds = [...new Set(result.rows.map(r => r.order_id))];
    sseHub.sendToUser(driverId, 'cooldowns_cleared', { message: 'Tus restricciones han sido eliminadas por el administrador.' });
    console.log(`[admin.emergency] reset-cooldowns driver=${driverId.slice(0,8)} affected=${orderIds.length} orders`);
    return res.json({ ok: true, clearedOrders: orderIds.length });
  } catch (error) { return next(error); }
});

/* ── POST /admin/drivers/:id/force-available ── */
router.post('/drivers/:id/force-available', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const driverId = req.params.id;

    const result = await query(
      `UPDATE driver_profiles
      SET is_available = true,
          session_rebalances = 0,
          session_releases   = 0,
          session_cancels    = 0,
          session_expires    = 0,
          session_started_at = NOW()
      WHERE user_id = $1
      RETURNING user_id`, [driverId]
    );
    if (result.rowCount === 0) return next(new AppError(404, 'Driver no encontrado'));

    await query(
      `UPDATE orders
      SET reconnect_deadline = NULL, updated_at = NOW()
      WHERE driver_id = $1 AND status = 'on_the_way' AND reconnect_deadline IS NOT NULL`,
      [driverId]
    ).catch(() => {});

    try {
      const { getQueuedOrders, serializedOffer } = await import('../../orders/assignment/index.js');
      const { offerNextDrivers } = await import('../../orders/assignment/core.js');
      const { offerCb } = await import('../../events/offerCallback.js');
      const openOrders = await getQueuedOrders();
      for (const ord of openOrders) {
        serializedOffer(ord.id, offerNextDrivers, offerCb);
      }
      console.log(`[admin.emergency] force-available driver=${driverId.slice(0,8)} requeued=${openOrders.length}`);
    } catch (e) {
      console.warn('[admin.emergency] force-available: error re-encolando:', e.message);
    }

    sseHub.sendToUser(driverId, 'forced_available', { message: 'El administrador te ha puesto en modo disponible.' });
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

/* ── POST /admin/drivers/:id/force-unavailable ── */
router.post('/drivers/:id/force-unavailable', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const driverId = req.params.id;

    const result = await query(
      `UPDATE driver_profiles SET is_available=false, updated_at=NOW()
       WHERE user_id=$1 RETURNING user_id`, [driverId]
    );

    if (result.rowCount === 0) {
      try {
        await query(
          `INSERT INTO driver_profiles (user_id, is_available, vehicle_type, created_at, updated_at)
           VALUES ($1, false, 'motorcycle', NOW(), NOW())
           ON CONFLICT (user_id) DO UPDATE SET is_available=false, updated_at=NOW()`,
          [driverId]
        );
      } catch (insertErr) {
        console.warn(`[admin.emergency] force-unavailable: no se pudo crear perfil driver=${driverId.slice(0,8)}:`, insertErr.message);
        return res.json({ ok: true, skipped: true });
      }
    }

    sseHub.sendToUser(driverId, 'forced_unavailable', {
      message: 'Tu cuenta está pendiente de activación por el administrador.',
    });
    console.log(`[admin.emergency] force-unavailable driver=${driverId.slice(0,8)}`);
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

/* ── POST /admin/restaurants/:userId/silent-close ── */
router.post('/restaurants/:userId/silent-close', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const result = await query(
      `UPDATE restaurants SET is_open = false, updated_at = NOW()
       WHERE owner_user_id = $1 RETURNING id, name`, [req.params.userId]
    );
    if (result.rowCount === 0) return next(new AppError(404, 'Restaurante no encontrado'));
    console.log(`[admin.emergency] silent-close restaurant=${result.rows[0].name} by admin`);
    return res.json({ ok: true, restaurant: result.rows[0] });
  } catch (error) { return next(error); }
});

/* ── POST /admin/restaurants/:userId/silent-open ── */
router.post('/restaurants/:userId/silent-open', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const result = await query(
      `UPDATE restaurants SET is_open = true, updated_at = NOW()
       WHERE owner_user_id = $1 RETURNING id, name`, [req.params.userId]
    );
    if (result.rowCount === 0) return next(new AppError(404, 'Restaurante no encontrado'));
    console.log(`[admin.emergency] silent-open restaurant=${result.rows[0].name} by admin`);
    return res.json({ ok: true, restaurant: result.rows[0] });
  } catch (error) { return next(error); }
});

/* ── POST /admin/users/:id/create-restaurant ── */
router.post('/users/:id/create-restaurant', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const { name, address, lat, lng, is_open = false } = req.body || {};
    if (!name) return next(new AppError(400, 'El campo name es requerido'));

    const userCheck = await query('SELECT id, role FROM users WHERE id = $1', [req.params.id]);
    if (userCheck.rowCount === 0) return next(new AppError(404, 'Usuario no encontrado'));

    const existingRest = await query(
      'SELECT id FROM restaurants WHERE owner_user_id = $1 LIMIT 1', [req.params.id]
    );
    if (existingRest.rowCount > 0) {
      const updated = await query(
        `UPDATE restaurants
         SET name=$1, address=COALESCE($2, address),
             lat=COALESCE($3, lat), lng=COALESCE($4, lng), updated_at=NOW()
         WHERE owner_user_id=$5
         RETURNING id, name`,
        [name, address || null, lat ? Number(lat) : null, lng ? Number(lng) : null, req.params.id]
      );
      console.log(`[admin.emergency] update-restaurant user=${req.params.id.slice(0,8)} restaurant=${updated.rows[0].id.slice(0,8)}`);
      return res.json({ ok: true, restaurant: updated.rows[0], updated: true });
    }

    const result = await query(
      `INSERT INTO restaurants (owner_user_id, name, address, lat, lng, is_open, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, true, NOW(), NOW())
       RETURNING id, name`,
      [req.params.id, name, address || '', lat ? Number(lat) : null, lng ? Number(lng) : null, Boolean(is_open)]
    );

    await query(
      `UPDATE users SET role='restaurant', updated_at=NOW() WHERE id=$1 AND role != 'restaurant'`,
      [req.params.id]
    ).catch(() => {});

    console.log(`[admin.emergency] create-restaurant user=${req.params.id.slice(0,8)} restaurant=${result.rows[0].id.slice(0,8)}`);
    return res.status(201).json({ ok: true, restaurant: result.rows[0] });
  } catch (error) { return next(error); }
});

export default router;
