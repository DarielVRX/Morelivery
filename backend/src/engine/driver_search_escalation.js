// backend/src/engine/driver_search_escalation.js
//
// Ticker de escalada para pedidos sin repartidor disponible.
//
// Flujo por pedido (tiempo desde created_at o driver_search_escalated_at):
//
//   T+2min  → SSE silencioso (ya lo emite core.js en tiempo real)
//   T+5min  → Push alta prioridad con botones "Seguir esperando" / "Cancelar"
//             Si el cliente NO responde en 5 min → cancelación automática (T+10)
//   T+10min → Si no respondió: cancelar automáticamente
//             Si respondió (keep-waiting): informativo sin cancelar
//   T+15min → Informativo con botón cancelar
//   T+25min en adelante → Repetir cada 10 min con botón cancelar
//
// "Responder" = llamar POST /orders/:id/keep-waiting
//   → actualiza driver_search_escalated_at, reiniciando el timer desde T=0
//
// Se llama desde el ticker principal del servidor cada 60s.

import { query } from '../config/db.js';
import { sendPushToUser } from '../modules/notifications/pushSubscription.js';
import { sseHub } from '../modules/events/hub.js';

const MINUTE = 60; // segundos

// Umbrales en segundos desde created_at (o driver_search_escalated_at si existe)
const T_OFFER_PUSH      =  5 * MINUTE; // push con botones
const T_AUTO_CANCEL     = 10 * MINUTE; // cancelar si no respondió
const T_INFORM_15       = 15 * MINUTE; // informativo post-respuesta
const T_REPEAT_INTERVAL = 10 * MINUTE; // repetir cada 10 min desde T+25

export async function tickDriverSearchEscalation() {
  // Pedidos en estado pending_driver o created sin driver asignado
  const r = await query(
    `SELECT
    o.id,
    o.customer_id,
    o.created_at,
    o.driver_search_escalated_at,
    o.driver_search_push_sent_at,
    rest.owner_user_id AS restaurant_owner_id
    FROM orders o
    JOIN restaurants rest ON rest.id = o.restaurant_id
    WHERE o.driver_id IS NULL
    AND o.status IN ('created', 'pending_driver')
    AND o.cancelled_by IS NULL`,
    []
  );

  if (r.rowCount === 0) return;

  const nowSec = Date.now() / 1000;

  for (const order of r.rows) {
    try {
      await _processOrder(order, nowSec);
    } catch (e) {
      console.error(`[escalation] error order=${order.id.slice(0,8)}:`, e.message);
    }
  }
}

async function _processOrder(order, nowSec) {
  // Base del timer: si el cliente respondió "seguir esperando", usar esa fecha
  // sino usar created_at
  const baseTs = order.driver_search_escalated_at
  ? new Date(order.driver_search_escalated_at).getTime() / 1000
  : new Date(order.created_at).getTime() / 1000;

  const elapsedSec = nowSec - baseTs;

  // Push ya enviado — leer timestamp
  const pushSentAt = order.driver_search_push_sent_at
  ? new Date(order.driver_search_push_sent_at).getTime() / 1000
  : null;

  const pushElapsedSec = pushSentAt ? nowSec - pushSentAt : null;

  // ── T+5min: primer push con botones ─────────────────────────────────────
  if (elapsedSec >= T_OFFER_PUSH && !pushSentAt) {
    await _sendNoDriverPush(order, {
      title:    'Buscando repartidor',
      body:     'Aún no encontramos un repartidor. ¿Deseas seguir esperando?',
      priority: 'high',
      actions:  [
        { action: 'keep_waiting', title: '⏳ Seguir esperando' },
        { action: 'cancel_order', title: '✕ Cancelar pedido'  },
      ],
    });
    await query(
      `UPDATE orders SET driver_search_push_sent_at = NOW() WHERE id = $1`,
                [order.id]
    );
    return;
  }

  // ── T+10min: cancelar si no respondió ────────────────────────────────────
  if (elapsedSec >= T_AUTO_CANCEL && pushSentAt && pushElapsedSec >= 5 * MINUTE) {
    // Verificar que no haya respondido (driver_search_escalated_at sigue siendo null
    // o anterior al push)
    const respondedAfterPush = order.driver_search_escalated_at &&
    new Date(order.driver_search_escalated_at).getTime() / 1000 > pushSentAt;

    if (!respondedAfterPush) {
      await _autoCancelOrder(order);
      return;
    }
  }

  // ── T+15min: informativo post-respuesta ──────────────────────────────────
  if (elapsedSec >= T_INFORM_15 && elapsedSec < T_INFORM_15 + MINUTE) {
    await _sendNoDriverPush(order, {
      title:    'Aún sin repartidor',
      body:     'Han pasado 15 minutos. Seguimos buscando — te avisamos en cuanto se asigne.',
      priority: 'normal',
      actions:  [{ action: 'cancel_order', title: '✕ Cancelar pedido' }],
    });
    return;
  }

  // ── T+25min en adelante: repetir cada 10 min ─────────────────────────────
  const repeatStart = 25 * MINUTE;
  if (elapsedSec >= repeatStart) {
    const cyclesSinceRepeat = Math.floor((elapsedSec - repeatStart) / T_REPEAT_INTERVAL);
    const cycleStart        = repeatStart + cyclesSinceRepeat * T_REPEAT_INTERVAL;
    const inWindow          = (elapsedSec - cycleStart) < MINUTE;

    if (inWindow) {
      const waitedMins = Math.round(elapsedSec / MINUTE);
      await _sendNoDriverPush(order, {
        title:    'Pedido en espera',
        body:     `Han pasado ${waitedMins} minutos. ¿Aún deseas esperar?`,
        priority: 'normal',
        actions:  [{ action: 'cancel_order', title: '✕ Cancelar pedido' }],
      });
    }
  }
}

async function _sendNoDriverPush(order, { title, body, priority, actions }) {
  await sendPushToUser(order.customer_id, {
    title,
    body,
    tag:      `no_driver_${order.id}`,
    group:    'customer',
    priority,
    url:      '/customer',
    pushType: 'no_driver',
    orderId:  order.id,
    actions,
  }).catch(() => {});
}

async function _autoCancelOrder(order) {
  await query(
    `UPDATE orders
    SET status = 'cancelled', cancelled_by = 'no_driver_timeout', updated_at = NOW()
    WHERE id = $1 AND driver_id IS NULL AND status IN ('created','pending_driver')`,
              [order.id]
  );

  // Notificar a cliente y restaurante
  sseHub.sendToUser(order.customer_id, 'order_update', {
    orderId: order.id,
    status:  'cancelled',
    message: 'Tu pedido fue cancelado porque no encontramos un repartidor disponible.',
  });
  sseHub.sendToUser(order.restaurant_owner_id, 'order_update', {
    orderId: order.id,
    status:  'cancelled',
    message: 'El pedido fue cancelado automáticamente — sin repartidor disponible.',
  });

  await sendPushToUser(order.customer_id, {
    title:    'Pedido cancelado',
    body:     'No encontramos un repartidor disponible. Tu pedido fue cancelado.',
    tag:      `cancelled_${order.id}`,
    group:    'customer',
    priority: 'high',
    url:      '/customer',
    pushType: 'cancelled',
    orderId:  order.id,
  }).catch(() => {});

  console.log(`[escalation] auto-cancel order=${order.id.slice(0,8)} — sin respuesta tras push`);
}
