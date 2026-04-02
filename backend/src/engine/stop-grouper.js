// backend/src/engine/stop-grouper.js
//
// Agrupa filas de pedidos activos en stops de pickup/delivery.
//
// Reemplaza el bloque pickupByRestaurant duplicado en reroute.js
// y route-simulator.js. Ambos módulos llaman a groupPickupStops()
// con las filas de su query respectiva.
//
// LÓGICA DE AGRUPACIÓN:
//   - Key del Map: celda de grilla de 75m (posToGridKey) en lugar de
//     restaurant_id. Dos restaurantes a menos de 75m entre sí se tratan
//     como la misma parada física.
//   - kitchenReadyAtSecs[]: array individual por pedido para trazabilidad.
//   - maxKitchenReadyAtSec: precalculado, actualizado al agregar pedidos.
//   - Gap de cocina: si |nuevo.kitchenReadyAt - existing.maxKitchenReadyAt|
//     supera kitchen_gap_threshold_s, el pedido NO se agrupa — se crea
//     un stop independiente aunque esté en la misma celda de grilla.
//     Esto evita que un pedido listo espere horas a uno con sobredemanda.

import { posToGridKey } from '../utils/geo.js';
import { getParam } from './params.js';

/**
 * Construye stops de pickup agrupados por grilla con validación de gap de cocina.
 *
 * @param {Array} rows  — filas de query con campos:
 *   id, status, rest_lat, rest_lng, cust_lat, cust_lng,
 *   volume_liters, kitchen_estimated_ready, restaurant_id,
 *   picked_up_at (opcional), max_delivery_time_s (opcional),
 *   created_at (opcional)
 * @param {number} nowSec  — Date.now() / 1000
 * @param {'simulator'|'reroute'} mode
 *   'simulator' — produce campos compatibles con SimStop (orderIds[], pickedUpAt)
 *   'reroute'   — produce campos compatibles con RerouteStop (pairOrderId, slaDeadlineSec)
 *
 * @returns {{ pickupStops: Map<string, object>, stops: Array }}
 *   pickupStops: gridKey → stop (para resolver pairOrderId en deliveries)
 *   stops: array ordenado de todos los stops (pickups + deliveries)
 */
