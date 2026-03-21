// backend/src/engine/kitchen.js
//
// KitchenEngine mixto para producción.
//
// FLUJO:
//   1. Al crear el pedido: grabar prep_started_at + kitchen_estimated_ready
//      usando prep_time_estimate_s del restaurante.
//   2. El restaurante marca "listo" manualmente (PATCH /orders/:id/status → ready).
//   3. Ticker (cada 30s): si kitchen_estimated_ready <= NOW() y el pedido no está
//      marcado como ready, marcarlo automáticamente y notificar al restaurante.
//   4. Al completar el pedido: si el driver esperó más de kitchen_wait_threshold_s,
//      comparar tiempo real vs estimado. Si difiere más de kitchen_estimate_diff_threshold_s,
//      actualizar prep_time_estimate_s del restaurante y notificar para corrección manual.

import { query } from '../config/db.js';
import { getParam } from './params.js';
import { sseHub } from '../modules/events/hub.js';
import { shortId } from '../utils/geo.js';

/**
 * Inicializa los campos de cocina al crear un pedido.
 * Se llama en POST /orders justo después de insertar el pedido.
 *
 * @param {string} orderId
 * @param {string} restaurantId
 */
export async function initKitchenTiming(orderId, restaurantId) {
  try {
    const r = await query(
      'SELECT prep_time_estimate_s, owner_user_id FROM restaurants WHERE id=$1',
      [restaurantId]
    );
    if (r.rowCount === 0) return;

    const prepEstimate = r.rows[0].prep_time_estimate_s ?? 600;
    await query(
      `UPDATE orders
       SET prep_started_at          = NOW(),
           kitchen_estimated_ready  = NOW() + ($1 * INTERVAL '1 second'),
           updated_at               = NOW()
       WHERE id = $2`,
      [prepEstimate, orderId]
    );
  } catch (e) {
    console.warn(`[kitchen] initKitchenTiming error order=${shortId(orderId)}:`, e.message);
  }
}

/**
 * Ticker de cocina. Llama desde el loop principal del servidor cada ~30s.
 * Marca automáticamente como 'ready' los pedidos cuyo estimado ya venció
 * y el restaurante no los marcó manualmente.
 * Notifica al restaurante vía SSE para que corrija si es un error.
 */
export async function tickKitchen() {
  try {
    // Pedidos donde el estimado ya venció pero siguen en estado 'accepted' o 'preparing'
    const overdue = await query(
      `SELECT o.id, o.restaurant_id, o.prep_started_at, o.kitchen_estimated_ready,
              r.owner_user_id AS restaurant_owner_id,
              r.name          AS restaurant_name
       FROM orders o
       JOIN restaurants r ON r.id = o.restaurant_id
       WHERE o.status IN ('accepted','preparing')
         AND o.kitchen_estimated_ready IS NOT NULL
         AND o.kitchen_estimated_ready <= NOW()
         AND o.driver_id IS NOT NULL`
    );

    for (const row of overdue.rows) {
      // Marcar como ready automáticamente
      await query(
        `UPDATE orders
         SET status='ready', ready_at=NOW(), updated_at=NOW(),
             restaurant_note=COALESCE(restaurant_note,'') || ' [AUTO: marcado listo por estimado]'
         WHERE id=$1 AND status IN ('accepted','preparing')`,
        [row.id]
      );

      console.log(`[kitchen] order=${shortId(row.id)} marcado ready automáticamente (${row.restaurant_name})`);

      // Notificar al restaurante para que corrija si fue error
      if (row.restaurant_owner_id) {
        sseHub.sendToUser(row.restaurant_owner_id, 'kitchen_auto_ready', {
          orderId:        row.id,
          restaurantName: row.restaurant_name,
          message:        'El pedido fue marcado automáticamente como listo. Si aún no está listo, corrígelo.',
        });
      }

      // Notificar al driver
      sseHub.sendToUser(null, 'order_update', { orderId: row.id, status: 'ready' });

      // Broadcast a todos los interesados en este pedido
      const parties = await query(
        `SELECT o.customer_id, o.driver_id, r.owner_user_id
         FROM orders o JOIN restaurants r ON r.id=o.restaurant_id WHERE o.id=$1`,
        [row.id]
      );
      if (parties.rowCount > 0) {
        const { customer_id, driver_id, owner_user_id } = parties.rows[0];
        sseHub.sendToUser(customer_id,  'order_update', { orderId: row.id, status: 'ready' });
        sseHub.sendToUser(driver_id,    'order_update', { orderId: row.id, status: 'ready' });
        sseHub.sendToUser(owner_user_id,'order_update', { orderId: row.id, status: 'ready' });
      }
    }
  } catch (e) {
    console.error('[kitchen] tickKitchen error:', e.message);
  }
}

/**
 * Lllamado cuando el driver llega al restaurante (PATCH on_the_way o evento at_restaurant).
 * Actualiza pickup_wait_s y, al completar la entrega, evalúa si hay que
 * sugerir ajuste del estimado de prep del restaurante.
 *
 * @param {string} orderId
 * @param {number} pickupWaitSec  — segundos que el driver esperó en el restaurante
 */
export async function recordPickupWait(orderId, pickupWaitSec) {
  if (!pickupWaitSec || pickupWaitSec <= 0) return;
  try {
    await query(
      `UPDATE orders SET pickup_wait_s=$1, updated_at=NOW() WHERE id=$2`,
      [Math.round(pickupWaitSec), orderId]
    );
  } catch (e) {
    console.warn(`[kitchen] recordPickupWait error:`, e.message);
  }
}

