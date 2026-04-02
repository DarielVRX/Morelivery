// backend/src/modules/orders/assignment/events.js
// ─────────────────────────────────────────────────────────────────────────────
// Eventos del ciclo de vida de una oferta.
//
// Cada función maneja un evento externo y sus efectos secundarios:
//   - acceptOffer:   Driver acepta → asignar pedido, expirar competidores
//   - rejectOffer:   Driver rechaza → cooldown, despertar pedidos huérfanos
//   - releaseOrder:  Driver libera un pedido ya asignado → volver a ofrecer
//   - expireTimedOutOffers: Ticker periódico → expirar ofertas sin respuesta
//   - notifyPickup:  Driver recogió pedido en restaurante → reroute
//   - notifyDelivery: Driver entregó pedido al cliente → reroute + trigger
//   - notifyOrderCancelled: Pedido cancelado → reroute del driver afectado
//
// CAMBIOS respecto a versión anterior:
//   - rerouteDriver() se llama en: acceptOffer, releaseOrder, notifyPickup,
//     notifyDelivery, notifyOrderCancelled.
//   - triggerPendingAssignments() se llama en: notifyDelivery (driver liberado),
//     notifyOrderCancelled (slot liberado).
// ─────────────────────────────────────────────────────────────────────────────

import { REBALANCE_COOLDOWN_SECONDS, REBALANCE_DISPUTE_TIMEOUT_S, SESSION_REBALANCE_LIMIT, log, logWarn } from './constants.js';
import { getParam } from '../../../engine/params.js';
import {
  assignDriverToOrder, unassignDriverFromOrder,
  acceptPendingOffer, expireCompetingOffers,
  rejectDriverOffer, releaseDriverOffer,
  expireAllPendingForDriver,
  expireTimedOutOffersInDB,
  getOpenOrder, getQueuedOrders,
  getOrderForSse,
} from './queries.js';
import { query } from '../../../config/db.js';
import { serializedOffer, hasActiveChain } from './queue.js';
import { offerNextDrivers, triggerPendingAssignments } from './core.js';
import { sseHub } from '../../events/hub.js';
import { rerouteDriver } from '../../../engine/reroute.js';

// ─── Aceptar ──────────────────────────────────────────────────────────────────

/**
 * El driver acepta la oferta.
 * Usa FOR UPDATE SKIP LOCKED → si otro driver aceptó antes, devuelve false.
 *
 * @returns {boolean}  true si la asignación fue exitosa
 */
export async function acceptOffer(orderId, driverId) {
  log(orderId, `✅ ACEPTAR — driver=${driverId.slice(0,8)}`);

  const assigned = await assignDriverToOrder(orderId, driverId);
  if (!assigned) {
    logWarn(orderId, `⚠️  ACEPTAR: pedido ya tomado por otro — driver=${driverId.slice(0,8)}`);
    return false;
  }

  await acceptPendingOffer(orderId, driverId);
  await expireCompetingOffers(orderId, driverId);

  // Incrementar contador de pedidos activos — reemplaza subquery COUNT(*) en finder
  await query(
    `UPDATE driver_profiles SET active_orders_count = active_orders_count + 1 WHERE user_id = $1`,
    [driverId]
  ).catch(e => logWarn(orderId, `active_orders_count +1 error: ${e.message}`));

  // Emitir order_update
  const orderData = await getOrderForSse(orderId);
  if (orderData) {
    const payload = {
      orderId,
      status:         'assigned',
      totalCents:     orderData.total_cents,
      restaurantName: orderData.restaurant_name,
      customerName:   orderData.customer_name,
    };
    sseHub.sendToUser(orderData.customer_id,    'order_update', payload);
    sseHub.sendToUser(orderData.restaurant_id,  'order_update', payload);
  }

  // Rerouting inmediato — el driver tiene un nuevo pedido en su ruta
  rerouteDriver(driverId).catch(e =>
    logWarn(orderId, `rerouteDriver error tras aceptar: ${e.message}`)
  );

  log(orderId, `🎉 ASIGNADO → driver=${driverId.slice(0,8)}`);
  return true;
}

// ─── Rechazar ─────────────────────────────────────────────────────────────────

/**
 * El driver rechaza la oferta.
 * 1. Aplica cooldown al driver para este pedido.
 * 2. Expira las otras ofertas pending del driver → despierta esos pedidos.
 * 3. Re-encola este pedido para buscar otro driver.
 */
