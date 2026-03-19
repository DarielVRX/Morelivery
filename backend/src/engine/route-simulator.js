// backend/src/engine/route-simulator.js
//
// RouteInsertionSimulator adaptado para producción.
// Simula la ruta completa del driver incluyendo el nuevo pedido,
// calculando el ETA real hacia el cliente nuevo y verificando
// que no se rompa el SLA de los pedidos ya asignados.
//
// A diferencia del simulador, los stops activos del driver
// se cargan desde la DB (no de world.orders en memoria).

import { query } from '../config/db.js';
import { haversineMeters } from '../utils/geo.js';
import { etaEstimator } from './eta.js';
import { getParam } from './params.js';
import { ACTIVE_STATUSES } from '../modules/orders/assignment/constants.js';

/**
 * Carga los pedidos activos del driver con sus coordenadas.
 * Devuelve stops ordenados: primero pickups pendientes, luego deliveries.
 *
 * @param {string} driverId
 * @returns {Promise<Array<{ type: 'pickup'|'delivery', orderId: string, pos: {lat,lng}, pickedUpAt: Date|null }>>}
 */
async function loadDriverStops(driverId) {
  const r = await query(
    `SELECT
       o.id,
       o.status,
       o.picked_up_at,
       o.delivery_lat    AS cust_lat,
       o.delivery_lng    AS cust_lng,
       COALESCE(ru.home_lat, rest.lat) AS rest_lat,
       COALESCE(ru.home_lng, rest.lng) AS rest_lng
     FROM orders o
     JOIN restaurants rest ON rest.id = o.restaurant_id
     LEFT JOIN users ru ON ru.id = rest.owner_user_id
     JOIN users cu ON cu.id = o.customer_id
     WHERE o.driver_id = $1
       AND o.status = ANY($2::text[])
     ORDER BY o.accepted_at ASC NULLS LAST`,
    [driverId, ACTIVE_STATUSES]
  );

  const stops = [];
  for (const row of r.rows) {
    // Pickup pendiente (no recogido aún)
    if (row.status !== 'on_the_way' && row.rest_lat && row.rest_lng) {
      stops.push({
        type:      'pickup',
        orderId:   row.id,
        pos:       { lat: Number(row.rest_lat), lng: Number(row.rest_lng) },
        pickedUpAt: null,
      });
    }
    // Delivery pendiente
    if (row.cust_lat && row.cust_lng) {
      stops.push({
        type:       'delivery',
        orderId:    row.id,
        pos:        { lat: Number(row.cust_lat), lng: Number(row.cust_lng) },
        pickedUpAt: row.picked_up_at ? new Date(row.picked_up_at) : null,
      });
    }
  }

  return stops;
}

/**
 * Simula la ruta del driver incluyendo el nuevo pedido y calcula:
 * - etaToNewCustomer: segundos hasta entregar el nuevo pedido
 * - valid: no rompe SLA del nuevo pedido
 * - validExisting: no rompe SLA de pedidos ya asignados
 * - slaBreaches: lista de order IDs con SLA roto
 *
 * @param {object} candidate    — de CandidateFinder
 * @param {object} order        — { id, restaurant_id, customer_id }
 * @param {{ lat, lng }} restaurantPos
 * @param {{ lat, lng }} customerPos
 * @param {number} nowSec       — Date.now() / 1000
 * @returns {Promise<object>}
 */
