// frontend/src/sim/panels/DriverPanel.jsx
// Panel colapsable para un driver individual.
// Reutiliza ActiveOrderPanel de producción cuando hay pedido activo.

import React, { useState, useEffect, useRef } from 'react';
import { useSimContext } from '../SimProvider.jsx';

// Íconos simples
function IconUser() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function IconBike() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="5.5" cy="17.5" r="3.5" />
      <circle cx="18.5" cy="17.5" r="3.5" />
      <path d="M15 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" />
      <path d="M12 17v-6l-3-3 4-3 3 3-2 2" />
      <path d="M8 12h3" />
    </svg>
  );
}

function IconCar() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M5 12h14M7 8h10M9 4h6" />
      <rect x="3" y="10" width="18" height="8" rx="2" />
      <circle cx="7" cy="16" r="2" />
      <circle cx="17" cy="16" r="2" />
    </svg>
  );
}

function IconMotorcycle() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="5.5" cy="17.5" r="3.5" />
      <circle cx="18.5" cy="17.5" r="3.5" />
      <path d="M14 6h3l2 3" />
      <path d="M12 17v-6l-3-3 4-3 3 3-2 2" />
      <path d="M8 12h3" />
    </svg>
  );
}

function IconPlay() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function IconPause() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </svg>
  );
}

function IconStop() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <rect x="4" y="4" width="16" height="16" />
    </svg>
  );
}

function IconChevron({ expanded }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points={expanded ? "18 15 12 9 6 15" : "6 9 12 15 18 9"} />
    </svg>
  );
}

