// backend/src/modules/restaurants/routes.js
import { Router } from 'express';
import { query } from '../../config/db.js';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { resetPrepEstimateOnOpen, recordManualCorrection } from '../../engine/kitchen.js';
import { createMenuItemSchema, updateMenuItemSchema } from './schemas.js';
import { AppError } from '../../utils/errors.js';

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

    // Fallback: horario automático (retrocompat — no se usará una vez que
    // todos los restaurantes hayan tocado el toggle al menos una vez)
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

    // Paso 8: NO recalcular ni persistir is_open automáticamente.
    // El horario ahora solo sirve para recordatorios push.
    // La apertura/cierre sigue siendo manual_open_override.
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

    // Paso 8: ya NO se acepta override=null (automático eliminado).
    // Solo true (abrir) o false (cerrar).
    if (override !== true && override !== false) {
      return next(new AppError(400, 'override debe ser true (abrir) o false (cerrar)'));
    }

    await query('UPDATE restaurants SET manual_open_override=$1 WHERE id=$2', [override, restaurantId]);

    const isOpen = await computeIsOpen(restaurantId);
    await query('UPDATE restaurants SET is_open=$1 WHERE id=$2', [isOpen, restaurantId]);

    if (isOpen) {
      resetPrepEstimateOnOpen(restaurantId).catch(() => {});
    }

    return res.json({ is_open: isOpen, manual_open_override: override });
  } catch (error) { return next(error); }
});