export async function simulateDriverWithOrder(candidate, order, restaurantPos, customerPos, nowSec) {
  const driver      = candidate.driver;
  const driverPos   = { ...driver.pos };
  const driverObj   = { speed_kmh: driver.speedKmh };
  const maxSla      = getParam('max_delivery_time_s', 1800);

  // Estado de simulación: orderId → { status, pickedUpAtSec }
  const simState = {};

  // Cargar stops actuales del driver
  const existingStops = await loadDriverStops(driver.id);
  for (const stop of existingStops) {
    if (!simState[stop.orderId]) {
      simState[stop.orderId] = {
        status:      stop.type === 'delivery' && stop.pickedUpAt ? 'on_the_way' : 'assigned',
        pickedUpAtSec: stop.pickedUpAt ? stop.pickedUpAt.getTime() / 1000 : null,
      };
    }
  }

  // Añadir el nuevo pedido
  simState[order.id] = {
    status:        'assigned',
    pickedUpAtSec: null,
    isNew:         true,
  };

  let currentPos = { ...driverPos };
  let simNow     = nowSec;
  let etaToNewCustomer = Infinity;
  let pickupDone = false;

  const maxIter = (existingStops.length + 1) * 6 + 10;

  for (let i = 0; i < maxIter; i++) {
    // Construir stops activos desde el estado actual
    const activeStops = [];

    for (const stop of existingStops) {
      const state = simState[stop.orderId];
      if (!state) continue;
      if (stop.type === 'pickup' && state.status === 'assigned') {
        activeStops.push(stop);
      }
      if (stop.type === 'delivery' && state.status === 'on_the_way') {
        activeStops.push(stop);
      }
    }

    // Agregar el nuevo pedido
    if (!pickupDone) {
      activeStops.push({ type: 'pickup', orderId: order.id, pos: restaurantPos });
    } else if (simState[order.id]?.status === 'on_the_way') {
      activeStops.push({ type: 'delivery', orderId: order.id, pos: customerPos });
    }

    // Filtrar stops ya procesados
    const pending = activeStops.filter(s => {
      const st = simState[s.orderId];
      if (!st) return false;
      if (s.type === 'pickup')   return st.status === 'assigned';
      if (s.type === 'delivery') return st.status === 'on_the_way';
      return false;
    });

    if (pending.length === 0) break;

    // Detectar entregas urgentes (SLA casi vencido)
    const urgent = pending.filter(s => {
      if (s.type !== 'delivery') return false;
      const st = simState[s.orderId];
      if (!st?.pickedUpAtSec) return false;
      const elapsed   = simNow - st.pickedUpAtSec;
      const remaining = maxSla - elapsed;
      const etaDirect = etaEstimator.estimateSync(currentPos, s.pos, driverObj);
      return etaDirect >= remaining;
    });

    // Elegir siguiente stop: urgentes primero, luego el más cercano
    const pool    = urgent.length > 0 ? urgent : pending;
    let nextStop  = pool[0];
    let bestDist  = haversineMeters(currentPos, pool[0].pos);
    for (const s of pool.slice(1)) {
      const d = haversineMeters(currentPos, s.pos);
      if (d < bestDist) { bestDist = d; nextStop = s; }
    }

    // Moverse al siguiente stop
    const travelSec = await etaEstimator.estimate(currentPos, nextStop.pos, driverObj);
    simNow     += travelSec;
    currentPos  = { ...nextStop.pos };

    const state = simState[nextStop.orderId];
    if (!state) break;

    if (nextStop.type === 'pickup') {
      // Esperar cocina si corresponde — se omite en simulación (el kitchen engine lo maneja)
      state.status      = 'on_the_way';
      state.pickedUpAtSec = simNow;

      if (nextStop.orderId === order.id) {
        pickupDone = true;
      }
    } else {
      state.status = 'delivered';

      if (nextStop.orderId === order.id) {
        etaToNewCustomer = simNow - nowSec;
      }
    }
  }

  // Verificar SLA del nuevo pedido
  const delay = Math.max(0, etaToNewCustomer - maxSla);
  const valid  = Number.isFinite(etaToNewCustomer) && delay === 0;

  // Verificar SLA de pedidos existentes on_the_way
  const slaBreaches = [];
  for (const stop of existingStops) {
    if (stop.type !== 'delivery') continue;
    const st = simState[stop.orderId];
    if (!st || st.status !== 'delivered') continue;
    const pickedUp = st.pickedUpAtSec ?? nowSec;
    // Buscar el delivered simNow (aproximación: si se entregó usamos simNow como proxy)
    // El cálculo es conservador
    if (st.status === 'delivered') {
      const elapsed = simNow - pickedUp;
      if (elapsed > maxSla) slaBreaches.push(stop.orderId);
    }
  }

  const validExisting = slaBreaches.length === 0;

  return {
    ...candidate,
    etaToNewCustomer,
    valid:         valid && validExisting,
    validExisting,
    slaBreaches,
    newOrderDelay: delay,
    totalCost:     etaToNewCustomer + delay,
  };
}