// Componente de progreso simple
function ProgressBar({ progress, label }) {
  const percent = Math.min(100, Math.max(0, (progress || 0) * 100));
  return (
    <div style={{ width: '100%' }}>
      {label && <div style={{ fontSize: '0.7rem', marginBottom: '4px', color: 'var(--text-secondary)' }}>{label}</div>}
      <div style={{ height: '6px', background: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
        <div style={{ width: `${percent}%`, height: '100%', background: 'var(--brand)', borderRadius: '3px', transition: 'width 0.3s' }} />
      </div>
    </div>
  );
}

// Mini ActiveOrderPanel (simplificado para el simulador)
function MiniActiveOrderPanel({ order, onStatusChange, loadingStatus }) {
  if (!order) return null;

  const isPickup = order.status !== 'on_the_way' && order.status !== 'delivered';
  const targetName = isPickup ? order.restaurant_name : order.customer_name;
  const targetAddress = isPickup ? order.restaurant_name : order.customer_name;

  const canMarkReady = order.status === 'preparing';
  const canMarkOTW = order.status === 'ready' || (order.status === 'accepted' && order.restaurant_confirmed);
  const canMarkDelivered = order.status === 'on_the_way';

  const handleStatus = (status) => {
    if (loadingStatus) return;
    onStatusChange(order.id, status);
  };

  return (
    <div style={{ 
      background: 'var(--bg-raised)', 
      borderRadius: '8px', 
      padding: '0.75rem',
      border: '1px solid var(--border)'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>{targetName}</span>
        <span style={{ 
          fontSize: '0.65rem', 
          padding: '2px 8px', 
          borderRadius: '12px',
          background: order.status === 'on_the_way' ? 'var(--success-bg)' : 'var(--warn-bg)',
          color: order.status === 'on_the_way' ? 'var(--success)' : 'var(--warn)'
        }}>
          {order.status}
        </span>
      </div>
      
      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
        {targetAddress}
      </div>
      
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
        {canMarkReady && (
          <button
            onClick={() => handleStatus('ready')}
            disabled={loadingStatus === 'ready'}
            style={{
              flex: 1,
              padding: '0.5rem',
              background: '#f59e0b',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Listo
          </button>
        )}
        {canMarkOTW && (
          <button
            onClick={() => handleStatus('on_the_way')}
            disabled={loadingStatus === 'on_the_way'}
            style={{
              flex: 1,
              padding: '0.5rem',
              background: 'var(--brand)',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            En camino
          </button>
        )}
        {canMarkDelivered && (
          <button
            onClick={() => handleStatus('delivered')}
            disabled={loadingStatus === 'delivered'}
            style={{
              flex: 1,
              padding: '0.5rem',
              background: 'var(--success)',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Entregar
          </button>
        )}
      </div>
    </div>
  );
}

export default function DriverPanel({ driverId, onClose, onSelectEntity }) {
  const {
    world,
    clock,
    movementEngine,
    setDriverAvailability,
    addImpassableWay,
    removeImpassableWay,
    addRoutePreference,
    removeRoutePreference,
    releaseDriverFromOrder,
    updateOrderStatus,
    startDriverMovement,
    pauseDriverMovement,
    resumeDriverMovement,
    stopDriverMovement,
    isDriverMoving,
    getDriverProgress,
    isDriverInCooldown,
    simTime,
  } = useSimContext();

  const [expanded, setExpanded] = useState(true);
  const [loadingStatus, setLoadingStatus] = useState(null);
  const [showReleaseConfirm, setShowReleaseConfirm] = useState(false);
  const [releaseReason, setReleaseReason] = useState('');
  const [showWayPicker, setShowWayPicker] = useState(false);
  const [wayPickerMode, setWayPickerMode] = useState(null);
  const [progress, setProgress] = useState(null);

  const driver = world.getDriver(driverId);
  const activeOrder = driver?.activeOrders?.[0] ? world.getOrder(driver.activeOrders[0]) : null;
  const isMoving = isDriverMoving?.(driverId) || false;
  const inCooldown = isDriverInCooldown?.(driverId) || false;

  // Actualizar progreso periódicamente
  useEffect(() => {
    if (!isMoving) {
      setProgress(null);
      return;
    }
    const interval = setInterval(() => {
      const prog = getDriverProgress?.(driverId);
      if (prog) setProgress(prog);
    }, 500);
    return () => clearInterval(interval);
  }, [isMoving, driverId, getDriverProgress]);

  if (!driver) {
    return (
      <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
        Conductor no encontrado
      </div>
    );
  }

  const vehicleIcon = {
    bike: <IconBike />,
    motorcycle: <IconMotorcycle />,
    car: <IconCar />,
  }[driver.vehicle_type] || <IconCar />;

  const handleToggleAvailability = () => {
    setDriverAvailability(driverId, !driver.is_available);
  };

  const handleStatusChange = async (orderId, status) => {
    setLoadingStatus(status);
    try {
      await updateOrderStatus(orderId, status);
      // Si el pedido se pone en camino, iniciar movimiento
      if (status === 'on_the_way') {
        // Esperar a que el reroute engine calcule la ruta
        setTimeout(() => {
          // La ruta ya debería estar en el event bus
          // El movimiento se iniciará desde SimMap cuando reciba route_update
        }, 500);
      }
    } finally {
      setLoadingStatus(null);
    }
  };

  const handleRelease = async () => {
    if (releaseReason.trim().length < 5) return;
    await releaseDriverFromOrder(driverId, activeOrder?.id, releaseReason);
    setShowReleaseConfirm(false);
    setReleaseReason('');
  };

  const handleMovementControl = () => {
    if (isMoving) {
      pauseDriverMovement?.(driverId);
    } else if (progress) {
      resumeDriverMovement?.(driverId);
    }
  };

  const handleStopMovement = () => {
    stopDriverMovement?.(driverId);
  };

  const handleWayPickerConfirm = (ways) => {
    if (wayPickerMode === 'impassable') {
      ways.forEach(way => addImpassableWay(driverId, way));
    } else if (wayPickerMode === 'preference') {
      ways.forEach(way => addRoutePreference(driverId, way));
    }
    setShowWayPicker(false);
    setWayPickerMode(null);
  };

  return (
    <div style={{ 
      height: '100%', 
      display: 'flex', 
      flexDirection: 'column',
      background: 'var(--bg-card)',
    }}>
      {/* Header */}
      <div 
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '12px',
          cursor: 'pointer',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-raised)',
        }}
      >
        <div style={{ 
          width: '40px', 
          height: '40px', 
          borderRadius: '50%', 
          background: 'var(--brand-light)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--brand)'
        }}>
          {vehicleIcon}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700 }}>{driver.name}</div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
            {driver.vehicle_type} · {driver.activeOrders.length} pedido(s)
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onClose?.(); }}
          style={{
            background: 'none',
            border: 'none',
            fontSize: '1.2rem',
            cursor: 'pointer',
            color: 'var(--text-secondary)'
          }}
        >
          ✕
        </button>
      </div>

      {expanded && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          
          {/* Estado y disponibilidad */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Estado</div>
              <div style={{ fontWeight: 600, color: driver.is_available ? 'var(--success)' : 'var(--danger)' }}>
                {driver.is_available ? 'Disponible' : 'Desconectado'}
                {inCooldown && <span style={{ fontSize: '0.65rem', marginLeft: '8px', color: 'var(--warn)' }}>(cooldown)</span>}
              </div>
            </div>
            <button
              onClick={handleToggleAvailability}
              style={{
                padding: '6px 12px',
                borderRadius: '20px',
                border: 'none',
                background: driver.is_available ? 'var(--danger-bg)' : 'var(--success-bg)',
                color: driver.is_available ? 'var(--danger)' : 'var(--success)',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              {driver.is_available ? 'Desconectar' : 'Conectar'}
            </button>
          </div>

          {/* Posición actual */}
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
            📍 Posición: {driver.last_lat.toFixed(5)}, {driver.last_lng.toFixed(5)}
          </div>

          {/* Pedido activo */}
          {activeOrder && (
            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: '8px' }}>Pedido activo</div>
              <MiniActiveOrderPanel 
                order={activeOrder}
                onStatusChange={handleStatusChange}
                loadingStatus={loadingStatus}
              />
            </div>
          )}

          {/* Recorrido / movimiento */}
          {progress && (
            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: '8px' }}>Recorrido</div>
              <div style={{ background: 'var(--bg-raised)', borderRadius: '8px', padding: '10px' }}>
                <ProgressBar progress={progress.progress} label={`${Math.round(progress.progress * 100)}% completado`} />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px', fontSize: '0.65rem', color: 'var(--text-secondary)' }}>
                  <span>{Math.round(progress.distanceTraveled)}m</span>
                  <span>{Math.round(progress.totalDistance)}m</span>
                </div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                  <button
                    onClick={handleMovementControl}
                    style={{
                      flex: 1,
                      padding: '6px',
                      borderRadius: '6px',
                      border: '1px solid var(--border)',
                      background: 'var(--bg-card)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '4px'
                    }}
                  >
                    {isMoving ? <IconPause /> : <IconPlay />}
                    {isMoving ? 'Pausar' : 'Reanudar'}
                  </button>
                  <button
                    onClick={handleStopMovement}
                    style={{
                      flex: 1,
                      padding: '6px',
                      borderRadius: '6px',
                      border: '1px solid var(--danger-border)',
                      background: 'var(--danger-bg)',
                      color: 'var(--danger)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '4px'
                    }}
                  >
                    <IconStop />
                    Detener
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Preferencias de ruta */}
          <div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: '8px' }}>Preferencias de ruta</div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                onClick={() => { setWayPickerMode('impassable'); setShowWayPicker(true); }}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--danger-border)',
                  background: 'var(--danger-bg)',
                  color: 'var(--danger)',
                  fontSize: '0.7rem',
                  cursor: 'pointer'
                }}
              >
                ⛔ Marcar calle no viable
              </button>
              <button
                onClick={() => { setWayPickerMode('preference'); setShowWayPicker(true); }}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--brand-border)',
                  background: 'var(--brand-light)',
                  color: 'var(--brand)',
                  fontSize: '0.7rem',
                  cursor: 'pointer'
                }}
              >
                ⭐ Marcar preferencia
              </button>
            </div>
            
            {/* Lista de calles no viables */}
            {driver.impassableWays.length > 0 && (
              <div style={{ marginTop: '8px' }}>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Calles no viables:</div>
                {driver.impassableWays.map(way => (
                  <div key={way.way_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.7rem', padding: '4px 0' }}>
                    <span>{way.name || way.way_id}</span>
                    <button
                      onClick={() => removeImpassableWay(driverId, way.way_id)}
                      style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '0.8rem' }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            {/* Lista de preferencias */}
            {driver.routePreferences.length > 0 && (
              <div style={{ marginTop: '8px' }}>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Preferencias:</div>
                {driver.routePreferences.map(way => (
                  <div key={way.way_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.7rem', padding: '4px 0' }}>
                    <span>{way.name || way.way_id} ({way.preference})</span>
                    <button
                      onClick={() => removeRoutePreference(driverId, way.way_id)}
                      style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '0.8rem' }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Acciones */}
          <div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: '8px' }}>Acciones</div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {activeOrder && (
                <>
                  <button
                    onClick={() => setShowReleaseConfirm(true)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '6px',
                      border: '1px solid var(--danger-border)',
                      background: 'var(--danger-bg)',
                      color: 'var(--danger)',
                      fontSize: '0.7rem',
                      cursor: 'pointer'
                    }}
                  >
                    🔓 Liberar pedido
                  </button>
                  <button
                    onClick={() => {
                      // Simular desconexión SSE - solo para logging
                      world._logEngine('movement', { driverId, action: 'simulate_disconnect' });
                    }}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '6px',
                      border: '1px solid var(--border)',
                      background: 'var(--bg-raised)',
                      fontSize: '0.7rem',
                      cursor: 'pointer'
                    }}
                  >
                    📡 Simular desconexión
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Confirmación de liberación */}
          {showReleaseConfirm && (
            <div style={{ 
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000
            }}>
              <div style={{ 
                background: 'var(--bg-card)',
                borderRadius: '12px',
                padding: '16px',
                width: '280px',
                maxWidth: '90%'
              }}>
                <div style={{ fontWeight: 700, marginBottom: '12px' }}>Liberar pedido</div>
                <textarea
                  value={releaseReason}
                  onChange={(e) => setReleaseReason(e.target.value)}
                  placeholder="Motivo (mín. 5 caracteres)"
                  rows={3}
                  style={{
                    width: '100%',
                    padding: '8px',
                    borderRadius: '6px',
                    border: '1px solid var(--border)',
                    fontSize: '0.75rem',
                    marginBottom: '12px'
                  }}
                />
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={handleRelease}
                    disabled={releaseReason.trim().length < 5}
                    style={{
                      flex: 1,
                      padding: '8px',
                      borderRadius: '6px',
                      border: 'none',
                      background: releaseReason.trim().length < 5 ? 'var(--border)' : 'var(--danger)',
                      color: '#fff',
                      cursor: releaseReason.trim().length < 5 ? 'not-allowed' : 'pointer'
                    }}
                  >
                    Confirmar
                  </button>
                  <button
                    onClick={() => { setShowReleaseConfirm(false); setReleaseReason(''); }}
                    style={{
                      flex: 1,
                      padding: '8px',
                      borderRadius: '6px',
                      border: '1px solid var(--border)',
                      background: 'var(--bg-card)',
                      cursor: 'pointer'
                    }}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* WayPicker placeholder (se abriría en el mapa) */}
          {showWayPicker && (
            <div style={{ 
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000
            }}>
              <div style={{ 
                background: 'var(--bg-card)',
                borderRadius: '12px',
                padding: '16px',
                width: '300px',
                textAlign: 'center'
              }}>
                <div style={{ marginBottom: '12px' }}>
                  {wayPickerMode === 'impassable' ? '⛔ Marcar calle no viable' : '⭐ Marcar preferencia'}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                  Esta funcionalidad requiere selección en el mapa.
                  <br />
                  Haz click en una calle en el mapa principal.
                </div>
                <button
                  onClick={() => { setShowWayPicker(false); setWayPickerMode(null); }}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '6px',
                    border: '1px solid var(--border)',
                    background: 'var(--bg-card)',
                    cursor: 'pointer'
                  }}
                >
                  Cerrar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}