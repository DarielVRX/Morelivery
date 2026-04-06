// frontend/src/sim/panels/RestaurantPanel.jsx
// Panel colapsable para un restaurante.

import React, { useState } from 'react';
import { useSimContext } from '../SimProvider.js';

// Íconos simples
function IconRestaurant() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 3h18v18H3z" />
      <path d="M8 7v10M16 7v10M12 7v10" />
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

function formatTimeSec(secs) {
  if (!secs) return '—';
  const mins = Math.round(secs / 60);
  return `${mins} min`;
}

export default function RestaurantPanel({ restaurantId, onClose }) {
  const {
    world,
    updateOrderStatus,
    setRestaurantOpen,
    setRestaurantPrepTime,
  } = useSimContext();

  const [expanded, setExpanded] = useState(true);
  const [prepTimeInput, setPrepTimeInput] = useState('');
  const [loadingStatus, setLoadingStatus] = useState(null);

  const restaurant = world.getRestaurant(restaurantId);
  
  // Obtener pedidos activos de este restaurante
  const activeOrders = world.getAllOrders().filter(
    order => order.restaurant_id === restaurantId && 
    !['delivered', 'cancelled'].includes(order.status)
  );

  if (!restaurant) {
    return (
      <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
        Restaurante no encontrado
      </div>
    );
  }

  const handleToggleOpen = () => {
    setRestaurantOpen(restaurantId, !restaurant.is_open);
  };

  const handleUpdatePrepTime = () => {
    const mins = parseInt(prepTimeInput, 10);
    if (!isNaN(mins) && mins > 0) {
      setRestaurantPrepTime(restaurantId, mins * 60);
      setPrepTimeInput('');
    }
  };

  const handleConfirmOrder = async (orderId) => {
    setLoadingStatus(orderId);
    try {
      await updateOrderStatus(orderId, 'accepted');
      // Actualizar restaurante confirmed
      const order = world.getOrder(orderId);
      if (order) order.restaurant_confirmed = true;
    } finally {
      setLoadingStatus(null);
    }
  };

  const handleMarkReady = async (orderId) => {
    setLoadingStatus(orderId);
    try {
      await updateOrderStatus(orderId, 'ready');
    } finally {
      setLoadingStatus(null);
    }
  };

  const getOrderStatusLabel = (status) => {
    const labels = {
      'created': '🆕 Nuevo',
      'assigned': '👨‍🍳 Asignado',
      'accepted': '✅ Confirmado',
      'preparing': '🍳 Preparando',
      'ready': '📦 Listo',
      'on_the_way': '🚚 En camino',
      'delivered': '✅ Entregado',
    };
    return labels[status] || status;
  };

  const getOrderActions = (order) => {
    if (order.status === 'created' && !order.restaurant_confirmed) {
      return (
        <button
          onClick={() => handleConfirmOrder(order.id)}
          disabled={loadingStatus === order.id}
          style={{
            padding: '4px 10px',
            borderRadius: '6px',
            border: 'none',
            background: 'var(--success)',
            color: '#fff',
            fontSize: '0.7rem',
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          Confirmar
        </button>
      );
    }
    
    if (order.status === 'accepted' || order.status === 'preparing') {
      return (
        <button
          onClick={() => handleMarkReady(order.id)}
          disabled={loadingStatus === order.id}
          style={{
            padding: '4px 10px',
            borderRadius: '6px',
            border: 'none',
            background: '#f59e0b',
            color: '#fff',
            fontSize: '0.7rem',
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          Marcar listo
        </button>
      );
    }
    
    return null;
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
          <IconRestaurant />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700 }}>{restaurant.name}</div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
            {restaurant.is_open ? '🟢 Abierto' : '🔴 Cerrado'} · {activeOrders.length} pedido(s)
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
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          
          {/* Estado y configuración */}
          <div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: '8px' }}>Estado</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Abierto/Cerrado</div>
                <div style={{ fontWeight: 600, color: restaurant.is_open ? 'var(--success)' : 'var(--danger)' }}>
                  {restaurant.is_open ? 'Abierto' : 'Cerrado'}
                </div>
              </div>
              <button
                onClick={handleToggleOpen}
                style={{
                  padding: '6px 12px',
                  borderRadius: '20px',
                  border: 'none',
                  background: restaurant.is_open ? 'var(--danger-bg)' : 'var(--success-bg)',
                  color: restaurant.is_open ? 'var(--danger)' : 'var(--success)',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                {restaurant.is_open ? 'Cerrar' : 'Abrir'}
              </button>
            </div>
          </div>

          {/* Posición */}
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
            📍 Ubicación: {restaurant.lat.toFixed(5)}, {restaurant.lng.toFixed(5)}
          </div>

          {/* Tiempo de preparación */}
          <div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: '8px' }}>Tiempo de preparación</div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                {formatTimeSec(restaurant.prep_time_estimate_s)}
              </span>
              <input
                type="number"
                value={prepTimeInput}
                onChange={(e) => setPrepTimeInput(e.target.value)}
                placeholder="minutos"
                style={{
                  width: '80px',
                  padding: '6px',
                  borderRadius: '6px',
                  border: '1px solid var(--border)',
                  fontSize: '0.75rem'
                }}
              />
              <button
                onClick={handleUpdatePrepTime}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-raised)',
                  fontSize: '0.7rem',
                  cursor: 'pointer'
                }}
              >
                Actualizar
              </button>
            </div>
          </div>

          {/* Pedidos activos */}
          <div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: '8px' }}>
              Pedidos activos ({activeOrders.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {activeOrders.length === 0 && (
                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textAlign: 'center', padding: '12px' }}>
                  No hay pedidos activos
                </div>
              )}
              {activeOrders.map(order => {
                const driver = order.driver_id ? world.getDriver(order.driver_id) : null;
                const customer = world.getCustomer(order.customer_id);
                
                return (
                  <div
                    key={order.id}
                    style={{
                      background: 'var(--bg-raised)',
                      borderRadius: '8px',
                      padding: '10px',
                      border: '1px solid var(--border)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.8rem' }}>{order.id}</span>
                      <span style={{ 
                        fontSize: '0.65rem', 
                        padding: '2px 8px', 
                        borderRadius: '12px',
                        background: order.status === 'ready' ? 'var(--success-bg)' : 'var(--warn-bg)',
                        color: order.status === 'ready' ? 'var(--success)' : 'var(--warn)'
                      }}>
                        {getOrderStatusLabel(order.status)}
                      </span>
                    </div>
                    
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                      Cliente: {customer?.name || order.customer_name}
                    </div>
                    
                    {driver && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                        Conductor: {driver.name}
                      </div>
                    )}
                    
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', marginBottom: '8px' }}>
                      Items: {order.items.length} · Total: ${(order.total_cents / 100).toFixed(2)}
                    </div>
                    
                    <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                      {getOrderActions(order)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}