/**
 * Evalúa si el estimado de prep del restaurante debe ajustarse.
 * Se llama cuando el pedido pasa a 'on_the_way' (pickup confirmado).
 *
 * Trigger: ambas condiciones deben cumplirse simultáneamente:
 *   1. El conductor esperó > kitchen_wait_threshold_s (default 120 s = 2 min)
 *   2. El tiempo real de prep excedió el estimado en > kitchen_estimate_diff_threshold_s
 *      (default 300 s = 5 min) — solo en dirección positiva (el estimado fue corto)
 *
 * Cuando se dispara: nuevo estimado = tiempo real exacto de esa orden.
 *
 * @param {string} orderId
 */
export async function evaluatePrepEstimate(orderId) {
  const waitThreshold = await getParam('kitchen_wait_threshold_s', 120);
  const diffThreshold = await getParam('kitchen_estimate_diff_threshold_s', 300);

  try {
    const r = await query(
      `SELECT o.pickup_wait_s, o.prep_started_at, o.ready_at,
              o.restaurant_id, r.prep_time_estimate_s, r.owner_user_id,
              r.name AS restaurant_name
       FROM orders o
       JOIN restaurants r ON r.id = o.restaurant_id
       WHERE o.id = $1`,
      [orderId]
    );

    if (r.rowCount === 0) return;
    const row = r.rows[0];

    // Condición 1: conductor esperó más de N segundos
    const pickupWait = row.pickup_wait_s ?? 0;
    if (pickupWait <= waitThreshold) return;

    // Requisitos de datos para calcular tiempo real
    if (!row.prep_started_at || !row.ready_at) return;
    const realPrepSec = Math.round(
      (new Date(row.ready_at) - new Date(row.prep_started_at)) / 1000
    );

    const currentEstimate = row.prep_time_estimate_s ?? 600;

    // Condición 2: el tiempo real superó el estimado en más de M segundos
    // Solo dirección positiva (estimado fue corto, no cuando fue excesivamente largo)
    if ((realPrepSec - currentEstimate) <= diffThreshold) return;

    // Nuevo estimado = tiempo real exacto de esta orden
    const newEstimate = realPrepSec;

    await query(
      `UPDATE restaurants
       SET prep_time_estimate_s     = $1,
           last_prep_time_s         = $2,
           prep_estimate_updated_at = NOW()
       WHERE id = $3`,
      [newEstimate, realPrepSec, row.restaurant_id]
    );

    console.log(
      `[kitchen] auto-adjust rest=${shortId(row.restaurant_id)} ` +
      `${currentEstimate}s → ${newEstimate}s ` +
      `(real=${realPrepSec}s, espera conductor=${pickupWait}s)`
    );

    // Notificar al restaurante vía SSE
    if (row.owner_user_id) {
      sseHub.sendToUser(row.owner_user_id, 'prep_estimate_updated', {
        restaurantName:   row.restaurant_name,
        previousEstimate: currentEstimate,
        newEstimate,
        realPrepTime:     realPrepSec,
        driverWaitSecs:   pickupWait,
        triggeredBy:      'auto',
        message:
          `El tiempo de preparación se actualizó automáticamente a ` +
          `${Math.round(newEstimate / 60)} min ` +
          `(antes: ${Math.round(currentEstimate / 60)} min). ` +
          `El conductor esperó ${Math.round(pickupWait / 60)} min. ` +
          `Puedes corregirlo desde Pedidos si es incorrecto.`,
      });
    }
  } catch (e) {
    console.warn(`[kitchen] evaluatePrepEstimate error order=${shortId(orderId)}:`, e.message);
  }
}

/**
 * Registra una corrección manual del restaurante en restaurant_prep_corrections.
 * Vigencia: 1 hora. Se usa para detección de abuso, no afecta el flujo de pedidos.
 *
 * @param {string} restaurantId
 * @param {number} previousS
 * @param {number} newS
 */
export async function recordManualCorrection(restaurantId, previousS, newS) {
  try {
    await query(
      `INSERT INTO restaurant_prep_corrections (restaurant_id, previous_s, new_s)
       VALUES ($1, $2, $3)`,
      [restaurantId, previousS, newS]
    );
  } catch (e) {
    console.warn(`[kitchen] recordManualCorrection error rest=${shortId(restaurantId)}:`, e.message);
  }
}

/**
 * Devuelve el número de correcciones manuales vigentes (última hora).
 *
 * @param {string} restaurantId
 * @returns {Promise<number>}
 */
export async function getActiveCorrectionsCount(restaurantId) {
  try {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS cnt
       FROM restaurant_prep_corrections
       WHERE restaurant_id = $1 AND expires_at > NOW()`,
      [restaurantId]
    );
    return rows[0]?.cnt ?? 0;
  } catch (e) {
    console.warn(`[kitchen] getActiveCorrectionsCount error:`, e.message);
    return 0;
  }
}

/**
 * Restablece el estimado de prep al abrir el restaurante.
 * Llama desde el endpoint que cambia is_open = true.
 * Solo resetea si el restaurante no tiene un estimado personalizado reciente.
 *
 * @param {string} restaurantId
 */
export async function resetPrepEstimateOnOpen(restaurantId) {
  try {
    // No resetear si fue actualizado en las últimas 24h (estimado fresco)
    await query(
      `UPDATE restaurants
       SET prep_estimate_updated_at = NOW()
       WHERE id = $1
         AND (prep_estimate_updated_at IS NULL
              OR prep_estimate_updated_at < NOW() - INTERVAL '24 hours')`,
      [restaurantId]
    );
  } catch (e) {
    console.warn(`[kitchen] resetPrepEstimateOnOpen error:`, e.message);
  }
}
