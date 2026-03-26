import { Router } from 'express';
import { query } from '../../config/db.js';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { AppError } from '../../utils/errors.js';
import { sseHub } from '../events/hub.js';

const router = Router();

const VALID_PREFERENCES = ['preferred', 'difficult', 'avoid'];
const VALID_DURATIONS   = ['days', 'weeks', 'months', 'permanent'];

// ── POST /preference ──────────────────────────────────────────────────────────
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
      if (!VALID_PREFERENCES.includes(preference))
        throw new AppError(400, `preference debe ser uno de: ${VALID_PREFERENCES.join(', ')}`);
      await query(
        `INSERT INTO road_preferences (driver_id, way_id, preference)
         VALUES ($1, $2, $3)
         ON CONFLICT (driver_id, way_id) DO UPDATE
           SET preference = EXCLUDED.preference, updated_at = NOW()`,
        [req.user.userId, way_id, preference]
      );
    }
    return res.json({ ok: true, saved: items.length });
  } catch (error) { return next(error); }
});

// ── GET /preferences ──────────────────────────────────────────────────────────
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

// ── POST /impassable ──────────────────────────────────────────────────────────
// Guarda múltiples ways como UN SOLO registro (agrupado por calle).
// { lat, lng, ways: [{ way_id, name, coords, estimated_duration, description? }] }
// o forma simple: { way_id, lat, lng, name, coords, estimated_duration }
router.post('/impassable', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const body    = req.body || {};
    const baseLat = Number(body.lat ?? 0);
    const baseLng = Number(body.lng ?? 0);

    let rawWays = [];
    if (Array.isArray(body.ways)) {
      rawWays = body.ways.map(w => ({
        way_id:             String(w.way_id || w.id || ''),
        lat:                Number(w.lat ?? baseLat),
        lng:                Number(w.lng ?? baseLng),
        name:               w.name || null,
        coords:             Array.isArray(w.coords) ? w.coords : null,
        description:        w.description || body.description || null,
        estimated_duration: w.estimated_duration || body.estimated_duration,
      }));
    } else {
      rawWays = [{
        way_id:             String(body.way_id || ''),
        lat:                baseLat,
        lng:                baseLng,
        name:               body.name || null,
        coords:             Array.isArray(body.coords) ? body.coords : null,
        description:        body.description || null,
        estimated_duration: body.estimated_duration,
      }];
    }

    if (!rawWays.length) throw new AppError(400, 'Se requiere al menos un tramo');

    for (const w of rawWays) {
      if (!w.way_id) throw new AppError(400, 'way_id es obligatorio en cada tramo');
      if (!VALID_DURATIONS.includes(w.estimated_duration))
        throw new AppError(400, `estimated_duration debe ser uno de: ${VALID_DURATIONS.join(', ')}`);
      if (w.description && w.description.length > 500)
        throw new AppError(400, 'description no puede superar 500 caracteres');
    }

    // Agrupar: un registro por reporte, con todos los way_ids del grupo
    const primary    = rawWays[0];
    const allWayIds  = rawWays.map(w => w.way_id);
    const groupName  = rawWays.find(w => w.name && w.name !== w.way_id)?.name || primary.name || null;
    const groupCoords = primary.coords; // geometría del segmento principal

    let savedReport = null;
    try {
      const result = await query(
        `INSERT INTO impassable_reports
           (way_id, lat, lng, name, coords, way_ids, description, estimated_duration, reported_by)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)
         ON CONFLICT (way_id) WHERE confirmed = false
         DO UPDATE SET
           lat                = EXCLUDED.lat,
           lng                = EXCLUDED.lng,
           name               = EXCLUDED.name,
           coords             = EXCLUDED.coords,
           way_ids            = EXCLUDED.way_ids,
           description        = EXCLUDED.description,
           estimated_duration = EXCLUDED.estimated_duration,
           reported_by        = EXCLUDED.reported_by
         RETURNING *`,
        [
          primary.way_id,
          primary.lat,
          primary.lng,
          groupName,
          groupCoords ? JSON.stringify(groupCoords) : null,
          allWayIds,
          primary.description || null,
          primary.estimated_duration,
          req.user.userId,
        ]
      );
      savedReport = result.rows[0] || null;
    } catch (e) {
      if (e?.code !== '23505') throw e;
      // 23505 = el way_id ya tiene un reporte confirmed — ignorar silenciosamente
    }

    return res.status(201).json({ ok: true, report: savedReport });
  } catch (error) { return next(error); }
});

// ── PATCH /impassable/:way_id — editar reporte propio (no confirmado) ─────────
router.patch('/impassable/:way_id', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const { way_id }                      = req.params;
    const { estimated_duration, description } = req.body || {};

    if (estimated_duration && !VALID_DURATIONS.includes(estimated_duration))
      throw new AppError(400, `estimated_duration debe ser uno de: ${VALID_DURATIONS.join(', ')}`);
    if (description && description.length > 500)
      throw new AppError(400, 'description no puede superar 500 caracteres');

    const setParts = [];
    const params   = [];
    if (estimated_duration) {
      params.push(estimated_duration);
      setParts.push(`estimated_duration = $${params.length}`);
    }
    if (description !== undefined) {
      params.push(description || null);
      setParts.push(`description = $${params.length}`);
    }
    if (!setParts.length) throw new AppError(400, 'Nada que actualizar');

    params.push(way_id, req.user.userId);
    const result = await query(
      `UPDATE impassable_reports
       SET ${setParts.join(', ')}
       WHERE way_id     = $${params.length - 1}
         AND reported_by = $${params.length}
         AND confirmed   = false
       RETURNING *`,
      params
    );
    if (result.rowCount === 0)
      throw new AppError(404, 'Reporte no encontrado, sin permiso, o ya confirmado');

    return res.json({ ok: true, report: result.rows[0] });
  } catch (error) { return next(error); }
});

