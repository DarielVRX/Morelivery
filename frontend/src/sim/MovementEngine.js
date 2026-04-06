// frontend/src/sim/MovementEngine.js
// Mueve drivers a lo largo de rutas OSRM en tiempo simulado.
// Interpola posición punto a punto, emite driver_location y driver_arrived.

import { getSimWorld } from './SimWorld.js';

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

function interpolatePoint(p1, p2, fraction) {
  return {
    lat: p1.lat + (p2.lat - p1.lat) * fraction,
    lng: p1.lng + (p2.lng - p1.lng) * fraction,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// OSRM ETA (para calcular tiempo restante)
// ──────────────────────────────────────────────────────────────────────────

async function estimateEta(from, to, speedKmh = 30) {
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

// ──────────────────────────────────────────────────────────────────────────
// Movimiento activo por driver
// ──────────────────────────────────────────────────────────────────────────

class ActiveMovement {
  constructor(driverId, geometry, speedKmh, firstSegmentLength, onComplete) {
    this.driverId = driverId;
    this.geometry = geometry;
    this.speedKmh = speedKmh;
    this.speedMs = (speedKmh * 1000) / 3600;
    this.firstSegmentLength = firstSegmentLength || geometry.length;
    this.onComplete = onComplete;
    
    this.currentIndex = 0;           // Índice del segmento actual (geometry[i] -> geometry[i+1])
    this.progress = 0;               // Progreso en el segmento actual (0..1)
    this.segmentDistance = 0;
    this.segmentDuration = 0;
    this.elapsedInSegment = 0;
    
    this._updateSegment();
  }
  
  _updateSegment() {
    if (this.currentIndex >= this.geometry.length - 1) {
      this.segmentDistance = 0;
      this.segmentDuration = 0;
      return;
    }
    
    const p1 = this.geometry[this.currentIndex];
    const p2 = this.geometry[this.currentIndex + 1];
    this.segmentDistance = haversineMeters(p1.lat, p1.lng, p2.lat, p2.lng);
    this.segmentDuration = this.segmentDistance / this.speedMs;
  }
  
  /**
   * Actualiza el movimiento con el delta de tiempo simulado.
   * @param {number} deltaMs - Delta en milisegundos (tiempo simulado)
   * @returns {Object|null} - { position, arrivedAtStop, stopIndex, remainingEta } o null si completó
   */
  update(deltaMs) {
    if (this.currentIndex >= this.geometry.length - 1) {
      return null;
    }
    
    const deltaSec = deltaMs / 1000;
    let remainingDelta = deltaSec;
    
    while (remainingDelta > 0 && this.currentIndex < this.geometry.length - 1) {
      const remainingInSegment = this.segmentDuration - this.elapsedInSegment;
      
      if (remainingDelta >= remainingInSegment) {
        // Completar este segmento
        remainingDelta -= remainingInSegment;
        this.elapsedInSegment = 0;
        this.currentIndex++;
        this.progress = 0;
        this._updateSegment();
        
        // Si llegamos al final de la geometría
        if (this.currentIndex >= this.geometry.length - 1) {
          const finalPos = this.geometry[this.geometry.length - 1];
          this.onComplete?.(this.driverId, finalPos);
          return { position: finalPos, arrivedAtStop: true, stopIndex: this.currentIndex, remainingEta: 0 };
        }
      } else {
        // Avanzar parcialmente en el segmento actual
        this.elapsedInSegment += remainingDelta;
        this.progress = this.elapsedInSegment / this.segmentDuration;
        remainingDelta = 0;
      }
    }
    
    // Calcular posición actual
    const p1 = this.geometry[this.currentIndex];
    const p2 = this.geometry[this.currentIndex + 1];
    const position = interpolatePoint(p1, p2, this.progress);
    
    // Calcular ETA restante hasta el final de la ruta
    let remainingEta = 0;
    if (this.currentIndex < this.geometry.length - 1) {
      const remainingInSegment = this.segmentDuration - this.elapsedInSegment;
      remainingEta += remainingInSegment;
      
      for (let i = this.currentIndex + 1; i < this.geometry.length - 1; i++) {
        const pA = this.geometry[i];
        const pB = this.geometry[i + 1];
        remainingEta += haversineMeters(pA.lat, pA.lng, pB.lat, pB.lng) / this.speedMs;
      }
    }
    
    return {
      position,
      arrivedAtStop: false,
      stopIndex: this.currentIndex,
      remainingEta: Math.round(remainingEta),
    };
  }
  
  /**
   * @returns {boolean} true si el movimiento ha terminado
   */
  isComplete() {
    return this.currentIndex >= this.geometry.length - 1;
  }
  
  /**
   * @returns {number} distancia total de la ruta en metros
   */
  getTotalDistance() {
    let total = 0;
    for (let i = 0; i < this.geometry.length - 1; i++) {
      total += haversineMeters(
        this.geometry[i].lat, this.geometry[i].lng,
        this.geometry[i + 1].lat, this.geometry[i + 1].lng
      );
    }
    return total;
  }
  
  /**
   * @returns {number} distancia recorrida en metros
   */
  getDistanceTraveled() {
    let traveled = 0;
    // Segmentos completados
    for (let i = 0; i < this.currentIndex; i++) {
      traveled += haversineMeters(
        this.geometry[i].lat, this.geometry[i].lng,
        this.geometry[i + 1].lat, this.geometry[i + 1].lng
      );
    }
    // Progreso en segmento actual
    if (this.currentIndex < this.geometry.length - 1) {
      const p1 = this.geometry[this.currentIndex];
      const p2 = this.geometry[this.currentIndex + 1];
      const segmentDist = haversineMeters(p1.lat, p1.lng, p2.lat, p2.lng);
      traveled += segmentDist * this.progress;
    }
    return traveled;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Motor de movimiento principal
// ──────────────────────────────────────────────────────────────────────────

class MovementEngine {
  constructor(simWorld, simClock) {
    this.simWorld = simWorld;
    this.simClock = simClock;
    this._activeMovements = new Map(); // driverId -> ActiveMovement
    this._pendingArrivals = new Map();  // driverId -> { orderId, target }
    this._tickHandler = null;
    
    this._start();
  }
  
  /**
   * Inicia el listener de ticks del reloj.
   */
  _start() {
    this._tickHandler = (simTime, deltaMs) => {
      this._updateMovements(deltaMs);
    };
    this.simClock.onTick(this._tickHandler);
  }
  
  /**
   * Actualiza todos los movimientos activos.
   * @param {number} deltaMs - Delta en milisegundos (tiempo simulado)
   */
  _updateMovements(deltaMs) {
    for (const [driverId, movement] of this._activeMovements) {
      const result = movement.update(deltaMs);
      
      if (result) {
        // Actualizar posición del driver en SimWorld
        this.simWorld.updateDriverPosition(driverId, result.position.lat, result.position.lng);
        
        // Emitir driver_location (mismo formato que backend)
        const driver = this.simWorld.getDriver(driverId);
        const activeOrderId = driver?.activeOrders[0];
        
        this.simWorld.eventBus.emit('driver_location', {
          driverId,
          lat: result.position.lat,
          lng: result.position.lng,
          orderId: activeOrderId,
          eta_secs: result.remainingEta,
          is_next_stop: movement.currentIndex < movement.firstSegmentLength,
        });
        
        // Si llegó a un stop
        if (result.arrivedAtStop) {
          this._handleArrival(driverId, result.stopIndex, movement);
        }
      }
      
      // Limpiar movimientos completados
      if (movement.isComplete()) {
        this._activeMovements.delete(driverId);
        this.simWorld._logEngine('movement', {
          driverId,
          action: 'completed',
          distance: Math.round(movement.getTotalDistance()),
        });
      }
    }
  }
  
  /**
   * Maneja la llegada a un stop (pickup o delivery).
   * @param {string} driverId
   * @param {number} stopIndex
   * @param {ActiveMovement} movement
   */
  _handleArrival(driverId, stopIndex, movement) {
    const driver = this.simWorld.getDriver(driverId);
    if (!driver) return;
    
    // El stop en el índice stopIndex es el punto al que llegamos
    // Necesitamos saber qué orden corresponde a este stop
    // Por ahora, usamos el activeOrder más cercano basado en posición
    const currentPos = movement.geometry[stopIndex];
    
    for (const orderId of driver.activeOrders) {
      const order = this.simWorld.getOrder(orderId);
      if (!order) continue;
      
      // Verificar si llegó al restaurante (pickup)
      const distToRestaurant = haversineMeters(
        currentPos.lat, currentPos.lng,
        order.restaurant_lat, order.restaurant_lng
      );
      
      if (distToRestaurant < 30 && order.status !== 'on_the_way' && order.status !== 'delivered') {
        // Llegó al restaurante para recoger
        this.simWorld._logEngine('movement', {
          driverId,
          action: 'arrived_at_restaurant',
          orderId,
          dist: Math.round(distToRestaurant),
        });
        
        this.simWorld.eventBus.emit('driver_arrived', {
          driverId,
          orderId,
          target: 'pickup',
          message: `Conductor llegó a ${order.restaurant_name}`,
        });
        
        // Auto-marcar como on_the_way si el pedido está ready
        if (order.status === 'ready' || order.kitchen_estimated_ready) {
          const readyAt = order.kitchen_estimated_ready ? new Date(order.kitchen_estimated_ready).getTime() : 0;
          if (Date.now() >= readyAt) {
            setTimeout(() => {
              this.simWorld.updateOrderStatus(orderId, 'on_the_way', { picked_up_at: new Date().toISOString() });
            }, 500);
          }
        }
        break;
      }
      
      // Verificar si llegó al cliente (delivery)
      const distToCustomer = haversineMeters(
        currentPos.lat, currentPos.lng,
        order.customer_lat, order.customer_lng
      );
      
      if (distToCustomer < 30 && order.status === 'on_the_way') {
        // Llegó al cliente para entregar
        this.simWorld._logEngine('movement', {
          driverId,
          action: 'arrived_at_customer',
          orderId,
          dist: Math.round(distToCustomer),
        });
        
        this.simWorld.eventBus.emit('driver_arrived', {
          driverId,
          orderId,
          target: 'delivery',
          message: `Conductor llegó a ${order.customer_name}`,
        });
        
        // Auto-entregar después de 2 segundos simulados
        setTimeout(() => {
          this.simWorld.updateOrderStatus(orderId, 'delivered');
          this.simWorld._logOrder('delivered', { orderId, driverId });
        }, 2000);
        break;
      }
    }
  }
  
  /**
   * Inicia el movimiento de un driver a lo largo de una geometría.
   * @param {string} driverId
   * @param {Array} geometry - Array de {lat, lng}
   * @param {Function} onComplete - Callback opcional al completar
   */
  startMovement(driverId, geometry, firstSegmentLength = 0, onComplete = null) {
    if (!geometry || geometry.length < 2) {
      console.warn(`[MovementEngine] Geometría inválida para driver ${driverId}`);
      return false;
    }
    
    const driver = this.simWorld.getDriver(driverId);
    if (!driver) return false;
    
    const speedKmh = this._getDriverSpeedKmh(driver.vehicle_type);
    
    // Detener movimiento existente
    this.stopMovement(driverId);
    
    const movement = new ActiveMovement(driverId, geometry, speedKmh, firstSegmentLength, (id, finalPos) => {
      this.simWorld.updateDriverPosition(id, finalPos.lat, finalPos.lng);
      if (onComplete) onComplete(id, finalPos);
    });
    
    this._activeMovements.set(driverId, movement);
    
    this.simWorld._logEngine('movement', {
      driverId,
      action: 'start',
      geometryPoints: geometry.length,
      totalDistance: Math.round(movement.getTotalDistance()),
      speedKmh,
    });
    
    return true;
  }
  
  /**
   * Pausa el movimiento de un driver.
   * @param {string} driverId
   */
  pauseMovement(driverId) {
    const movement = this._activeMovements.get(driverId);
    if (!movement) return false;
    
    // Guardar estado actual para poder reanudar
    movement._paused = true;
    
    this.simWorld._logEngine('movement', {
      driverId,
      action: 'pause',
      progress: movement.progress,
      segmentIndex: movement.currentIndex,
    });
    
    return true;
  }
  
  /**
   * Reanuda el movimiento de un driver.
   * @param {string} driverId
   */
  resumeMovement(driverId) {
    const movement = this._activeMovements.get(driverId);
    if (!movement || !movement._paused) return false;
    
    delete movement._paused;
    
    this.simWorld._logEngine('movement', {
      driverId,
      action: 'resume',
    });
    
    return true;
  }
  
  /**
   * Detiene y limpia el movimiento de un driver.
   * @param {string} driverId
   */
  stopMovement(driverId) {
    const movement = this._activeMovements.get(driverId);
    if (!movement) return false;
    
    this._activeMovements.delete(driverId);
    
    this.simWorld._logEngine('movement', {
      driverId,
      action: 'stop',
    });
    
    return true;
  }
  
  /**
   * Verifica si un driver está en movimiento.
   * @param {string} driverId
   * @returns {boolean}
   */
  isMoving(driverId) {
    return this._activeMovements.has(driverId);
  }
  
  /**
   * Obtiene el progreso actual de un driver.
   * @param {string} driverId
   * @returns {Object|null} - { progress, distanceTraveled, totalDistance, currentSegment }
   */
  getProgress(driverId) {
    const movement = this._activeMovements.get(driverId);
    if (!movement) return null;
    
    return {
      progress: movement.getDistanceTraveled() / movement.getTotalDistance(),
      distanceTraveled: Math.round(movement.getDistanceTraveled()),
      totalDistance: Math.round(movement.getTotalDistance()),
      currentSegment: movement.currentIndex,
      totalSegments: movement.geometry.length - 1,
    };
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
   * Limpia todos los movimientos activos.
   */
  destroy() {
    if (this._tickHandler) {
      this.simClock.offTick(this._tickHandler);
      this._tickHandler = null;
    }
    this._activeMovements.clear();
    this._pendingArrivals.clear();
  }
}

// Singleton export
let instance = null;

export function getMovementEngine(simWorld, simClock) {
  if (!instance) {
    instance = new MovementEngine(simWorld, simClock);
  }
  return instance;
}

export default MovementEngine;