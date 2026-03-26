import { Router } from 'express';
import { query } from '../../config/db.js';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { AppError } from '../../utils/errors.js';
import { sseHub } from '../events/hub.js';

const router = Router();

const VALID_PREFERENCES = ['preferred', 'difficult', 'avoid'];
const VALID_DURATIONS   = ['days', 'weeks', 'months', 'permanent'];

// POST /preference — guardar preferencia(s) de calle
router.post('/preference', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const body = req.body || {};

    let items = [];
    if (Array.isArray(body.ways)) {
      items = body.ways.map(w => ({
        way_id:     String(w.way_id || w.id || ''),
        preference: w.preference,
      }));
    } else {
      items = [{ way_id: String(body.way_id || ''), preference: body.preference }];
    }

    if (!items.length) throw new AppError(400, 'Se requiere al menos un tramo');

    for (const { way_id, preference } of items) {
      if (!way_id) throw new AppError(400, 'way_id es obligatorio en cada tramo');
      if (!VALID_PREFERENCES.includes(preference)) {
        throw new AppError(400, `preference debe ser uno de: ${VALID_PREFERENCES.join(', ')}`);
      }
      await query(
        `INSERT INTO road_preferences (driver_id, way_id, preference)
         VALUES ($1, $2, $3)
         ON CONFLICT (driver_id, way_id) DO UPDATE
           SET preference = EXCLUDED.preference, updated_at = NOW()`,
        [req.user.userId, way_id, preference]
      );
    }

    return res.json({ ok: true, saved: items.length });
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

// POST /impassable — reportar calle(s) no viable(s)
// Acepta objeto único { way_id, lat, lng, description?, estimated_duration }
// o array     { lat, lng, ways: [{ way_id, description?, estimated_duration }] }
router.post('/impassable', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const body = req.body || {};
    const baseLat = Number(body.lat ?? 0);
    const baseLng = Number(body.lng ?? 0);

    let items = [];
    if (Array.isArray(body.ways)) {
      items = body.ways.map(w => ({
        way_id:             String(w.way_id || w.id || ''),
        lat:                Number(w.lat ?? baseLat),
        lng:                Number(w.lng ?? baseLng),
        description:        w.description || body.description || null,
        estimated_duration: w.estimated_duration || body.estimated_duration,
      }));
    } else {
      items = [{
        way_id:             String(body.way_id || ''),
        lat:                baseLat,
        lng:                baseLng,
        description:        body.description || null,
        estimated_duration: body.estimated_duration,
      }];
    }

    if (!items.length) throw new AppError(400, 'Se requiere al menos un tramo');

    const reports = [];
    for (const { way_id, lat, lng, description, estimated_duration } of items) {
      if (!way_id) throw new AppError(400, 'way_id es obligatorio en cada tramo');
      if (!VALID_DURATIONS.includes(estimated_duration)) {
        throw new AppError(400, `estimated_duration debe ser uno de: ${VALID_DURATIONS.join(', ')}`);
      }
      if (description && description.length > 500) {
        throw new AppError(400, 'description no puede superar 500 caracteres');
      }

      // ON CONFLICT usa el índice único (way_id) — un way_id solo puede tener un reporte pendiente
      // Si ya existe uno confirmado del mismo driver, se actualiza; si es de otro driver, se inserta
      // El schema tiene: CREATE UNIQUE INDEX idx_impassable_one_per_way ON impassable_reports(way_id) WHERE confirmed = false
      // Por lo tanto usamos INSERT ... ON CONFLICT (way_id) WHERE confirmed = false
      try {
        const result = await query(
          `INSERT INTO impassable_reports (way_id, lat, lng, description, estimated_duration, reported_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (way_id) WHERE confirmed = false
           DO UPDATE SET
             lat                = EXCLUDED.lat,
             lng                = EXCLUDED.lng,
             description        = EXCLUDED.description,
             estimated_duration = EXCLUDED.estimated_duration,
             reported_by        = EXCLUDED.reported_by
           RETURNING *`,
          [way_id, lat, lng, description || null, estimated_duration, req.user.userId]
        );
        if (result.rows[0]) reports.push(result.rows[0]);
      } catch (e) {
        // 23505 = unique_violation para el caso de confirmed=true ya existente — ignorar
        if (e?.code !== '23505') throw e;
      }
    }

    return res.status(201).json({ ok: true, reports });
  } catch (error) {
    return next(error);
  }
});

// GET /impassable/mine — reportes del driver autenticado
router.get('/impassable/mine', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const result = await query(
      `SELECT ir.*,
              COUNT(ic.id)::int AS confirmation_count,
              CASE WHEN ir.confirmed THEN 'confirmed' ELSE 'pending' END AS status
       FROM impassable_reports ir
       LEFT JOIN impassable_confirmations ic ON ic.way_id = ir.way_id
       WHERE ir.reported_by = $1
       GROUP BY ir.id
       ORDER BY ir.created_at DESC`,
      [req.user.userId]
    );
    return res.json({ reports: result.rows });
  } catch (error) {
    if (error?.code === '42P01') return res.json({ reports: [] });
    return next(error);
  }
});

