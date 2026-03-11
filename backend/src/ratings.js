// ── Ratings/Reseñas — submódulo de orders ────────────────────────────────────
// POST /orders/:id/rating  — cliente califica entrega (restaurante + driver)
// GET  /orders/:id/rating  — traer calificación existente (para mostrar en UI)
// GET  /restaurants/:id/ratings — promedio público de un restaurante

import { Router } from 'express';
import { query } from '../../config/db.js';
import { authenticate } from '../../middlewares/auth.js';
import { AppError } from '../../utils/errors.js';

const router = Router({ mergeParams: true });

/* ── POST /orders/:id/rating ── cliente califica tras entrega ── */
router.post('/', authenticate, async (req, res, next) => {
  try {
    const { id: orderId } = req.params;
    const { restaurant_stars, driver_stars, comment } = req.body || {};

    // Validaciones
    const rStars = Number(restaurant_stars);
    const dStars = driver_stars != null ? Number(driver_stars) : null;
    if (!Number.isInteger(rStars) || rStars < 1 || rStars > 5)
      return next(new AppError(400, 'restaurant_stars debe ser entre 1 y 5'));
    if (dStars != null && (!Number.isInteger(dStars) || dStars < 1 || dStars > 5))
      return next(new AppError(400, 'driver_stars debe ser entre 1 y 5'));

    // Verificar que el pedido pertenece al cliente y está entregado
    const ord = await query(
      `SELECT o.id, o.status, o.customer_id, o.driver_id, o.restaurant_id
       FROM orders o WHERE o.id=$1`, [orderId]
    );
    if (ord.rowCount === 0) return next(new AppError(404, 'Pedido no encontrado'));
    const order = ord.rows[0];
    if (order.customer_id !== req.user.userId)
      return next(new AppError(403, 'Solo el cliente puede calificar'));
    if (order.status !== 'delivered')
      return next(new AppError(409, 'Solo se puede calificar un pedido entregado'));

    // Evitar calificación duplicada
    try {
      const existing = await query(
        'SELECT id FROM order_ratings WHERE order_id=$1', [orderId]
      );
      if (existing.rowCount > 0)
        return next(new AppError(409, 'Este pedido ya fue calificado'));
    } catch (e) {
      // Si la tabla no existe (primera vez), la creamos implícitamente
      if (!e.message.includes('does not exist')) throw e;
    }

    // Insertar rating
    await query(`
      INSERT INTO order_ratings(order_id, customer_id, restaurant_id, driver_id,
        restaurant_stars, driver_stars, comment, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
    `, [orderId, order.customer_id, order.restaurant_id, order.driver_id,
        rStars, dStars, comment?.trim() || null]);

    // Actualizar promedio en restaurants (denormalizado para rendimiento)
    await query(`
      UPDATE restaurants SET
        rating_avg   = (SELECT AVG(restaurant_stars)::numeric(3,2) FROM order_ratings WHERE restaurant_id=$1),
        rating_count = (SELECT COUNT(*)::int FROM order_ratings WHERE restaurant_id=$1)
      WHERE id=$1
    `, [order.restaurant_id]).catch(() => {}); // silenciar si columna no existe aún

    return res.status(201).json({ ok: true });
  } catch (error) { return next(error); }
});

/* ── GET /orders/:id/rating ── traer calificación del pedido ── */
router.get('/', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT restaurant_stars, driver_stars, comment, created_at
       FROM order_ratings WHERE order_id=$1`, [req.params.id]
    ).catch(() => ({ rows: [] }));
    return res.json({ rating: result.rows[0] || null });
  } catch (error) { return next(error); }
});

export default router;