export async function rejectOffer(orderId, driverId, onOffer) {
  log(orderId, `rejectOffer driver=${driverId} cooldown=${getParam('cooldown_s', 300)}s`);

  await rejectDriverOffer(orderId, driverId, getParam('cooldown_s', 300));

  const freedOrderIds = await expireAllPendingForDriver(driverId, orderId);
  for (const freeOrderId of freedOrderIds) {
    if (!hasActiveChain(freeOrderId)) {
      log(freeOrderId, `despertado — driver=${driverId} liberó al rechazar ${orderId}`);
      serializedOffer(freeOrderId, offerNextDrivers, onOffer);
    }
  }

  serializedOffer(orderId, offerNextDrivers, onOffer);
}

// ─── Liberar ──────────────────────────────────────────────────────────────────

/**
 * El driver se retracta de un pedido ya asignado.
 * 1. Aplica cooldown al driver para este pedido.
 * 2. Desasigna el driver del pedido → vuelve a created/pending_driver.
 * 3. Libera otros pedidos bloqueados.
 * 4. Re-encola el pedido liberado.
 * 5. Rerouting del driver — su ruta cambió.
 */
export async function releaseOrder(orderId, driverId, onOffer) {
  log(orderId, `releaseOrder driver=${driverId} cooldown=${getParam('cooldown_s', 300)}s`);

  await releaseDriverOffer(orderId, driverId, getParam('cooldown_s', 300));
  await unassignDriverFromOrder(orderId, driverId);

  // Decrementar contador — el driver soltó el pedido
  await query(
    `UPDATE driver_profiles SET active_orders_count = GREATEST(active_orders_count - 1, 0) WHERE user_id = $1`,
    [driverId]
  ).catch(e => logWarn(orderId, `active_orders_count -1 error (release): ${e.message}`));

  const freedOrderIds = await expireAllPendingForDriver(driverId, null);
  for (const freeOrderId of freedOrderIds) {
    if (freeOrderId !== orderId && !hasActiveChain(freeOrderId)) {
      log(freeOrderId, `despertado — driver=${driverId} liberó al soltar ${orderId}`);
      serializedOffer(freeOrderId, offerNextDrivers, onOffer);
    }
  }

  serializedOffer(orderId, offerNextDrivers, onOffer);

  // Rerouting — el pedido salió de la ruta del driver
  rerouteDriver(driverId).catch(e =>
    logWarn(orderId, `rerouteDriver error tras liberar: ${e.message}`)
  );
}

// ─── Pickup completado ────────────────────────────────────────────────────────

/**
 * El driver recogió el pedido en el restaurante.
 * Actualiza estado del pedido y dispara rerouting.
 *
 * @returns {{ ok: boolean }}
 */
export async function notifyPickup(orderId, driverId) {
  log(orderId, `notifyPickup driver=${driverId.slice(0,8)}`);

  const r = await query(
    `UPDATE orders
     SET status = 'on_the_way', picked_up_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND driver_id = $2
       AND status IN ('assigned','accepted','preparing','ready')
       AND picked_up_at IS NULL
     RETURNING id`,
    [orderId, driverId]
  );

  if (r.rowCount === 0) {
    logWarn(orderId, `notifyPickup: pedido no encontrado o ya recogido — driver=${driverId.slice(0,8)}`);
    return { ok: false };
  }

  // SSE al cliente y restaurante
  const orderData = await getOrderForSse(orderId);
  if (orderData) {
    const payload = { orderId, status: 'on_the_way' };
    sseHub.sendToUser(orderData.customer_id,   'order_update', payload);
    sseHub.sendToUser(orderData.restaurant_id, 'order_update', payload);
  }

  // Rerouting — el estado de la ruta cambió (pickup ya procesado)
  rerouteDriver(driverId).catch(e =>
    logWarn(orderId, `rerouteDriver error tras pickup: ${e.message}`)
  );

  log(orderId, `📦 RECOGIDO → driver=${driverId.slice(0,8)}`);
  return { ok: true };
}

// ─── Delivery completado ──────────────────────────────────────────────────────

/**
 * El driver entregó el pedido al cliente.
 * Actualiza estado, dispara rerouting y trigger de asignación para pedidos en cola.
 *
 * @returns {{ ok: boolean }}
 */