// POST /impassable/:way_id/confirm — confirmar reporte de otro driver
router.post('/impassable/:way_id/confirm', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const { way_id } = req.params;
    const { estimated_duration } = req.body || {};

    if (!VALID_DURATIONS.includes(estimated_duration)) {
      throw new AppError(400, `estimated_duration debe ser uno de: ${VALID_DURATIONS.join(', ')}`);
    }

    const reportRes = await query(
      `SELECT id FROM impassable_reports WHERE way_id = $1 LIMIT 1`,
      [way_id]
    );
    if (reportRes.rowCount === 0) {
      throw new AppError(404, 'No existe reporte para este way_id');
    }

    const alreadyConfirmed = await query(
      `SELECT id FROM impassable_confirmations WHERE way_id = $1 AND confirmed_by = $2`,
      [way_id, req.user.userId]
    );
    if (alreadyConfirmed.rowCount > 0) {
      throw new AppError(409, 'Ya confirmaste este reporte');
    }

    await query(
      `INSERT INTO impassable_confirmations (way_id, confirmed_by, estimated_duration)
       VALUES ($1, $2, $3)`,
      [way_id, req.user.userId, estimated_duration]
    );

    const confirmationsRes = await query(
      `SELECT estimated_duration FROM impassable_confirmations WHERE way_id = $1`,
      [way_id]
    );
    const confirmationCount = confirmationsRes.rowCount;
    const isPermanent = estimated_duration === 'permanent';
    const threshold = isPermanent ? 5 : 3;

    if (confirmationCount >= threshold) {
      const freq = {};
      for (const row of confirmationsRes.rows) {
        freq[row.estimated_duration] = (freq[row.estimated_duration] || 0) + 1;
      }
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

      try {
        sseHub.sendToRole('driver', 'impassable_confirmed', { way_id, consensus_duration });
      } catch (_) {}
    }

    return res.json({ ok: true, confirmation_count: confirmationCount });
  } catch (error) {
    return next(error);
  }
});

// GET /impassable — todos los reportes
router.get('/impassable', async (req, res, next) => {
  try {
    const filter = req.query.confirmed;
    const whereClause = filter === 'true'
      ? 'WHERE ir.confirmed = true'
      : filter === 'false'
        ? 'WHERE ir.confirmed = false'
        : '';

    const result = await query(
      `SELECT ir.*,
              COUNT(ic.id)::int AS confirmation_count,
              CASE WHEN ir.confirmed THEN 'confirmed' ELSE 'pending' END AS status
       FROM impassable_reports ir
       LEFT JOIN impassable_confirmations ic ON ic.way_id = ir.way_id
       ${whereClause}
       GROUP BY ir.id
       ORDER BY ir.created_at DESC`
    );
    return res.json({ reports: result.rows });
  } catch (error) {
    if (error?.code === '42P01') return res.json({ reports: [] });
    return next(error);
  }
});

// GET /impassable/near — reportes cercanos
router.get('/impassable/near', async (req, res, next) => {
  try {
    const lat      = Number(req.query.lat);
    const lng      = Number(req.query.lng);
    const radius_m = Number(req.query.radius_m) || 300;

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new AppError(400, 'lat y lng son requeridos');
    }

    const result = await query(
      `SELECT ir.*,
              COUNT(ic.id)::int AS confirmation_count,
              CASE WHEN ir.confirmed THEN 'confirmed' ELSE 'pending' END AS status
       FROM impassable_reports ir
       LEFT JOIN impassable_confirmations ic ON ic.way_id = ir.way_id
       WHERE SQRT(POW((ir.lat - $1) * 111320, 2) + POW((ir.lng - $2) * 111320 * COS(RADIANS($1)), 2)) <= $3
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

// DELETE /impassable/:way_id — eliminar propio reporte
router.delete('/impassable/:way_id', authenticate, authorize(['driver', 'admin']), async (req, res, next) => {
  try {
    const { way_id } = req.params;
    const result = req.user.role === 'admin'
      ? await query(`DELETE FROM impassable_reports WHERE way_id=$1 RETURNING way_id`, [way_id])
      : await query(`DELETE FROM impassable_reports WHERE way_id=$1 AND reported_by=$2 RETURNING way_id`,
                    [way_id, req.user.userId]);
    if (result.rowCount === 0) throw new AppError(404, 'Reporte no encontrado o sin permiso');
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

// PUT /preference/:way_id — editar preferencia personal
router.put('/preference/:way_id', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const { way_id } = req.params;
    const { preference } = req.body || {};
    if (!VALID_PREFERENCES.includes(preference))
      throw new AppError(400, `preference debe ser uno de: ${VALID_PREFERENCES.join(', ')}`);
    const result = await query(
      `UPDATE road_preferences SET preference=$1, updated_at=NOW()
       WHERE driver_id=$2 AND way_id=$3 RETURNING *`,
      [preference, req.user.userId, way_id]
    );
    if (result.rowCount === 0) throw new AppError(404, 'Preferencia no encontrada');
    return res.json({ ok: true, preference: result.rows[0] });
  } catch (error) { return next(error); }
});

// DELETE /preference/:way_id — eliminar preferencia personal
router.delete('/preference/:way_id', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const { way_id } = req.params;
    await query(
      `DELETE FROM road_preferences WHERE driver_id=$1 AND way_id=$2`,
      [req.user.userId, way_id]
    );
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

export default router;