// ── GET /impassable/mine ──────────────────────────────────────────────────────
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

// ── POST /impassable/:way_id/confirm ──────────────────────────────────────────
router.post('/impassable/:way_id/confirm', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const { way_id } = req.params;
    const { estimated_duration } = req.body || {};

    if (!VALID_DURATIONS.includes(estimated_duration))
      throw new AppError(400, `estimated_duration debe ser uno de: ${VALID_DURATIONS.join(', ')}`);

    const reportRes = await query(
      `SELECT id FROM impassable_reports WHERE way_id = $1 LIMIT 1`, [way_id]
    );
    if (reportRes.rowCount === 0) throw new AppError(404, 'No existe reporte para este way_id');

    const already = await query(
      `SELECT id FROM impassable_confirmations WHERE way_id = $1 AND confirmed_by = $2`,
      [way_id, req.user.userId]
    );
    if (already.rowCount > 0) throw new AppError(409, 'Ya confirmaste este reporte');

    await query(
      `INSERT INTO impassable_confirmations (way_id, confirmed_by, estimated_duration) VALUES ($1, $2, $3)`,
      [way_id, req.user.userId, estimated_duration]
    );

    const confirmationsRes = await query(
      `SELECT estimated_duration FROM impassable_confirmations WHERE way_id = $1`, [way_id]
    );
    const count     = confirmationsRes.rowCount;
    const threshold = estimated_duration === 'permanent' ? 5 : 3;

    if (count >= threshold) {
      const freq = {};
      for (const row of confirmationsRes.rows)
        freq[row.estimated_duration] = (freq[row.estimated_duration] || 0) + 1;
      const orig = await query(
        `SELECT estimated_duration FROM impassable_reports WHERE way_id = $1 LIMIT 1`, [way_id]
      );
      if (orig.rowCount > 0) {
        const od = orig.rows[0].estimated_duration;
        freq[od] = (freq[od] || 0) + 1;
      }
      const consensus = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
      await query(
        `UPDATE impassable_reports SET confirmed = true, consensus_duration = $1 WHERE way_id = $2`,
        [consensus, way_id]
      );
      try { sseHub.sendToRole('driver', 'impassable_confirmed', { way_id, consensus_duration: consensus }); } catch (_) {}
    }

    return res.json({ ok: true, confirmation_count: count });
  } catch (error) { return next(error); }
});

// ── GET /impassable ───────────────────────────────────────────────────────────
router.get('/impassable', async (req, res, next) => {
  try {
    const filter = req.query.confirmed;
    const where  = filter === 'true' ? 'WHERE ir.confirmed = true'
                 : filter === 'false' ? 'WHERE ir.confirmed = false' : '';
    const result = await query(
      `SELECT ir.*,
              COUNT(ic.id)::int AS confirmation_count,
              CASE WHEN ir.confirmed THEN 'confirmed' ELSE 'pending' END AS status
       FROM impassable_reports ir
       LEFT JOIN impassable_confirmations ic ON ic.way_id = ir.way_id
       ${where}
       GROUP BY ir.id
       ORDER BY ir.created_at DESC`
    );
    return res.json({ reports: result.rows });
  } catch (error) {
    if (error?.code === '42P01') return res.json({ reports: [] });
    return next(error);
  }
});

// ── GET /impassable/near ──────────────────────────────────────────────────────
router.get('/impassable/near', async (req, res, next) => {
  try {
    const lat      = Number(req.query.lat);
    const lng      = Number(req.query.lng);
    const radius_m = Number(req.query.radius_m) || 300;
    if (!Number.isFinite(lat) || !Number.isFinite(lng))
      throw new AppError(400, 'lat y lng son requeridos');
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

// ── DELETE /impassable/:way_id ────────────────────────────────────────────────
router.delete('/impassable/:way_id', authenticate, authorize(['driver', 'admin']), async (req, res, next) => {
  try {
    const { way_id } = req.params;
    const result = req.user.role === 'admin'
      ? await query(`DELETE FROM impassable_reports WHERE way_id=$1 RETURNING way_id`, [way_id])
      : await query(
          `DELETE FROM impassable_reports WHERE way_id=$1 AND reported_by=$2 RETURNING way_id`,
          [way_id, req.user.userId]
        );
    if (result.rowCount === 0) throw new AppError(404, 'Reporte no encontrado o sin permiso');
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

// ── PUT /preference/:way_id ───────────────────────────────────────────────────
router.put('/preference/:way_id', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const { way_id }     = req.params;
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

// ── DELETE /preference/:way_id ────────────────────────────────────────────────
router.delete('/preference/:way_id', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const { way_id } = req.params;
    await query(`DELETE FROM road_preferences WHERE driver_id=$1 AND way_id=$2`, [req.user.userId, way_id]);
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

export default router;
