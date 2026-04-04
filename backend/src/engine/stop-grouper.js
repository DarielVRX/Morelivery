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
//
// SLA:
//   El deadline corre desde created_at — el cliente empieza a esperar
//   desde que hace el pedido, no desde que el driver lo recoge.

import { posToGridKey } from '../utils/geo.js';
import { getParam } from './params.js';

export function groupPickupStops(rows, nowSec, mode = 'reroute') {
  const kitchenGapThreshold = getParam('kitchen_gap_threshold_s', 600);
  const maxSlaDefault       = getParam('max_delivery_time_s', 3600);

  const pickupsByGrid = new Map();
  const stops = [];

  for (const row of rows) {
    const restLat      = Number(row.rest_lat);
    const restLng      = Number(row.rest_lng);
    const validRestPos = Number.isFinite(restLat) && Number.isFinite(restLng);

    const custLat      = Number(row.cust_lat);
    const custLng      = Number(row.cust_lng);
    const validCustPos = Number.isFinite(custLat) && Number.isFinite(custLng);

    const kitchenReadyAtSec = row.kitchen_estimated_ready
      ? new Date(row.kitchen_estimated_ready).getTime() / 1000
      : nowSec;

    // SLA corre desde created_at
    const createdAtSec   = row.created_at
      ? new Date(row.created_at).getTime() / 1000
      : nowSec;
    const maxSla         = Number(row.max_delivery_time_s ?? maxSlaDefault);
    const slaDeadlineSec = createdAtSec + maxSla;

    // ── Pickup pendiente ──────────────────────────────────────────────────
    if (row.status !== 'on_the_way' && validRestPos) {
      const gridKey  = posToGridKey({ lat: restLat, lng: restLng });
      const existing = _findCompatiblePickup(pickupsByGrid, gridKey, kitchenReadyAtSec, kitchenGapThreshold);

      if (existing) {
        existing.maxKitchenReadyAtSec = Math.max(existing.maxKitchenReadyAtSec, kitchenReadyAtSec);
        existing.kitchenReadyAtSecs.push(kitchenReadyAtSec);
        existing.volumeLiters += Number(row.volume_liters) || 0;
        // slaDeadlineSec del grupo = el más urgente (el más antiguo)
        existing.slaDeadlineSec = Math.min(existing.slaDeadlineSec, slaDeadlineSec);

        if (mode === 'simulator') {
          existing.orderIds.push(row.id);
          existing.kitchenReadyAtSec = existing.maxKitchenReadyAtSec;
        } else {
          existing.orderIds.push(row.id); // P4: acumular en modo reroute también
        }
      } else {
        const stop = mode === 'simulator'
          ? _makeSimStop(row, restLat, restLng, kitchenReadyAtSec, slaDeadlineSec)
          : _makeRerouteStop(row, restLat, restLng, kitchenReadyAtSec, slaDeadlineSec);

        if (!pickupsByGrid.has(gridKey)) pickupsByGrid.set(gridKey, []);
        pickupsByGrid.get(gridKey).push(stop);
        stops.push(stop);
      }
    }

    // ── Delivery pendiente ────────────────────────────────────────────────
    if (validCustPos) {
      const pickedUpAtSec = row.picked_up_at
        ? new Date(row.picked_up_at).getTime() / 1000
        : null;

      if (mode === 'simulator') {
        const pickedUpAt = row.picked_up_at ? new Date(row.picked_up_at) : null;
        stops.push({
          type:              'delivery',
          orderIds:          [row.id],
          orderId:           row.id,
          pos:               { lat: custLat, lng: custLng },
          pickedUpAt,
          volumeLiters:      Number(row.volume_liters) || 0,
          kitchenReadyAtSec: nowSec,
          slaDeadlineSec,
          pairOrderId:       row.id,
        });
      } else {
        const validRest2 = Number.isFinite(Number(row.rest_lat)) && Number.isFinite(Number(row.rest_lng));
        const gridKey2   = validRest2
          ? posToGridKey({ lat: Number(row.rest_lat), lng: Number(row.rest_lng) })
          : null;
        const gridStops  = gridKey2 ? pickupsByGrid.get(gridKey2) : null;
        const pickupStop = gridStops
          ? _findCompatiblePickupFromArray(gridStops, kitchenReadyAtSec, kitchenGapThreshold)
          : null;

        const pairId = (pickupStop && row.status !== 'on_the_way')
          ? pickupStop.orderId
          : row.id;

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

function _findCompatiblePickup(pickupsByGrid, gridKey, kitchenReadyAtSec, threshold) {
  const existing = pickupsByGrid.get(gridKey);
  if (!existing) return null;
  return _findCompatiblePickupFromArray(existing, kitchenReadyAtSec, threshold);
}

function _findCompatiblePickupFromArray(arr, kitchenReadyAtSec, threshold) {
  for (const stop of arr) {
    if (Math.abs(kitchenReadyAtSec - stop.maxKitchenReadyAtSec) <= threshold) {
      return stop;
    }
  }
  return null;
}

function _makeSimStop(row, restLat, restLng, kitchenReadyAtSec, slaDeadlineSec) {
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
    slaDeadlineSec,
  };
}

function _makeRerouteStop(row, restLat, restLng, kitchenReadyAtSec, slaDeadlineSec) {
  return {
    type:                 'pickup',
    orderId:              row.id,
    orderIds:             [row.id], // P4: array para badge multi-pedido
    pairOrderId:          row.id,
    pos:                  { lat: restLat, lng: restLng },
    pickedUpAtSec:        null,
    slaDeadlineSec,
    kitchenReadyAtSec,
    maxKitchenReadyAtSec: kitchenReadyAtSec,
    kitchenReadyAtSecs:   [kitchenReadyAtSec],
    volumeLiters:         Number(row.volume_liters) || 0,
    restaurantId:         row.restaurant_id,
  };
}