export function groupPickupStops(rows, nowSec, mode = 'reroute') {
  const kitchenGapThreshold = getParam('kitchen_gap_threshold_s', 600);

  // gridKey → stop de pickup
  // Puede haber múltiples stops por celda si el gap de cocina los separa
  // Se usa un array por key para manejar ese caso
  const pickupsByGrid = new Map(); // gridKey → stop[] (uno o más si hay gap)
  const stops = [];

  for (const row of rows) {
    const restLat = Number(row.rest_lat);
    const restLng = Number(row.rest_lng);
    const validRestPos = Number.isFinite(restLat) && Number.isFinite(restLng);

    const custLat = Number(row.cust_lat);
    const custLng = Number(row.cust_lng);
    const validCustPos = Number.isFinite(custLat) && Number.isFinite(custLng);

    const kitchenReadyAtSec = row.kitchen_estimated_ready
      ? new Date(row.kitchen_estimated_ready).getTime() / 1000
      : nowSec;

    // ── Pickup pendiente ──────────────────────────────────────────────────
    if (row.status !== 'on_the_way' && validRestPos) {
      const gridKey = posToGridKey({ lat: restLat, lng: restLng });
      const existing = _findCompatiblePickup(pickupsByGrid, gridKey, kitchenReadyAtSec, kitchenGapThreshold);

      if (existing) {
        // Agregar al stop existente
        existing.maxKitchenReadyAtSec = Math.max(existing.maxKitchenReadyAtSec, kitchenReadyAtSec);
        existing.kitchenReadyAtSecs.push(kitchenReadyAtSec);
        existing.volumeLiters += Number(row.volume_liters) || 0;

        if (mode === 'simulator') {
          existing.orderIds.push(row.id);
          existing.kitchenReadyAtSec = existing.maxKitchenReadyAtSec;
        }
      } else {
        // Crear nuevo stop — ya sea primera entrada de la celda o gap incompatible
        const stop = mode === 'simulator'
          ? _makeSimStop(row, restLat, restLng, kitchenReadyAtSec, nowSec)
          : _makeRerouteStop(row, restLat, restLng, kitchenReadyAtSec, nowSec);

        if (!pickupsByGrid.has(gridKey)) pickupsByGrid.set(gridKey, []);
        pickupsByGrid.get(gridKey).push(stop);
        stops.push(stop);
      }
    }

    // ── Delivery pendiente ────────────────────────────────────────────────
    if (validCustPos) {
      if (mode === 'simulator') {
        const pickedUpAt = row.picked_up_at ? new Date(row.picked_up_at) : null;
        stops.push({
          type:             'delivery',
          orderIds:         [row.id],
          orderId:          row.id,
          pos:              { lat: custLat, lng: custLng },
          pickedUpAt,
          volumeLiters:     Number(row.volume_liters) || 0,
          kitchenReadyAtSec: nowSec,
          slaDeadlineSec:   (pickedUpAt ? pickedUpAt.getTime() / 1000 : nowSec)
                            + Number(row.max_delivery_time_s ?? 1800),
          pairOrderId:      row.id,
        });
      } else {
        // reroute — resolver pairOrderId desde el stop de pickup agrupado
        const restLat2 = Number(row.rest_lat);
        const restLng2 = Number(row.rest_lng);
        const validRest2 = Number.isFinite(restLat2) && Number.isFinite(restLng2);
        const gridKey   = validRest2 ? posToGridKey({ lat: restLat2, lng: restLng2 }) : null;
        const gridStops = gridKey ? pickupsByGrid.get(gridKey) : null;
        const pickupStop = gridStops
          ? _findCompatiblePickup({ get: k => ({ [k]: gridStops }[k] ?? null), has: () => true },
              gridKey, kitchenReadyAtSec, kitchenGapThreshold)
          : null;

        const pairId = (pickupStop && row.status !== 'on_the_way')
          ? pickupStop.orderId
          : row.id;

        const pickedUpAtSec = row.picked_up_at
          ? new Date(row.picked_up_at).getTime() / 1000
          : null;
        const slaBase        = pickedUpAtSec ?? nowSec;
        const slaDeadlineSec = slaBase + Number(row.max_delivery_time_s ?? 1800);

        stops.push({
          type:             'delivery',
          orderId:          row.id,
          pairOrderId:      pairId,
          pos:              { lat: custLat, lng: custLng },
          pickedUpAtSec,
          slaDeadlineSec,
          kitchenReadyAtSec,
          volumeLiters:     Number(row.volume_liters) || 0,
        });
      }
    }
  }

  return { pickupsByGrid, stops };
}

// ─── Helpers privados ─────────────────────────────────────────────────────────

/**
 * Busca un stop de pickup existente en la celda de grilla que sea compatible
 * con el kitchenReadyAtSec del nuevo pedido (gap <= threshold).
 * Retorna el primer stop compatible o null si no hay ninguno.
 */
function _findCompatiblePickup(pickupsByGrid, gridKey, kitchenReadyAtSec, threshold) {
  const existing = pickupsByGrid.get?.(gridKey);
  if (!existing) return null;
  const arr = Array.isArray(existing) ? existing : [existing];
  for (const stop of arr) {
    if (Math.abs(kitchenReadyAtSec - stop.maxKitchenReadyAtSec) <= threshold) {
      return stop;
    }
  }
  return null;
}

function _makeSimStop(row, restLat, restLng, kitchenReadyAtSec, nowSec) {
  return {
    type:                 'pickup',
    orderIds:             [row.id],
    orderId:              row.id,
    pos:                  { lat: restLat, lng: restLng },
    pickedUpAt:           null,
    volumeLiters:         Number(row.volume_liters) || 0,
    kitchenReadyAtSec,
    maxKitchenReadyAtSec: kitchenReadyAtSec,
    kitchenReadyAtSecs:   [kitchenReadyAtSec],
  };
}

function _makeRerouteStop(row, restLat, restLng, kitchenReadyAtSec, nowSec) {
  const pickedUpAtSec  = null;
  const slaDeadlineSec = nowSec + Number(row.max_delivery_time_s ?? 1800);
  return {
    type:                 'pickup',
    orderId:              row.id,
    pairOrderId:          row.id,
    pos:                  { lat: restLat, lng: restLng },
    pickedUpAtSec,
    slaDeadlineSec,
    kitchenReadyAtSec,
    maxKitchenReadyAtSec: kitchenReadyAtSec,
    kitchenReadyAtSecs:   [kitchenReadyAtSec],
    volumeLiters:         Number(row.volume_liters) || 0,
    restaurantId:         row.restaurant_id,
  };
}
