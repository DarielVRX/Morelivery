// backend/modules/restaurants/routes.js
import { Router } from 'express';
import { query } from '../../config/db.js';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { createMenuItemSchema, updateMenuItemSchema } from './schemas.js';
import { AppError } from '../../utils/errors.js';

const router = Router();

function isMissingColumn(e) { return e?.code === '42703'; }
function isMissingRelation(e) { return e?.code === '42P01'; }

async function getRestaurantIdByOwner(userId) {
  const r = await query('SELECT id FROM restaurants WHERE owner_user_id = $1 LIMIT 1', [userId]);
  return r.rows[0]?.id || null;
}

/**
 * Determina si el restaurante está abierto AHORA:
 *   1. manual_open_override !== NULL  →  usar ese valor directamente
 *   2. Buscar el horario del día actual en restaurant_schedules
 *   3. Fallback: valor de is_open guardado en la tabla
 */
async function computeIsOpen(restaurantId) {
  try {
    const r = await query('SELECT is_open, manual_open_override FROM restaurants WHERE id = $1', [restaurantId]);
    if (r.rowCount === 0) return false;
    const { is_open, manual_open_override } = r.rows[0];
    if (manual_open_override !== null && manual_open_override !== undefined) return Boolean(manual_open_override);

    const now  = new Date();
    const dow  = now.getDay();
    const hhmm = now.toTimeString().slice(0, 5); // "HH:MM"

    try {
      const s = await query(
        'SELECT opens_at, closes_at, is_closed FROM restaurant_schedules WHERE restaurant_id=$1 AND day_of_week=$2',
        [restaurantId, dow]
      );
      if (s.rowCount === 0) return Boolean(is_open);
      const { opens_at, closes_at, is_closed } = s.rows[0];
      if (is_closed || !opens_at || !closes_at) return false;
      return hhmm >= opens_at.slice(0,5) && hhmm < closes_at.slice(0,5);
    } catch (e) {
      if (isMissingRelation(e)) return Boolean(is_open);
      throw e;
    }
  } catch (_) { return false; }
}

/* ── GET / — lista pública con is_open calculado en tiempo real ── */
router.get('/', async (_req, res, next) => {
  try {
    const result = await query('SELECT id, name, category, is_open, address FROM restaurants WHERE is_active = true ORDER BY name');
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
      'SELECT id, name, category, is_open, address, manual_open_override FROM restaurants WHERE owner_user_id=$1 LIMIT 1',
      [req.user.userId]
    );
    if (result.rowCount === 0) return res.json({ restaurant: null });
    const rest = { ...result.rows[0], is_open: await computeIsOpen(result.rows[0].id) };
    return res.json({ restaurant: rest });
  } catch (error) { return next(error); }
});

/* ── GET /my/menu ── */
router.get('/my/menu', authenticate, authorize(['restaurant']), async (req, res, next) => {
  try {
    const restaurantId = await getRestaurantIdByOwner(req.user.userId);
    if (!restaurantId) return next(new AppError(404, 'Restaurant not found'));
    const result = await query(
      'SELECT id, name, description, price_cents, is_available FROM menu_items WHERE restaurant_id=$1 ORDER BY name',
      [restaurantId]
    );
    return res.json({ menu: result.rows });
  } catch (error) { return next(error); }
});

/* ── GET /my/schedule — horario guardado de los 7 días ── */
router.get('/my/schedule', authenticate, authorize(['restaurant']), async (req, res, next) => {
  try {
    const restaurantId = await getRestaurantIdByOwner(req.user.userId);
    if (!restaurantId) return next(new AppError(404, 'Restaurant not found'));

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
      day_of_week: i, opens_at: '09:00:00', closes_at: '22:00:00', is_closed: false
    });

    const restInfo = await query('SELECT manual_open_override FROM restaurants WHERE id=$1', [restaurantId]);
    return res.json({ schedule, manual_open_override: restInfo.rows[0]?.manual_open_override ?? null });
  } catch (error) { return next(error); }
});

