import { query } from '../../config/db.js';
import { orderEvents } from '../../events/orderEvents.js';
import { logEvent } from '../../utils/logger.js';
import { AppError } from '../../utils/errors.js';
import { offerNextDrivers, expireTimedOutOffers, serializedOffer, getPendingAssignmentOrders } from './assignment/index.js';
import { sseHub } from '../events/hub.js';
import { initKitchenTiming, evaluatePrepEstimate, recordPickupWait } from '../../engine/kitchen.js';
import { createOrderSchema, suggestionResponseSchema, suggestionSchema, updateOrderStatusSchema } from './schemas.js';

export const SERVICE_FEE_PCT = 0.05;
export const DELIVERY_FEE_PCT = 0.10;
export const RESTAURANT_FEE_PCT = 0.10;

export function isMissingColumnError(e) { return e?.code === '42703'; }
export function isMissingRelationError(e) { return e?.code === '42P01'; }

export async function notifyOrderParties(orderId, event, data) {
  try {
    const r = await query(
      `SELECT o.customer_id, o.driver_id, rest.owner_user_id AS restaurant_owner_id
       FROM orders o JOIN restaurants rest ON rest.id = o.restaurant_id WHERE o.id = $1`,
      [orderId]
    );
    if (r.rowCount === 0) return;
    const { customer_id, driver_id, restaurant_owner_id } = r.rows[0];
    sseHub.sendToUser(customer_id, event, data);
    sseHub.sendToUser(restaurant_owner_id, event, data);
    if (driver_id) sseHub.sendToUser(driver_id, event, data);
  } catch (_) {}
}

export const STATUS_TS = {
  accepted: 'accepted_at',
  preparing: 'preparing_at',
  ready: 'ready_at',
  on_the_way: 'picked_up_at',
  delivered: 'delivered_at',
  cancelled: 'cancelled_at',
};

export function parseSuggestionItems(raw) {
  if (!raw) return [];
  try {
    const p = JSON.parse(raw);
    return Array.isArray(p?.items) ? p.items : [];
  } catch {
    return [];
  }
}

export function parseSuggestionNote(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw)?.note || null;
  } catch {
    return null;
  }
}

export async function getOrderItems(orderIds = []) {
  if (orderIds.length === 0) return new Map();
  let result;
  try {
    result = await query(
      `SELECT oi.order_id, oi.menu_item_id, oi.quantity, oi.unit_price_cents,
              COALESCE(mi.name,'Producto') AS name
       FROM order_items oi LEFT JOIN menu_items mi ON mi.id = oi.menu_item_id
       WHERE oi.order_id = ANY($1::uuid[]) ORDER BY oi.order_id, oi.id`,
      [orderIds]
    );
  } catch (e) {
    if (isMissingRelationError(e)) return new Map();
    throw e;
  }
  const map = new Map();
  for (const row of result.rows) {
    if (!map.has(row.order_id)) map.set(row.order_id, []);
    map.get(row.order_id).push({
      menuItemId: row.menu_item_id,
      name: row.name,
      quantity: row.quantity,
      unitPriceCents: row.unit_price_cents,
    });
  }
  return map;
}

export const sharedDeps = {
  query,
  orderEvents,
  logEvent,
  AppError,
  offerNextDrivers,
  expireTimedOutOffers,
  serializedOffer,
  getPendingAssignmentOrders,
  sseHub,
  initKitchenTiming,
  evaluatePrepEstimate,
  recordPickupWait,
  createOrderSchema,
  suggestionResponseSchema,
  suggestionSchema,
  updateOrderStatusSchema,
};
