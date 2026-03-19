// backend/src/engine/stale.js
//
// cleanStaleEntities adaptado para producción.
// Equivalente a la función del SidePanel.jsx del simulador pero corriendo
// desde el ticker del servidor (server.js), no desde un botón de UI.
//
// LÓGICA:
//   1. Pedidos 'on_the_way' con driver_id que ya no existe / no disponible:
//      → Iniciar ventana de reconexión (reconnect_deadline).
//      → Si la ventana expiró: cancelar pedido + incrementar disconnect_penalties del driver.
//   2. Pedidos 'assigned' con driver perdido:
//      → Desasignar y volver a 'pending_driver' para reofertar.
//   3. Pedidos en estados activos sin driver_id y sin oferta pendiente:
//      → Re-enquelar al motor de asignación.

import { query } from '../config/db.js';
import { getParam } from './params.js';
import { shortId } from '../utils/geo.js';
import { serializedOffer, hasActiveChain } from '../modules/orders/assignment/queue.js';
import { offerNextDrivers } from '../modules/orders/assignment/core.js';

/**
 * Limpia entidades stale y re-encola pedidos huérfanos.
 * Se llama desde el ticker del servidor.
 *
 * @param {Function} onOffer  — callback SSE del motor de asignación
 * @returns {Promise<{ checked: number, requeued: number, cancelled: number, reassigned: number }>}
 */
export async function cleanStaleEntities(onOffer) {
  const reconnectWindow = getParam('reconnect_window_s', 600);
  const now = new Date();

  let requeued   = 0;
  let cancelled  = 0;
  let reassigned = 0;

  try {
    // ── 1. Pedidos on_the_way: driver inactivo o desconectado ──────────────
    // "Desconectado" = is_available=false y el pedido lleva más de reconnect_window_s sin moverse
    const staleOnWay = await query(
      `SELECT o.id, o.last_driver_id, o.reconnect_deadline,
              o.updated_at, dp.is_available, dp.disconnect_penalties
       FROM orders o
       LEFT JOIN driver_profiles dp ON dp.user_id = o.driver_id
       WHERE o.status = 'on_the_way'
         AND o.driver_id IS NOT NULL
         AND (dp.is_available = false OR dp.user_id IS NULL)
         AND o.updated_at < NOW() - INTERVAL '2 minutes'`
    );

    for (const row of staleOnWay.rows) {
      const orderId = row.id;

      if (!row.reconnect_deadline) {
        // Primera vez: establecer deadline
        await query(
          `UPDATE orders
           SET reconnect_deadline = NOW() + ($1 * INTERVAL '1 second'),
               updated_at = NOW()
           WHERE id = $2`,
          [reconnectWindow, orderId]
        );
        console.log(`[stale] order=${shortId(orderId)} on_the_way sin driver activo → reconnect_deadline establecido`);
        continue;
      }

      const deadline = new Date(row.reconnect_deadline);
      if (now < deadline) {
        // Dentro de ventana — esperar
        continue;
      }

      // Ventana expirada — cancelar y penalizar al driver
      console.warn(`[stale] order=${shortId(orderId)} reconnect expirado → cancelando + penalizando driver=${shortId(row.last_driver_id)}`);

      await query(
        `UPDATE orders
         SET status='cancelled',
             cancelled_at=NOW(),
             restaurant_note='[AUTO] Pedido cancelado por desconexión del conductor',
             updated_at=NOW()
         WHERE id=$1`,
        [orderId]
      );

      // Incrementar penalización al driver (por last_driver_id, que persiste aunque se desasigne)
      if (row.last_driver_id) {
        await query(
          `UPDATE driver_profiles
           SET disconnect_penalties = LEAST(disconnect_penalties + 1, 10)
           WHERE user_id = $1`,
          [row.last_driver_id]
        );
      }

      cancelled++;
    }

    // ── 2. Pedidos 'assigned' con driver_id que no existe en driver_profiles ──
    const staleAssigned = await query(
      `SELECT o.id
       FROM orders o
       LEFT JOIN driver_profiles dp ON dp.user_id = o.driver_id
       WHERE o.status = 'assigned'
         AND o.driver_id IS NOT NULL
         AND dp.user_id IS NULL`
    );

    for (const row of staleAssigned.rows) {
      await query(
        `UPDATE orders
         SET driver_id=NULL, status='pending_driver',
             last_driver_id=driver_id, updated_at=NOW()
         WHERE id=$1`,
        [row.id]
      );
      console.log(`[stale] order=${shortId(row.id)} assigned con driver inexistente → pending_driver`);
      reassigned++;
    }

    // ── 3. Pedidos activos sin driver y sin oferta activa → re-enquelar ──────
    const orphans = await query(
      `SELECT o.id
       FROM orders o
       WHERE o.driver_id IS NULL
         AND o.status IN ('created','pending_driver')
         AND NOT EXISTS (
           SELECT 1 FROM order_driver_offers od
           WHERE od.order_id=o.id AND od.status='pending'
         )`
    );

    for (const row of orphans.rows) {
      if (!hasActiveChain(row.id)) {
        serializedOffer(row.id, offerNextDrivers, onOffer);
        requeued++;
      }
    }

  } catch (e) {
    console.error('[stale] error en cleanStaleEntities:', e.message);
  }

  return {
    checked:    staleOnWay?.rowCount ?? 0,
    requeued,
    cancelled,
    reassigned,
  };
}
