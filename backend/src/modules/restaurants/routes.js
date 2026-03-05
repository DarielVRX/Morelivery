import { Router } from 'express';
import { query } from '../../config/db.js';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { createMenuItemSchema, updateMenuItemSchema } from './schemas.js';
import { sanitizeText } from '../../utils/sanitize.js';
import { AppError } from '../../utils/errors.js';

const router = Router();

async function getRestaurantIdByOwner(userId) {
  const restaurantResult = await query('SELECT id FROM restaurants WHERE owner_user_id = $1 LIMIT 1', [userId]);
  return restaurantResult.rows[0]?.id || null;
}

router.get('/', async (_req, res, next) => {
  try {
    const result = await query('SELECT id, name, category, is_open FROM restaurants WHERE is_active = true ORDER BY name');
    return res.json({ restaurants: result.rows });
  } catch (error) {
    if (error?.code === '42P01') {
      return res.json({ restaurants: [], warning: 'restaurants table not initialized yet' });
    }
    return next(error);
  }
});

router.get('/my', authenticate, authorize(['restaurant']), async (req, res, next) => {
  try {
    const result = await query('SELECT id, name, category, is_open FROM restaurants WHERE owner_user_id = $1 LIMIT 1', [req.user.userId]);
    return res.json({ restaurant: result.rows[0] || null });
  } catch (error) {
    return next(error);
  }
});

router.get('/my/menu', authenticate, authorize(['restaurant']), async (req, res, next) => {
  try {
    const restaurantId = await getRestaurantIdByOwner(req.user.userId);
    if (!restaurantId) return next(new AppError(404, 'Restaurant not found'));
    const result = await query(
      'SELECT id, name, description, price_cents, is_available FROM menu_items WHERE restaurant_id = $1 ORDER BY name',
      [restaurantId]
    );
    return res.json({ menu: result.rows });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id/menu', async (req, res, next) => {
  try {
    const result = await query(
      'SELECT id, name, description, price_cents, is_available FROM menu_items WHERE restaurant_id = $1 ORDER BY name',
      [req.params.id]
    );
    return res.json({ menu: result.rows });
  } catch (error) {
    if (error?.code === '42P01') {
      return res.json({ menu: [], warning: 'menu_items table not initialized yet' });
    }
    return next(error);
  }
});

router.post('/menu-items', authenticate, authorize(['restaurant']), validate(createMenuItemSchema), async (req, res, next) => {
  try {
    const restaurantId = await getRestaurantIdByOwner(req.user.userId);
    if (!restaurantId) return next(new AppError(404, 'Restaurant not found'));
    const { name, description, priceCents } = req.validatedBody;
    const result = await query(
      'INSERT INTO menu_items(restaurant_id, name, description, price_cents, is_available) VALUES($1, $2, $3, $4, true) RETURNING *',
      [restaurantId, sanitizeText(name), sanitizeText(description), priceCents]
    );
    return res.status(201).json({ menuItem: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.patch('/menu-items/:id', authenticate, authorize(['restaurant']), validate(updateMenuItemSchema), async (req, res, next) => {
  try {
    const restaurantId = await getRestaurantIdByOwner(req.user.userId);
    if (!restaurantId) return next(new AppError(404, 'Restaurant not found'));

    const itemResult = await query('SELECT * FROM menu_items WHERE id = $1 AND restaurant_id = $2', [req.params.id, restaurantId]);
    if (itemResult.rowCount === 0) return next(new AppError(404, 'Menu item not found'));

    const current = itemResult.rows[0];
    const payload = req.validatedBody;

    const result = await query(
      'UPDATE menu_items SET name = $1, description = $2, price_cents = $3, is_available = $4 WHERE id = $5 RETURNING *',
      [
        sanitizeText(payload.name ?? current.name),
        sanitizeText(payload.description ?? current.description ?? ''),
        payload.priceCents ?? current.price_cents,
        payload.isAvailable ?? current.is_available,
        req.params.id
      ]
    );

    return res.json({ menuItem: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

export default router;
