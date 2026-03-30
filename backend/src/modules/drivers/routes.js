// backend/modules/drivers/routes.js
// CORRECCIONES aplicadas:
//   1. etaAlertedAt / arrivedAlertedAt — limpieza periódica para evitar memory leak
//      y alertas duplicadas tras cold start (ahora se resetean entradas viejas).
//   2. notify-call — ya usa sseHub importado estáticamente (sin dynamic import). ✓
//   3. authenticate ya está aplicado en todos los endpoints del router. ✓

import { Router } from 'express';
import { query } from '../../config/db.js';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { acceptOffer, rejectOffer, releaseOrder, offerNextDrivers, getQueuedOrders, serializedOffer, requestRebalance } from '../orders/assignment/index.js';
import { sseHub } from '../events/hub.js';
import { offerCb } from '../events/offerCallback.js';
import { AppError } from '../../utils/errors.js';
import { getParam }       from '../../engine/params.js';
import { sendPushToUser } from '../notifications/pushSubscription.js';

const router = Router();
const ETA_ALERT_COOLDOWN_MS     = 5 * 60 * 1000; // 5 min entre alertas ETA
const ARRIVED_ALERT_COOLDOWN_MS = 2 * 60 * 1000; // 2 min entre alertas arrived

// FIX: mapas con timestamp de inserción para poder limpiarlos periódicamente.
// Antes se reiniciaban con cada cold start → alertas duplicadas al volver.
// Ahora se limpian entradas con más de 30 min de antigüedad cada 10 minutos.
const etaAlertedAt     = new Map(); // orderId → ts
const arrivedAlertedAt = new Map(); // key → ts

const MAP_TTL_MS = 30 * 60 * 1000; // 30 min
setInterval(() => {
  const cutoff = Date.now() - MAP_TTL_MS;
  for (const [k, v] of etaAlertedAt)     if (v < cutoff) etaAlertedAt.delete(k);
  for (const [k, v] of arrivedAlertedAt) if (v < cutoff) arrivedAlertedAt.delete(k);
}, 10 * 60 * 1000).unref();

function isMissingColumnError(e)   { return e?.code === '42703'; }
function isMissingRelationError(e) { return e?.code === '42P01'; }
function haversineM(lat1, lng1, lat2, lng2) {
  const R    = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2
  + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// POST /drivers/listener — deprecated
router.post('/listener', authenticate, authorize(['driver']), async (_req, res) => {
  return res.json({ ok: true, deprecated: true });
});

/* ── PATCH /drivers/availability ─────────────────────────────────────────── */
router.patch('/availability', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const { isAvailable } = req.body;
    const driverId = req.user.userId;
    const result = await query(
      'UPDATE driver_profiles SET is_available=$1 WHERE user_id=$2 RETURNING *',
      [Boolean(isAvailable), driverId]
    );
    if (result.rowCount === 0) return next(new AppError(404, 'Perfil de driver no encontrado'));

    if (isAvailable) {
      try {
        await query(
          `UPDATE driver_profiles
           SET session_rebalances = 0, session_releases = 0,
               session_cancels = 0,   session_expires = 0,
               session_started_at = NOW()
           WHERE user_id = $1`,
          [driverId]
        );
      } catch (_) {}

      try {
        await query(
          `UPDATE orders SET reconnect_deadline = NULL, updated_at = NOW()
           WHERE driver_id = $1 AND status = 'on_the_way' AND reconnect_deadline IS NOT NULL`,
          [driverId]
        );
      } catch (_) {}

      try {
        const openOrders = await getQueuedOrders();
        for (const ord of openOrders) {
          serializedOffer(ord.id, offerNextDrivers, offerCb);
        }
        console.log(`[availability] driver=${driverId.slice(0,8)} disponible → ${openOrders.length} pedido(s) encolados`);
      } catch (e) {
        console.error('[availability] error encolando pedidos:', e.message);
      }
    }

    return res.json({ profile: result.rows[0] });
  } catch (error) { return next(error); }
});

