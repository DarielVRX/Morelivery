import { Router } from 'express';
import { query } from '../../config/db.js';
import { authenticate, authorize } from '../../middlewares/auth.js';

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    const result = await query('SELECT id, name, category, is_open FROM restaurants WHERE is_active = true ORDER BY name');
    res.json({ restaurants: result.rows });
  } catch (error) {
    next(error);
  }
});

router.get('/:id/menu', async (req, res, next) => {
  try {
    const result = await query(
      'SELECT id, name, description, price_cents, is_available FROM menu_items WHERE restaurant_id = $1 ORDER BY name',
      [req.params.id]
    );
    res.json({ menu: result.rows });
  } catch (error) {
    next(error);
  }
});

router.post('/menu-items', authenticate, authorize(['restaurant']), async (req, res, next) => {
  try {
    const { restaurantId, name, description, priceCents } = req.body;
    const result = await query(
      'INSERT INTO menu_items(restaurant_id, name, description, price_cents, is_available) VALUES($1, $2, $3, $4, true) RETURNING *',
      [restaurantId, name, description, priceCents]
    );
    res.status(201).json({ menuItem: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

export default router;
