// backend/src/modules/admin/route-groups/platform.js
import { Router } from 'express';
import { authenticate, authorize } from '../../../middlewares/auth.js';
import { isPaused, setPaused } from '../../platform/state.js';
import { sseHub } from '../../events/hub.js';
import { query } from '../../../config/db.js';

const router = Router();

const PAUSE_MSG = 'En este momento tenemos problemas técnicos. Por favor, intenta de nuevo en unos minutos. Disculpa las molestias.';

/* ── GET /admin/platform/status ─────────────────────────────────────────── */
router.get('/platform/status', authenticate, authorize(['admin']), (_req, res) => {
  res.json({ paused: isPaused() });
});

/* ── PATCH /admin/platform/pause ─────────────────────────────────────────── */
router.patch('/platform/pause', authenticate, authorize(['admin']), (req, res) => {
  const { paused } = req.body ?? {};
  if (typeof paused !== 'boolean')
    return res.status(400).json({ error: 'paused must be a boolean' });

  setPaused(paused);

  sseHub.sendToRole('customer', 'platform_status', {
    paused,
    message: paused ? PAUSE_MSG : null,
  });

  console.log(`[platform] paused=${paused} by admin=${req.user.userId.slice(0, 8)}`);
  return res.json({ ok: true, paused });
});

/* ── GET /admin/map-data ─────────────────────────────────────────────────── */
router.get('/map-data', authenticate, authorize(['admin']), async (_req, res, next) => {
  try {
    const driversRes = await query(
      `SELECT
         dp.user_id   AS id,
         u.full_name,
         u.alias,
         dp.is_available,
         dp.active_orders_count,
         dp.last_lat  AS lat,
         dp.last_lng  AS lng,
         dp.vehicle_type
       FROM driver_profiles dp
       JOIN users u ON u.id = dp.user_id
       WHERE dp.last_lat IS NOT NULL AND dp.last_lng IS NOT NULL
       ORDER BY dp.active_orders_count DESC, dp.is_available DESC`
    );

    const driverIds = driversRes.rows.map(d => d.id);

    let stopsByDriver = {};
    if (driverIds.length > 0) {
      const stopsRes = await query(
        `SELECT
           o.driver_id,
           o.id AS order_id,
           o.status,
           o.restaurant_lat  AS rest_lat,
           o.restaurant_lng  AS rest_lng,
           r.name            AS restaurant_name,
           o.delivery_lat    AS cust_lat,
           o.delivery_lng    AS cust_lng,
           COALESCE(cu.alias, cu.full_name) AS customer_name,
           o.delivery_address
         FROM orders o
         JOIN restaurants r ON r.id = o.restaurant_id
         JOIN users cu       ON cu.id = o.customer_id
         WHERE o.driver_id = ANY($1::uuid[])
           AND o.status IN ('assigned','accepted','preparing','ready','on_the_way')
         ORDER BY o.accepted_at ASC NULLS LAST`,
        [driverIds]
      );
      for (const row of stopsRes.rows) {
        if (!stopsByDriver[row.driver_id]) stopsByDriver[row.driver_id] = [];
        const stops = [];
        if (row.status !== 'on_the_way' && row.rest_lat && row.rest_lng) {
          stops.push({
            type: 'pickup',
            orderId: row.order_id,
            lat: Number(row.rest_lat),
            lng: Number(row.rest_lng),
            label: row.restaurant_name,
          });
        }
        if (row.cust_lat && row.cust_lng) {
          stops.push({
            type: 'delivery',
            orderId: row.order_id,
            lat: Number(row.cust_lat),
            lng: Number(row.cust_lng),
            label: row.customer_name || row.delivery_address,
          });
        }
        stopsByDriver[row.driver_id].push(...stops);
      }
    }

    const drivers = driversRes.rows.map(d => ({
      id:           d.id,
      name:         d.alias || d.full_name,
      isAvailable:  d.is_available,
      activeOrders: Number(d.active_orders_count) || 0,
      lat:          Number(d.lat),
      lng:          Number(d.lng),
      vehicleType:  d.vehicle_type,
      stops:        stopsByDriver[d.id] || [],
    }));

    return res.json({ drivers, paused: isPaused() });
  } catch (e) { return next(e); }
});

export default router;
