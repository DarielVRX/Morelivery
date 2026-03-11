// backend/modules/drivers/routes.js
import { Router } from 'express';
import { query } from '../../config/db.js';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { acceptOffer, rejectOffer, releaseOrder, offerNextDrivers, getQueuedOrders, serializedOffer } from '../orders/assignment/index.js';
import { sseHub } from '../events/hub.js';
import { offerCb } from '../events/offerCallback.js';
import { AppError } from '../../utils/errors.js';

const router = Router();

function isMissingColumnError(e)   { return e?.code === '42703'; }
function isMissingRelationError(e) { return e?.code === '42P01'; }

// POST /drivers/listener — mantenido por compatibilidad con clientes viejos,
// pero ya no es necesario. El sistema es push puro desde el servidor.
router.post('/listener', authenticate, authorize(['driver']), async (_req, res) => {
  return res.json({ ok: true, deprecated: true });
});

/* ── PATCH /drivers/availability ────────────────────────────────────────────── */
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
      // Push: buscar todos los pedidos abiertos sin driver y disparar assignment.
      // serializedOffer es idempotente — si ya tiene cadena activa la ignora.
      try {
        const openOrders = await getQueuedOrders();
        for (const ord of openOrders) {
          serializedOffer(ord.id, offerNextDrivers, offerCb);
        }
        console.log(`[availability] driver=${driverId.slice(0,8)} disponible → ${openOrders.length} pedido(s) abierto(s) encolados`);
      } catch (e) {
        console.error('[availability] error encolando pedidos:', e.message);
      }
    }

    return res.json({ profile: result.rows[0] });
  } catch (error) { return next(error); }
});


/* ── GET /drivers/me ───────────────────────────────────────────────────────── */
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

/* ── GET /drivers/offers ── ofertas pendientes del driver ───────────────────── */
router.get('/offers', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    let result;
    try {
      result = await query(
        `SELECT o.id, o.total_cents, o.service_fee_cents, o.delivery_fee_cents,
                o.tip_cents, o.payment_method, o.status,
                r.name AS restaurant_name, r.address AS restaurant_address,
                r.lat AS restaurant_lat, r.lng AS restaurant_lng,
                COALESCE(o.delivery_address, c.address) AS customer_address,
                COALESCE(o.delivery_lat, c.lat) AS customer_lat,
                COALESCE(o.delivery_lng, c.lng) AS customer_lng,
                GREATEST(0, EXTRACT(EPOCH FROM (od.updated_at + (60::int * INTERVAL '1 second') - NOW())))::int AS seconds_left
         FROM order_driver_offers od
         JOIN orders o ON o.id = od.order_id
         JOIN restaurants r ON r.id = o.restaurant_id
         JOIN users c       ON c.id = o.customer_id
         WHERE od.driver_id=$1 AND od.status='pending' AND o.driver_id IS NULL
         ORDER BY od.created_at ASC`,
        [req.user.userId]
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
    const offers = result.rows.map(r => ({ ...r, seconds_left: Number(r.seconds_left ?? 60), items: itemsByOrder.get(r.id) || [] }));
    return res.json({ offers });
  } catch (error) { return next(error); }
});