export async function notifyDelivery(orderId, driverId, onOffer) {
  log(orderId, `notifyDelivery driver=${driverId.slice(0,8)}`);

  const r = await query(
    `UPDATE orders
     SET status = 'delivered', delivered_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND driver_id = $2
       AND status = 'on_the_way'
     RETURNING id`,
    [orderId, driverId]
  );

  if (r.rowCount === 0) {
    logWarn(orderId, `notifyDelivery: pedido no encontrado o no en tránsito — driver=${driverId.slice(0,8)}`);
    return { ok: false };
  }

  // Decrementar contador — el pedido salió del inventario activo del driver
  await query(
    `UPDATE driver_profiles SET active_orders_count = GREATEST(active_orders_count - 1, 0) WHERE user_id = $1`,
    [driverId]
  ).catch(e => logWarn(orderId, `active_orders_count -1 error (delivery): ${e.message}`));

  // SSE al cliente y restaurante
  const orderData = await getOrderForSse(orderId);
  if (orderData) {
    const payload = { orderId, status: 'delivered' };
    sseHub.sendToUser(orderData.customer_id,   'order_update', payload);
    sseHub.sendToUser(orderData.restaurant_id, 'order_update', payload);
  }

  // Rerouting — pedido entregado, ruta actualizada
  rerouteDriver(driverId).catch(e =>
    logWarn(orderId, `rerouteDriver error tras delivery: ${e.message}`)
  );

  // Trigger inmediato — el driver liberó capacidad, puede tomar pedidos en cola
  triggerPendingAssignments(onOffer).catch(e =>
    logWarn(orderId, `triggerPendingAssignments error: ${e.message}`)
  );

  log(orderId, `✅ ENTREGADO → driver=${driverId.slice(0,8)}`);
  return { ok: true };
}

// ─── Pedido cancelado ─────────────────────────────────────────────────────────

/**
 * Un pedido fue cancelado (por el cliente, admin, o distancia límite).
 * Si tenía driver asignado, dispara rerouting y trigger de asignación.
 *
 * @param {string} orderId
 * @param {string|null} driverId  — null si no tenía driver
 * @param {Function} onOffer
 */
export async function notifyOrderCancelled(orderId, driverId, onOffer) {
  log(orderId, `notifyOrderCancelled driver=${driverId?.slice(0,8) ?? 'none'}`);

  if (driverId) {
    // Decrementar contador — el pedido cancelado sale del inventario del driver
    await query(
      `UPDATE driver_profiles SET active_orders_count = GREATEST(active_orders_count - 1, 0) WHERE user_id = $1`,
      [driverId]
    ).catch(e => logWarn(orderId, `active_orders_count -1 error (cancel): ${e.message}`));

    // Rerouting — el pedido desapareció de la ruta del driver
    rerouteDriver(driverId).catch(e =>
      logWarn(orderId, `rerouteDriver error tras cancelación: ${e.message}`)
    );

    // Trigger inmediato — slot liberado
    triggerPendingAssignments(onOffer).catch(e =>
      logWarn(orderId, `triggerPendingAssignments error tras cancelación: ${e.message}`)
    );
  }
}

// ─── Expirar ofertas con timeout ──────────────────────────────────────────────

/**
 * Ticker periódico (llamado desde el intervalo del servidor).
 * Expira todas las ofertas pending que llevan más de offer_timeout_s
 * sin respuesta del driver, y re-encola esos pedidos.
 */
export async function expireTimedOutOffers(onOffer) {
  const expired = await expireTimedOutOffersInDB(
    getParam('offer_timeout_s', 60),
    getParam('cooldown_s', 300)
  );

  if (expired.length > 0) {
    console.log(
      `[assign] expireTimedOutOffers: ${expired.length} oferta(s) expiradas:`,
      expired.map(r => `order=${r.order_id} driver=${r.driver_id}`).join(', ')
    );
  }

  const orderIds = [...new Set(expired.map(r => r.order_id))];
  for (const orderId of orderIds) {
    const still = await getOpenOrder(orderId);
    if (still) {
      if (hasActiveChain(orderId)) {
        log(orderId, 'oferta expirada — ya tiene cadena activa, skip re-encola');
      } else {
        log(orderId, 'oferta expirada — re-encolando');
        serializedOffer(orderId, offerNextDrivers, onOffer);
      }
    } else {
      log(orderId, 'oferta expirada — pedido ya no necesita driver, skip');
    }
  }

  // Barrer pedidos huérfanos
  try {
    const orphans = await getQueuedOrders();
    for (const ord of orphans) {
      if (ord.has_candidates && !hasActiveChain(ord.id)) {
        serializedOffer(ord.id, offerNextDrivers, onOffer);
      }
    }
  } catch (e) {
    logWarn('ticker', `error barriendo pedidos huérfanos: ${e.message}`);
  }
}

