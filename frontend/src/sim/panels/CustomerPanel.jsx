// frontend/src/sim/panels/CustomerPanel.jsx
// Panel colapsable para un cliente.
// Permite crear pedidos y ver estado del pedido activo.

import React, { useState } from 'react';
import { useSimContext } from '../SimProvider.js';

// Íconos simples
function IconCustomer() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
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

// Items predefinidos para facilitar pruebas
const SUGGESTED_ITEMS = [
  { name: '🌮 Tacos (3 piezas)', priceCents: 1200, quantity: 1 },
  { name: '🍔 Hamburguesa', priceCents: 8500, quantity: 1 },
  { name: '🍕 Pizza mediana', priceCents: 18500, quantity: 1 },
  { name: '🥗 Ensalada César', priceCents: 7500, quantity: 1 },
  { name: '🥤 Refresco', priceCents: 2500, quantity: 1 },
  { name: '☕ Café', priceCents: 3500, quantity: 1 },
];

export default function CustomerPanel({ customerId, onClose }) {
  const {
    world,
    createOrder,
    updateOrderStatus,
    getAllRestaurants,
  } = useSimContext();

  const [expanded, setExpanded] = useState(true);
  const [selectedRestaurantId, setSelectedRestaurantId] = useState('');
  const [selectedItems, setSelectedItems] = useState([]);
  const [paymentMethod, setPaymentMethod] = useState('card');
  const [creating, setCreating] = useState(false);
  const [customItemName, setCustomItemName] = useState('');
  const [customItemPrice, setCustomItemPrice] = useState('');

  const customer = world.getCustomer(customerId);
  const restaurants = getAllRestaurants();
  
  // Obtener pedido activo de este cliente
  const activeOrder = customer?.activeOrderId ? world.getOrder(customer.activeOrderId) : null;

  if (!customer) {
    return (
      <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
        Cliente no encontrado
      </div>
    );
  }

  const handleAddSuggestedItem = (item) => {
    setSelectedItems(prev => {
      const existing = prev.find(i => i.name === item.name);
      if (existing) {
        return prev.map(i => 
          i.name === item.name 
            ? { ...i, quantity: i.quantity + 1 }
            : i
        );
      }
      return [...prev, { ...item, quantity: 1 }];
    });
  };

  const handleAddCustomItem = () => {
    if (!customItemName.trim()) return;
    const price = parseInt(customItemPrice, 10) || 5000;
    setSelectedItems(prev => [
      ...prev,
      { name: customItemName, priceCents: price, quantity: 1 }
    ]);
    setCustomItemName('');
    setCustomItemPrice('');
  };

  const handleUpdateQuantity = (itemName, delta) => {
    setSelectedItems(prev => {
      const newItems = prev
        .map(i => {
          if (i.name === itemName) {
            const newQty = i.quantity + delta;
            if (newQty <= 0) return null;
            return { ...i, quantity: newQty };
          }
          return i;
        })
        .filter(Boolean);
      return newItems;
    });
  };

  const handleRemoveItem = (itemName) => {
    setSelectedItems(prev => prev.filter(i => i.name !== itemName));
  };

  const handleCreateOrder = async () => {
    if (!selectedRestaurantId) {
      alert('Selecciona un restaurante');
      return;
    }
    if (selectedItems.length === 0) {
      alert('Agrega al menos un item');
      return;
    }

    setCreating(true);
    try {
      const orderId = await createOrder({
        restaurantId: selectedRestaurantId,
        customerId: customer.id,
        items: selectedItems,
        paymentMethod,
      });
      
      // Limpiar formulario
      setSelectedRestaurantId('');
      setSelectedItems([]);
      
      // Mostrar feedback
      console.log(`Pedido creado: ${orderId}`);
    } catch (error) {
      console.error('Error al crear pedido:', error);
      alert('Error al crear pedido');
    } finally {
      setCreating(false);
    }
  };

  const totalCents = selectedItems.reduce((sum, i) => sum + (i.priceCents * i.quantity), 0);

  // Renderizar estado del pedido activo en lenguaje natural
  const renderOrderStatus = () => {
    if (!activeOrder) return null;

    const statusMessages = {
      'created': '🆕 Pedido creado, buscando conductor...',
      'assigned': '🚗 Conductor asignado, en camino al restaurante',
      'accepted': '✅ Restaurante confirmó tu pedido',
      'preparing': '🍳 Tu pedido se está preparando',
      'ready': '📦 Pedido listo, el conductor lo recogerá',
      'on_the_way': '🚚 Tu pedido viene en camino',
      'delivered': '✅ ¡Pedido entregado!',
    };

    const message = statusMessages[activeOrder.status] || `Estado: ${activeOrder.status}`;
    
    const driver = activeOrder.driver_id ? world.getDriver(activeOrder.driver_id) : null;
    
    return (
      <div style={{
        background: 'var(--bg-raised)',
        borderRadius: '12px',
        padding: '12px',
        border: '1px solid var(--border)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <span style={{ fontSize: '1.2rem' }}>
            {activeOrder.status === 'delivered' ? '✅' : '🔄'}
          </span>
          <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>
            Pedido #{activeOrder.id}
          </span>
        </div>
        
        <div style={{ fontSize: '0.8rem', marginBottom: '8px' }}>
          {message}
        </div>
        
        {driver && (
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
            Conductor: {driver.name}
          </div>
        )}
        
        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
          Restaurante: {activeOrder.restaurant_name}
        </div>
        
        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
          Total: ${(activeOrder.total_cents / 100).toFixed(2)}
        </div>
        
        {activeOrder.status !== 'delivered' && activeOrder.status !== 'cancelled' && (
          <button
            onClick={() => updateOrderStatus(activeOrder.id, 'cancelled')}
            style={{
              marginTop: '8px',
              padding: '4px 8px',
              borderRadius: '6px',
              border: '1px solid var(--danger-border)',
              background: 'var(--danger-bg)',
              color: 'var(--danger)',
              fontSize: '0.7rem',
              cursor: 'pointer'
            }}
          >
            Cancelar pedido
          </button>
        )}
      </div>
    );
  };

  const selectedRestaurant = selectedRestaurantId 
    ? restaurants.find(r => r.id === selectedRestaurantId) 
    : null;

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
          <IconCustomer />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700 }}>{customer.name}</div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
            📍 {customer.lat.toFixed(5)}, {customer.lng.toFixed(5)}
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
          
          {/* Pedido activo */}
          {activeOrder && (
            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: '8px' }}>📦 Mi pedido</div>
              {renderOrderStatus()}
            </div>
          )}

          {/* Crear nuevo pedido (solo si no hay pedido activo) */}
          {!activeOrder && (
            <>
              <div>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: '8px' }}>🍽️ Nuevo pedido</div>
                
                {/* Seleccionar restaurante */}
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Restaurante</div>
                  <select
                    value={selectedRestaurantId}
                    onChange={(e) => setSelectedRestaurantId(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px',
                      borderRadius: '8px',
                      border: '1px solid var(--border)',
                      background: 'var(--bg-card)',
                      fontSize: '0.8rem'
                    }}
                  >
                    <option value="">Seleccionar restaurante...</option>
                    {restaurants.map(r => (
                      <option key={r.id} value={r.id}>
                        {r.name} {!r.is_open && '(Cerrado)'}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Items sugeridos */}
                {selectedRestaurant && (
                  <>
                    <div style={{ marginBottom: '12px' }}>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Items sugeridos</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {SUGGESTED_ITEMS.map(item => (
                          <button
                            key={item.name}
                            onClick={() => handleAddSuggestedItem(item)}
                            style={{
                              padding: '4px 10px',
                              borderRadius: '16px',
                              border: '1px solid var(--border)',
                              background: 'var(--bg-raised)',
                              fontSize: '0.7rem',
                              cursor: 'pointer'
                            }}
                          >
                            + {item.name}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Item personalizado */}
                    <div style={{ marginBottom: '12px' }}>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Agregar item personalizado</div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <input
                          type="text"
                          value={customItemName}
                          onChange={(e) => setCustomItemName(e.target.value)}
                          placeholder="Nombre"
                          style={{
                            flex: 2,
                            padding: '6px',
                            borderRadius: '6px',
                            border: '1px solid var(--border)',
                            fontSize: '0.7rem'
                          }}
                        />
                        <input
                          type="number"
                          value={customItemPrice}
                          onChange={(e) => setCustomItemPrice(e.target.value)}
                          placeholder="$ MXN"
                          style={{
                            width: '80px',
                            padding: '6px',
                            borderRadius: '6px',
                            border: '1px solid var(--border)',
                            fontSize: '0.7rem'
                          }}
                        />
                        <button
                          onClick={handleAddCustomItem}
                          style={{
                            padding: '6px 12px',
                            borderRadius: '6px',
                            border: 'none',
                            background: 'var(--brand)',
                            color: '#fff',
                            fontSize: '0.7rem',
                            cursor: 'pointer'
                          }}
                        >
                          +
                        </button>
                      </div>
                    </div>

                    {/* Lista de items seleccionados */}
                    {selectedItems.length > 0 && (
                      <div style={{ marginBottom: '12px' }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Tu pedido</div>
                        {selectedItems.map(item => (
                          <div key={item.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border-light)' }}>
                            <div style={{ fontSize: '0.75rem' }}>
                              {item.name}
                              <span style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', marginLeft: '4px' }}>
                                ${(item.priceCents / 100).toFixed(2)}
                              </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <button
                                onClick={() => handleUpdateQuantity(item.name, -1)}
                                style={{
                                  width: '24px',
                                  height: '24px',
                                  borderRadius: '4px',
                                  border: '1px solid var(--border)',
                                  background: 'var(--bg-raised)',
                                  cursor: 'pointer'
                                }}
                              >
                                -
                              </button>
                              <span style={{ fontSize: '0.75rem', minWidth: '20px', textAlign: 'center' }}>{item.quantity}</span>
                              <button
                                onClick={() => handleUpdateQuantity(item.name, 1)}
                                style={{
                                  width: '24px',
                                  height: '24px',
                                  borderRadius: '4px',
                                  border: '1px solid var(--border)',
                                  background: 'var(--bg-raised)',
                                  cursor: 'pointer'
                                }}
                              >
                                +
                              </button>
                              <button
                                onClick={() => handleRemoveItem(item.name)}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: 'var(--danger)',
                                  cursor: 'pointer',
                                  fontSize: '0.8rem'
                                }}
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                        ))}
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px', fontWeight: 600, fontSize: '0.8rem' }}>
                          <span>Total</span>
                          <span>${(totalCents / 100).toFixed(2)}</span>
                        </div>
                      </div>
                    )}

                    {/* Método de pago */}
                    <div style={{ marginBottom: '12px' }}>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Método de pago</div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        {['card', 'cash', 'spei'].map(method => (
                          <label key={method} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.7rem' }}>
                            <input
                              type="radio"
                              value={method}
                              checked={paymentMethod === method}
                              onChange={(e) => setPaymentMethod(e.target.value)}
                            />
                            {method === 'card' ? '💳 Tarjeta' : method === 'cash' ? '💵 Efectivo' : '🏦 SPEI'}
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Botón crear pedido */}
                    <button
                      onClick={handleCreateOrder}
                      disabled={creating || selectedItems.length === 0}
                      style={{
                        width: '100%',
                        padding: '10px',
                        borderRadius: '8px',
                        border: 'none',
                        background: (creating || selectedItems.length === 0) ? 'var(--border)' : 'var(--brand)',
                        color: (creating || selectedItems.length === 0) ? 'var(--text-secondary)' : '#fff',
                        fontSize: '0.85rem',
                        fontWeight: 600,
                        cursor: (creating || selectedItems.length === 0) ? 'not-allowed' : 'pointer'
                      }}
                    >
                      {creating ? 'Creando pedido...' : '🛒 Crear pedido'}
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}