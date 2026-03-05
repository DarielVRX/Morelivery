import { Router } from 'express';
import { query } from '../../config/db.js';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { createMenuItemSchema } from './schemas.js';
import { sanitizeText } from '../../utils/sanitize.js';
import { AppError } from '../../utils/errors.js';

const router = Router();

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
    const restaurantResult = await query('SELECT id FROM restaurants WHERE owner_user_id = $1 LIMIT 1', [req.user.userId]);
    if (restaurantResult.rowCount === 0) return next(new AppError(404, 'Restaurant not found'));
    const { name, description, priceCents } = req.validatedBody;
    const result = await query(
      'INSERT INTO menu_items(restaurant_id, name, description, price_cents, is_available) VALUES($1, $2, $3, $4, true) RETURNING *',
      [restaurantResult.rows[0].id, sanitizeText(name), sanitizeText(description), priceCents]
    );
    return res.status(201).json({ menuItem: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

export default router;
