// frontend/src/sim/SimRerouteEngine.js
// Porte de reroute.js y stop-grouper.js a browser.
// Recalcula secuencia óptima de stops para un driver.
// Emite route_update con geometry y firstSegmentLength.

import { getSimWorld } from './SimWorld.js';

// ──────────────────────────────────────────────────────────────────────────
// Parámetros (mismos que engine/params.js)
// ──────────────────────────────────────────────────────────────────────────

const PARAMS = {
  max_delivery_time_s: 1800,
  sla_critical_threshold_s: 600,
  sla_warning_threshold_s: 1200,
  reroute_lock_radius_m: 200,
  kitchen_gap_threshold_s: 600,
};

function getParam(key, fallback) {
  return PARAMS[key] ?? fallback ?? 0;
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers geográficos
// ──────────────────────────────────────────────────────────────────────────

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ──────────────────────────────────────────────────────────────────────────
// OSRM Geometría (para obtener polyline de ruta)
// ──────────────────────────────────────────────────────────────────────────

async function getRouteGeometry(from, to) {
  if (!from || !to) return [];
  
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
  
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const data = await res.json();
    const coords = data?.routes?.[0]?.geometry?.coordinates;
    if (!Array.isArray(coords)) return [];
    // GeoJSON usa [lng, lat] → convertir a {lat, lng}
    return coords.map(([lng, lat]) => ({ lat, lng }));
  } catch (e) {
    console.warn('[SimReroute] OSRM geometry error:', e);
    return [];
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Agrupar stops de pickup por restaurante (portado de stop-grouper.js)
// ──────────────────────────────────────────────────────────────────────────

function groupPickupStops(orders, nowSec) {
  const pickupsByRestaurant = new Map();
  const stops = [];

  for (const order of orders) {
    const kitchenReadyAtSec = order.kitchen_estimated_ready
      ? new Date(order.kitchen_estimated_ready).getTime() / 1000
      : nowSec;
    
    const createdAtSec = order.created_at
      ? new Date(order.created_at).getTime() / 1000
      : nowSec;
    const maxSla = getParam('max_delivery_time_s', 1800);
    const slaDeadlineSec = createdAtSec + maxSla;

    // Pickup pendiente (si no ha sido recogido)
    if (order.status !== 'on_the_way' && order.status !== 'delivered') {
      const restId = order.restaurant_id;
      
      if (pickupsByRestaurant.has(restId)) {
        const existing = pickupsByRestaurant.get(restId);
        existing.orderIds.push(order.id);
        existing.kitchenReadyAtSec = Math.max(existing.kitchenReadyAtSec, kitchenReadyAtSec);
        existing.slaDeadlineSec = Math.min(existing.slaDeadlineSec, slaDeadlineSec);
      } else {
        pickupsByRestaurant.set(restId, {
          type: 'pickup',
          orderId: order.id,
          orderIds: [order.id],
          restaurantId: restId,
          restaurantName: order.restaurant_name,
          pos: { lat: order.restaurant_lat, lng: order.restaurant_lng },
          kitchenReadyAtSec,
          slaDeadlineSec,
        });
      }
    }
  }

  // Agregar pickups agrupados
  for (const pickup of pickupsByRestaurant.values()) {
    stops.push(pickup);
  }

  // Agregar deliveries (uno por pedido)
  for (const order of orders) {
    if (order.status !== 'delivered') {
      // Encontrar el pickup asociado
      const associatedPickup = pickupsByRestaurant.get(order.restaurant_id);
      const pairOrderId = associatedPickup?.orderId || order.id;
      
      stops.push({
        type: 'delivery',
        orderId: order.id,
        orderIds: [order.id],
        pairOrderId,
        pos: { lat: order.customer_lat, lng: order.customer_lng },
        pickedUpAt: order.picked_up_at,
        slaDeadlineSec: new Date(order.created_at).getTime() / 1000 + getParam('max_delivery_time_s', 1800),
      });
    }
  }

  return stops;
}

// ──────────────────────────────────────────────────────────────────────────
// Selección del siguiente stop (greedy con SLA condicional)
// ──────────────────────────────────────────────────────────────────────────

function selectNextStop(viableStops, allStops, fromPos, driverObj, nowSec) {
  const criticalThreshold = getParam('sla_critical_threshold_s', 600);
  const warningThreshold = getParam('sla_warning_threshold_s', 1200);

  // Mapa de urgencia SLA por pairOrderId
  const deliverySlaByPairId = new Map();
  for (const stop of allStops) {
    if (stop.type === 'delivery') {
      deliverySlaByPairId.set(stop.pairOrderId, stop.slaDeadlineSec);
    }
  }

  // Enriquecer stops viables
  const enriched = viableStops.map(stop => {
    const dist = haversineMeters(fromPos.lat, fromPos.lng, stop.pos.lat, stop.pos.lng);
    const effectiveSla = stop.type === 'pickup'
      ? (deliverySlaByPairId.get(stop.orderId) ?? stop.slaDeadlineSec)
      : stop.slaDeadlineSec;
    const remaining = effectiveSla - nowSec;

    let zone;
    if (remaining < criticalThreshold) zone = 'critical';
    else if (remaining < warningThreshold) zone = 'warning';
    else zone = 'normal';

    return { stop, dist, remaining, zone };
  });

  const critical = enriched.filter(e => e.zone === 'critical');
  const warning = enriched.filter(e => e.zone === 'warning');

  if (critical.length > 0) {
    critical.sort((a, b) => a.remaining !== b.remaining ? a.remaining - b.remaining : a.dist - b.dist);
    return critical[0].stop;
  }

  if (warning.length > 0) {
    warning.sort((a, b) => a.remaining !== b.remaining ? a.remaining - b.remaining : a.dist - b.dist);
    return warning[0].stop;
  }

  // Normal: greedy por distancia
  enriched.sort((a, b) => a.dist - b.dist);
  return enriched[0].stop;
}

// ──────────────────────────────────────────────────────────────────────────
// Encontrar secuencia óptima (portado de reroute.js)
// ──────────────────────────────────────────────────────────────────────────

function findOptimalSequence(stops, driverPos, driverObj, nowSec) {
  if (stops.length === 0) return [];
  if (stops.length === 1) return stops;

  const lockRadiusM = getParam('reroute_lock_radius_m', 200);
  
  // Set de pairOrderIds ya recogidos
  const pickedUp = new Set(
    stops
      .filter(s => s.type === 'delivery' && s.pickedUpAt !== null)
      .map(s => s.pairOrderId)
  );

  const sequence = [];
  const remaining = [...stops];

  // Locked stop guard: si el driver está dentro del radio de lock, ese stop va primero
  let lockedStop = null;
  for (const stop of remaining) {
    const dist = haversineMeters(driverPos.lat, driverPos.lng, stop.pos.lat, stop.pos.lng);
    if (dist <= lockRadiusM) {
      if (stop.type === 'pickup' || pickedUp.has(stop.pairOrderId)) {
        lockedStop = stop;
        break;
      }
    }
  }

  if (lockedStop) {
    sequence.push(lockedStop);
    const idx = remaining.indexOf(lockedStop);
    if (idx !== -1) remaining.splice(idx, 1);
    if (lockedStop.type === 'pickup') pickedUp.add(lockedStop.orderId);
  }

  let currentPos = lockedStop ? lockedStop.pos : driverPos;

  while (remaining.length > 0) {
    const viable = remaining.filter(s =>
      s.type === 'pickup' || pickedUp.has(s.pairOrderId)
    );

    if (viable.length === 0) break;

    const next = selectNextStop(viable, stops, currentPos, driverObj, nowSec);
    sequence.push(next);
    const idx = remaining.indexOf(next);
    if (idx !== -1) remaining.splice(idx, 1);
    if (next.type === 'pickup') pickedUp.add(next.orderId);
    currentPos = next.pos;
  }

  return sequence;
}

// ──────────────────────────────────────────────────────────────────────────
// Construir geometría completa de la ruta
// ──────────────────────────────────────────────────────────────────────────

async function buildRouteGeometry(sequence, driverPos) {
  if (sequence.length === 0) return { geometry: [], firstSegmentLength: 0 };

  const points = [driverPos, ...sequence.map(s => s.pos)];
  const geometries = [];
  let firstSegmentLength = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const geom = await getRouteGeometry(points[i], points[i + 1]);
    if (i === 0) firstSegmentLength = geom.length;
    geometries.push(...geom);
  }

  return { geometry: geometries, firstSegmentLength };
}

// ──────────────────────────────────────────────────────────────────────────
// Motor principal de reroute
// ──────────────────────────────────────────────────────────────────────────

class SimRerouteEngine {
  constructor(simWorld, simClock) {
    this.simWorld = simWorld;
    this.simClock = simClock;
    this._pendingReroutes = new Map(); // driverId -> Promise
  }

  /**
   * Recalcula la ruta óptima para un driver y emite route_update.
   * @param {string} driverId
   * @returns {Promise<Object|null>} { stops, geometry, firstSegmentLength } o null
   */
  async rerouteDriver(driverId) {
    // Evitar reroutes concurrentes para el mismo driver
    if (this._pendingReroutes.has(driverId)) {
      return this._pendingReroutes.get(driverId);
    }

    const promise = this._doReroute(driverId);
    this._pendingReroutes.set(driverId, promise);
    
    try {
      const result = await promise;
      return result;
    } finally {
      this._pendingReroutes.delete(driverId);
    }
  }

  async _doReroute(driverId) {
    const driver = this.simWorld.getDriver(driverId);
    if (!driver) return null;

    // Obtener pedidos activos del driver
    const activeOrders = driver.activeOrders
      .map(orderId => this.simWorld.getOrder(orderId))
      .filter(o => o && o.status !== 'delivered' && o.status !== 'cancelled');

    if (activeOrders.length === 0) {
      // Sin pedidos activos: emitir route_update vacío
      this.simWorld.eventBus.emit('route_update', {
        driverId,
        stops: [],
        geometry: [],
        firstSegmentLength: 0,
        totalStops: 0,
      });
      return null;
    }

    const nowSec = this.simClock.getSimTime();
    const driverPos = { lat: driver.last_lat, lng: driver.last_lng };
    const driverObj = { speed_kmh: this._getDriverSpeedKmh(driver.vehicle_type) };

    // Agrupar stops (pickup + delivery)
    const stops = groupPickupStops(activeOrders, nowSec);

    // Encontrar secuencia óptima
    const optimalSequence = findOptimalSequence(stops, driverPos, driverObj, nowSec);

    // Construir geometría de ruta
    const { geometry, firstSegmentLength } = await buildRouteGeometry(optimalSequence, driverPos);

    // Calcular ETAs para cada stop
    let currentPos = driverPos;
    let accumulatedTime = 0;
    const stopsWithEta = [];

    for (const stop of optimalSequence) {
      const etaSec = await this._estimateEta(currentPos, stop.pos, driverObj.speed_kmh);
      accumulatedTime += etaSec;
      
      stopsWithEta.push({
        type: stop.type,
        orderId: stop.orderId,
        orderIds: stop.orderIds,
        pos: stop.pos,
        etaFromNowSec: Math.round(accumulatedTime),
        slaDeadlineSec: Math.round(stop.slaDeadlineSec),
        slaRemainingSec: Math.round(stop.slaDeadlineSec - nowSec - accumulatedTime),
      });
      
      currentPos = stop.pos;
      
      // Si es pickup, añadir tiempo de espera en cocina
      if (stop.type === 'pickup' && stop.kitchenReadyAtSec) {
        const waitSec = Math.max(0, stop.kitchenReadyAtSec - (nowSec + accumulatedTime));
        if (waitSec > 0) {
          accumulatedTime += waitSec;
        }
      }
    }

    const routeUpdatePayload = {
      driverId,
      stops: stopsWithEta,
      geometry,
      firstSegmentLength,
      totalStops: stopsWithEta.length,
    };

    // Emitir evento route_update (mismo formato que backend SSE)
    this.simWorld.eventBus.emit('route_update', routeUpdatePayload);
    
    this.simWorld._logEngine('reroute', {
      driverId,
      stopsCount: stopsWithEta.length,
      geometryPoints: geometry.length,
      firstSegmentLength,
    });

    return routeUpdatePayload;
  }

  /**
   * Obtiene velocidad en km/h según tipo de vehículo.
   * @param {string} vehicleType
   * @returns {number}
   */
  _getDriverSpeedKmh(vehicleType) {
    switch (vehicleType) {
      case 'bike': return 20;
      case 'motorcycle': return 40;
      case 'car': return 30;
      default: return 30;
    }
  }

  /**
   * Estima ETA entre dos puntos usando OSRM.
   * @param {Object} from
   * @param {Object} to
   * @param {number} speedKmh
   * @returns {Promise<number>}
   */
  async _estimateEta(from, to, speedKmh = 30) {
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`;
    
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error('OSRM failed');
      const data = await res.json();
      const durationS = data?.routes?.[0]?.duration;
      if (durationS && speedKmh !== 30) {
        return Math.round(durationS * (30 / speedKmh));
      }
      return Math.round(durationS || 0);
    } catch (e) {
      const dist = haversineMeters(from.lat, from.lng, to.lat, to.lng);
      const speedMs = Math.max(1, (speedKmh * 1000) / 3600);
      return Math.round(dist / speedMs);
    }
  }

  /**
   * Limpia recursos.
   */
  destroy() {
    this._pendingReroutes.clear();
  }
}

// Singleton export
let instance = null;

export function getSimRerouteEngine(simWorld, simClock) {
  if (!instance) {
    instance = new SimRerouteEngine(simWorld, simClock);
  }
  return instance;
}

export default SimRerouteEngine;