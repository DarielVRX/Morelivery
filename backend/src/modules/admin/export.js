// backend/modules/admin/export.js
// Agregar estas rutas al router de admin existente (modules/admin/routes.js)
// o importar este router y montarlo dentro del módulo admin.
//
// Ejemplo de integración en modules/admin/routes.js:
//   import exportRoutes from './export.js';
//   router.use('/orders', exportRoutes);
//   // Queda disponible como GET /api/admin/orders/export

import { Router }       from 'express';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { AppError }     from '../../utils/errors.js';
import { query }        from '../../config/db.js';

const router = Router();

// ── GET /api/admin/orders/export ──────────────────────────────────────────────
// Exporta pedidos de un día como JSON o CSV.
// El frontend usa showSaveFilePicker para guardar el archivo directamente
// en el dispositivo del admin sin pasar por <a download>.
//
// Query params:
//   date   — YYYY-MM-DD (requerido)
//   format — "json" | "csv" (default: "json")
//
// Solo accesible para admin.
router.get('/export', authenticate, authorize(['admin']), async (req, res, next) => {
  try {
    const { date, format = 'json' } = req.query;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
      return next(new AppError(400, 'Parámetro date requerido en formato YYYY-MM-DD'));

    if (!['json', 'csv'].includes(format))
      return next(new AppError(400, 'format debe ser "json" o "csv"'));

    const { rows } = await query(
      `SELECT
         o.id,
         o.status,
         o.total,
         o.created_at,
         o.updated_at,
         r.name        AS restaurant,
         r.address     AS restaurant_address,
         u.name        AS customer,
         d.name        AS driver,
         o.delivery_address
       FROM orders o
       LEFT JOIN restaurants r ON r.id = o.restaurant_id
       LEFT JOIN users u       ON u.id = o.customer_id
       LEFT JOIN users d       ON d.id = o.driver_id
       WHERE o.created_at::date = $1::date
       ORDER BY o.created_at ASC`,
      [date]
    );

    if (format === 'csv') {
      const headers = ['id', 'status', 'total', 'created_at', 'restaurant', 'customer', 'driver', 'delivery_address'];
      const escape  = (v) => (v == null ? '' : `"${String(v).replace(/"/g, '""')}"`);
      const csvRows = [
        headers.join(','),
        ...rows.map(r => headers.map(h => escape(r[h])).join(',')),
      ];
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="pedidos-${date}.csv"`);
      return res.send(csvRows.join('\r\n'));
    }

    // JSON default
    res.setHeader('Content-Type', 'application/json');
    return res.json(rows);

  } catch (err) { return next(err); }
});

export default router;


