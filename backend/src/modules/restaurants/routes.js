// backend/src/modules/restaurants/routes.js
// FIX aplicado:
//   - sseHub importado estáticamente al inicio (era await import(...) dentro del handler)
//   - NOTA CRÍTICA: ejecutar migration_confirmation_flow.sql ANTES de deployar este archivo
//     o el UPDATE fallará con "column restaurant_confirmed does not exist"

import { Router } from 'express';
import { query } from '../../config/db.js';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { resetPrepEstimateOnOpen, recordManualCorrection } from '../../engine/kitchen.js';
import { createMenuItemSchema, updateMenuItemSchema } from './schemas.js';
import { AppError } from '../../utils/errors.js';
// FIX: import estático — ya no se usa await import(...) dentro de handlers
import { sseHub } from '../events/hub.js';

const router = Router();

function isMissingColumn(e)   { return e?.code === '42703'; }
function isMissingRelation(e) { return e?.code === '42P01'; }

async function getRestaurantIdByOwner(userId) {
  const r = await query('SELECT id FROM restaurants WHERE owner_user_id = $1 LIMIT 1', [userId]);
  return r.rows[0]?.id || null;
}

/**
 * computeIsOpen — apertura manual estricta (paso 8)
 * Con el horario 100% manual, manual_open_override siempre tiene un valor
 * (true o false). Se mantiene el fallback al horario automático por
 * retrocompatibilidad, pero ya no se usará en producción.
 */
async function computeIsOpen(restaurantId) {
  try {
    const r = await query('SELECT is_open, manual_open_override FROM restaurants WHERE id = $1', [restaurantId]);
    if (r.rowCount === 0) return false;
    const { is_open, manual_open_override } = r.rows[0];
    if (manual_open_override !== null && manual_open_override !== undefined) return Boolean(manual_open_override);

    // Fallback: horario automático (retrocompat)
    const tz    = 'America/Mexico_City';
    const nowMx = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
    const dow   = nowMx.getDay();
    const hh    = String(nowMx.getHours()).padStart(2, '0');
    const mm    = String(nowMx.getMinutes()).padStart(2, '0');
    const hhmm  = `${hh}:${mm}`;

    try {
      const s = await query(
        'SELECT opens_at, closes_at, is_closed FROM restaurant_schedules WHERE restaurant_id=$1 AND day_of_week=$2',
        [restaurantId, dow]
      );
      if (s.rowCount === 0) return Boolean(is_open);
      const { opens_at, closes_at, is_closed } = s.rows[0];
      if (is_closed || !opens_at || !closes_at) return false;
      return hhmm >= opens_at.slice(0, 5) && hhmm < closes_at.slice(0, 5);
    } catch (e) {
      if (isMissingRelation(e)) return Boolean(is_open);
      throw e;
    }
  } catch (_) { return false; }
}

/* ── GET / — lista pública ── */
router.get('/', async (_req, res, next) => {
  try {
    const result = await query(
      `SELECT r.id, r.name, r.category, r.is_open,
              COALESCE(u.address, r.address) AS address,
              r.profile_photo, COALESCE(u.home_lat, r.lat) AS lat, COALESCE(u.home_lng, r.lng) AS lng,
              r.rating_avg, r.rating_count
       FROM restaurants r
       LEFT JOIN users u ON u.id = r.owner_user_id
       WHERE r.is_active = true
       ORDER BY r.name`
    ).catch(() =>
      query(
        `SELECT r.id, r.name, r.category, r.is_open,
                COALESCE(u.address, r.address) AS address,
                r.profile_photo, COALESCE(u.home_lat, r.lat) AS lat, COALESCE(u.home_lng, r.lng) AS lng
         FROM restaurants r
         LEFT JOIN users u ON u.id = r.owner_user_id
         WHERE r.is_active = true
         ORDER BY r.name`
      )
    );
    const restaurants = await Promise.all(result.rows.map(async r => ({ ...r, is_open: await computeIsOpen(r.id) })));
    return res.json({ restaurants });
  } catch (error) {
    if (isMissingRelation(error)) return res.json({ restaurants: [] });
    return next(error);
  }
});

