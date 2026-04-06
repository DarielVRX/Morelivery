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

// Mini popup flotante para configurar entidad recién colocada
function PlacePopup({ type, pos, onConfirm, onCancel }) {
  const [name, setName]         = useState('');
  const [vehicle, setVehicle]   = useState('motorcycle');
  const [bag, setBag]           = useState(60);
  const [prep, setPrep]         = useState(15);

  const handleConfirm = () => {
    if (type === 'restaurant' && !name.trim()) return;
    onConfirm({
      name: name.trim() || undefined,
      vehicleType: vehicle,
      bagCapacityLiters: Number(bag),
      prepTimeMins: Number(prep),
    });
  };

  return (
    <div style={{
      position: 'absolute', top: '50%', left: '50%',
      transform: 'translate(-50%, -50%)',
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '1rem', zIndex: 100,
      boxShadow: '0 8px 32px rgba(0,0,0,0.25)', minWidth: 220,
    }}>
      <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.75rem' }}>
        {type === 'driver' ? '🛵 Nuevo conductor' : type === 'restaurant' ? '🍽️ Nuevo restaurante' : '👤 Nuevo cliente'}
      </div>

      <input
        autoFocus
        placeholder={type === 'restaurant' ? 'Nombre del restaurante *' : 'Nombre (opcional)'}
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleConfirm()}
        style={{ width: '100%', marginBottom: '0.5rem', padding: '0.4rem 0.6rem',
          borderRadius: 7, border: '1px solid var(--border)', fontSize: '0.82rem',
          boxSizing: 'border-box' }}
      />

      {type === 'driver' && (
        <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.5rem' }}>
          {['motorcycle','car','bike'].map(v => (
            <button key={v} onClick={() => setVehicle(v)}
              style={{ flex: 1, padding: '0.3rem', borderRadius: 6, fontSize: '0.7rem',
                fontWeight: 600, cursor: 'pointer', border: '1px solid var(--border)',
                background: vehicle === v ? 'var(--brand)' : 'var(--bg-raised)',
                color: vehicle === v ? '#fff' : 'var(--text-secondary)' }}>
              {v === 'motorcycle' ? '🏍️' : v === 'car' ? '🚗' : '🚲'}
            </button>
          ))}
        </div>
      )}

      {type === 'driver' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem',
          fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          <span>Mochila</span>
          <input type="number" value={bag} onChange={e => setBag(e.target.value)}
            min={1} max={200} style={{ width: 60, padding: '0.25rem 0.4rem',
              borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.75rem' }} />
          <span>L</span>
        </div>
      )}

      {type === 'restaurant' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem',
          fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          <span>Prep</span>
          <input type="number" value={prep} onChange={e => setPrep(e.target.value)}
            min={1} max={120} style={{ width: 55, padding: '0.25rem 0.4rem',
              borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.75rem' }} />
          <span>min</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
        <button onClick={handleConfirm}
          style={{ flex: 1, padding: '0.45rem', borderRadius: 7, border: 'none',
            background: 'var(--brand)', color: '#fff', fontWeight: 700,
            fontSize: '0.8rem', cursor: 'pointer' }}>
          Colocar
        </button>
        <button onClick={onCancel}
          style={{ padding: '0.45rem 0.75rem', borderRadius: 7,
            border: '1px solid var(--border)', background: 'var(--bg-raised)',
            cursor: 'pointer', fontSize: '0.8rem' }}>
          ✕
        </button>
      </div>
    </div>
  );
}

// Sidebar izquierdo con listas de entidades
function Sidebar({ onSelectEntity, selectedEntityType, selectedEntityId, onStartPlace }) {
  const { getDrivers, getRestaurants, getCustomers } = useSimContext();
  const [driversExpanded,     setDriversExpanded]     = useState(true);
  const [restaurantsExpanded, setRestaurantsExpanded] = useState(true);
  const [customersExpanded,   setCustomersExpanded]   = useState(true);

  const drivers     = getDrivers();
  const restaurants = getRestaurants();
  const customers   = getCustomers();

  const isSelected = (type, id) => selectedEntityType === type && selectedEntityId === id;

  return (
    <div style={{
      width: '200px', background: 'var(--bg-card)',
      borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      overflowY: 'auto', flexShrink: 0,
    }}>
      {/* Drivers */}
      <div style={{ borderBottom: '1px solid var(--border)' }}>
        <div onClick={() => setDriversExpanded(!driversExpanded)}
          style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
            padding:'10px 12px', cursor:'pointer', background:'var(--bg-raised)' }}>
          <span style={{ fontWeight:600, fontSize:'0.8rem' }}>🛵 Conductores ({drivers.length})</span>
          <IconChevronDown expanded={driversExpanded} />
        </div>
        {driversExpanded && (
          <div style={{ padding:'6px 8px' }}>
            {drivers.map(d => (
              <div key={d.id} onClick={() => onSelectEntity('driver', d.id)}
                style={{ padding:'5px 8px', marginBottom:3, borderRadius:6, cursor:'pointer',
                  background: isSelected('driver', d.id) ? 'var(--brand-light)' : 'transparent',
                  fontSize:'0.75rem', display:'flex', justifyContent:'space-between' }}>
                <span>{d.name}</span>
                <span style={{ fontSize:'0.6rem', color: d.is_available ? 'var(--success)' : 'var(--danger)' }}>
                  {d.is_available ? '●' : '○'}
                </span>
              </div>
            ))}
            <button onClick={() => onStartPlace('driver')}
              style={{ width:'100%', marginTop:6, padding:'5px', borderRadius:6,
                border:'1px dashed var(--brand)', background:'transparent',
                color:'var(--brand)', fontSize:'0.72rem', fontWeight:600,
                cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:4 }}>
              <IconPlus /> Colocar en mapa
            </button>
          </div>
        )}
      </div>

      {/* Restaurantes */}
      <div style={{ borderBottom: '1px solid var(--border)' }}>
        <div onClick={() => setRestaurantsExpanded(!restaurantsExpanded)}
          style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
            padding:'10px 12px', cursor:'pointer', background:'var(--bg-raised)' }}>
          <span style={{ fontWeight:600, fontSize:'0.8rem' }}>🍽️ Restaurantes ({restaurants.length})</span>
          <IconChevronDown expanded={restaurantsExpanded} />
        </div>
        {restaurantsExpanded && (
          <div style={{ padding:'6px 8px' }}>
            {restaurants.map(r => (
              <div key={r.id} onClick={() => onSelectEntity('restaurant', r.id)}
                style={{ padding:'5px 8px', marginBottom:3, borderRadius:6, cursor:'pointer',
                  background: isSelected('restaurant', r.id) ? 'var(--brand-light)' : 'transparent',
                  fontSize:'0.75rem' }}>
                {r.name}
              </div>
            ))}
            <button onClick={() => onStartPlace('restaurant')}
              style={{ width:'100%', marginTop:6, padding:'5px', borderRadius:6,
                border:'1px dashed var(--brand)', background:'transparent',
                color:'var(--brand)', fontSize:'0.72rem', fontWeight:600,
                cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:4 }}>
              <IconPlus /> Colocar en mapa
            </button>
          </div>
        )}
      </div>

      {/* Clientes */}
      <div>
        <div onClick={() => setCustomersExpanded(!customersExpanded)}
          style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
            padding:'10px 12px', cursor:'pointer', background:'var(--bg-raised)' }}>
          <span style={{ fontWeight:600, fontSize:'0.8rem' }}>👤 Clientes ({customers.length})</span>
          <IconChevronDown expanded={customersExpanded} />
        </div>
        {customersExpanded && (
          <div style={{ padding:'6px 8px' }}>
            {customers.map(c => (
              <div key={c.id} onClick={() => onSelectEntity('customer', c.id)}
                style={{ padding:'5px 8px', marginBottom:3, borderRadius:6, cursor:'pointer',
                  background: isSelected('customer', c.id) ? 'var(--brand-light)' : 'transparent',
                  fontSize:'0.75rem' }}>
                {c.name}
              </div>
            ))}
            <button onClick={() => onStartPlace('customer')}
              style={{ width:'100%', marginTop:6, padding:'5px', borderRadius:6,
                border:'1px dashed var(--brand)', background:'transparent',
                color:'var(--brand)', fontSize:'0.72rem', fontWeight:600,
                cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:4 }}>
              <IconPlus /> Colocar en mapa
            </button>
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

function SimPageContent() {
  const { addDriver, addRestaurant, addCustomer } = useSimContext();
  const [selectedEntityType, setSelectedEntityType] = useState(null);
  const [selectedEntityId,   setSelectedEntityId]   = useState(null);
  const [wayPickerMode,      setWayPickerMode]       = useState(null);
  const [zonePlacerMode,     setZonePlacerMode]      = useState(null);

  // placeMode: tipo de entidad a colocar ('driver'|'restaurant'|'customer'|null)
  // pendingPlace: { type, lat, lng } — esperando popup de config
  const [placeMode,    setPlaceMode]    = useState(null);
  const [pendingPlace, setPendingPlace] = useState(null);

  // ESC cancela placeMode
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') { setPlaceMode(null); setPendingPlace(null); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleSelectEntity = (type, id) => {
    setSelectedEntityType(type);
    setSelectedEntityId(id);
  };

  const handleClosePanel = () => {
    setSelectedEntityType(null);
    setSelectedEntityId(null);
  };

  // Click en mapa mientras se está en placeMode
  const handleMapPlaceClick = ({ lat, lng }) => {
    if (!placeMode) return;
    setPendingPlace({ type: placeMode, lat, lng });
    setPlaceMode(null);
  };

  // Confirmar creación desde el popup
  const handlePlaceConfirm = ({ name, vehicleType, bagCapacityLiters, prepTimeMins }) => {
    if (!pendingPlace) return;
    const { type, lat, lng } = pendingPlace;
    if (type === 'driver') {
      addDriver({ lat, lng, vehicleType, bagCapacityLiters, name });
    } else if (type === 'restaurant') {
      addRestaurant({ lat, lng, name, prepTimeMins });
    } else {
      addCustomer({ lat, lng, name });
    }
    setPendingPlace(null);
  };

  const renderSelectedPanel = () => {
    if (!selectedEntityType || !selectedEntityId) {
      return (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center',
          height:'100%', color:'var(--text-tertiary)', fontSize:'0.8rem',
          textAlign:'center', padding:'20px' }}>
          Selecciona un conductor,<br />
          restaurante o cliente<br />
          desde el mapa o el sidebar
        </div>
      );
    }
    switch (selectedEntityType) {
      case 'driver':     return <DriverPanel     driverId={selectedEntityId}     onClose={handleClosePanel} />;
      case 'restaurant': return <RestaurantPanel restaurantId={selectedEntityId} onClose={handleClosePanel} />;
      case 'customer':   return <CustomerPanel   customerId={selectedEntityId}   onClose={handleClosePanel} />;
      default:           return null;
    }
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100vh',
      width:'100vw', overflow:'hidden', background:'var(--bg-page)' }}>
      <TopBar />

      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>
        <Sidebar
          onSelectEntity={handleSelectEntity}
          selectedEntityType={selectedEntityType}
          selectedEntityId={selectedEntityId}
          onStartPlace={setPlaceMode}
        />

        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
          <div style={{ flex:1, position:'relative',
            cursor: placeMode ? 'crosshair' : 'default' }}>

            {/* Banner de modo colocar */}
            {placeMode && (
              <div style={{
                position:'absolute', top:10, left:'50%', transform:'translateX(-50%)',
                background:'rgba(0,0,0,0.7)', color:'#fff', borderRadius:20,
                padding:'0.3rem 1rem', fontSize:'0.75rem', zIndex:20,
                pointerEvents:'none', whiteSpace:'nowrap',
              }}>
                {placeMode === 'driver' ? '🛵' : placeMode === 'restaurant' ? '🍽️' : '👤'}
                {' '}Toca el mapa para colocar · <span style={{ opacity:0.7 }}>ESC para cancelar</span>
              </div>
            )}

            <SimMap
              selectedEntityId={selectedEntityId}
              selectedEntityType={selectedEntityType}
              onSelectEntity={handleSelectEntity}
              placeMode={placeMode}
              onPlaceClick={handleMapPlaceClick}
              wayPickerMode={wayPickerMode}
              onWayPickerConfirm={() => setWayPickerMode(null)}
              onWayPickerCancel={() => setWayPickerMode(null)}
              zonePlacerMode={zonePlacerMode}
              onZonePlacerConfirm={() => setZonePlacerMode(null)}
              onZonePlacerCancel={() => setZonePlacerMode(null)}
            />

            {/* Popup de configuración */}
            {pendingPlace && (
              <PlacePopup
                type={pendingPlace.type}
                pos={{ lat: pendingPlace.lat, lng: pendingPlace.lng }}
                onConfirm={handlePlaceConfirm}
                onCancel={() => setPendingPlace(null)}
              />
            )}
          </div>
          <LogPanel />
        </div>

        <div style={{ width:'320px', borderLeft:'1px solid var(--border)',
          background:'var(--bg-card)', overflowY:'auto', flexShrink:0 }}>
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
