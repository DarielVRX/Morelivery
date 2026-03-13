import { Router } from 'express';
import { query } from '../../config/db.js';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { AppError } from '../../utils/errors.js';

const router = Router();

const VALID_TYPES = ['traffic', 'construction', 'accident', 'flood', 'blocked', 'other'];

// POST / — crear zona
router.post('/', authenticate, authorize(['driver', 'admin']), async (req, res, next) => {
  try {
    const { lat, lng, radius_m, type, estimated_hours } = req.body || {};

    if (lat == null || lng == null || radius_m == null || type == null || estimated_hours == null) {
      throw new AppError(400, 'lat, lng, radius_m, type y estimated_hours son obligatorios');
    }
    if (!VALID_TYPES.includes(type)) {
      throw new AppError(400, `type debe ser uno de: ${VALID_TYPES.join(', ')}`);
    }
    if (Number(radius_m) < 20 || Number(radius_m) > 2000) {
      throw new AppError(400, 'radius_m debe estar entre 20 y 2000');
    }
    if (Number(estimated_hours) < 1 || Number(estimated_hours) > 72) {
      throw new AppError(400, 'estimated_hours debe estar entre 1 y 72');
    }

    // FIX 42P08: $5 no puede usarse con dos tipos distintos (double precision vs integer).
    // Se usa $5::integer en el cálculo de expires_at para forzar el tipo correcto.
    const result = await query(
      `INSERT INTO road_zones (lat, lng, radius_m, type, estimated_hours, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, NOW() + ($5::integer * INTERVAL '1 hour'), $6)
       RETURNING *`,
      [Number(lat), Number(lng), Number(radius_m), type, Number(estimated_hours), req.user.userId]
    );

    return res.status(201).json({ zone: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

// GET /active — zonas activas no expiradas
router.get('/active', async (_req, res, next) => {
  try {
    const result = await query(
      `SELECT * FROM road_zones WHERE expires_at > NOW() AND active = true ORDER BY created_at DESC`
    );
    return res.json({ zones: result.rows });
  } catch (error) {
    if (error?.code === '42P01') return res.json({ zones: [] });
    return next(error);
  }
});

// GET /near — zonas activas cercanas
router.get('/near', async (req, res, next) => {
  try {
    const lat      = Number(req.query.lat);
    const lng      = Number(req.query.lng);
    const radius_m = Number(req.query.radius_m) || 500;

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new AppError(400, 'lat y lng son requeridos');
    }

    const result = await query(
      `SELECT * FROM road_zones
       WHERE expires_at > NOW() AND active = true
         AND SQRT(POW((lat - $1) * 111320, 2) + POW((lng - $2) * 111320 * COS(RADIANS($1)), 2)) <= $3`,
      [lat, lng, radius_m]
    );
    return res.json({ zones: result.rows });
  } catch (error) {
    if (error?.code === '42P01') return res.json({ zones: [] });
    return next(error);
  }
});

// DELETE /:id — desactivar zona
router.delete('/:id', authenticate, authorize(['driver', 'admin']), async (req, res, next) => {
  try {
    const { id } = req.params;
    let result;

    if (req.user.role === 'admin') {
      result = await query(
        `UPDATE road_zones SET active = false WHERE id = $1 RETURNING id`,
        [id]
      );
    } else {
      result = await query(
        `UPDATE road_zones SET active = false WHERE id = $1 AND created_by = $2 RETURNING id`,
        [id, req.user.userId]
      );
    }

    if (result.rowCount === 0) {
      throw new AppError(404, 'Zona no encontrada o sin permiso para desactivarla');
    }

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

export default router;
