import { Router } from 'express';
import { query } from '../../config/db.js';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { AppError } from '../../utils/errors.js';
import { sseHub } from '../events/hub.js';

const router = Router();

const VALID_PREFERENCES = ['preferred', 'difficult', 'avoid'];
const VALID_DURATIONS   = ['days', 'weeks', 'months', 'permanent'];

// ── Helpers de conteo de votos ────────────────────────────────────────────────
async function getVoteCounts(way_id) {
  const r = await query(
    `SELECT
       COUNT(*) FILTER (WHERE vote='confirm') AS confirms,
       COUNT(*) FILTER (WHERE vote='dismiss') AS dismisses
     FROM impassable_votes WHERE way_id = $1`,
    [way_id]
  );
  return {
    confirm_count: Number(r.rows[0]?.confirms  ?? 0),
    dismiss_count: Number(r.rows[0]?.dismisses ?? 0),
  };
}

// ── Query base para GET de reportes (incluye conteos de votos) ────────────────
const IMPASSABLE_SELECT = `
  SELECT ir.*,
         COALESCE(cv.confirm_count, 0)::int AS confirm_count,
         COALESCE(dv.dismiss_count, 0)::int AS dismiss_count
  FROM impassable_reports ir
  LEFT JOIN (
    SELECT way_id, COUNT(*) AS confirm_count
    FROM impassable_votes WHERE vote = 'confirm' GROUP BY way_id
  ) cv ON cv.way_id = ir.way_id
  LEFT JOIN (
    SELECT way_id, COUNT(*) AS dismiss_count
    FROM impassable_votes WHERE vote = 'dismiss' GROUP BY way_id
  ) dv ON dv.way_id = ir.way_id
`;

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

    const primary     = rawWays[0];
    const allWayIds   = rawWays.map(w => w.way_id);
    const groupName   = rawWays.find(w => w.name && w.name !== w.way_id)?.name || primary.name || null;
    const groupCoords = primary.coords;

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
          primary.way_id, primary.lat, primary.lng,
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
    }

    return res.status(201).json({ ok: true, report: savedReport });
  } catch (error) { return next(error); }
});

// ── POST /impassable/:way_id/vote ─────────────────────────────────────────────
// confirm × 3 → confirmed = true (se usa en rutas)
// dismiss × 3 → eliminar reporte
// Un voto por driver, puede cambiar (upsert)
// El reporter no puede votar su propio reporte
router.post('/impassable/:way_id/vote', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const { way_id } = req.params;
    const { vote }   = req.body || {};

    if (!['confirm', 'dismiss'].includes(vote))
      throw new AppError(400, 'vote debe ser confirm o dismiss');

    // Verificar que el reporte existe
    const reportRes = await query(
      `SELECT id, reported_by FROM impassable_reports WHERE way_id = $1 LIMIT 1`,
      [way_id]
    );
    if (reportRes.rowCount === 0) throw new AppError(404, 'Reporte no encontrado');

    // El reporter no puede votar su propio reporte
    if (reportRes.rows[0].reported_by === req.user.userId)
      throw new AppError(403, 'No puedes votar tu propio reporte');

    // Upsert voto
    await query(
      `INSERT INTO impassable_votes (way_id, driver_id, vote)
       VALUES ($1, $2, $3)
       ON CONFLICT (way_id, driver_id)
       DO UPDATE SET vote = $3, voted_at = NOW()`,
      [way_id, req.user.userId, vote]
    );

    // Contar votos
    const counts = await query(
      `SELECT
         COUNT(*) FILTER (WHERE vote='confirm') AS confirms,
         COUNT(*) FILTER (WHERE vote='dismiss') AS dismisses
       FROM impassable_votes WHERE way_id = $1`,
      [way_id]
    );
    const confirms  = Number(counts.rows[0]?.confirms  ?? 0);
    const dismisses = Number(counts.rows[0]?.dismisses ?? 0);

    // 3+ dismiss → eliminar reporte
    if (dismisses >= 3) {
      await query(`DELETE FROM impassable_reports WHERE way_id = $1`, [way_id]);
      try { sseHub.sendToRole('driver', 'impassable_dismissed', { way_id }); } catch (_) {}
      return res.json({ ok: true, action: 'dismissed', confirms, dismisses });
    }

    // 3+ confirm → marcar como confirmado (se usa en rutas)
    if (confirms >= 3) {
      await query(
        `UPDATE impassable_reports SET confirmed = true WHERE way_id = $1`,
        [way_id]
      );
      try { sseHub.sendToRole('driver', 'impassable_confirmed', { way_id }); } catch (_) {}
      return res.json({ ok: true, action: 'confirmed', confirms, dismisses });
    }

    return res.json({ ok: true, action: 'voted', confirms, dismisses });
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
    if (estimated_duration) { params.push(estimated_duration); setParts.push(`estimated_duration = $${params.length}`); }
    if (description !== undefined) { params.push(description || null); setParts.push(`description = $${params.length}`); }
    if (!setParts.length) throw new AppError(400, 'Nada que actualizar');

    params.push(way_id, req.user.userId);
    const result = await query(
      `UPDATE impassable_reports
       SET ${setParts.join(', ')}
       WHERE way_id      = $${params.length - 1}
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
      `${IMPASSABLE_SELECT}
       WHERE ir.reported_by = $1
       ORDER BY ir.created_at DESC`,
      [req.user.userId]
    );
    return res.json({ reports: result.rows });
  } catch (error) {
    if (error?.code === '42P01') return res.json({ reports: [] });
    return next(error);
  }
});

// ── GET /impassable ───────────────────────────────────────────────────────────
router.get('/impassable', async (req, res, next) => {
  try {
    const filter = req.query.confirmed;
    const where  = filter === 'true'  ? 'WHERE ir.confirmed = true'
                 : filter === 'false' ? 'WHERE ir.confirmed = false' : '';
    const result = await query(`${IMPASSABLE_SELECT} ${where} ORDER BY ir.created_at DESC`);
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
      `${IMPASSABLE_SELECT}
       WHERE SQRT(POW((ir.lat - $1) * 111320, 2) + POW((ir.lng - $2) * 111320 * COS(RADIANS($1)), 2)) <= $3
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
