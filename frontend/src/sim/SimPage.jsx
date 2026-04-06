// frontend/src/sim/SimPage.jsx
// Layout principal del simulador.
// TopBar con controles, sidebar izquierdo, mapa central, panel derecho, logs inferior.

import React, { useState, useEffect, useRef } from 'react';
import SimProvider, { useSimContext } from './SimProvider.jsx';
import SimMap from './SimMap.jsx';
import DriverPanel from './panels/DriverPanel.jsx';
import RestaurantPanel from './panels/RestaurantPanel.jsx';
import CustomerPanel from './panels/CustomerPanel.jsx';

// Íconos simples
function IconPlay() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function IconPause() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </svg>
  );
}

function IconReset() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 12a9 9 0 1 0 9-9" />
      <path d="M3 3v6h6" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function IconChevronDown({ expanded }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points={expanded ? "18 15 12 9 6 15" : "6 9 12 15 18 9"} />
    </svg>
  );
}

// Componente de Logs
function LogPanel() {
  const { logger, simTime } = useSimContext();
  const [activeTab, setActiveTab] = useState('orders'); // 'orders' | 'engine'
  const [orderLogs, setOrderLogs] = useState([]);
  const [engineLogs, setEngineLogs] = useState([]);
  const [filterType, setFilterType] = useState('');
  const [expanded, setExpanded] = useState(true);
  
  const refreshLogs = () => {
    if (logger) {
      setOrderLogs(logger.getOrderLogs({ limit: 100 }));
      setEngineLogs(logger.getEngineLogs({ limit: 100 }));
    }
  };
  
  useEffect(() => {
    refreshLogs();
    const unsubscribe = logger?.subscribe(refreshLogs);
    return () => unsubscribe?.();
  }, [logger]);
  
  const filteredOrders = filterType
    ? orderLogs.filter(log => log.type === filterType)
    : orderLogs;
  
  const filteredEngine = filterType
    ? engineLogs.filter(log => log.type === filterType)
    : engineLogs;
  
  const getOrderTypeLabel = (type) => {
    const labels = {
      'created': '🆕 Creación',
      'assigned': '🚗 Asignación',
      'status_change': '📝 Estado',
      'delivered': '✅ Entrega',
      'cancelled': '❌ Cancelación',
      'released': '🔓 Liberación',
    };
    return labels[type] || type;
  };
  
  const getEngineTypeLabel = (type) => {
    const labels = {
      'assign': '🎯 Asignación',
      'scoring': '📊 Scoring',
      'reroute': '🔄 Reroute',
      'sla': '⏰ SLA',
      'kitchen': '🍳 Cocina',
      'movement': '🚚 Movimiento',
      'offer_sent': '📨 Oferta enviada',
      'offer_accepted': '✅ Oferta aceptada',
      'offer_rejected': '❌ Oferta rechazada',
      'offer_timeout': '⏱️ Oferta expirada',
    };
    return labels[type] || type;
  };
  
  const formatSimTime = (secs) => {
    const mins = Math.floor(secs / 60);
    const remainingSecs = Math.floor(secs % 60);
    return `${mins}:${remainingSecs.toString().padStart(2, '0')}`;
  };
  
  return (
    <div style={{
      background: 'var(--bg-card)',
      borderTop: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      height: expanded ? '200px' : '32px',
      transition: 'height 0.2s ease',
      overflow: 'hidden',
    }}>
      {/* Header del panel de logs */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          background: 'var(--bg-raised)',
          cursor: 'pointer',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <span style={{ fontWeight: 600, fontSize: '0.75rem' }}>📋 Logs</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={(e) => { e.stopPropagation(); setActiveTab('orders'); }}
              style={{
                padding: '2px 8px',
                borderRadius: '12px',
                border: 'none',
                background: activeTab === 'orders' ? 'var(--brand)' : 'var(--bg-card)',
                color: activeTab === 'orders' ? '#fff' : 'var(--text-secondary)',
                fontSize: '0.7rem',
                cursor: 'pointer',
              }}
            >
              Pedidos ({orderLogs.length})
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setActiveTab('engine'); }}
              style={{
                padding: '2px 8px',
                borderRadius: '12px',
                border: 'none',
                background: activeTab === 'engine' ? 'var(--brand)' : 'var(--bg-card)',
                color: activeTab === 'engine' ? '#fff' : 'var(--text-secondary)',
                fontSize: '0.7rem',
                cursor: 'pointer',
              }}
            >
              Engine ({engineLogs.length})
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {expanded && (
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              style={{
                padding: '2px 6px',
                fontSize: '0.65rem',
                borderRadius: '4px',
                border: '1px solid var(--border)',
              }}
            >
              <option value="">Todos los tipos</option>
              {activeTab === 'orders' && (
                <>
                  <option value="created">🆕 Creación</option>
                  <option value="assigned">🚗 Asignación</option>
                  <option value="status_change">📝 Estado</option>
                  <option value="delivered">✅ Entrega</option>
                </>
              )}
              {activeTab === 'engine' && (
                <>
                  <option value="assign">🎯 Asignación</option>
                  <option value="reroute">🔄 Reroute</option>
                  <option value="movement">🚚 Movimiento</option>
                  <option value="offer_sent">📨 Oferta</option>
                </>
              )}
            </select>
          )}
          <IconChevronDown expanded={expanded} />
        </div>
      </div>
      
      {/* Contenido de logs */}
      {expanded && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px', fontSize: '0.7rem', fontFamily: 'monospace' }}>
          {activeTab === 'orders' && filteredOrders.length === 0 && (
            <div style={{ color: 'var(--text-tertiary)', textAlign: 'center', padding: '20px' }}>
              No hay logs de pedidos
            </div>
          )}
          {activeTab === 'orders' && filteredOrders.map(log => (
            <div key={log.id} style={{ padding: '4px 0', borderBottom: '1px solid var(--border-light)', display: 'flex', gap: '12px' }}>
              <span style={{ color: 'var(--text-tertiary)', minWidth: '45px' }}>{formatSimTime(log.simTime)}</span>
              <span style={{ minWidth: '100px' }}>{getOrderTypeLabel(log.type)}</span>
              <span style={{ color: 'var(--text-secondary)' }}>{JSON.stringify(log.data).slice(0, 150)}</span>
            </div>
          ))}
          {activeTab === 'engine' && filteredEngine.length === 0 && (
            <div style={{ color: 'var(--text-tertiary)', textAlign: 'center', padding: '20px' }}>
              No hay logs del engine
            </div>
          )}
          {activeTab === 'engine' && filteredEngine.map(log => (
            <div key={log.id} style={{ padding: '4px 0', borderBottom: '1px solid var(--border-light)', display: 'flex', gap: '12px' }}>
              <span style={{ color: 'var(--text-tertiary)', minWidth: '45px' }}>{formatSimTime(log.simTime)}</span>
              <span style={{ minWidth: '100px' }}>{getEngineTypeLabel(log.type)}</span>
              <span style={{ color: 'var(--text-secondary)' }}>{JSON.stringify(log.data).slice(0, 150)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Sidebar izquierdo con listas de entidades
function Sidebar({ onSelectEntity, selectedEntityType, selectedEntityId }) {
  const { world, addDriver, addRestaurant, addCustomer, getDrivers, getRestaurants, getCustomers } = useSimContext();
  const [driversExpanded, setDriversExpanded] = useState(true);
  const [restaurantsExpanded, setRestaurantsExpanded] = useState(true);
  const [customersExpanded, setCustomersExpanded] = useState(true);
  
  const [newDriverPos, setNewDriverPos] = useState({ lat: 19.70595, lng: -101.19498 });
  const [newRestaurantPos, setNewRestaurantPos] = useState({ lat: 19.70595, lng: -101.19498 });
  const [newCustomerPos, setNewCustomerPos] = useState({ lat: 19.70595, lng: -101.19498 });
  
  const drivers = getDrivers();
  const restaurants = getRestaurants();
  const customers = getCustomers();
  
  const handleAddDriver = () => {
    const name = prompt('Nombre del conductor (opcional):');
    addDriver({
      lat: newDriverPos.lat,
      lng: newDriverPos.lng,
      vehicleType: 'car',
      bagCapacityLiters: 60,
      name: name || undefined,
    });
  };
  
  const handleAddRestaurant = () => {
    const name = prompt('Nombre del restaurante:');
    if (!name) return;
    addRestaurant({
      lat: newRestaurantPos.lat,
      lng: newRestaurantPos.lng,
      name,
      prepTimeMins: 15,
    });
  };
  
  const handleAddCustomer = () => {
    const name = prompt('Nombre del cliente:');
    if (!name) return;
    addCustomer({
      lat: newCustomerPos.lat,
      lng: newCustomerPos.lng,
      name,
    });
  };
  
  const isSelected = (type, id) => selectedEntityType === type && selectedEntityId === id;
  
  return (
    <div style={{
      width: '220px',
      background: 'var(--bg-card)',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      overflowY: 'auto',
      flexShrink: 0,
    }}>
      {/* Drivers */}
      <div style={{ borderBottom: '1px solid var(--border)' }}>
        <div
          onClick={() => setDriversExpanded(!driversExpanded)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 12px',
            cursor: 'pointer',
            background: 'var(--bg-raised)',
          }}
        >
          <span style={{ fontWeight: 600, fontSize: '0.8rem' }}>🚗 Conductores ({drivers.length})</span>
          <IconChevronDown expanded={driversExpanded} />
        </div>
        {driversExpanded && (
          <div style={{ padding: '8px' }}>
            {drivers.map(driver => (
              <div
                key={driver.id}
                onClick={() => onSelectEntity('driver', driver.id)}
                style={{
                  padding: '6px 8px',
                  marginBottom: '4px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  background: isSelected('driver', driver.id) ? 'var(--brand-light)' : 'transparent',
                  fontSize: '0.75rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span>{driver.name}</span>
                <span style={{ fontSize: '0.6rem', color: driver.is_available ? 'var(--success)' : 'var(--danger)' }}>
                  {driver.is_available ? '●' : '○'}
                </span>
              </div>
            ))}
            <div style={{ marginTop: '8px' }}>
              <div style={{ fontSize: '0.6rem', color: 'var(--text-tertiary)', marginBottom: '4px' }}>Posición inicial:</div>
              <input
                type="text"
                value={`${newDriverPos.lat.toFixed(5)}, ${newDriverPos.lng.toFixed(5)}`}
                onChange={(e) => {
                  const [lat, lng] = e.target.value.split(',').map(Number);
                  if (!isNaN(lat) && !isNaN(lng)) setNewDriverPos({ lat, lng });
                }}
                style={{ width: '100%', fontSize: '0.6rem', marginBottom: '4px', padding: '2px 4px' }}
                placeholder="lat, lng"
              />
              <button
                onClick={handleAddDriver}
                style={{
                  width: '100%',
                  padding: '4px',
                  fontSize: '0.7rem',
                  borderRadius: '4px',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-raised)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                }}
              >
                <IconPlus /> Agregar
              </button>
            </div>
          </div>
        )}
      </div>
      
      {/* Restaurantes */}
      <div style={{ borderBottom: '1px solid var(--border)' }}>
        <div
          onClick={() => setRestaurantsExpanded(!restaurantsExpanded)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 12px',
            cursor: 'pointer',
            background: 'var(--bg-raised)',
          }}
        >
          <span style={{ fontWeight: 600, fontSize: '0.8rem' }}>🍽️ Restaurantes ({restaurants.length})</span>
          <IconChevronDown expanded={restaurantsExpanded} />
        </div>
        {restaurantsExpanded && (
          <div style={{ padding: '8px' }}>
            {restaurants.map(restaurant => (
              <div
                key={restaurant.id}
                onClick={() => onSelectEntity('restaurant', restaurant.id)}
                style={{
                  padding: '6px 8px',
                  marginBottom: '4px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  background: isSelected('restaurant', restaurant.id) ? 'var(--brand-light)' : 'transparent',
                  fontSize: '0.75rem',
                }}
              >
                {restaurant.name}
              </div>
            ))}
            <div style={{ marginTop: '8px' }}>
              <div style={{ fontSize: '0.6rem', color: 'var(--text-tertiary)', marginBottom: '4px' }}>Posición:</div>
              <input
                type="text"
                value={`${newRestaurantPos.lat.toFixed(5)}, ${newRestaurantPos.lng.toFixed(5)}`}
                onChange={(e) => {
                  const [lat, lng] = e.target.value.split(',').map(Number);
                  if (!isNaN(lat) && !isNaN(lng)) setNewRestaurantPos({ lat, lng });
                }}
                style={{ width: '100%', fontSize: '0.6rem', marginBottom: '4px', padding: '2px 4px' }}
              />
              <button
                onClick={handleAddRestaurant}
                style={{
                  width: '100%',
                  padding: '4px',
                  fontSize: '0.7rem',
                  borderRadius: '4px',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-raised)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                }}
              >
                <IconPlus /> Agregar
              </button>
            </div>
          </div>
        )}
      </div>
      
      {/* Clientes */}
      <div>
        <div
          onClick={() => setCustomersExpanded(!customersExpanded)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 12px',
            cursor: 'pointer',
            background: 'var(--bg-raised)',
          }}
        >
          <span style={{ fontWeight: 600, fontSize: '0.8rem' }}>👤 Clientes ({customers.length})</span>
          <IconChevronDown expanded={customersExpanded} />
        </div>
        {customersExpanded && (
          <div style={{ padding: '8px' }}>
            {customers.map(customer => (
              <div
                key={customer.id}
                onClick={() => onSelectEntity('customer', customer.id)}
                style={{
                  padding: '6px 8px',
                  marginBottom: '4px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  background: isSelected('customer', customer.id) ? 'var(--brand-light)' : 'transparent',
                  fontSize: '0.75rem',
                }}
              >
                {customer.name}
              </div>
            ))}
            <div style={{ marginTop: '8px' }}>
              <div style={{ fontSize: '0.6rem', color: 'var(--text-tertiary)', marginBottom: '4px' }}>Posición:</div>
              <input
                type="text"
                value={`${newCustomerPos.lat.toFixed(5)}, ${newCustomerPos.lng.toFixed(5)}`}
                onChange={(e) => {
                  const [lat, lng] = e.target.value.split(',').map(Number);
                  if (!isNaN(lat) && !isNaN(lng)) setNewCustomerPos({ lat, lng });
                }}
                style={{ width: '100%', fontSize: '0.6rem', marginBottom: '4px', padding: '2px 4px' }}
              />
              <button
                onClick={handleAddCustomer}
                style={{
                  width: '100%',
                  padding: '4px',
                  fontSize: '0.7rem',
                  borderRadius: '4px',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-raised)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                }}
              >
                <IconPlus /> Agregar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// TopBar con controles
function TopBar() {
  const { clock, startSimulation, pauseSimulation, resetSimulation, setSimSpeed, simTime, simSpeed, isRunning } = useSimContext();
  const [speed, setSpeed] = useState(simSpeed);
  
  const handleSpeedChange = (newSpeed) => {
    setSpeed(newSpeed);
    setSimSpeed(newSpeed);
  };
  
  const formatTime = (secs) => {
    const mins = Math.floor(secs / 60);
    const remainingSecs = Math.floor(secs % 60);
    return `${mins}:${remainingSecs.toString().padStart(2, '0')}`;
  };
  
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '8px 16px',
      background: 'var(--bg-card)',
      borderBottom: '1px solid var(--border)',
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
          <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>EnCorto</span>
          <span style={{
            fontSize: '0.6rem',
            background: 'var(--brand)',
            color: '#fff',
            padding: '2px 6px',
            borderRadius: '10px',
          }}>SIM</span>
        </div>
        <div style={{ fontSize: '0.85rem', fontFamily: 'monospace' }}>
          ⏱️ {formatTime(simTime)}
        </div>
      </div>
      
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-raised)', borderRadius: '8px', padding: '2px' }}>
          {[1, 2, 5, 10].map(s => (
            <button
              key={s}
              onClick={() => handleSpeedChange(s)}
              style={{
                padding: '4px 10px',
                borderRadius: '6px',
                border: 'none',
                background: speed === s ? 'var(--brand)' : 'transparent',
                color: speed === s ? '#fff' : 'var(--text-secondary)',
                fontSize: '0.7rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {s}x
            </button>
          ))}
        </div>
        
        <button
          onClick={isRunning ? pauseSimulation : startSimulation}
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            border: 'none',
            background: 'var(--brand)',
            color: '#fff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {isRunning ? <IconPause /> : <IconPlay />}
        </button>
        
        <button
          onClick={resetSimulation}
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            border: '1px solid var(--border)',
            background: 'var(--bg-raised)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <IconReset />
        </button>
      </div>
    </div>
  );
}

// Componente principal del simulador
function SimPageContent() {
  const [selectedEntityType, setSelectedEntityType] = useState(null);
  const [selectedEntityId, setSelectedEntityId] = useState(null);
  const [wayPickerMode, setWayPickerMode] = useState(null);
  const [zonePlacerMode, setZonePlacerMode] = useState(null);
  
  const handleSelectEntity = (type, id) => {
    setSelectedEntityType(type);
    setSelectedEntityId(id);
  };
  
  const handleClosePanel = () => {
    setSelectedEntityType(null);
    setSelectedEntityId(null);
  };
  
  const renderSelectedPanel = () => {
    if (!selectedEntityType || !selectedEntityId) {
      return (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--text-tertiary)',
          fontSize: '0.8rem',
          textAlign: 'center',
          padding: '20px',
        }}>
          Selecciona un conductor,<br />
          restaurante o cliente<br />
          desde el mapa o el sidebar
        </div>
      );
    }
    
    switch (selectedEntityType) {
      case 'driver':
        return <DriverPanel driverId={selectedEntityId} onClose={handleClosePanel} />;
      case 'restaurant':
        return <RestaurantPanel restaurantId={selectedEntityId} onClose={handleClosePanel} />;
      case 'customer':
        return <CustomerPanel customerId={selectedEntityId} onClose={handleClosePanel} />;
      default:
        return null;
    }
  };
  
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      width: '100vw',
      overflow: 'hidden',
      background: 'var(--bg-page)',
    }}>
      <TopBar />
      
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar
          onSelectEntity={handleSelectEntity}
          selectedEntityType={selectedEntityType}
          selectedEntityId={selectedEntityId}
        />
        
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <SimMap
              selectedEntityId={selectedEntityId}
              selectedEntityType={selectedEntityType}
              onSelectEntity={handleSelectEntity}
              wayPickerMode={wayPickerMode}
              onWayPickerConfirm={(ways) => { console.log('Ways:', ways); setWayPickerMode(null); }}
              onWayPickerCancel={() => setWayPickerMode(null)}
              zonePlacerMode={zonePlacerMode}
              onZonePlacerConfirm={(zone) => { console.log('Zone:', zone); setZonePlacerMode(null); }}
              onZonePlacerCancel={() => setZonePlacerMode(null)}
            />
          </div>
          <LogPanel />
        </div>
        
        <div style={{
          width: '320px',
          borderLeft: '1px solid var(--border)',
          background: 'var(--bg-card)',
          overflowY: 'auto',
          flexShrink: 0,
        }}>
          {renderSelectedPanel()}
        </div>
      </div>
    </div>
  );
}

// Export con Provider
export default function SimPage() {
  return (
    <SimProvider>
      <SimPageContent />
    </SimProvider>
  );
}