import { Router } from 'express';
import { query } from '../../config/db.js';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { AppError } from '../../utils/errors.js';
import { sseHub } from '../events/hub.js';

const router = Router();

const VALID_PREFERENCES = ['preferred', 'difficult', 'avoid'];
const VALID_DURATIONS   = ['days', 'weeks', 'months', 'permanent'];

// POST /preference — guardar preferencia de calle
router.post('/preference', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const { way_id, preference } = req.body || {};

    if (!way_id || !preference) {
      throw new AppError(400, 'way_id y preference son obligatorios');
    }
    if (!VALID_PREFERENCES.includes(preference)) {
      throw new AppError(400, `preference debe ser uno de: ${VALID_PREFERENCES.join(', ')}`);
    }

    await query(
      `INSERT INTO road_preferences (driver_id, way_id, preference)
       VALUES ($1, $2, $3)
       ON CONFLICT (driver_id, way_id) DO UPDATE
         SET preference = EXCLUDED.preference, updated_at = NOW()`,
      [req.user.userId, String(way_id), preference]
    );

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

// GET /preferences — preferencias del driver autenticado
router.get('/preferences', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const result = await query(
      `SELECT * FROM road_preferences WHERE driver_id = $1 ORDER BY updated_at DESC`,
      [req.user.userId]
    );
    return res.json({ preferences: result.rows });
  } catch (error) {
    if (error?.code === '42P01') return res.json({ preferences: [] });
    return next(error);
  }
});

// POST /impassable — reportar calle no viable
router.post('/impassable', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const { way_id, lat, lng, description, estimated_duration } = req.body || {};

    if (!way_id || lat == null || lng == null) {
      throw new AppError(400, 'way_id, lat y lng son obligatorios');
    }
    if (!VALID_DURATIONS.includes(estimated_duration)) {
      throw new AppError(400, `estimated_duration debe ser uno de: ${VALID_DURATIONS.join(', ')}`);
    }
    if (description && description.length > 500) {
      throw new AppError(400, 'description no puede superar 500 caracteres');
    }

    const result = await query(
      `INSERT INTO impassable_reports (way_id, lat, lng, description, estimated_duration, reported_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [String(way_id), Number(lat), Number(lng), description || null, estimated_duration, req.user.userId]
    );

    return res.status(201).json({ report: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

// POST /impassable/:way_id/confirm — confirmar reporte
router.post('/impassable/:way_id/confirm', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const { way_id } = req.params;
    const { estimated_duration } = req.body || {};

    if (!VALID_DURATIONS.includes(estimated_duration)) {
      throw new AppError(400, `estimated_duration debe ser uno de: ${VALID_DURATIONS.join(', ')}`);
    }

    // Verificar que el reporte existe
    const reportRes = await query(
      `SELECT id FROM impassable_reports WHERE way_id = $1 LIMIT 1`,
      [way_id]
    );
    if (reportRes.rowCount === 0) {
      throw new AppError(404, 'No existe reporte para este way_id');
    }

    // Verificar que el usuario no haya confirmado ya
    const alreadyConfirmed = await query(
      `SELECT id FROM impassable_confirmations WHERE way_id = $1 AND confirmed_by = $2`,
      [way_id, req.user.userId]
    );
    if (alreadyConfirmed.rowCount > 0) {
      throw new AppError(409, 'Ya confirmaste este reporte');
    }

    // Insertar confirmación
    await query(
      `INSERT INTO impassable_confirmations (way_id, confirmed_by, estimated_duration)
       VALUES ($1, $2, $3)`,
      [way_id, req.user.userId, estimated_duration]
    );

    // Contar confirmaciones y determinar consenso
    const confirmationsRes = await query(
      `SELECT estimated_duration FROM impassable_confirmations WHERE way_id = $1`,
      [way_id]
    );
    const confirmationCount = confirmationsRes.rowCount;
    const isPermanent = estimated_duration === 'permanent';
    const threshold = isPermanent ? 5 : 3;

    if (confirmationCount >= threshold) {
      // Calcular moda (valor más frecuente)
      const freq = {};
      for (const row of confirmationsRes.rows) {
        freq[row.estimated_duration] = (freq[row.estimated_duration] || 0) + 1;
      }
      // También incluir el estimated_duration del reporte original
      const origReport = await query(
        `SELECT estimated_duration FROM impassable_reports WHERE way_id = $1 LIMIT 1`,
        [way_id]
      );
      if (origReport.rowCount > 0) {
        const od = origReport.rows[0].estimated_duration;
        freq[od] = (freq[od] || 0) + 1;
      }
      const consensus_duration = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];

      await query(
        `UPDATE impassable_reports SET confirmed = true, consensus_duration = $1 WHERE way_id = $2`,
        [consensus_duration, way_id]
      );

      // Emitir SSE a todos los drivers
      try {
        sseHub.sendToRole('driver', 'impassable_confirmed', { way_id, consensus_duration });
      } catch (_) {}
    }

    return res.json({ ok: true, confirmation_count: confirmationCount });
  } catch (error) {
    return next(error);
  }
});

// GET /impassable — reportes confirmados
router.get('/impassable', async (_req, res, next) => {
  try {
    const result = await query(
      `SELECT ir.*, COUNT(ic.id)::int AS confirmation_count
       FROM impassable_reports ir
       LEFT JOIN impassable_confirmations ic ON ic.way_id = ir.way_id
       WHERE ir.confirmed = true
       GROUP BY ir.id
       ORDER BY ir.created_at DESC`
    );
    return res.json({ reports: result.rows });
  } catch (error) {
    if (error?.code === '42P01') return res.json({ reports: [] });
    return next(error);
  }
});

// GET /impassable/near — reportes confirmados cercanos
router.get('/impassable/near', async (req, res, next) => {
  try {
    const lat      = Number(req.query.lat);
    const lng      = Number(req.query.lng);
    const radius_m = Number(req.query.radius_m) || 300;

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new AppError(400, 'lat y lng son requeridos');
    }

    const result = await query(
      `SELECT ir.*, COUNT(ic.id)::int AS confirmation_count
       FROM impassable_reports ir
       LEFT JOIN impassable_confirmations ic ON ic.way_id = ir.way_id
       WHERE ir.confirmed = true
         AND SQRT(POW((ir.lat - $1) * 111320, 2) + POW((ir.lng - $2) * 111320 * COS(RADIANS($1)), 2)) <= $3
       GROUP BY ir.id
       ORDER BY ir.created_at DESC`,
      [lat, lng, radius_m]
    );
    return res.json({ reports: result.rows });
  } catch (error) {
    if (error?.code === '42P01') return res.json({ reports: [] });
    return next(error);
  }
});

export default router;