/* ── PUT /my/schedule — guardar horario semanal completo ── */
router.put('/my/schedule', authenticate, authorize(['restaurant']), async (req, res, next) => {
  try {
    const restaurantId = await getRestaurantIdByOwner(req.user.userId);
    if (!restaurantId) return next(new AppError(404, 'Restaurant not found'));

    const { schedule } = req.body;
    if (!Array.isArray(schedule) || schedule.length !== 7) return next(new AppError(400, 'Se requieren los 7 días'));

    for (const day of schedule) {
      await query(
        `INSERT INTO restaurant_schedules(restaurant_id, day_of_week, opens_at, closes_at, is_closed)
         VALUES($1,$2,$3,$4,$5)
         ON CONFLICT(restaurant_id, day_of_week)
         DO UPDATE SET opens_at=$3, closes_at=$4, is_closed=$5`,
        [restaurantId, day.day_of_week,
         day.is_closed ? null : (day.opens_at || '09:00'),
         day.is_closed ? null : (day.closes_at || '22:00'),
         Boolean(day.is_closed)]
      );
    }

    // Recalcular y persistir is_open
    const isOpen = await computeIsOpen(restaurantId);
    await query('UPDATE restaurants SET is_open=$1 WHERE id=$2', [isOpen, restaurantId]);

    return res.json({ ok: true, is_open: isOpen });
  } catch (error) { return next(error); }
});

/* ── PATCH /my/toggle — override manual de apertura/cierre ── */
router.patch('/my/toggle', authenticate, authorize(['restaurant']), async (req, res, next) => {
  try {
    const restaurantId = await getRestaurantIdByOwner(req.user.userId);
    if (!restaurantId) return next(new AppError(404, 'Restaurant not found'));

    // override: true | false | null (null = volver al horario automático)
    const { override } = req.body;
    const value = override === null || override === undefined ? null : Boolean(override);
    await query('UPDATE restaurants SET manual_open_override=$1 WHERE id=$2', [value, restaurantId]);

    const isOpen = await computeIsOpen(restaurantId);
    await query('UPDATE restaurants SET is_open=$1 WHERE id=$2', [isOpen, restaurantId]);

    return res.json({ is_open: isOpen, manual_open_override: value });
  } catch (error) { return next(error); }
});

/* ── GET /:id/menu ── */
router.get('/:id/menu', async (req, res, next) => {
  try {
    const result = await query(
      'SELECT id, name, description, price_cents, is_available FROM menu_items WHERE restaurant_id=$1 ORDER BY name',
      [req.params.id]
    );
    return res.json({ menu: result.rows });
  } catch (error) {
    if (isMissingRelation(error)) return res.json({ menu: [] });
    return next(error);
  }
});

/* ── POST /menu-items ── */
router.post('/menu-items', authenticate, authorize(['restaurant']), validate(createMenuItemSchema), async (req, res, next) => {
  try {
    const restaurantId = await getRestaurantIdByOwner(req.user.userId);
    if (!restaurantId) return next(new AppError(404, 'Restaurant not found'));
    const { name, description, priceCents } = req.validatedBody;
    const result = await query(
      'INSERT INTO menu_items(restaurant_id, name, description, price_cents, is_available) VALUES($1,$2,$3,$4,true) RETURNING *',
      [restaurantId, name, description, priceCents]
    );
    return res.status(201).json({ menuItem: result.rows[0] });
  } catch (error) { return next(error); }
});

/* ── PATCH /menu-items/:id ── */
router.patch('/menu-items/:id', authenticate, authorize(['restaurant']), validate(updateMenuItemSchema), async (req, res, next) => {
  try {
    const restaurantId = await getRestaurantIdByOwner(req.user.userId);
    if (!restaurantId) return next(new AppError(404, 'Restaurant not found'));
    const item = await query('SELECT * FROM menu_items WHERE id=$1 AND restaurant_id=$2', [req.params.id, restaurantId]);
    if (item.rowCount === 0) return next(new AppError(404, 'Menu item not found'));
    const c = item.rows[0];
    const p = req.validatedBody;
    const result = await query(
      'UPDATE menu_items SET name=$1, description=$2, price_cents=$3, is_available=$4 WHERE id=$5 RETURNING *',
      [p.name ?? c.name, p.description ?? c.description ?? '', p.priceCents ?? c.price_cents, p.isAvailable ?? c.is_available, req.params.id]
    );
    return res.json({ menuItem: result.rows[0] });
  } catch (error) { return next(error); }
});

export default router;