/* ── GET /my ── */
router.get('/my', authenticate, authorize(['restaurant']), async (req, res, next) => {
  try {
    const result = await query(
      `SELECT r.id, r.name, r.category, r.is_open,
              COALESCE(u.address, r.address) AS address,
              r.manual_open_override, r.profile_photo,
              COALESCE(u.home_lat, r.lat) AS lat, COALESCE(u.home_lng, r.lng) AS lng,
              r.max_cash_cents, r.allow_frequent_customers, r.prep_time_estimate_s
       FROM restaurants r
       LEFT JOIN users u ON u.id = r.owner_user_id
       WHERE r.owner_user_id=$1 LIMIT 1`,
      [req.user.userId]
    );
    if (result.rowCount === 0) return res.json({ restaurant: null });
    const rest = { ...result.rows[0], is_open: await computeIsOpen(result.rows[0].id) };
    return res.json({ restaurant: rest });
  } catch (error) {
    if (isMissingColumn(error)) {
      try {
        const result = await query(
          `SELECT r.id, r.name, r.category, r.is_open,
                  COALESCE(u.address, r.address) AS address,
                  r.manual_open_override, r.profile_photo,
                  COALESCE(u.home_lat, r.lat) AS lat, COALESCE(u.home_lng, r.lng) AS lng
           FROM restaurants r
           LEFT JOIN users u ON u.id = r.owner_user_id
           WHERE r.owner_user_id=$1 LIMIT 1`,
          [req.user.userId]
        );
        if (result.rowCount === 0) return res.json({ restaurant: null });
        const rest = { ...result.rows[0], is_open: await computeIsOpen(result.rows[0].id) };
        return res.json({ restaurant: rest });
      } catch (e2) { return next(e2); }
    }
    return next(error);
  }
});

/* ── GET /my/menu ── */
router.get('/my/menu', authenticate, authorize(['restaurant']), async (req, res, next) => {
  try {
    const restaurantId = await getRestaurantIdByOwner(req.user.userId);
    if (!restaurantId) return next(new AppError(404, 'Restaurante no encontrado'));
    const result = await query(
      'SELECT id, name, description, price_cents, is_available, image_url FROM menu_items WHERE restaurant_id=$1 ORDER BY name',
      [restaurantId]
    );
    return res.json({ menu: result.rows });
  } catch (error) { return next(error); }
});

/* ── GET /my/schedule ── */
router.get('/my/schedule', authenticate, authorize(['restaurant']), async (req, res, next) => {
  try {
    const restaurantId = await getRestaurantIdByOwner(req.user.userId);
    if (!restaurantId) return next(new AppError(404, 'Restaurante no encontrado'));

    let rows = [];
    try {
      const result = await query(
        'SELECT day_of_week, opens_at, closes_at, is_closed FROM restaurant_schedules WHERE restaurant_id=$1 ORDER BY day_of_week',
        [restaurantId]
      );
      rows = result.rows;
    } catch (e) { if (!isMissingRelation(e)) throw e; }

    const scheduleMap = new Map(rows.map(r => [r.day_of_week, r]));
    const schedule = Array.from({ length: 7 }, (_, i) => scheduleMap.get(i) || {
      day_of_week: i, opens_at: '09:00:00', closes_at: '22:00:00', is_closed: false,
    });

    const restInfo = await query('SELECT manual_open_override FROM restaurants WHERE id=$1', [restaurantId]);
    return res.json({ schedule, manual_open_override: restInfo.rows[0]?.manual_open_override ?? null });
  } catch (error) { return next(error); }
});