// ─── Rebalanceo manual ────────────────────────────────────────────────────────

/**
 * El driver solicita rebalanceo manual de un pedido aún no recogido.
 * @returns {{ ok: boolean, reason?: string }}
 */
export async function requestRebalance(orderId, driverId) {
  log(orderId, `requestRebalance driver=${driverId.slice(0,8)}`);

  const orderRow = await query(
    `SELECT id, status, picked_up_at, is_disputed
     FROM orders
     WHERE id = $1 AND driver_id = $2
       AND status IN ('assigned','accepted','preparing','ready')
       AND picked_up_at IS NULL`,
    [orderId, driverId]
  );
  if (orderRow.rowCount === 0) {
    return { ok: false, reason: 'Pedido no disponible para rebalanceo (ya recogido o no asignado a ti)' };
  }
  if (orderRow.rows[0].is_disputed) {
    return { ok: false, reason: 'Este pedido ya está en disputa' };
  }

  const profileRow = await query(
    `SELECT session_rebalances FROM driver_profiles WHERE user_id = $1`,
    [driverId]
  );
  const sessionCount = profileRow.rows[0]?.session_rebalances ?? 0;
  if (sessionCount >= SESSION_REBALANCE_LIMIT) {
    return { ok: false, reason: `Límite de rebalanceos por sesión alcanzado (${SESSION_REBALANCE_LIMIT})` };
  }

  const disputedUntil = new Date(Date.now() + REBALANCE_DISPUTE_TIMEOUT_S * 1000);
  await query(
    `UPDATE orders
     SET is_disputed = true, disputed_until = $1, disputed_by = $2, updated_at = NOW()
     WHERE id = $3`,
    [disputedUntil, driverId, orderId]
  );

  await query(
    `INSERT INTO order_driver_offers(order_id, driver_id, status, wait_until)
     VALUES ($1, $2, 'released', NOW() + ($3 * INTERVAL '1 second'))
     ON CONFLICT (order_id, driver_id)
     DO UPDATE SET status='released',
                   wait_until  = NOW() + ($3 * INTERVAL '1 second'),
                   updated_at  = NOW()`,
    [orderId, driverId, REBALANCE_COOLDOWN_SECONDS]
  );

  await query(
    `UPDATE driver_profiles
     SET session_rebalances = session_rebalances + 1,
         total_rebalances   = total_rebalances + 1
     WHERE user_id = $1`,
    [driverId]
  );

  log(orderId, `en disputa hasta ${disputedUntil.toISOString()} — cooldown driver=${driverId.slice(0,8)} ${REBALANCE_COOLDOWN_SECONDS}s`);
  return { ok: true };
}

/**
 * Cancelar una disputa manualmente (driver original).
 * @returns {{ ok: boolean, reason?: string }}
 */
export async function cancelDispute(orderId, driverId) {
  log(orderId, `cancelDispute driver=${driverId.slice(0,8)}`);

  const orderRow = await query(
    `SELECT id FROM orders
     WHERE id = $1 AND is_disputed = true AND driver_id = $2`,
    [orderId, driverId]
  );
  if (orderRow.rowCount === 0) {
    return { ok: false, reason: 'No hay disputa activa para este pedido' };
  }

  await query(
    `UPDATE orders
     SET is_disputed = false, disputed_until = NULL, disputed_by = NULL, updated_at = NOW()
     WHERE id = $1`,
    [orderId]
  );

  log(orderId, `disputa cancelada manualmente por driver=${driverId.slice(0,8)}`);
  return { ok: true };
}

/**
 * Ticker periódico: cancela disputas que expiraron sin ser tomadas.
 */
export async function expireDisputedOrders() {
  const r = await query(
    `UPDATE orders
     SET is_disputed    = false,
         disputed_until = NULL,
         disputed_by    = NULL,
         updated_at     = NOW()
     WHERE is_disputed = true
       AND disputed_until < NOW()
       AND driver_id IS NOT NULL
     RETURNING id, driver_id`,
    []
  );

  if (r.rowCount > 0) {
    log('ticker', `${r.rowCount} disputa(s) expiradas sin tomador — pedidos vuelven a ruta original`);

    // Rerouting para drivers que recuperan sus pedidos
    await Promise.all(
      r.rows.map(row =>
        rerouteDriver(row.driver_id).catch(e =>
          logWarn(row.id, `rerouteDriver error tras expiración disputa: ${e.message}`)
        )
      )
    );
  }

  return r.rows;
}