/* ── GET /:id ── */
router.get('/:id', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT r.id, r.name, r.category, r.is_open,
              COALESCE(u.address, r.address) AS address,
              r.profile_photo,
              COALESCE(u.home_lat, r.lat) AS lat,
              COALESCE(u.home_lng, r.lng) AS lng,
              r.rating_avg, r.rating_count
       FROM restaurants r
       LEFT JOIN users u ON u.id = r.owner_user_id
       WHERE r.id = $1 AND r.is_active = true`,
      [req.params.id]
    );
    if (result.rowCount === 0) return next(new AppError(404, 'Restaurante no encontrado'));
    const restaurant = { ...result.rows[0], is_open: await computeIsOpen(result.rows[0].id) };
    return res.json({ restaurant });
  } catch (error) { return next(error); }
});

/* ── GET /:id/menu ── */
router.get('/:id/menu', async (req, res, next) => {
  try {
    const result = await query(
      'SELECT id, name, description, price_cents, is_available, image_url FROM menu_items WHERE restaurant_id=$1 ORDER BY name',
      [req.params.id]
    );
    return res.json({ menu: result.rows });
  } catch (error) {
    if (isMissingRelation(error)) return res.json({ menu: [] });
    return next(error);
  }
});

/* ── PATCH /my/profile-photo ── */
router.patch('/my/profile-photo', authenticate, authorize(['restaurant']), async (req, res, next) => {
  try {
    const { photoUrl } = req.body || {};
    const val = (photoUrl === null || photoUrl === '') ? null : (typeof photoUrl === 'string' ? photoUrl : null);
    try {
      await query('UPDATE restaurants SET profile_photo=$1 WHERE owner_user_id=$2', [val, req.user.userId]);
    } catch (e) {
      if (e?.code === '42703') return next(new AppError(500, 'Ejecuta migration_v11.sql primero'));
      throw e;
    }
    return res.json({ ok: true, photoUrl: val });
  } catch (error) { return next(error); }
});

/* ── PATCH /my/cover-photo ── */
router.patch('/my/cover-photo', authenticate, authorize(['restaurant']), async (req, res, next) => {
  try {
    const { photoUrl } = req.body || {};
    const val = (photoUrl === null || photoUrl === '') ? null : (typeof photoUrl === 'string' ? photoUrl : null);
    try {
      await query('UPDATE restaurants SET cover_photo=$1 WHERE owner_user_id=$2', [val, req.user.userId]);
    } catch (e) {
      if (e?.code === '42703') return next(new AppError(500, 'Ejecuta migration_cover_photo.sql primero'));
      throw e;
    }
    return res.json({ ok: true, coverPhoto: val });
  } catch (error) { return next(error); }
});

/* ── POST /menu-items ── */
router.post('/menu-items', authenticate, authorize(['restaurant']), validate(createMenuItemSchema), async (req, res, next) => {
  try {
    const restaurantId = await getRestaurantIdByOwner(req.user.userId);
    if (!restaurantId) return next(new AppError(404, 'Restaurante no encontrado'));
    const { name, description, priceCents, pkgUnits, pkgVolumeLiters } = req.validatedBody;
    if (!Number.isInteger(priceCents) || priceCents < 100 || priceCents > 1_000_000)
      return next(new AppError(400, 'El precio debe estar entre $1.00 y $10,000.00'));
    const safeUnits  = pkgUnits        != null ? Math.max(1, Math.round(Number(pkgUnits)))  : 1;
    const safeVolume = pkgVolumeLiters != null ? Math.max(0, Number(pkgVolumeLiters))        : 0;
    const result = await query(
      `INSERT INTO menu_items(restaurant_id, name, description, price_cents, is_available, pkg_units, pkg_volume_liters)
       VALUES($1,$2,$3,$4,true,$5,$6) RETURNING *`,
      [restaurantId, name, description, priceCents, safeUnits, safeVolume]
    );
    return res.status(201).json({ menuItem: result.rows[0] });
  } catch (error) { return next(error); }
});

/* ── PATCH /menu-items/:id ── */
router.patch('/menu-items/:id', authenticate, authorize(['restaurant']), async (req, res, next) => {
  try {
    const restaurantId = await getRestaurantIdByOwner(req.user.userId);
    if (!restaurantId) return next(new AppError(404, 'Restaurante no encontrado'));
    const item = await query('SELECT * FROM menu_items WHERE id=$1 AND restaurant_id=$2', [req.params.id, restaurantId]);
    if (item.rowCount === 0) return next(new AppError(404, 'Producto no encontrado'));
    const cur = item.rows[0];
    const p = req.body || {};
    let imageUrl = cur.image_url;
    if (req.body.imageUrl !== undefined) {
      if (req.body.imageUrl === null || req.body.imageUrl === '') imageUrl = null;
      else if (typeof req.body.imageUrl === 'string') imageUrl = req.body.imageUrl;
    }
    const result = await query(
      `UPDATE menu_items
       SET name=$1, description=$2, price_cents=$3, is_available=$4, image_url=$5,
           pkg_units=$6, pkg_volume_liters=$7
       WHERE id=$8 RETURNING *`,
      [
        p.name        ?? cur.name,
        p.description ?? cur.description ?? '',
        (p.priceCents != null ? Math.round(Number(p.priceCents)) : null) ?? cur.price_cents,
        p.isAvailable ?? cur.is_available,
        imageUrl,
        p.pkgUnits        != null ? Math.max(1, Math.round(Number(p.pkgUnits)))       : (cur.pkg_units         ?? 1),
        p.pkgVolumeLiters != null ? Math.max(0, Number(p.pkgVolumeLiters))             : (cur.pkg_volume_liters ?? 0),
        req.params.id,
      ]
    );
    return res.json({ menuItem: result.rows[0] });
  } catch (error) { return next(error); }
});

/* ── DELETE /menu-items/:id ── */
router.delete('/menu-items/:id', authenticate, authorize(['restaurant']), async (req, res, next) => {
  try {
    const check = await query(
      `SELECT mi.id FROM menu_items mi
       JOIN restaurants r ON r.id = mi.restaurant_id
       WHERE mi.id = $1 AND r.owner_user_id = $2`,
      [req.params.id, req.user.userId]
    );
    if (check.rowCount === 0) return next(new AppError(404, 'Producto no encontrado'));
    try { await query('UPDATE order_items SET menu_item_id = NULL WHERE menu_item_id = $1', [req.params.id]); } catch (_) {}
    await query('DELETE FROM menu_items WHERE id = $1', [req.params.id]);
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

/* ── PATCH /my/prep-estimate ── */
router.patch('/my/prep-estimate', authenticate, authorize(['restaurant']), async (req, res, next) => {
  try {
    const restaurantId = await getRestaurantIdByOwner(req.user.userId);
    if (!restaurantId) return next(new AppError(404, 'Restaurante no encontrado'));
    const val = Number(req.body.prep_time_estimate_s);
    if (!Number.isFinite(val) || val < 30 || val > 7200)
      return next(new AppError(400, 'El estimado debe estar entre 30 segundos y 2 horas'));
    const prev = await query('SELECT prep_time_estimate_s FROM restaurants WHERE id = $1', [restaurantId]);
    const previousS = prev.rows[0]?.prep_time_estimate_s ?? null;
    const r = await query(
      `UPDATE restaurants SET prep_time_estimate_s=$1, prep_estimate_updated_at=NOW()
       WHERE id=$2 RETURNING id, prep_time_estimate_s`,
      [val, restaurantId]
    );
    if (previousS !== null && previousS !== val) {
      recordManualCorrection(restaurantId, previousS, val).catch(() => {});
    }
    return res.json({ restaurant: r.rows[0] });
  } catch (error) { return next(error); }
});

/* ── PATCH /my/frequent-customers ── */
router.patch('/my/frequent-customers', authenticate, authorize(['restaurant']), async (req, res, next) => {
  try {
    const restaurantId = await getRestaurantIdByOwner(req.user.userId);
    if (!restaurantId) return next(new AppError(404, 'Restaurante no encontrado'));
    const value = Boolean(req.body?.allow);
    try {
      await query('UPDATE restaurants SET allow_frequent_customers=$1 WHERE id=$2', [value, restaurantId]);
    } catch (e) {
      if (e?.code === '42703') return next(new AppError(500, 'Ejecuta migration_allow_frequent_customers.sql primero'));
      throw e;
    }
    return res.json({ ok: true, allow_frequent_customers: value });
  } catch (error) { return next(error); }
});

/* ── PATCH /my/cash-limit ── */
router.patch('/my/cash-limit', authenticate, authorize(['restaurant']), async (req, res, next) => {
  try {
    const restaurantId = await getRestaurantIdByOwner(req.user.userId);
    if (!restaurantId) return next(new AppError(404, 'Restaurante no encontrado'));
    const raw = req.body?.max_cash_cents;
    let value;
    if (raw === null || raw === 0 || raw === '0') {
      value = 0;
    } else {
      value = Math.round(Number(raw));
      if (!Number.isFinite(value) || value < 0)
        return next(new AppError(400, 'El límite debe ser un monto positivo o 0 para desactivar'));
    }
    try {
      await query('UPDATE restaurants SET max_cash_cents=$1 WHERE id=$2', [value, restaurantId]);
    } catch (e) {
      if (e?.code === '42703') return next(new AppError(500, 'Ejecuta migration_maxcashcents_and_disputes.sql primero'));
      throw e;
    }
    return res.json({ ok: true, max_cash_cents: value });
  } catch (error) { return next(error); }
});

/* ── POST /orders/:id/confirm — paso 7: restaurante confirma el pedido ── */
router.post('/orders/:id/confirm', authenticate, authorize(['restaurant']), async (req, res, next) => {
  try {
    const restaurantId = await getRestaurantIdByOwner(req.user.userId);
    if (!restaurantId) return next(new AppError(404, 'Restaurante no encontrado'));

    const result = await query(
      `UPDATE orders
       SET restaurant_confirmed    = true,
           restaurant_confirmed_at = NOW(),
           updated_at              = NOW()
       WHERE id = $1
         AND restaurant_id = $2
         AND restaurant_confirmed = false
         AND status NOT IN ('delivered', 'cancelled')
       RETURNING id, driver_id, customer_id, status`,
      [req.params.id, restaurantId]
    );

    // Idempotente: si ya estaba confirmado, responder ok igualmente
    if (result.rowCount === 0) return res.json({ ok: true, already: true });

    const ord = result.rows[0];

    // Notificar al driver: el pedido ya entra en su ruta activa
    if (ord.driver_id) {
      try {
        const { sseHub } = await import('../events/hub.js');
        sseHub.sendToUser(ord.driver_id, 'order_update', {
          orderId:             ord.id,
          restaurantConfirmed: true,
          status:              ord.status,
          message:             'La tienda confirmó el pedido — ya está en tu ruta',
        });
      } catch (_) {}
    }

    console.log(`[restaurant.confirm] order=${ord.id.slice(0, 8)} rest=${restaurantId.slice(0, 8)}`);
    return res.json({ ok: true, orderId: ord.id });
  } catch (error) { return next(error); }
});

export default router;