/* ── POST /drivers/offers/:orderId/accept ───────────────────────────────────── */
router.post('/offers/:orderId/accept', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const offer = await query(
      `SELECT 1 FROM order_driver_offers WHERE order_id=$1 AND driver_id=$2 AND status='pending'`,
      [req.params.orderId, req.user.userId]
    );
    if (offer.rowCount === 0) return next(new AppError(404, 'Oferta no encontrada o ya tomada por otro driver'));

    // Obtener competidores ANTES de aceptar (expireCompetingOffers los marca expired)
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
    // Notificar a drivers competidores que su oferta fue cancelada
    for (const { driver_id } of competitors.rows) {
      sseHub.sendToUser(driver_id, 'offer_cancelled', { orderId: req.params.orderId });
    }
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

/* ── POST /drivers/orders/:orderId/claim — aceptar pedido sin oferta previa ── */
// Usado desde "En espera": crea la oferta y la acepta en un paso si el pedido sigue libre
router.post('/orders/:orderId/claim', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const driverId = req.user.userId;
    const orderId  = req.params.orderId;

    // 1. Verificar que el pedido existe y sigue sin driver.
    // Nota de negocio: desde "En espera" el driver PUEDE aceptar aunque tenga
    // cooldown pendiente para ese pedido; el cooldown solo limita re-ofertas push.
    const orderCheck = await query(
      `SELECT o.id FROM orders o
       WHERE o.id=$1 AND o.driver_id IS NULL
         AND o.status IN ('created','pending_driver')`,
      [orderId]
    );
    if (orderCheck.rowCount === 0) return next(new AppError(409, 'Pedido no disponible'));

    // 2. Verificar que el driver tiene espacio (< MAX_ACTIVE_ORDERS)
    const MAX_ACTIVE = 4;
    const activeCount = await query(
      `SELECT COUNT(*)::int AS n FROM orders
       WHERE driver_id=$1 AND status IN ('assigned','accepted','preparing','ready','on_the_way')`,
      [driverId]
    );
    if ((activeCount.rows[0]?.n || 0) >= MAX_ACTIVE) return next(new AppError(409, 'No tienes espacio para más pedidos'));

    // 3. Crear oferta y aceptar atómicamente
    await query(
      `INSERT INTO order_driver_offers (order_id, driver_id, status, created_at, updated_at)
       VALUES ($1, $2, 'pending', NOW(), NOW())
       ON CONFLICT (order_id, driver_id) DO UPDATE
       SET status='pending', updated_at=NOW()`,
      [orderId, driverId]
    );
    const assigned = await acceptOffer(orderId, driverId);

    if (!assigned) return next(new AppError(409, 'El pedido ya fue tomado por otro driver'));

    // 4. Notificar vía SSE
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

/* ── POST /drivers/offers/:orderId/reject ───────────────────────────────────── */
router.post('/offers/:orderId/reject', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    await rejectOffer(req.params.orderId, req.user.userId, offerCb);
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

/* ── POST /drivers/orders/:orderId/release ──────────────────────────────────── */
router.post('/orders/:orderId/release', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const { note } = req.body || {};
    const { orderId } = req.params;
    const driverId = req.user.userId;
    if (note) {
      try { await query(`UPDATE orders SET driver_note=$1, updated_at=NOW() WHERE id=$2 AND driver_id=$3`, [note, orderId, driverId]); }
      catch (_) {}
    }
    await releaseOrder(orderId, driverId, offerCb);
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

/* ── PATCH /drivers/location ────────────────────────────────────────────────── */
router.patch('/location', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const { lat, lng } = req.body || {};
    if (typeof lat !== 'number' || typeof lng !== 'number')
      return next(new AppError(400, 'lat y lng son requeridos'));

    try { await query('UPDATE driver_profiles SET last_lat=$1, last_lng=$2 WHERE user_id=$3', [lat, lng, req.user.userId]); }
    catch (e) { if (!isMissingColumnError(e)) throw e; }

    // Notificar posición a clientes y restaurantes con pedido activo
    const activeOrders = await query(
      `SELECT o.id, o.customer_id, r.owner_user_id AS restaurant_owner_id
       FROM orders o JOIN restaurants r ON r.id=o.restaurant_id
       WHERE o.driver_id=$1 AND o.status IN ('assigned','accepted','preparing','ready','on_the_way')`,
      [req.user.userId]
    );
    for (const ord of activeOrders.rows) {
      const payload = { orderId: ord.id, driverId: req.user.userId, lat, lng };
      sseHub.sendToUser(ord.customer_id, 'driver_location', payload);
      sseHub.sendToUser(ord.restaurant_owner_id, 'driver_location', payload);
    }
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

export default router;
