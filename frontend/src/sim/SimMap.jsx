// frontend/src/sim/SimMap.jsx
// Mapa principal del simulador.
// Reutiliza DriverMap como base y agrega pines de restaurantes y clientes.

import React, { useEffect, useRef, useState, useCallback } from 'react';
import DriverMap from '../components/DriverMap.jsx';
import { useSimContext } from './SimProvider.jsx';
import { ensureMapLibreJS } from '../utils/mapLibre.js';

// Colores para los diferentes tipos de pines
const PIN_COLORS = {
  restaurant: '#f59e0b',  // naranja
  customer: '#3b82f6',    // azul
  driver: '#e3aaaa',      // rosa/marca
};

// Estilo para el contenedor del mapa
const MAP_STYLE = {
  height: '100%',
  width: '100%',
  position: 'relative',
};

export default function SimMap({ 
  selectedEntityId, 
  selectedEntityType,
  onSelectEntity,
  wayPickerMode,
  onWayPickerConfirm,
  onWayPickerCancel,
  zonePlacerMode,
  onZonePlacerConfirm,
  onZonePlacerCancel,
}) {
  const {
    world,
    movementEngine,
    rerouteEngine,
    simTime,
    getDriverProgress,
  } = useSimContext();

  const [mapInstance, setMapInstance] = useState(null);
  const [mlInstance, setMlInstance] = useState(null);
  const [routeGeometry, setRouteGeometry] = useState(null);
  const [partialRouteGeometry, setPartialRouteGeometry] = useState(null);
  const [allStops, setAllStops] = useState([]);
  const [routeActive, setRouteActive] = useState(false);
  const [centerMode, setCenterMode] = useState('free');
  const [centerSignal, setCenterSignal] = useState(null);
  const [navHeadingDeg, setNavHeadingDeg] = useState(0);
  
  const markersRef = useRef({
    restaurants: new Map(),
    customers: new Map(),
    drivers: new Map(),
  });
  
  const mlRef = useRef(null);
  const routeUpdateUnsubscribeRef = useRef(null);

  // Obtener datos actuales del mundo
  const drivers = world.getAllDrivers();
  const restaurants = world.getAllRestaurants();
  const customers = world.getAllCustomers();
  
  // Driver seleccionado (si aplica)
  const selectedDriver = selectedEntityType === 'driver' 
    ? world.getDriver(selectedEntityId) 
    : null;
  
  const hasActiveOrder = selectedDriver?.activeOrders?.length > 0;

  // Suscribirse a actualizaciones de ruta
  useEffect(() => {
    const handleRouteUpdate = (data) => {
      if (data.driverId === selectedDriver?.id) {
        setRouteGeometry(data.geometry);
        setAllStops(data.stops || []);
        setRouteActive(true);
        
        // Calcular ruta parcial (primer segmento)
        if (data.geometry && data.firstSegmentLength > 0) {
          setPartialRouteGeometry(data.geometry.slice(0, data.firstSegmentLength));
        } else {
          setPartialRouteGeometry(null);
        }
      }
    };
    
    routeUpdateUnsubscribeRef.current = world.eventBus.on('route_update', handleRouteUpdate);
    
    return () => {
      if (routeUpdateUnsubscribeRef.current) {
        routeUpdateUnsubscribeRef.current();
      }
    };
  }, [selectedDriver?.id, world.eventBus]);

  // Cuando cambia el driver seleccionado, solicitar su ruta
  useEffect(() => {
    if (selectedDriver && selectedDriver.activeOrders.length > 0) {
      rerouteEngine.rerouteDriver(selectedDriver.id);
      setRouteActive(true);
    } else {
      setRouteGeometry(null);
      setPartialRouteGeometry(null);
      setAllStops([]);
      setRouteActive(false);
    }
  }, [selectedDriver, rerouteEngine]);

  // Inicializar mapa y agregar pines adicionales
  const handleMapReady = useCallback(async (map) => {
    if (!map) return;
    setMapInstance(map);
    
    // Obtener instancia de MapLibre para crear markers
    const ml = await ensureMapLibreJS();
    mlRef.current = ml;
    setMlInstance(ml);
  }, []);

  // Actualizar pines de restaurantes y clientes
  useEffect(() => {
    if (!mapInstance || !mlInstance) return;
    
    const ml = mlInstance;
    
    // Limpiar markers existentes
    markersRef.current.restaurants.forEach(marker => marker.remove());
    markersRef.current.customers.forEach(marker => marker.remove());
    markersRef.current.restaurants.clear();
    markersRef.current.customers.clear();
    
    // Crear markers para restaurantes
    restaurants.forEach(restaurant => {
      const isSelected = selectedEntityType === 'restaurant' && selectedEntityId === restaurant.id;
      
      const el = document.createElement('div');
      el.style.cssText = `
        width: 32px;
        height: 32px;
        background: ${PIN_COLORS.restaurant};
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 2px solid white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        cursor: pointer;
        transition: transform 0.1s;
        font-size: 18px;
      `;
      el.textContent = '🍽️';
      if (isSelected) {
        el.style.transform = 'scale(1.15)';
        el.style.boxShadow = '0 0 0 2px var(--brand)';
      }
      
      const marker = new ml.Marker({ element: el })
        .setLngLat([restaurant.lng, restaurant.lat])
        .addTo(mapInstance);
      
      marker.getElement().addEventListener('click', (e) => {
        e.stopPropagation();
        onSelectEntity('restaurant', restaurant.id);
      });
      
      markersRef.current.restaurants.set(restaurant.id, marker);
    });
    
    // Crear markers para clientes
    customers.forEach(customer => {
      const isSelected = selectedEntityType === 'customer' && selectedEntityId === customer.id;
      
      const el = document.createElement('div');
      el.style.cssText = `
        width: 32px;
        height: 32px;
        background: ${PIN_COLORS.customer};
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 2px solid white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        cursor: pointer;
        transition: transform 0.1s;
        font-size: 18px;
      `;
      el.textContent = '👤';
      if (isSelected) {
        el.style.transform = 'scale(1.15)';
        el.style.boxShadow = '0 0 0 2px var(--brand)';
      }
      
      const marker = new ml.Marker({ element: el })
        .setLngLat([customer.lng, customer.lat])
        .addTo(mapInstance);
      
      marker.getElement().addEventListener('click', (e) => {
        e.stopPropagation();
        onSelectEntity('customer', customer.id);
      });
      
      markersRef.current.customers.set(customer.id, marker);
    });
  }, [mapInstance, mlInstance, restaurants, customers, selectedEntityType, selectedEntityId, onSelectEntity]);

  // Actualizar marcadores de drivers (los que no son el seleccionado)
  useEffect(() => {
    if (!mapInstance || !mlInstance) return;
    
    const ml = mlInstance;
    
    // Limpiar markers de drivers no seleccionados
    markersRef.current.drivers.forEach(marker => marker.remove());
    markersRef.current.drivers.clear();
    
    drivers.forEach(driver => {
      // Saltar el driver seleccionado porque DriverMap ya lo maneja
      if (selectedDriver && driver.id === selectedDriver.id) return;
      
      const isMoving = movementEngine?.isMoving(driver.id);
      const progress = movementEngine?.getProgress(driver.id);
      
      const el = document.createElement('div');
      const vehicleIcon = driver.vehicle_type === 'bike' ? '🚲' : 
                          driver.vehicle_type === 'motorcycle' ? '🏍️' : '🚗';
      
      el.style.cssText = `
        width: 36px;
        height: 36px;
        background: ${PIN_COLORS.driver};
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 2px solid white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        cursor: pointer;
        font-size: 18px;
        transition: transform 0.1s;
      `;
      el.textContent = vehicleIcon;
      
      if (isMoving) {
        el.style.animation = 'pulse 1s ease-in-out infinite';
      }
      
      const marker = new ml.Marker({ element: el })
        .setLngLat([driver.last_lng, driver.last_lat])
        .addTo(mapInstance);
      
      marker.getElement().addEventListener('click', (e) => {
        e.stopPropagation();
        onSelectEntity('driver', driver.id);
      });
      
      markersRef.current.drivers.set(driver.id, marker);
    });
    
    // Añadir estilo de animación si no existe
    if (!document.querySelector('#sim-map-pulse-style')) {
      const style = document.createElement('style');
      style.id = 'sim-map-pulse-style';
      style.textContent = `
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.1); opacity: 0.8; }
        }
      `;
      document.head.appendChild(style);
    }
  }, [mapInstance, mlInstance, drivers, selectedDriver, movementEngine, onSelectEntity]);

  // Actualizar posición de los markers de drivers cuando cambia
  useEffect(() => {
    const handleDriverLocation = ({ driverId, lat, lng }) => {
      const marker = markersRef.current.drivers.get(driverId);
      if (marker) {
        marker.setLngLat([lng, lat]);
      }
    };
    
    const unsubscribe = world.eventBus.on('driver_location', handleDriverLocation);
    return () => unsubscribe();
  }, [world.eventBus]);

  // Obtener posición del driver seleccionado
  const driverPos = selectedDriver 
    ? { lat: selectedDriver.last_lat, lng: selectedDriver.last_lng }
    : null;

  // Manejar centrado del mapa
  const handleCenterCycle = () => {
    const modes = ['free', 'nav', 'nextStop', 'overview'];
    const currentIndex = modes.indexOf(centerMode);
    const nextMode = modes[(currentIndex + 1) % modes.length];
    setCenterMode(nextMode);
    setCenterSignal(nextMode);
    setTimeout(() => setCenterSignal(null), 500);
  };

  const handleCenterDone = () => {
    setCenterSignal(null);
  };

  // Manejar navegación a pin
  const handleRouteToPin = (pinPos) => {
    if (!selectedDriver) return;
    // Solicitar ruta al pin
    // Esto activaría una ruta temporal (no persistente)
    console.log('Route to pin:', pinPos);
  };

  return (
    <div style={MAP_STYLE}>
      <DriverMap
        driverPos={driverPos}
        customPin={null}
        onCustomPin={() => {}}
        hasActiveOrder={hasActiveOrder}
        pickupPos={null}
        deliveryPos={null}
        pickupLabel=""
        deliveryLabel=""
        routeGeometry={routeGeometry}
        partialRouteGeometry={partialRouteGeometry}
        allStops={allStops}
        routeActive={routeActive}
        onRouteError={(msg) => console.warn('Route error:', msg)}
        centerMode={centerMode}
        navHeadingDeg={navHeadingDeg}
        onHeadingChange={setNavHeadingDeg}
        centerSignal={centerSignal}
        onCenterDone={handleCenterDone}
        onMapReady={handleMapReady}
        bottomOffset={0}
        pinAddress={null}
        loadingPin={false}
        onClearPin={() => {}}
        onRouteToPin={handleRouteToPin}
        impassableWays={selectedDriver?.impassableWays || []}
        roadPreferences={selectedDriver?.routePreferences || []}
      />
      
      {/* Indicador de modo seleccionado */}
      {(wayPickerMode || zonePlacerMode) && (
        <div style={{
          position: 'absolute',
          top: 10,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.7)',
          color: '#fff',
          padding: '6px 12px',
          borderRadius: '20px',
          fontSize: '0.75rem',
          zIndex: 10,
          pointerEvents: 'none',
        }}>
          {wayPickerMode === 'impassable' && '⛔ Toca una calle para marcarla como no viable'}
          {wayPickerMode === 'preference' && '⭐ Toca una calle para marcar preferencia'}
          {zonePlacerMode && '📍 Ajusta el área y confirma'}
        </div>
      )}
    </div>
  );
}