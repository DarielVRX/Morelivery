// backend/src/modules/orders/route-groups/creation.js
import { authenticate, authorize } from '../../../middlewares/auth.js';
import { validate } from '../../../middlewares/validate.js';
import { DELIVERY_FEE_PCT, RESTAURANT_FEE_PCT, SERVICE_FEE_PCT, isMissingColumnError, isMissingRelationError } from '../shared.js';
import { env } from '../../../config/env.js';

export function registerCreationRoutes(router, deps) {
  const {
    query, AppError, serializedOffer, offerNextDrivers,
    getPendingAssignmentOrders, initKitchenTiming,
    orderEvents, sseHub, logEvent, createOrderSchema,
  } = deps;

  router.get('/pending-assignment', authenticate, authorize(['driver']), async (req, res, next) => {
    try {
      const orders = await getPendingAssignmentOrders(req.user.userId, req.query.available === '1');
      return res.json({ orders });
    } catch (error) { return next(error); }
  });

  router.post('/', authenticate, authorize(['customer']), validate(createOrderSchema), async (req, res, next) => {
    const {
      restaurantId, items, payment_method, tip_cents,
      delivery_lat, delivery_lng, delivery_address,
      mp_payment_id, // Mercado Pago payment ID
    } = req.validatedBody;

    console.log(`[pedido.nuevo] cliente=${req.user?.userId?.slice(0,8)} pago=${payment_method} propina=${tip_cents} productos=${items?.length}`);

    try {
      // ── Verificar bloqueo del cliente ────────────────────────────────────
      try {
        const blockCheck = await query(
          'SELECT orders_blocked, orders_blocked_reason FROM users WHERE id=$1',
          [req.user.userId]
        );
        if (blockCheck.rows[0]?.orders_blocked)
          return next(new AppError(403,
            'Tu acceso a nuevos pedidos está restringido. Contacta a soporte.'
          ));
      } catch (e) { if (e?.code !== '42703') throw e; }

      // ── Verificar pago MP ANTES de crear el pedido ───────────────────────
      if (payment_method === 'card') {
        if (!mp_payment_id)
          return next(new AppError(400, 'Falta la referencia de pago. Completa el pago primero.'));

        try {
          const piRes = await fetch(
            `https://api.mercadopago.com/v1/payments/${mp_payment_id}`,
            { headers: { Authorization: `Bearer ${env.mpAccessToken}` } }
          );
          const pi = await piRes.json().catch(() => ({}));

          if (!piRes.ok)
            return next(new AppError(502, pi?.message || 'Error verificando pago en Mercado Pago'));
          if (pi.status !== 'approved')
            return next(new AppError(402, `El pago no fue aprobado (estado: ${pi.status}). Intenta de nuevo.`));

          // Verificar que pertenece al cliente
          if (pi.metadata?.customer_id && pi.metadata.customer_id !== req.user.userId)
            return next(new AppError(403, 'Este pago no pertenece a tu cuenta'));

          // Verificar que no fue usado en otro pedido
          const usedCheck = await query(
            'SELECT order_id FROM payment_intents WHERE provider_intent_id=$1 AND order_id IS NOT NULL',
            [String(mp_payment_id)]
          ).catch(() => ({ rows: [] }));
          if (usedCheck.rows.length > 0)
            return next(new AppError(409, 'Este pago ya fue utilizado para otro pedido.'));

        } catch (e) {
          if (e instanceof AppError) throw e;
          return next(new AppError(502, 'No se pudo verificar el pago. Intenta de nuevo.'));
        }
      }

      // ── Resolver dirección ────────────────────────────────────────────────
      let deliveryAddress = 'address-pending';
      try {
        const c = await query('SELECT address FROM users WHERE id=$1', [req.user.userId]);
        deliveryAddress = delivery_address?.trim() || c.rows[0]?.address || 'address-pending';
      } catch (e) { if (!isMissingColumnError(e)) throw e; }
      if (!deliveryAddress || deliveryAddress === 'address-pending')
        return next(new AppError(400, 'Debes guardar tu dirección antes de hacer un pedido'));

      // ── Coordenadas restaurante ───────────────────────────────────────────
      const restCoords = await query(
        `SELECT COALESCE(u.home_lat, r.lat) AS lat, COALESCE(u.home_lng, r.lng) AS lng
         FROM restaurants r LEFT JOIN users u ON u.id=r.owner_user_id WHERE r.id=$1`,
        [restaurantId]
      );
      if (restCoords.rowCount === 0) return next(new AppError(404, 'Restaurante no encontrado'));

      const restaurantLat    = restCoords.rows[0]?.lat != null ? Number(restCoords.rows[0].lat) : null;
      const restaurantLng    = restCoords.rows[0]?.lng != null ? Number(restCoords.rows[0].lng) : null;
      const orderDeliveryLat = Number.isFinite(Number(delivery_lat)) ? Number(delivery_lat) : null;
      const orderDeliveryLng = Number.isFinite(Number(delivery_lng)) ? Number(delivery_lng) : null;

      if (orderDeliveryLat == null || orderDeliveryLng == null)
        return next(new AppError(400, 'Falta ubicación de entrega.'));
      if (restaurantLat == null || restaurantLng == null)
        return next(new AppError(409, 'El restaurante no tiene coordenadas configuradas.'));

      // ── Cobertura ─────────────────────────────────────────────────────────
      const distResult = await query(
        `SELECT (6371 * acos(
           cos(radians($1::float8)) * cos(radians($3::float8)) *
           cos(radians($4::float8) - radians($2::float8)) +
           sin(radians($1::float8)) * sin(radians($3::float8))
         )) AS km`,
        [orderDeliveryLat, orderDeliveryLng, restaurantLat, restaurantLng]
      );
      const distKm = Number(distResult.rows[0]?.km ?? Infinity);
      if (!Number.isFinite(distKm) || distKm > 5)
        return next(new AppError(409, `Esta tienda está fuera de cobertura (${distKm.toFixed(1)} km). Máximo: 5 km.`));

      // ── Límite 1 pedido activo ────────────────────────────────────────────
      try {
        const activeCheck = await query(
          `SELECT COUNT(*) AS cnt FROM orders
           WHERE customer_id=$1 AND status NOT IN ('delivered','cancelled')`,
          [req.user.userId]
        );
        if (Number(activeCheck.rows[0]?.cnt || 0) > 0) {
          const historyCheck = await query(
            `SELECT
               COUNT(*) FILTER (WHERE status='delivered') AS total_delivered,
               COUNT(*) FILTER (WHERE status='delivered' AND payment_method='cash') AS cash_delivered
             FROM orders WHERE customer_id=$1`,
            [req.user.userId]
          );
          const totalDelivered  = Number(historyCheck.rows[0]?.total_delivered || 0);
          const cashDelivered   = Number(historyCheck.rows[0]?.cash_delivered  || 0);
          const exemptByHistory = totalDelivered >= 10 || cashDelivered >= 5;

          let exemptByRestaurant = false;
          if (!exemptByHistory) {
            try {
              const restCheck = await query(
                'SELECT allow_frequent_customers FROM restaurants WHERE id=$1', [restaurantId]
              );
              exemptByRestaurant = Boolean(restCheck.rows[0]?.allow_frequent_customers);
            } catch (e) { if (!isMissingColumnError(e)) throw e; }
          }

          if (!exemptByHistory && !exemptByRestaurant)
            return next(new AppError(409, 'Ya tienes un pedido en curso. Espera a que sea entregado.'));
        }
      } catch (e) {
        if (!isMissingColumnError(e) && !isMissingRelationError(e)) throw e;
      }

      // ── Calcular totales ──────────────────────────────────────────────────
      const menuIds   = items.map(i => i.menuItemId);
      const priceRows = await query(
        `SELECT id, price_cents,
                COALESCE(pkg_units, 1)         AS pkg_units,
                COALESCE(pkg_volume_liters, 0) AS pkg_volume_liters
         FROM menu_items WHERE id=ANY($1::uuid[]) AND restaurant_id=$2`,
        [menuIds, restaurantId]
      );
      if (priceRows.rowCount !== menuIds.length)
        return next(new AppError(400, 'Uno o más productos no pertenecen a este restaurante'));

      const priceMap = new Map(priceRows.rows.map(r => [r.id, {
        price_cents:       r.price_cents,
        pkg_units:         Number(r.pkg_units) || 1,
        pkg_volume_liters: Number(r.pkg_volume_liters) || 0,
      }]));

      let totalCents = 0, estimatedVolumeLiters = 0;
      for (const item of items) {
        const meta = priceMap.get(item.menuItemId);
        totalCents += meta.price_cents * item.quantity;
        const packs = Math.ceil(item.quantity / meta.pkg_units);
        estimatedVolumeLiters += packs * meta.pkg_volume_liters;
      }
      estimatedVolumeLiters = Math.round(estimatedVolumeLiters * 1000) / 1000;

      const serviceFee    = Math.round(totalCents * SERVICE_FEE_PCT);
      const deliveryFee   = Math.round(totalCents * DELIVERY_FEE_PCT);
      const restaurantFee = Math.round(totalCents * RESTAURANT_FEE_PCT);
      const paymentMethod = payment_method || 'cash';
      const tipCents      = Number(tip_cents) || 0;

      // ── Límite efectivo ───────────────────────────────────────────────────
      if (paymentMethod === 'cash') {
        try {
          const cashLimitRow = await query(
            'SELECT max_cash_cents FROM restaurants WHERE id=$1', [restaurantId]
          );
          const maxCash = cashLimitRow.rows[0]?.max_cash_cents;
          if (maxCash && maxCash > 0) {
            const grandTotal = totalCents + serviceFee + deliveryFee + tipCents;
            if (grandTotal > maxCash)
              return next(new AppError(409, `El pedido supera el límite de efectivo ($${(maxCash/100).toFixed(2)}).`));
          }
        } catch (e) { if (!isMissingColumnError(e)) throw e; }
      }

      // ── Crear pedido ──────────────────────────────────────────────────────
      const orderResult = await query(
        `INSERT INTO orders(
           customer_id, restaurant_id, status, total_cents,
           service_fee_cents, delivery_fee_cents, restaurant_fee_cents,
           payment_method, tip_cents, delivery_address,
           delivery_lat, delivery_lng, restaurant_lat, restaurant_lng,
           estimated_volume_liters, restaurant_confirmed
         )
         VALUES($1,$2,'created',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,false)
         RETURNING *`,
        [
          req.user.userId, restaurantId, totalCents,
          serviceFee, deliveryFee, restaurantFee,
          paymentMethod, tipCents, deliveryAddress,
          orderDeliveryLat, orderDeliveryLng, restaurantLat, restaurantLng,
          estimatedVolumeLiters,
        ]
      );
      const order = orderResult.rows[0];
      console.log(`[pedido.creado] id=${order.id.slice(0,8)} total=${order.total_cents}`);

      // ── Asociar payment_intent al pedido ─────────────────────────────────
      if (paymentMethod === 'card' && mp_payment_id) {
        await query(
          `UPDATE payment_intents SET order_id=$1, status='approved', updated_at=NOW()
           WHERE provider_intent_id=$2`,
          [order.id, String(mp_payment_id)]
        ).catch(e => console.warn('[pedido] payment_intent update:', e.message));
      }

      // ── Insertar items ────────────────────────────────────────────────────
      const itemValues = items.map((_, i) => {
        const base = i * 4;
        return `($${base+1},$${base+2},$${base+3},$${base+4})`;
      }).join(',');
      await query(
        `INSERT INTO order_items(order_id, menu_item_id, quantity, unit_price_cents) VALUES ${itemValues}`,
        items.flatMap(item => [order.id, item.menuItemId, item.quantity, priceMap.get(item.menuItemId).price_cents])
      );

      // ── Motor de asignación ───────────────────────────────────────────────
      try { await serializedOffer(order.id, offerNextDrivers); } catch (e) {
        if (!isMissingRelationError(e) && !isMissingColumnError(e)) throw e;
      }
      initKitchenTiming(order.id, restaurantId).catch(() => {});

      const updated = await query('SELECT * FROM orders WHERE id=$1', [order.id]);
      orderEvents.emitOrderUpdate(order.id, updated.rows[0].status);

      // ── Notificar al restaurante ──────────────────────────────────────────
      try {
        const restInfo = await query('SELECT owner_user_id, name FROM restaurants WHERE id=$1', [restaurantId]);
        if (restInfo.rowCount > 0) {
          sseHub.sendToUser(restInfo.rows[0].owner_user_id, 'new_order', {
            orderId:            order.id,
            status:             'created',
            totalCents,
            paymentMethod,
            restaurantConfirmed: false,
            restaurantName:     restInfo.rows[0].name,
            itemCount:          items.length,
          });
        }
      } catch (_) {}

      console.log(`[pedido.listo] id=${order.id.slice(0,8)} → notificando tienda y buscando driver`);
      logEvent('order.created', { orderId: order.id, customerId: req.user.userId });
      return res.status(201).json({ order: updated.rows[0] });

    } catch (error) { return next(error); }
  });
}
