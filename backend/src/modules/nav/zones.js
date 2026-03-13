import { Router } from 'express';
import { query } from '../../config/db.js';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { AppError } from '../../utils/errors.js';

const router = Router();
const VALID_TYPES = ['traffic', 'construction', 'accident', 'flood', 'blocked', 'other'];

// POST / — crear zona (visible para TODOS los conductores)
router.post('/', authenticate, authorize(['driver', 'admin']), async (req, res, next) => {
  try {
    const { lat, lng, radius_m, type, estimated_hours } = req.body || {};
    if (lat == null || lng == null || radius_m == null || type == null || estimated_hours == null)
      throw new AppError(400, 'lat, lng, radius_m, type y estimated_hours son obligatorios');
    if (!VALID_TYPES.includes(type))
      throw new AppError(400, `type debe ser uno de: ${VALID_TYPES.join(', ')}`);
    if (Number(radius_m) < 20 || Number(radius_m) > 2000)
      throw new AppError(400, 'radius_m debe estar entre 20 y 2000');
    if (Number(estimated_hours) < 1 || Number(estimated_hours) > 72)
      throw new AppError(400, 'estimated_hours debe estar entre 1 y 72');

    // FIX 42P08: usar ::integer para evitar ambigüedad de tipo en $5
    const result = await query(
      `INSERT INTO road_zones (lat, lng, radius_m, type, estimated_hours, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, NOW() + ($5::integer * INTERVAL '1 hour'), $6)
       RETURNING *`,
      [Number(lat), Number(lng), Number(radius_m), type, Number(estimated_hours), req.user.userId]
    );
    return res.status(201).json({ zone: result.rows[0] });
  } catch (err) { return next(err); }
});

// GET /active — zonas activas con conteo de votos y edición pendiente
router.get('/active', async (_req, res, next) => {
  try {
    const result = await query(`
      SELECT
        z.*,
        COALESCE(cv.confirm_count, 0) AS confirm_count,
        COALESCE(dv.dismiss_count,  0) AS dismiss_count,
        pe.type             AS pending_type,
        pe.estimated_hours  AS pending_hours,
        pe.suggested_by     AS pending_by,
        pe.confirm_count    AS pending_confirms
      FROM road_zones z
      LEFT JOIN (
        SELECT zone_id, COUNT(*) AS confirm_count
        FROM zone_votes WHERE vote = 'confirm' GROUP BY zone_id
      ) cv ON cv.zone_id = z.id
      LEFT JOIN (
        SELECT zone_id, COUNT(*) AS dismiss_count
        FROM zone_votes WHERE vote = 'dismiss' GROUP BY zone_id
      ) dv ON dv.zone_id = z.id
      LEFT JOIN zone_pending_edits pe ON pe.zone_id = z.id
      WHERE z.expires_at > NOW() AND z.active = true
        AND COALESCE(dv.dismiss_count, 0) < 3
      ORDER BY z.created_at DESC
    `);

    const zones = result.rows.map(r => {
      const z = { ...r };
      if (r.pending_type) {
        z.pending_edit = {
          type:            r.pending_type,
          estimated_hours: r.pending_hours,
          suggested_by:    r.pending_by,
          confirm_count:   r.pending_confirms,
        };
      }
      delete z.pending_type; delete z.pending_hours;
      delete z.pending_by;   delete z.pending_confirms;
      return z;
    });

    return res.json({ zones });
  } catch (err) {
    if (err?.code === '42P01') return res.json({ zones: [] });
    return next(err);
  }
});

// GET /near — zonas activas cercanas
router.get('/near', async (req, res, next) => {
  try {
    const lat      = Number(req.query.lat);
    const lng      = Number(req.query.lng);
    const radius_m = Number(req.query.radius_m) || 500;
    if (!Number.isFinite(lat) || !Number.isFinite(lng))
      throw new AppError(400, 'lat y lng son requeridos');

    const result = await query(
      `SELECT * FROM road_zones
       WHERE expires_at > NOW() AND active = true
         AND SQRT(POW((lat-$1)*111320,2)+POW((lng-$2)*111320*COS(RADIANS($1)),2)) <= $3`,
      [lat, lng, radius_m]
    );
    return res.json({ zones: result.rows });
  } catch (err) {
    if (err?.code === '42P01') return res.json({ zones: [] });
    return next(err);
  }
});

