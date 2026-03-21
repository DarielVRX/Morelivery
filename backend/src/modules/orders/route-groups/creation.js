import { authenticate, authorize } from '../../../middlewares/auth.js';
import { validate } from '../../../middlewares/validate.js';
import { DELIVERY_FEE_PCT, RESTAURANT_FEE_PCT, SERVICE_FEE_PCT, isMissingColumnError, isMissingRelationError } from '../shared.js';

export function registerCreationRoutes(router, deps) {
  const {
    query,
    AppError,
    serializedOffer,
    offerNextDrivers,
    getPendingAssignmentOrders,
    initKitchenTiming,
    orderEvents,
    sseHub,
    logEvent,
    createOrderSchema,
  } = deps;

  router.get('/pending-assignment', authenticate, authorize(['driver']), async (req, res, next) => {
    try {
      const orders = await getPendingAssignmentOrders(req.user.userId);
      return res.json({ orders });
    } catch (error) { return next(error); }
  });

  router.post('/', authenticate, authorize(['customer']), validate(createOrderSchema), async (req, res, next) => {
    const { restaurantId, items, payment_method, tip_cents, delivery_lat, delivery_lng, delivery_address } = req.validatedBody;
    console.log(`📦 [pedido.nuevo] cliente=${req.user?.userId?.slice(0,8)} pago=${payment_method} propina=${tip_cents} productos=${items?.length}`);
    try {
      let deliveryAddress = 'address-pending';
      try {
        const c = await query('SELECT address FROM users WHERE id=$1', [req.user.userId]);
        deliveryAddress = delivery_address?.trim() || c.rows[0]?.address || 'address-pending';
      } catch (e) { if (!isMissingColumnError(e)) throw e; }
      if (!deliveryAddress || deliveryAddress === 'address-pending') return next(new AppError(400, 'Debes guardar tu dirección antes de hacer un pedido'));

      const restCoords = await query(`SELECT COALESCE(u.home_lat, r.lat) AS lat, COALESCE(u.home_lng, r.lng) AS lng
                                      FROM restaurants r
                                      LEFT JOIN users u ON u.id = r.owner_user_id
                                      WHERE r.id=$1`, [restaurantId]);
      if (restCoords.rowCount === 0) return next(new AppError(404, 'Restaurante no encontrado'));

      const restaurantLat = restCoords.rows[0]?.lat != null ? Number(restCoords.rows[0].lat) : null;
      const restaurantLng = restCoords.rows[0]?.lng != null ? Number(restCoords.rows[0].lng) : null;
      const orderDeliveryLat = Number.isFinite(Number(delivery_lat)) ? Number(delivery_lat) : null;
      const orderDeliveryLng = Number.isFinite(Number(delivery_lng)) ? Number(delivery_lng) : null;

      if (orderDeliveryLat == null || orderDeliveryLng == null) {
        return next(new AppError(400, 'Falta ubicación de entrega (lat/lng). Selecciona ubicación actual, casa o manual.'));
      }
      if (restaurantLat == null || restaurantLng == null) {
        return next(new AppError(409, 'El restaurante no tiene coordenadas configuradas.'));
      }

      const distResult = await query(
        `SELECT (
           6371 * acos(
             cos(radians($1::float8)) * cos(radians($3::float8)) *
             cos(radians($4::float8) - radians($2::float8)) +
             sin(radians($1::float8)) * sin(radians($3::float8))
           )
         ) AS km`,
        [orderDeliveryLat, orderDeliveryLng, restaurantLat, restaurantLng]
      );
      const distKm = Number(distResult.rows[0]?.km ?? Infinity);
      if (!Number.isFinite(distKm) || distKm > 5) {
        return next(new AppError(409, `Esta tienda está fuera de cobertura (${distKm.toFixed(1)} km). Máximo permitido: 5 km.`));
      }

      const menuIds = items.map(i => i.menuItemId);
      const priceRows = await query(
        `SELECT id, price_cents,
                COALESCE(pkg_units, 1)           AS pkg_units,
                COALESCE(pkg_volume_liters, 0)   AS pkg_volume_liters
         FROM menu_items WHERE id = ANY($1::uuid[]) AND restaurant_id = $2`,
        [menuIds, restaurantId]
      );
      if (priceRows.rowCount !== menuIds.length) {
        return next(new AppError(400, 'Uno o más productos no pertenecen a este restaurante'));
      }
      const priceMap = new Map(priceRows.rows.map(r => [r.id, {
        price_cents: r.price_cents,
        pkg_units: Number(r.pkg_units) || 1,
        pkg_volume_liters: Number(r.pkg_volume_liters) || 0,
      }]));

      let totalCents = 0;
      let estimatedVolumeLiters = 0;
      for (const item of items) {
        const meta = priceMap.get(item.menuItemId);
        totalCents += meta.price_cents * item.quantity;
        const packs = Math.ceil(item.quantity / meta.pkg_units);
        estimatedVolumeLiters += packs * meta.pkg_volume_liters;
      }
      estimatedVolumeLiters = Math.round(estimatedVolumeLiters * 1000) / 1000;

      const serviceFee = Math.round(totalCents * SERVICE_FEE_PCT);
      const deliveryFee = Math.round(totalCents * DELIVERY_FEE_PCT);
      const restaurantFee = Math.round(totalCents * RESTAURANT_FEE_PCT);
      const paymentMethod = payment_method || 'cash';
      const tipCents = Number(tip_cents) || 0;

      const orderResult = await query(
        `INSERT INTO orders(customer_id, restaurant_id, status, total_cents, service_fee_cents, delivery_fee_cents, restaurant_fee_cents, payment_method, tip_cents, delivery_address, delivery_lat, delivery_lng, restaurant_lat, restaurant_lng, estimated_volume_liters)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
        [req.user.userId, restaurantId, 'created', totalCents, serviceFee, deliveryFee, restaurantFee, paymentMethod || 'cash', tipCents, deliveryAddress, orderDeliveryLat, orderDeliveryLng, restaurantLat, restaurantLng, estimatedVolumeLiters]
      );
      const order = orderResult.rows[0];
      console.log(`📦 [pedido.creado] id=${order.id.slice(0,8)} total=${order.total_cents} rest=${restaurantId.slice(0,8)}`);

      const itemValues = items.map((item, i) => {
        const base = i * 4;
        return `($${base + 1},$${base + 2},$${base + 3},$${base + 4})`;
      }).join(',');
      const itemParams = items.flatMap(item => [
        order.id, item.menuItemId, item.quantity, priceMap.get(item.menuItemId).price_cents,
      ]);
      await query(
        `INSERT INTO order_items(order_id, menu_item_id, quantity, unit_price_cents) VALUES ${itemValues}`,
        itemParams
      );

      try { await serializedOffer(order.id, offerNextDrivers); } catch (e) {
        if (!isMissingRelationError(e) && !isMissingColumnError(e)) throw e;
      }

      initKitchenTiming(order.id, restaurantId).catch(() => {});

      const updated = await query('SELECT * FROM orders WHERE id=$1', [order.id]);
      orderEvents.emitOrderUpdate(order.id, updated.rows[0].status);

      try {
        const restInfo = await query('SELECT owner_user_id FROM restaurants WHERE id=$1', [restaurantId]);
        if (restInfo.rowCount > 0) sseHub.sendToUser(restInfo.rows[0].owner_user_id, 'order_update', { orderId: order.id, status: 'created', action: 'new_order' });
      } catch (_) {}

      console.log(`📦 [pedido.listo] id=${order.id.slice(0,8)} → notificando tienda y buscando driver`);
      logEvent('order.created', { orderId: order.id, customerId: req.user.userId });
      return res.status(201).json({ order: updated.rows[0] });
    } catch (error) { return next(error); }
  });
}