/* ── GET /drivers/me/bag-capacity ────────────────────────────────────────── */
router.get('/me/bag-capacity', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const result = await query(
      `SELECT bag_capacity_liters FROM driver_profiles WHERE user_id = $1`,
      [req.user.userId]
    );
    if (result.rowCount === 0) return next(new AppError(404, 'Perfil de driver no encontrado'));
    return res.json({ bag_capacity_liters: Number(result.rows[0].bag_capacity_liters) });
  } catch (error) { return next(error); }
});

/* ── PATCH /drivers/me/bag-capacity ─────────────────────────────────────── */
router.patch('/me/bag-capacity', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const { bag_capacity_liters } = req.body || {};
    const val = Number(bag_capacity_liters);
    if (!Number.isFinite(val) || val < 1 || val > 200)
      return next(new AppError(400, 'bag_capacity_liters debe ser un número entre 1 y 200'));
    const result = await query(
      `UPDATE driver_profiles SET bag_capacity_liters = $1 WHERE user_id = $2
       RETURNING bag_capacity_liters`,
      [val, req.user.userId]
    );
    if (result.rowCount === 0) return next(new AppError(404, 'Perfil de driver no encontrado'));
    return res.json({ ok: true, bag_capacity_liters: Number(result.rows[0].bag_capacity_liters) });
  } catch (error) { return next(error); }
});

/* ── GET /drivers/me ─────────────────────────────────────────────────────── */
router.get('/me', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const r = await query(
      'SELECT user_id, is_available, vehicle_type, is_verified, driver_number FROM driver_profiles WHERE user_id=$1 LIMIT 1',
      [req.user.userId]
    );
    if (r.rowCount === 0) return next(new AppError(404, 'Perfil de driver no encontrado'));
    return res.json({ profile: r.rows[0] });
  } catch (error) { return next(error); }
});

/* ── GET /drivers/offers ─────────────────────────────────────────────────── */
router.get('/offers', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    let result;
    try {
      result = await query(
        `SELECT od.order_id AS id,
                o.status,
                o.total_cents,
                o.delivery_address,
                o.payment_method,
                r.name   AS restaurant_name,
                r.address AS restaurant_address,
                r.lat    AS restaurant_lat,
                r.lng    AS restaurant_lng,
                ru.full_name AS restaurant_owner_name,
                COALESCE(o.delivery_lat, c.lat) AS customer_lat,
                COALESCE(o.delivery_lng, c.lng) AS customer_lng,
                GREATEST(0, EXTRACT(EPOCH FROM (od.updated_at + ($2::int * INTERVAL '1 second') - NOW())))::int AS seconds_left
         FROM order_driver_offers od
         JOIN orders o ON o.id = od.order_id
         JOIN restaurants r ON r.id = o.restaurant_id
         LEFT JOIN users ru ON ru.id = r.owner_user_id
         JOIN users c ON c.id = o.customer_id
         WHERE od.driver_id=$1 AND od.status='pending' AND o.driver_id IS NULL
         ORDER BY od.created_at ASC`,
        [req.user.userId, getParam('offer_timeout_s', 60)]
      );
    } catch (e) {
      if (!isMissingColumnError(e) && !isMissingRelationError(e)) throw e;
      result = { rows: [] };
    }

    const orderIds = result.rows.map(r => r.id);
    let itemsByOrder = new Map();
    if (orderIds.length > 0) {
      try {
        const items = await query(
          `SELECT oi.order_id, oi.menu_item_id, oi.quantity,
                  COALESCE(mi.name,'Producto') AS name
           FROM order_items oi LEFT JOIN menu_items mi ON mi.id=oi.menu_item_id
           WHERE oi.order_id=ANY($1::uuid[])`,
          [orderIds]
        );
        for (const row of items.rows) {
          if (!itemsByOrder.has(row.order_id)) itemsByOrder.set(row.order_id, []);
          itemsByOrder.get(row.order_id).push({ menuItemId: row.menu_item_id, name: row.name, quantity: row.quantity });
        }
      } catch (_) {}
    }
    const offers = result.rows.map(r => ({
      ...r,
      seconds_left: Number(r.seconds_left ?? 60),
      items: itemsByOrder.get(r.id) || [],
    }));
    return res.json({ offers });
  } catch (error) { return next(error); }
});

