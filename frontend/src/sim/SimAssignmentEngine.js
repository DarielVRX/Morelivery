// frontend/src/sim/SimAssignmentEngine.js
// Porte de scoring.js, candidate-finder.js y assignment/core.js a browser.
// Lee candidatos de SimWorld en lugar de Postgres.
// Usa OSRM browser para ETAs.

import { getSimWorld } from './SimWorld.js';

// ──────────────────────────────────────────────────────────────────────────
// Parámetros (mismos que engine/params.js)
// ──────────────────────────────────────────────────────────────────────────

const PARAMS = {
  // Asignación
  offer_timeout_s: 60,
  cooldown_s: 300,
  max_active_orders_per_driver: 4,
  assignment_hard_top_k: 5,
  max_pickup_radius_km: 5,
  simulation_budget_per_tick: 75,
  
  // Scoring
  fairness_penalty_per_order_s: 120,
  soft_sla_penalty_factor: 3,
  hard_sla_penalty_s: 1800,
  pickup_bridge_penalty_factor: 1,
  nearby_driver_preference_m: 250,
  max_delivery_time_s: 1800,
  disconnect_penalty_s: 300,
  disconnect_penalty_max: 3,
  
  // Otros
  default_bag_capacity_liters: 60,
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
// OSRM ETA (browser directo)
// ──────────────────────────────────────────────────────────────────────────

async function estimateEta(from, to, speedKmh = 30) {
  if (!from || !to) return 0;
  
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`;
  
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error('OSRM failed');
    const data = await res.json();
    const durationS = data?.routes?.[0]?.duration;
    if (durationS && speedKmh !== 30) {
      // Escalar por velocidad del driver (OSRM asume 30 km/h promedio)
      return Math.round(durationS * (30 / speedKmh));
    }
    return Math.round(durationS || 0);
  } catch (e) {
    // Fallback a haversine
    const dist = haversineMeters(from.lat, from.lng, to.lat, to.lng);
    const speedMs = Math.max(1, (speedKmh * 1000) / 3600);
    return Math.round(dist / speedMs);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Velocidad por tipo de vehículo
// ──────────────────────────────────────────────────────────────────────────

function speedKmhByVehicle(vehicleType) {
  switch (vehicleType) {
    case 'bike': return 20;
    case 'motorcycle': return 40;
    case 'car': return 30;
    default: return 30;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Scoring (portado de scoring.js)
// ──────────────────────────────────────────────────────────────────────────

function scoreCandidate(candidate, customer, driverPenalties = 0) {
  const fairnessWeight = getParam('fairness_penalty_per_order_s', 120);
  const softSlaWeight = getParam('soft_sla_penalty_factor', 3);
  const hardPenalty = getParam('hard_sla_penalty_s', 1800);
  const bridgeWeight = getParam('pickup_bridge_penalty_factor', 1);
  const disconnectPenaltyS = getParam('disconnect_penalty_s', 300);
  const maxDeliverySla = getParam('max_delivery_time_s', 1800);

  const activeOrders = candidate.activeOrders ?? 0;
  const fairnessPenalty = activeOrders * fairnessWeight;
  const disconnectPenalty = driverPenalties * disconnectPenaltyS;

  const maxSla = customer?.max_delivery_time_s ?? maxDeliverySla;
  const eta = candidate.etaToNewCustomer ?? Infinity;
  const delay = Math.max(0, eta - maxSla);
  const softSlaPenalty = delay * softSlaWeight;
  const hardSlaPenalty = delay > 900 ? hardPenalty : 0;

  const bridgePenalty = Math.max(0, candidate.bridgePenaltyS ?? 0) * bridgeWeight;

  const totalCost = eta + fairnessPenalty + softSlaPenalty + hardSlaPenalty + bridgePenalty + disconnectPenalty;

  return {
    totalCost: Number.isFinite(totalCost) ? totalCost : Infinity,
    fairnessPenalty,
    softSlaPenalty,
    hardSlaPenalty,
    bridgePenalty,
    disconnectPenalty,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Encontrar punto de inserción viable (viableStop)
// ──────────────────────────────────────────────────────────────────────────

function getClosestViableStop(driverPos, activeStops, restaurantPos, maxRadiusM) {
  const candidates = [];

  // 1. Posición actual del driver
  const driverDist = haversineMeters(driverPos.lat, driverPos.lng, restaurantPos.lat, restaurantPos.lng);
  if (driverDist < maxRadiusM) {
    candidates.push({
      type: 'driver',
      orderId: null,
      pos: { ...driverPos },
      distToRestaurant: driverDist,
    });
  }

  // 2. Stops activos
  for (const stop of activeStops) {
    const dist = haversineMeters(stop.pos.lat, stop.pos.lng, restaurantPos.lat, restaurantPos.lng);
    if (dist < maxRadiusM) {
      candidates.push({
        type: stop.type,
        orderId: stop.orderId,
        pos: { ...stop.pos },
        distToRestaurant: dist,
      });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.distToRestaurant - b.distToRestaurant);
  return candidates[0];
}

// ──────────────────────────────────────────────────────────────────────────
// Encontrar candidatos (portado de candidate-finder.js)
// ──────────────────────────────────────────────────────────────────────────

async function findCandidates(order, simWorld) {
  const maxRadiusM = getParam('max_pickup_radius_km', 5) * 1000;
  const hardTopK = getParam('assignment_hard_top_k', 5);
  const nearbyPrefM = getParam('nearby_driver_preference_m', 250);

  const restaurant = simWorld.getRestaurant(order.restaurant_id);
  const customer = simWorld.getCustomer(order.customer_id);
  
  if (!restaurant || !customer) return [];

  const restaurantPos = { lat: restaurant.lat, lng: restaurant.lng };
  const customerPos = { lat: customer.lat, lng: customer.lng };

  // Filtrar drivers disponibles
  const drivers = simWorld.getAllDrivers().filter(d => 
    d.is_available && 
    d.activeOrders.length < getParam('max_active_orders_per_driver', 4)
  );

  const envelopes = await Promise.all(
    drivers.map(async (driver) => {
      const driverPos = { lat: driver.last_lat, lng: driver.last_lng };
      const distToRestaurant = haversineMeters(driverPos.lat, driverPos.lng, restaurantPos.lat, restaurantPos.lng);
      
      if (distToRestaurant >= maxRadiusM) return null;

      const driverObj = { speed_kmh: speedKmhByVehicle(driver.vehicle_type) };
      const speedMs = (driverObj.speed_kmh * 1000) / 3600;

      // Stops activos del driver (pedidos pendientes)
      const activeStops = [];
      for (const orderId of driver.activeOrders) {
        const ord = simWorld.getOrder(orderId);
        if (!ord) continue;
        if (ord.status !== 'on_the_way' && ord.status !== 'delivered') {
          activeStops.push({
            type: 'pickup',
            orderId: ord.id,
            pos: { lat: ord.restaurant_lat, lng: ord.restaurant_lng },
          });
        }
        if (ord.status !== 'delivered') {
          activeStops.push({
            type: 'delivery',
            orderId: ord.id,
            pos: { lat: ord.customer_lat, lng: ord.customer_lng },
          });
        }
      }

      const viableStop = getClosestViableStop(driverPos, activeStops, restaurantPos, maxRadiusM);
      if (!viableStop) return null;

      // Calcular ETAs
      const etaToViableStop = await estimateEta(driverPos, viableStop.pos, driverObj.speed_kmh);
      const etaViableToRestaurant = await estimateEta(viableStop.pos, restaurantPos, driverObj.speed_kmh);
      const etaRestaurantToCustomer = await estimateEta(restaurantPos, customerPos, driverObj.speed_kmh);

      const directDriverToRestaurantMeters = distToRestaurant;
      const driverBridgeMeters = Math.max(0, directDriverToRestaurantMeters - (viableStop.distToRestaurant ?? 0));
      const bridgePenaltyS = driverBridgeMeters / speedMs;
      const loadPenalty = driver.activeOrders.length * getParam('fairness_penalty_per_order_s', 120);

      return {
        driver,
        viableStop,
        activeStops,
        etaToViableStop,
        etaViableToRestaurant,
        etaRestaurantToCustomer,
        etaToNewCustomer: etaToViableStop + etaViableToRestaurant + etaRestaurantToCustomer,
        directDriverToRestaurantMeters,
        bridgePenaltyS,
        loadPenalty,
        activeOrders: driver.activeOrders.length,
        driverSpeedKmh: driverObj.speed_kmh,
        disconnectPenalties: 0, // Simulador sin desconexiones
      };
    })
  );

  const validEnvelopes = envelopes.filter(Boolean);
  
  // Ordenar por etaToNewCustomer y tomar top K
  validEnvelopes.sort((a, b) => a.etaToNewCustomer - b.etaToNewCustomer);
  
  // Preferir drivers cercanos
  const preferredNearby = validEnvelopes.filter(c => 
    c.directDriverToRestaurantMeters <= nearbyPrefM ||
    (c.viableStop?.distToRestaurant ?? Infinity) <= nearbyPrefM
  );

  const topDrivers = [...preferredNearby, ...validEnvelopes.slice(0, hardTopK)]
    .filter((c, idx, arr) => arr.findIndex(x => x.driver.id === c.driver.id) === idx)
    .slice(0, hardTopK);

  return topDrivers;
}

// ──────────────────────────────────────────────────────────────────────────
// Simular driver con pedido (portado de route-simulator.js simplificado)
// ──────────────────────────────────────────────────────────────────────────

async function simulateDriverWithOrder(candidate, order, restaurantPos, customerPos, nowSec) {
  const customerObj = { max_delivery_time_s: getParam('max_delivery_time_s', 1800) };
  
  const result = scoreCandidate(candidate, customerObj, 0);
  
  return {
    ...result,
    etaToNewCustomer: candidate.etaToNewCustomer,
    bagOverflowPct: 0, // Simulador simplificado sin volumen
    valid: true,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Motor de asignación principal
// ──────────────────────────────────────────────────────────────────────────

class SimAssignmentEngine {
  constructor(simWorld, simClock) {
    this.simWorld = simWorld;
    this.simClock = simClock;
    this._pendingOffers = new Map(); // orderId -> { driverId, timeoutId, resolve, reject }
    this._activeTimers = new Map();   // driverId -> timeoutId (cooldown)
  }

  /**
   * Busca el mejor candidato para un pedido y envía oferta.
   * @param {string} orderId
   * @returns {Promise<Object|null>} driver asignado o null
   */
  async assignOrder(orderId) {
    const order = this.simWorld.getOrder(orderId);
    if (!order) return null;
    if (order.driver_id) return this.simWorld.getDriver(order.driver_id);
    if (order.status !== 'created' && order.status !== 'assigned') return null;

    const candidates = await findCandidates(order, this.simWorld);
    
    if (candidates.length === 0) {
      this.simWorld._logEngine('assign', { orderId, result: 'no_candidates' });
      return null;
    }

    // Tomar el mejor candidato (menor etaToNewCustomer)
    const best = candidates[0];
    
    // Enviar oferta al driver
    const accepted = await this._sendOffer(order, best);
    
    if (accepted) {
      this.simWorld.assignDriverToOrder(best.driver.id, order.id);
      this.simWorld.updateOrderStatus(order.id, 'assigned');
      this.simWorld._logEngine('assign', { 
        orderId, 
        driverId: best.driver.id, 
        eta: Math.round(best.etaToNewCustomer),
        totalCost: best.etaToNewCustomer 
      });
      return best.driver;
    }
    
    return null;
  }

  /**
   * Envía oferta a un driver y espera respuesta (timeout o manual accept/reject).
   * @param {Object} order
   * @param {Object} candidate
   * @returns {Promise<boolean>}
   */
  _sendOffer(order, candidate) {
    return new Promise((resolve) => {
      const timeoutSec = getParam('offer_timeout_s', 60);
      
      const timeoutId = setTimeout(() => {
        this._cleanupOffer(order.id);
        this.simWorld._logEngine('offer_timeout', { orderId: order.id, driverId: candidate.driver.id });
        resolve(false);
      }, timeoutSec * 1000);

      this._pendingOffers.set(order.id, {
        driverId: candidate.driver.id,
        timeoutId,
        resolve,
        reject: () => {},
      });

      // Emitir evento new_offer (igual que SSE de producción)
      this.simWorld.eventBus.emit('new_offer', {
        orderId: order.id,
        restaurantName: order.restaurant_name,
        restaurantLat: order.restaurant_lat,
        restaurantLng: order.restaurant_lng,
        customerAddress: `${order.customer_name}`,
        customerLat: order.customer_lat,
        customerLng: order.customer_lng,
        totalCents: order.total_cents,
        paymentMethod: order.payment_method,
        secondsLeft: timeoutSec,
        bagOverflowPct: 0,
        driverEarning: Math.round(order.total_cents * 0.8), // Estimado 80% para el driver
      });

      this.simWorld._logEngine('offer_sent', { orderId: order.id, driverId: candidate.driver.id, timeoutSec });
    });
  }

  /**
   * Driver acepta una oferta pendiente.
   * @param {string} orderId
   * @param {string} driverId
   * @returns {boolean}
   */
  acceptOffer(orderId, driverId) {
    const pending = this._pendingOffers.get(orderId);
    if (!pending || pending.driverId !== driverId) return false;
    
    clearTimeout(pending.timeoutId);
    this._cleanupOffer(orderId);
    pending.resolve(true);
    
    this.simWorld._logEngine('offer_accepted', { orderId, driverId });
    return true;
  }

  /**
   * Driver rechaza una oferta pendiente.
   * @param {string} orderId
   * @param {string} driverId
   * @returns {boolean}
   */
  rejectOffer(orderId, driverId) {
    const pending = this._pendingOffers.get(orderId);
    if (!pending || pending.driverId !== driverId) return false;
    
    clearTimeout(pending.timeoutId);
    this._cleanupOffer(orderId);
    pending.resolve(false);
    
    // Aplicar cooldown al driver
    this._applyCooldown(driverId);
    
    this.simWorld._logEngine('offer_rejected', { orderId, driverId });
    return true;
  }

  /**
   * Limpia oferta pendiente.
   * @param {string} orderId
   */
  _cleanupOffer(orderId) {
    const pending = this._pendingOffers.get(orderId);
    if (pending) {
      this._pendingOffers.delete(orderId);
    }
  }

  /**
   * Aplica cooldown a un driver (no recibirá ofertas por un tiempo).
   * @param {string} driverId
   */
  _applyCooldown(driverId) {
    const cooldownSec = getParam('cooldown_s', 300);
    
    if (this._activeTimers.has(driverId)) {
      clearTimeout(this._activeTimers.get(driverId));
    }
    
    const timeoutId = setTimeout(() => {
      this._activeTimers.delete(driverId);
      this.simWorld.eventBus.emit('driver_cooldown_ended', { driverId });
    }, cooldownSec * 1000);
    
    this._activeTimers.set(driverId, timeoutId);
  }

  /**
   * Verifica si un driver está en cooldown.
   * @param {string} driverId
   * @returns {boolean}
   */
  isDriverInCooldown(driverId) {
    return this._activeTimers.has(driverId);
  }

  /**
   * Limpia todos los timers y ofertas pendientes.
   */
  destroy() {
    for (const [orderId, pending] of this._pendingOffers) {
      clearTimeout(pending.timeoutId);
    }
    for (const [driverId, timeoutId] of this._activeTimers) {
      clearTimeout(timeoutId);
    }
    this._pendingOffers.clear();
    this._activeTimers.clear();
  }
}

// Singleton export
let instance = null;

export function getSimAssignmentEngine(simWorld, simClock) {
  if (!instance) {
    instance = new SimAssignmentEngine(simWorld, simClock);
  }
  return instance;
}

export default SimAssignmentEngine;