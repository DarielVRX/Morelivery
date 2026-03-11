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

    // Usar timezone de México — el servidor puede correr en UTC
    const tz  = 'America/Mexico_City';
    const now = new Date();
    // getDay() equivalente en Mexico_City: restar el offset al momento UTC
    const nowMx   = new Date(now.toLocaleString('en-US', { timeZone: tz }));
    const dow     = nowMx.getDay();   // 0=Dom … 6=Sab
    const hh      = String(nowMx.getHours()).padStart(2, '0');
    const mm      = String(nowMx.getMinutes()).padStart(2, '0');
    const hhmm    = `${hh}:${mm}`;

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
    const result = await query('SELECT id, name, category, is_open, address, profile_photo, lat, lng FROM restaurants WHERE is_active = true ORDER BY name');
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
      'SELECT id, name, category, is_open, address, manual_open_override, profile_photo, lat, lng FROM restaurants WHERE owner_user_id=$1 LIMIT 1',
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
    if (!restaurantId) return next(new AppError(404, 'Restaurante no encontrado'));
    const result = await query(
      'SELECT id, name, description, price_cents, is_available, image_url FROM menu_items WHERE restaurant_id=$1 ORDER BY name',
      [restaurantId]
    );
    return res.json({ menu: result.rows });
  } catch (error) { return next(error); }
});

/* ── GET /my/schedule — horario guardado de los 7 días ── */
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
    if (!restaurantId) return next(new AppError(404, 'Restaurante no encontrado'));

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
      'SELECT id, name, description, price_cents, is_available, image_url FROM menu_items WHERE restaurant_id=$1 ORDER BY name',
      [req.params.id]
    );
    return res.json({ menu: result.rows });
  } catch (error) {
    if (isMissingRelation(error)) return res.json({ menu: [] });
    return next(error);
  }
});

/* ── POST /menu-items ── */

/* ── PATCH /restaurants/my/profile-photo ── */
router.patch('/my/profile-photo', authenticate, authorize(['restaurant']), async (req, res, next) => {
  try {
    // Acepta base64 (data:image/...) o URL o null para eliminar
    const { photoUrl } = req.body || {};
    const val = (photoUrl === null || photoUrl === '') ? null
      : (typeof photoUrl === 'string' ? photoUrl : null);
    try {
      await query(
        `UPDATE restaurants SET profile_photo=$1 WHERE owner_user_id=$2`,
        [val, req.user.userId]
      );
    } catch (e) {
      // Columna puede no existir si la migration no se corrió
      if (e?.code === '42703') return next(new AppError(500, 'Ejecuta migration_v11.sql primero'));
      throw e;
    }
    return res.json({ ok: true, photoUrl: val });
  } catch (error) { return next(error); }
});

router.post('/menu-items', authenticate, authorize(['restaurant']), validate(createMenuItemSchema), async (req, res, next) => {
  try {
    const restaurantId = await getRestaurantIdByOwner(req.user.userId);
    if (!restaurantId) return next(new AppError(404, 'Restaurante no encontrado'));
    const { name, description, priceCents } = req.validatedBody;
    // priceCents validado: entero entre $1 y $10,000
    if (!Number.isInteger(priceCents) || priceCents < 100 || priceCents > 1_000_000) {
      return next(new AppError(400, 'El precio debe estar entre $1.00 y $10,000.00'));
    }
    const result = await query(
      'INSERT INTO menu_items(restaurant_id, name, description, price_cents, is_available) VALUES($1,$2,$3,$4,true) RETURNING *',
      [restaurantId, name, description, priceCents]
    );
    return res.status(201).json({ menuItem: result.rows[0] });
  } catch (error) { return next(error); }
});

/* ── PATCH /menu-items/:id ── */
router.patch('/menu-items/:id', authenticate, authorize(['restaurant']), async (req, res, next) => {
  // No usar updateMenuItemSchema porque bloquea peticiones que solo traen imageUrl
  try {
    const restaurantId = await getRestaurantIdByOwner(req.user.userId);
    if (!restaurantId) return next(new AppError(404, 'Restaurante no encontrado'));
    const item = await query('SELECT * FROM menu_items WHERE id=$1 AND restaurant_id=$2', [req.params.id, restaurantId]);
    if (item.rowCount === 0) return next(new AppError(404, 'Producto no encontrado'));
    const cur = item.rows[0];
    const p = req.body || {};
    // imageUrl: acepta base64 (data:image/...) o null para eliminar imagen
    let imageUrl = cur.image_url;
    if (req.body.imageUrl !== undefined) {
      if (req.body.imageUrl === null || req.body.imageUrl === '') {
        imageUrl = null;
      } else if (typeof req.body.imageUrl === 'string') {
        // base64 o URL — aceptar sin restricción de formato
        imageUrl = req.body.imageUrl;
      }
    }
    const result = await query(
      'UPDATE menu_items SET name=$1, description=$2, price_cents=$3, is_available=$4, image_url=$5 WHERE id=$6 RETURNING *',
      [p.name ?? cur.name, p.description ?? cur.description ?? '', (p.priceCents != null ? Math.round(Number(p.priceCents)) : null) ?? cur.price_cents, p.isAvailable ?? cur.is_available, imageUrl, req.params.id]
    );
    return res.json({ menuItem: result.rows[0] });
  } catch (error) { return next(error); }
});


/* ── DELETE /menu-items/:id — eliminar producto ── */
router.delete('/menu-items/:id', authenticate, authorize(['restaurant']), async (req, res, next) => {
  try {
    // Verificar que el item pertenece a este restaurante
    const check = await query(
      `SELECT mi.id FROM menu_items mi
       JOIN restaurants r ON r.id = mi.restaurant_id
       WHERE mi.id = $1 AND r.owner_user_id = $2`,
      [req.params.id, req.user.userId]
    );
    if (check.rowCount === 0) return next(new AppError(404, 'Producto no encontrado'));

    // Preservar historial: limpiar referencia en order_items antes de borrar
    try {
      await query(`UPDATE order_items SET menu_item_id = NULL WHERE menu_item_id = $1`, [req.params.id]);
    } catch (_) {}
    await query(`DELETE FROM menu_items WHERE id = $1`, [req.params.id]);
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});
export default router;
