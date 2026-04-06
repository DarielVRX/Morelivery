// frontend/src/sim/SimProvider.jsx
// Context central que une todos los engines del simulador.
// Expone hook useSimContext() para acceso desde los paneles.

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { getSimWorld } from './SimWorld.js';
import { getSimClock } from './SimClock.js';
import { getSimAssignmentEngine } from './SimAssignmentEngine.js';
import { getSimRerouteEngine } from './SimRerouteEngine.js';
import { getMovementEngine } from './MovementEngine.js';
import { getSimLogger } from './SimLogger.js';

// Instancias singleton
const simWorld = getSimWorld();
const simClock = getSimClock();
let simAssignmentEngine = null;
let simRerouteEngine = null;
let movementEngine = null;
let simLogger = null;

const SimContext = createContext(null);

// Helper para obtener logger con inicialización lazy
function getLogger() {
  if (!simLogger) {
    simLogger = getSimLogger();
  }
  return simLogger;
}

export function SimProvider({ children }) {
  const [, forceUpdate] = useState({});
  const [clockRunning, setClockRunning] = useState(false);
  const [clockSimTime, setClockSimTime] = useState(0);
  const [clockSpeed,   setClockSpeed]   = useState(1);
  const enginesRef = useRef({ initialized: false });
  const eventUnsubscribers = useRef([]);

  // Inicializar engines una sola vez
  if (!enginesRef.current.initialized) {
    simAssignmentEngine = getSimAssignmentEngine(simWorld, simClock);
    simRerouteEngine = getSimRerouteEngine(simWorld, simClock);
    movementEngine = getMovementEngine(simWorld, simClock);
    simLogger = getLogger();
    enginesRef.current.initialized = true;
  }

  // Tick del reloj → estado reactivo para UI
  useEffect(() => {
    const cb = (simTime) => {
      setClockSimTime(simTime);
      setClockRunning(simClock.isRunning());
      setClockSpeed(simClock.getSpeed());
    };
    simClock.onTick(cb);
    return () => simClock.offTick(cb);
  }, []);

  // Configurar event handlers
  useEffect(() => {
    const unsubscribers = [];

    // Cuando se crea un pedido, intentar asignarlo automáticamente
    const handleOrderCreated = async ({ orderId }) => {
      const order = simWorld.getOrder(orderId);
      if (order && !order.driver_id) {
        // Pequeño delay para simular procesamiento
        setTimeout(async () => {
          const assignedDriver = await simAssignmentEngine.assignOrder(orderId);
          if (assignedDriver) {
            // Una vez asignado, recalcular ruta del driver
            setTimeout(() => {
              simRerouteEngine.rerouteDriver(assignedDriver.id);
            }, 500);
          }
        }, 100);
      }
    };

    // Cuando cambia el estado de un pedido, puede requerir reroute
    const handleOrderStatusChanged = async ({ orderId, newStatus, order }) => {
      const driverId = order?.driver_id;
      if (driverId) {
        // Estados que requieren recalcular ruta
        const needsReroute = ['accepted', 'preparing', 'ready', 'on_the_way', 'delivered'];
        if (needsReroute.includes(newStatus)) {
          setTimeout(() => {
            simRerouteEngine.rerouteDriver(driverId);
          }, 200);
        }
        
        // Si el pedido fue entregado, limpiar movimiento si ya no hay pedidos activos
        if (newStatus === 'delivered') {
          const driver = simWorld.getDriver(driverId);
          if (driver && driver.activeOrders.length === 0) {
            movementEngine.stopMovement(driverId);
          }
        }
      }
    };

    // Cuando un driver acepta una oferta (desde el panel)
    const handleOfferAccepted = ({ orderId, driverId }) => {
      simAssignmentEngine.acceptOffer(orderId, driverId);
    };

    // Cuando se libera un pedido, recalcular ruta
    const handleOrderReleased = ({ orderId, driverId }) => {
      if (driverId) {
        setTimeout(() => {
          simRerouteEngine.rerouteDriver(driverId);
        }, 200);
      }
    };

    // Registrar listeners
    simWorld.eventBus.on('order_created', handleOrderCreated);
    simWorld.eventBus.on('order_status_changed', handleOrderStatusChanged);
    simWorld.eventBus.on('offer_accepted', handleOfferAccepted);
    simWorld.eventBus.on('order_released', handleOrderReleased);

    unsubscribers.push(() => {
      simWorld.eventBus.off('order_created', handleOrderCreated);
      simWorld.eventBus.off('order_status_changed', handleOrderStatusChanged);
      simWorld.eventBus.off('offer_accepted', handleOfferAccepted);
      simWorld.eventBus.off('order_released', handleOrderReleased);
    });

    // Forzar actualización cuando el mundo cambia (para UI)
    const handleWorldChange = () => {
      forceUpdate({});
    };

    // Suscribirse a eventos que afectan la UI
    const uiEvents = [
      'driver_added', 'restaurant_added', 'customer_added',
      'driver_availability_changed', 'order_created', 'order_status_changed',
      'driver_location', 'route_update', 'new_offer',
    ];
    
    uiEvents.forEach(event => {
      simWorld.eventBus.on(event, handleWorldChange);
      unsubscribers.push(() => simWorld.eventBus.off(event, handleWorldChange));
    });

    eventUnsubscribers.current = unsubscribers;

    return () => {
      unsubscribers.forEach(fn => fn());
      eventUnsubscribers.current = [];
    };
  }, []);

  // Context value
  const contextValue = {
    // Instancias
    world: simWorld,
    clock: simClock,
    assignmentEngine: simAssignmentEngine,
    rerouteEngine: simRerouteEngine,
    movementEngine: movementEngine,
    logger: simLogger,

    // Métodos de conveniencia para UI
    addDriver: (params) => simWorld.addDriver(params),
    addRestaurant: (params) => simWorld.addRestaurant(params),
    addCustomer: (params) => simWorld.addCustomer(params),
    createOrder: (params) => simWorld.createOrder(params),
    
    updateOrderStatus: (orderId, status, extra) => simWorld.updateOrderStatus(orderId, status, extra),
    assignDriverToOrder: (driverId, orderId) => simWorld.assignDriverToOrder(driverId, orderId),
    releaseDriverFromOrder: (driverId, orderId, reason) => simWorld.releaseDriverFromOrder(driverId, orderId, reason),
    
    setDriverAvailability: (driverId, isAvailable) => simWorld.setDriverAvailability(driverId, isAvailable),
    setRestaurantOpen: (restaurantId, isOpen) => simWorld.setRestaurantOpen(restaurantId, isOpen),
    setRestaurantPrepTime: (restaurantId, prepTimeSecs) => simWorld.setRestaurantPrepTime(restaurantId, prepTimeSecs),
    
    addImpassableWay: (driverId, way) => simWorld.addImpassableWay(driverId, way),
    removeImpassableWay: (driverId, wayId) => simWorld.removeImpassableWay(driverId, wayId),
    addRoutePreference: (driverId, way) => simWorld.addRoutePreference(driverId, way),
    removeRoutePreference: (driverId, wayId) => simWorld.removeRoutePreference(driverId, wayId),
    
    // Control de simulación
    startSimulation: () => { simClock.start(); setClockRunning(true); },
    pauseSimulation: () => { simClock.pause(); setClockRunning(false); },
    resetSimulation: () => {
      // Detener todos los movimientos
      const drivers = simWorld.getAllDrivers();
      drivers.forEach(d => movementEngine.stopMovement(d.id));
      
      // Resetear mundo
      simWorld.reset();
      
      // Resetear reloj
      simClock.reset();
      
      // Limpiar logs
      simLogger?.clear();
      
      // Forzar actualización UI
      forceUpdate({});
    },
    setSimSpeed: (speed) => { simClock.setSpeed(speed); setClockSpeed(speed); },
    
    // Movimiento
    startDriverMovement: (driverId, geometry, onComplete) => movementEngine.startMovement(driverId, geometry, onComplete),
    pauseDriverMovement: (driverId) => movementEngine.pauseMovement(driverId),
    resumeDriverMovement: (driverId) => movementEngine.resumeMovement(driverId),
    stopDriverMovement: (driverId) => movementEngine.stopMovement(driverId),
    isDriverMoving: (driverId) => movementEngine.isMoving(driverId),
    getDriverProgress: (driverId) => movementEngine.getProgress(driverId),
    
    // Ofertas
    acceptOffer: (orderId, driverId) => simAssignmentEngine.acceptOffer(orderId, driverId),
    rejectOffer: (orderId, driverId) => simAssignmentEngine.rejectOffer(orderId, driverId),
    isDriverInCooldown: (driverId) => simAssignmentEngine.isDriverInCooldown(driverId),
    
    // Estado actual (para UI reactiva)
    getDrivers: () => simWorld.getAllDrivers(),
    getRestaurants: () => simWorld.getAllRestaurants(),
    getCustomers: () => simWorld.getAllCustomers(),
    getOrders: () => simWorld.getAllOrders(),
    getDriver: (id) => simWorld.getDriver(id),
    getRestaurant: (id) => simWorld.getRestaurant(id),
    getCustomer: (id) => simWorld.getCustomer(id),
    getOrder: (id) => simWorld.getOrder(id),
    
    // Suscripción a eventos (para componentes que necesitan escuchar)
    onEvent: (event, callback) => {
      simWorld.eventBus.on(event, callback);
      return () => simWorld.eventBus.off(event, callback);
    },
    
    // Estado del reloj
    isRunning: clockRunning,
    simTime: clockSimTime,
    simSpeed: clockSpeed,
  };

  return (
    <SimContext.Provider value={contextValue}>
      {children}
    </SimContext.Provider>
  );
}

export function useSimContext() {
  const context = useContext(SimContext);
  if (!context) {
    throw new Error('useSimContext must be used within a SimProvider');
  }
  return context;
}

export default SimProvider;