/* ── PUT /my/schedule ── */
router.put('/my/schedule', authenticate, authorize(['restaurant']), async (req, res, next) => {
  try {
    const restaurantId = await getRestaurantIdByOwner(req.user.userId);
    if (!restaurantId) return next(new AppError(404, 'Restaurante no encontrado'));

    const { schedule } = req.body;
    if (!Array.isArray(schedule) || schedule.length !== 7) return next(new AppError(400, 'Se requieren los 7 días'));

    for (const day of schedule) {
      await query(
        `INSERT INTO restaurant_schedules(restaurant_id, day_of_week, opens_at, closes_at, is_closed)
         VALUES($1,$2,$3,$4,$5)
         ON CONFLICT(restaurant_id, day_of_week)
         DO UPDATE SET opens_at=$3, closes_at=$4, is_closed=$5`,
        [restaurantId, day.day_of_week,
         day.is_closed ? null : (day.opens_at  || '09:00'),
         day.is_closed ? null : (day.closes_at || '22:00'),
         Boolean(day.is_closed)]
      );
    }

    const isOpen = await computeIsOpen(restaurantId);
    return res.json({ ok: true, is_open: isOpen });
  } catch (error) { return next(error); }
});

/* ── PATCH /my/toggle — override manual estricto (paso 8) ── */
router.patch('/my/toggle', authenticate, authorize(['restaurant']), async (req, res, next) => {
  try {
    const restaurantId = await getRestaurantIdByOwner(req.user.userId);
    if (!restaurantId) return next(new AppError(404, 'Restaurante no encontrado'));

    const { override } = req.body;

    if (override !== true && override !== false) {
      return next(new AppError(400, 'override debe ser true (abrir) o false (cerrar)'));
    }

    await query('UPDATE restaurants SET manual_open_override=$1 WHERE id=$2', [override, restaurantId]);

    const isOpen = await computeIsOpen(restaurantId);
    await query('UPDATE restaurants SET is_open=$1 WHERE id=$2', [isOpen, restaurantId]);

    if (isOpen) {
      resetPrepEstimateOnOpen(restaurantId).catch(() => {});
    }

    // FIX: notificar via SSE usando la referencia estática (sin dynamic import)
    sseHub.sendToRole('admin', 'restaurant_toggle', {
      restaurantId,
      isOpen,
      override,
      ownerId: req.user.userId,
    });

    return res.json({ is_open: isOpen, manual_open_override: override });
  } catch (error) { return next(error); }
});

// ── PATCH /orders/:orderId/confirm — confirmación del restaurante ─────────────
// NOTA CRÍTICA: este endpoint requiere que la columna restaurant_confirmed exista.
// Ejecutar migration_confirmation_flow.sql ANTES de deployar.
router.patch('/orders/:orderId/confirm', authenticate, authorize(['restaurant']), async (req, res, next) => {
  try {
    const restaurantId = await getRestaurantIdByOwner(req.user.userId);
    if (!restaurantId) return next(new AppError(404, 'Restaurante no encontrado'));

    const result = await query(
      `UPDATE orders
       SET restaurant_confirmed = true,
           restaurant_confirmed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
         AND restaurant_id = $2
         AND status NOT IN ('delivered', 'cancelled')
       RETURNING id, driver_id, customer_id, status`,
      [req.params.orderId, restaurantId]
    );

    if (result.rowCount === 0)
      return next(new AppError(404, 'Pedido no encontrado o no pertenece a este restaurante'));

    const ord = result.rows[0];

    // FIX: sseHub ya importado estáticamente — sin await import(...)
    const payload = { orderId: ord.id, restaurantConfirmed: true };
    if (ord.driver_id) sseHub.sendToUser(ord.driver_id, 'order_update', payload);
    sseHub.sendToUser(ord.customer_id, 'order_update', payload);
    sseHub.sendToRole('admin', 'order_update', { ...payload, restaurantId });

    return res.json({ ok: true });
  } catch (error) {
    // FIX: detectar columna faltante y dar error claro en lugar de 500 genérico
    if (isMissingColumn(error)) {
      return next(new AppError(503,
        'La migración de confirmación aún no se ha ejecutado. ' +
        'Ejecuta migration_confirmation_flow.sql antes de usar este endpoint.'
      ));
    }
    return next(error);
  }
});

export default router;