/* ── POST /drivers/offers/:orderId/accept ────────────────────────────────── */
router.post('/offers/:orderId/accept', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const offer = await query(
      `SELECT 1 FROM order_driver_offers WHERE order_id=$1 AND driver_id=$2 AND status='pending'`,
      [req.params.orderId, req.user.userId]
    );
    if (offer.rowCount === 0) return next(new AppError(404, 'Oferta no encontrada o ya tomada por otro driver'));

    const competitors = await query(
      `SELECT driver_id FROM order_driver_offers
       WHERE order_id=$1 AND driver_id<>$2 AND status='pending'`,
      [req.params.orderId, req.user.userId]
    );

    const assigned = await acceptOffer(req.params.orderId, req.user.userId);
    if (!assigned) return next(new AppError(409, 'El pedido ya fue tomado por otro driver'));

    const orderInfo = await query(
      `SELECT o.customer_id, r.owner_user_id AS restaurant_owner_id
       FROM orders o JOIN restaurants r ON r.id=o.restaurant_id WHERE o.id=$1`,
      [req.params.orderId]
    );
    if (orderInfo.rowCount > 0) {
      const ord = orderInfo.rows[0];
      const payload = { orderId: req.params.orderId, status:'assigned', driverId: req.user.userId };
      sseHub.sendToUser(ord.customer_id, 'order_update', payload);
      sseHub.sendToUser(ord.restaurant_owner_id, 'order_update', payload);
      sseHub.sendToRole('admin', 'order_update', payload);
    }
    for (const { driver_id } of competitors.rows) {
      sseHub.sendToUser(driver_id, 'offer_cancelled', { orderId: req.params.orderId });
    }
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

/* ── POST /drivers/orders/:orderId/claim ─────────────────────────────────── */
router.post('/orders/:orderId/claim', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const driverId = req.user.userId;
    const orderId  = req.params.orderId;

    const orderCheck = await query(
      `SELECT o.id FROM orders o WHERE o.id=$1 AND o.driver_id IS NULL AND o.status IN ('created','pending_driver')`,
      [orderId]
    );
    if (orderCheck.rowCount === 0) return next(new AppError(409, 'Pedido no disponible'));

    const MAX_ACTIVE = 4;
    const activeCount = await query(
      `SELECT COUNT(*)::int AS n FROM orders
       WHERE driver_id=$1 AND status IN ('assigned','accepted','preparing','ready','on_the_way')`,
      [driverId]
    );
    if ((activeCount.rows[0]?.n || 0) >= MAX_ACTIVE)
      return next(new AppError(409, 'No tienes espacio para más pedidos'));

    await query(
      `INSERT INTO order_driver_offers (order_id, driver_id, status, created_at, updated_at)
       VALUES ($1, $2, 'pending', NOW(), NOW())
       ON CONFLICT (order_id, driver_id) DO UPDATE SET status='pending', updated_at=NOW()`,
      [orderId, driverId]
    );
    const assigned = await acceptOffer(orderId, driverId);
    if (!assigned) return next(new AppError(409, 'El pedido ya fue tomado por otro driver'));

    try {
      const orderInfo = await query(
        `SELECT o.customer_id, r.owner_user_id AS restaurant_owner_id
         FROM orders o JOIN restaurants r ON r.id=o.restaurant_id WHERE o.id=$1`,
        [orderId]
      );
      if (orderInfo.rowCount > 0) {
        const ord = orderInfo.rows[0];
        const payload = { orderId, status:'assigned', driverId };
        sseHub.sendToUser(ord.customer_id, 'order_update', payload);
        sseHub.sendToUser(ord.restaurant_owner_id, 'order_update', payload);
        sseHub.sendToRole('admin', 'order_update', payload);
      }
    } catch (_) {}

    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

/* ── POST /drivers/offers/:orderId/reject ────────────────────────────────── */
router.post('/offers/:orderId/reject', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    await rejectOffer(req.params.orderId, req.user.userId, offerCb);
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

/* ── POST /drivers/orders/:orderId/rebalance ─────────────────────────────── */
router.post('/orders/:orderId/rebalance', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const driverId    = req.user.userId;
    const result = await requestRebalance(orderId, driverId);
    if (!result.ok) return next(new AppError(409, result.reason));
    sseHub.sendToUser(driverId, 'order_update', {
      orderId, status: 'disputed', isDisputed: true,
      message: 'Tu pedido está en disputa. Si nadie lo toma, sigue en tu ruta.',
    });
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

/* ── POST /drivers/orders/:orderId/cancel-dispute ────────────────────────── */
router.post('/orders/:orderId/cancel-dispute', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const driverId    = req.user.userId;
    const r = await query(
      `UPDATE orders
       SET is_disputed = false, disputed_until = NULL, disputed_by = NULL, updated_at = NOW()
       WHERE id = $1 AND driver_id = $2 AND is_disputed = true
       RETURNING id`,
      [orderId, driverId]
    );
    if (r.rowCount === 0) return next(new AppError(404, 'Pedido no encontrado o no está en disputa'));
    sseHub.sendToUser(driverId, 'order_update', {
      orderId, isDisputed: false,
      message: 'Disputa cancelada. El pedido sigue en tu ruta.',
    });
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

/* ── POST /drivers/orders/:orderId/release ───────────────────────────────── */
router.post('/orders/:orderId/release', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const { note }    = req.body || {};
    const { orderId } = req.params;
    const driverId    = req.user.userId;
    if (note) {
      try {
        await query(
          `UPDATE orders SET driver_note=$1, updated_at=NOW() WHERE id=$2 AND driver_id=$3`,
          [note, orderId, driverId]
        );
      } catch (_) {}
    }
    await releaseOrder(orderId, driverId, offerCb);
    try {
      await query(
        `UPDATE driver_profiles
         SET session_releases = session_releases + 1, total_releases = total_releases + 1
         WHERE user_id = $1`,
        [driverId]
      );
    } catch (_) {}
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

/* ── PATCH /drivers/location ─────────────────────────────────────────────── */
router.patch('/location', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const { lat, lng } = req.body || {};
    if (typeof lat !== 'number' || typeof lng !== 'number')
      return next(new AppError(400, 'lat y lng son requeridos'));

    try {
      await query('UPDATE driver_profiles SET last_lat=$1, last_lng=$2 WHERE user_id=$3',
                  [lat, lng, req.user.userId]);
    } catch (e) { if (!isMissingColumnError(e)) throw e; }

    const activeOrders = await query(
      `SELECT o.id, o.status, o.customer_id,
      o.restaurant_lat, o.restaurant_lng,
      o.delivery_lat, o.delivery_lng,
      r.owner_user_id AS restaurant_owner_id,
      COALESCE(cu.alias, cu.full_name) AS customer_name
      FROM orders o
      JOIN restaurants r ON r.id = o.restaurant_id
      JOIN users cu ON cu.id = o.customer_id
      WHERE o.driver_id = $1
      AND o.status IN ('assigned','accepted','preparing','ready','on_the_way')`,
      [req.user.userId]
    );

    const now = Date.now();

    for (const ord of activeOrders.rows) {
      const payload = { orderId: ord.id, driverId: req.user.userId, lat, lng };
      sseHub.sendToUser(ord.customer_id,          'driver_location', payload);
      sseHub.sendToUser(ord.restaurant_owner_id,  'driver_location', payload);

      const isOTW = ord.status === 'on_the_way';
      const stopLat = isOTW ? Number(ord.delivery_lat)    : Number(ord.restaurant_lat);
      const stopLng = isOTW ? Number(ord.delivery_lng)    : Number(ord.restaurant_lng);

      if (!Number.isFinite(stopLat) || !Number.isFinite(stopLng)) continue;

      const distM = haversineM(lat, lng, stopLat, stopLng);
      const etaSecs  = Math.round(distM / 6.94);
      const etaMins  = Math.round(etaSecs / 60);

      const lastEta = etaAlertedAt.get(ord.id) || 0;
      if (etaMins <= 5 && (now - lastEta) > ETA_ALERT_COOLDOWN_MS) {
        etaAlertedAt.set(ord.id, now);
        const etaPayload = { orderId: ord.id, etaMins, distM: Math.round(distM), target: isOTW ? 'delivery' : 'pickup' };
        if (isOTW) {
          const etaMsg = `Tu conductor llegará en aproximadamente ${etaMins} minuto${etaMins !== 1 ? 's' : ''}`;
          sseHub.sendToUser(ord.customer_id, 'driver_eta_alert', { ...etaPayload, message: etaMsg });
          sendPushToUser(ord.customer_id, {
            title: 'Tu pedido está por llegar',
            body:  etaMsg,
            tag:   `eta_${ord.id}`, group: 'customer', priority: 'normal',
            url:   '/customer', pushType: 'driver_eta_alert', orderId: ord.id,
          }).catch(() => {});
        } else {
          const etaMsg = `El conductor llegará en aproximadamente ${etaMins} minuto${etaMins !== 1 ? 's' : ''}`;
          sseHub.sendToUser(ord.restaurant_owner_id, 'driver_eta_alert', { ...etaPayload, message: etaMsg });
          sendPushToUser(ord.restaurant_owner_id, {
            title: 'El conductor está por llegar',
            body:  etaMsg,
            tag:   `eta_${ord.id}`, group: 'restaurant', priority: 'normal',
            url:   '/restaurant', pushType: 'driver_eta_alert', orderId: ord.id,
          }).catch(() => {});
        }
      }

      const arrivedKey = `${ord.id}_${isOTW ? 'delivery' : 'pickup'}`;
      const lastArrived = arrivedAlertedAt.get(arrivedKey) || 0;
      if (distM <= 200 && (now - lastArrived) > ARRIVED_ALERT_COOLDOWN_MS) {
        arrivedAlertedAt.set(arrivedKey, now);
        const arrivedPayload = { orderId: ord.id, distM: Math.round(distM), target: isOTW ? 'delivery' : 'pickup' };
        if (isOTW) {
          sseHub.sendToUser(ord.customer_id, 'driver_arrived', { ...arrivedPayload, message: 'Tu conductor ha llegado' });
          sendPushToUser(ord.customer_id, {
            title: 'Tu conductor ha llegado',
            body:  'El repartidor está esperando en tu puerta',
            tag:   `arrived_${ord.id}`, group: 'customer', priority: 'high',
            url:   '/customer', pushType: 'driver_arrived', orderId: ord.id,
          }).catch(() => {});
        } else {
          sseHub.sendToUser(ord.restaurant_owner_id, 'driver_arrived', { ...arrivedPayload, message: 'El conductor ha llegado a recoger el pedido' });
          sendPushToUser(ord.restaurant_owner_id, {
            title: 'El conductor ha llegado',
            body:  'El repartidor está en el restaurante para recoger el pedido',
            tag:   `arrived_pickup_${ord.id}`, group: 'restaurant', priority: 'high',
            url:   '/restaurant', pushType: 'driver_arrived', orderId: ord.id,
          }).catch(() => {});
        }
      }
    }

    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

/* ── GET /drivers/earnings ───────────────────────────────────────────────── */
router.get('/earnings', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const days   = Math.min(Number(req.query.days)   || 30, 365);
    const limit  = Math.min(Number(req.query.limit)  || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const rows = await query(
      `SELECT o.id, o.total_cents, o.delivery_fee_cents, o.service_fee_cents,
              o.tip_cents, o.delivered_tip_cents, o.payment_method,
              o.delivered_at, o.created_at,
              r.name AS restaurant_name,
              COALESCE(c.alias, c.full_name) AS customer_name
       FROM orders o
       JOIN restaurants r ON r.id = o.restaurant_id
       JOIN users c ON c.id = o.customer_id
       WHERE o.driver_id = $1 AND o.status = 'delivered'
         AND o.delivered_at >= NOW() - INTERVAL '1 day' * $2
       ORDER BY o.delivered_at DESC
       LIMIT $3 OFFSET $4`,
      [req.user.userId, days, limit, offset]
    );

    const totals = await query(
      `SELECT
         COUNT(*)::int AS deliveries,
         COALESCE(SUM(o.delivery_fee_cents), 0)::int AS total_delivery_fee,
         COALESCE(SUM(ROUND(o.service_fee_cents * 0.5)), 0)::int AS total_service_share,
         COALESCE(SUM(o.tip_cents + COALESCE(o.delivered_tip_cents,0)), 0)::int AS total_tips
       FROM orders o
       WHERE o.driver_id = $1 AND o.status = 'delivered'
         AND o.delivered_at >= NOW() - INTERVAL '1 day' * $2`,
      [req.user.userId, days]
    );

    const { deliveries, total_delivery_fee, total_service_share, total_tips } = totals.rows[0];
    const totalEarnings = total_delivery_fee + total_service_share + total_tips;

    return res.json({
      orders: rows.rows.map(r => ({
        ...r,
        delivery_fee_cents:  Number(r.delivery_fee_cents  || 0),
        service_fee_cents:   Number(r.service_fee_cents   || 0),
        tip_cents:           Number(r.tip_cents           || 0),
        delivered_tip_cents: Number(r.delivered_tip_cents || 0),
      })),
      summary: { deliveries, total_earnings: totalEarnings, total_tips, days },
      limit, offset,
    });
  } catch (error) { return next(error); }
});

// FIX: sseHub ya se importa estáticamente al inicio del archivo.
// No se necesita dynamic import aquí — se usa directamente la referencia estática.
router.post('/orders/:orderId/notify-call', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const { target } = req.body || {}; // 'customer' | 'restaurant'
    if (!['customer', 'restaurant'].includes(target))
      return next(new AppError(400, 'target debe ser customer o restaurant'));

    const { orderId } = req.params;
    const driverId    = req.user.userId; // FIX: req.user.userId disponible porque authenticate está aplicado ✓

    const orderRow = await query(
      `SELECT o.customer_id, r.owner_user_id AS restaurant_owner_id,
      d.full_name AS driver_name
      FROM orders o
      JOIN restaurants r ON r.id = o.restaurant_id
      JOIN users d ON d.id = o.driver_id
      WHERE o.id = $1 AND o.driver_id = $2
      AND o.status NOT IN ('delivered','cancelled')`,
      [orderId, driverId]
    );

    if (orderRow.rowCount === 0)
      return next(new AppError(404, 'Pedido no encontrado o no asignado a ti'));

    const ord        = orderRow.rows[0];
    const targetId   = target === 'customer' ? ord.customer_id : ord.restaurant_owner_id;
    const driverName = ord.driver_name || 'El repartidor';

    // FIX: usa sseHub importado estáticamente — sin await import(...)
    sseHub.sendToUser(targetId, 'simulated_call', {
      orderId,
      driverId,
      driverName,
      message: `${driverName} está intentando localizarte`,
    });
    sendPushToUser(targetId, {
      title: '📞 Llamada del repartidor',
      body: `${driverName} está intentando localizarte`,
      tag: `call_${orderId}`,
      group: target,
      priority: 'high',
      url: target === 'customer' ? '/customer/pedidos' : '/restaurant/pedidos',
      type: 'simulated_call',
      pushType: 'simulated_call',
      orderId,
      driverName,
      vibrate: [800, 400, 800, 400, 800],
    }).catch(() => {});

    console.log(`[driver.call] ${driverId.slice(0,8)} → ${target} order=${orderId.slice(0,8)}`);
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

export default router;