// POST /:id/vote — votar confirm (apoya la zona) o dismiss (alerta finalizada)
// Con 3 votos dismiss de diferentes conductores → zona se desactiva
// Con 3 votos confirm → zona se "valida" (flag confirmed = true)
router.post('/:id/vote', authenticate, authorize(['driver', 'admin']), async (req, res, next) => {
  try {
    const { id }   = req.params;
    const { vote } = req.body || {};
    if (!['confirm', 'dismiss'].includes(vote))
      throw new AppError(400, 'vote debe ser confirm o dismiss');

    // Upsert voto (un conductor, un voto por zona)
    await query(
      `INSERT INTO zone_votes (zone_id, driver_id, vote)
       VALUES ($1, $2, $3)
       ON CONFLICT (zone_id, driver_id)
       DO UPDATE SET vote = $3, voted_at = NOW()`,
      [id, req.user.userId, vote]
    );

    // Contar votos actualizados
    const counts = await query(
      `SELECT
         COUNT(*) FILTER (WHERE vote='confirm') AS confirms,
         COUNT(*) FILTER (WHERE vote='dismiss') AS dismisses
       FROM zone_votes WHERE zone_id = $1`,
      [id]
    );
    const { confirms, dismisses } = counts.rows[0];

    // 3+ dismiss → eliminar zona
    if (Number(dismisses) >= 3) {
      await query(`UPDATE road_zones SET active = false WHERE id = $1`, [id]);
      return res.json({ ok: true, action: 'dismissed', confirms: Number(confirms), dismisses: Number(dismisses) });
    }

    // 3+ confirm → marcar como validada
    if (Number(confirms) >= 3) {
      await query(`UPDATE road_zones SET confirmed = true WHERE id = $1`, [id]);
      return res.json({ ok: true, action: 'confirmed', confirms: Number(confirms), dismisses: Number(dismisses) });
    }

    return res.json({ ok: true, action: 'voted', confirms: Number(confirms), dismisses: Number(dismisses) });
  } catch (err) { return next(err); }
});

// POST /:id/suggest — sugerir un cambio de tipo/vigencia
// Guarda la edición pendiente; requiere confirmación de otro conductor
router.post('/:id/suggest', authenticate, authorize(['driver', 'admin']), async (req, res, next) => {
  try {
    const { id }                       = req.params;
    const { type, estimated_hours }    = req.body || {};
    if (!type && !estimated_hours)
      throw new AppError(400, 'Debes enviar type o estimated_hours');
    if (type && !VALID_TYPES.includes(type))
      throw new AppError(400, `type inválido`);

    // Upsert — solo una edición pendiente por zona
    await query(
      `INSERT INTO zone_pending_edits (zone_id, type, estimated_hours, suggested_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (zone_id)
       DO UPDATE SET type=$2, estimated_hours=$3, suggested_by=$4, confirm_count=0, created_at=NOW()`,
      [id, type || null, estimated_hours ? Number(estimated_hours) : null, req.user.userId]
    );
    return res.json({ ok: true });
  } catch (err) { return next(err); }
});

// POST /:id/suggest/confirm — confirmar la edición pendiente
// Al confirmar, se aplica el cambio a la zona
router.post('/:id/suggest/confirm', authenticate, authorize(['driver', 'admin']), async (req, res, next) => {
  try {
    const { id } = req.params;
    const edit   = await query(
      `SELECT * FROM zone_pending_edits WHERE zone_id = $1`, [id]
    );
    if (!edit.rows.length) throw new AppError(404, 'No hay edición pendiente para esta zona');

    const { type, estimated_hours, suggested_by } = edit.rows[0];
    // No puede confirmar el mismo conductor que sugirió
    if (suggested_by === req.user.userId)
      throw new AppError(403, 'No puedes confirmar tu propia sugerencia');

    // Aplicar cambio
    const updates = [];
    const vals    = [];
    let   idx     = 1;
    if (type)             { updates.push(`type = $${idx++}`);             vals.push(type); }
    if (estimated_hours)  { updates.push(`estimated_hours = $${idx++}`);  vals.push(estimated_hours);
                            updates.push(`expires_at = NOW() + ($${idx++}::integer * INTERVAL '1 hour')`); vals.push(estimated_hours); }
    if (updates.length) {
      vals.push(id);
      await query(`UPDATE road_zones SET ${updates.join(', ')} WHERE id = $${idx}`, vals);
    }

    // Borrar edición pendiente
    await query(`DELETE FROM zone_pending_edits WHERE zone_id = $1`, [id]);
    return res.json({ ok: true });
  } catch (err) { return next(err); }
});

// DELETE /:id — desactivar zona
router.delete('/:id', authenticate, authorize(['driver', 'admin']), async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = req.user.role === 'admin'
      ? await query(`UPDATE road_zones SET active=false WHERE id=$1 RETURNING id`, [id])
      : await query(`UPDATE road_zones SET active=false WHERE id=$1 AND created_by=$2 RETURNING id`,
                    [id, req.user.userId]);
    if (result.rowCount === 0) throw new AppError(404, 'Zona no encontrada o sin permiso');
    return res.json({ ok: true });
  } catch (err) { return next(err); }
});

export default router;
