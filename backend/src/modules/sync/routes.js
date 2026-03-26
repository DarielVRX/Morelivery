// backend/modules/sync/routes.js
import { Router }       from 'express';
import { authenticate } from '../../middlewares/auth.js';
import { AppError }     from '../../utils/errors.js';
import { query }        from '../../config/db.js';

const router = Router();

// ── POST /api/sync/test ───────────────────────────────────────────────────────
// Endpoint de prueba para verificar que el SW puede reenviar peticiones
// encoladas. No persiste nada — solo confirma que el backend recibe la llamada.
// Usado desde SystemTab → "Encolar petición de prueba".
router.post('/test', authenticate, (req, res) => {
  return res.json({ ok: true, receivedAt: new Date().toISOString() });
});

// ── POST /api/drivers/:driverId/location-batch ────────────────────────────────
// Recibe un lote de posiciones GPS acumuladas mientras el repartidor estuvo
// sin señal. El SW las encola con SYNC_LOCATION_BATCH y las envía al recuperar
// la conexión.
//
// Body: { positions: [{ lat, lng, ts }] }
// Responde 409 si driverId no corresponde al usuario autenticado (seguridad).
router.post('/drivers/:driverId/location-batch', authenticate, async (req, res, next) => {
  try {
    const { driverId } = req.params;
    const { positions } = req.body;

    if (!Array.isArray(positions) || positions.length === 0)
      return next(new AppError(400, 'positions debe ser un array no vacío'));

    // Solo el propio repartidor puede subir su ubicación
    if (req.user.userId !== driverId && req.user.role !== 'admin')
      return next(new AppError(403, 'No autorizado para este repartidor'));

    // Validar forma mínima de cada punto
    const valid = positions.every(p =>
      typeof p.lat === 'number' &&
      typeof p.lng === 'number' &&
      typeof p.ts  === 'number'
    );
    if (!valid)
      return next(new AppError(400, 'Cada posición debe tener lat, lng y ts numéricos'));

    // Ordenar por timestamp antes de insertar
    const sorted = [...positions].sort((a, b) => a.ts - b.ts);

    // Insertar ignorando duplicados (mismo driver + mismo ts)
    let stored = 0;
    for (const pos of sorted) {
      const result = await query(
        `INSERT INTO driver_locations (driver_id, lat, lng, recorded_at)
         VALUES ($1, $2, $3, to_timestamp($4 / 1000.0))
         ON CONFLICT (driver_id, recorded_at) DO NOTHING`,
        [driverId, pos.lat, pos.lng, pos.ts]
      );
      stored += result.rowCount ?? 0;
    }

    return res.json({ ok: true, received: positions.length, stored });
  } catch (err) { return next(err); }
});

// ── POST /api/drivers/:driverId/battery-alert ─────────────────────────────────
// El frontend llama esto cuando la batería baja del umbral configurado (15%).
// Emite un evento SSE al dispatcher para que lo vea antes de asignar un
// pedido largo. Solo se almacena en memoria — no necesita tabla.
//
// Body: { level: 14, charging: false }
router.post('/drivers/:driverId/battery-alert', authenticate, async (req, res, next) => {
  try {
    const { driverId } = req.params;
    const { level, charging } = req.body;

    if (typeof level !== 'number' || level < 0 || level > 100)
      return next(new AppError(400, 'level debe ser un número entre 0 y 100'));

    if (req.user.userId !== driverId && req.user.role !== 'admin')
      return next(new AppError(403, 'No autorizado para este repartidor'));

    // Emitir evento SSE a todos los clientes admin/dispatcher conectados.
    // req.sseClients es el Map que ya usa el módulo de events — ajusta el nombre
    // si tu implementación lo expone diferente (ej. req.app.locals.sseClients).
    const sseClients = req.app.locals.sseClients;
    if (sseClients) {
      const event = JSON.stringify({
        type:      'DRIVER_LOW_BATTERY',
        driverId,
        level,
        charging:  !!charging,
        timestamp: Date.now(),
      });
      for (const [, client] of sseClients) {
        if (['admin', 'dispatcher'].includes(client.role)) {
          client.res.write(`data: ${event}\n\n`);
        }
      }
    }

    return res.json({ ok: true });
  } catch (err) { return next(err); }
});

export default router;
