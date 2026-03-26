/**
 * CustomerCart.jsx — Panel de carrito persistente del cliente
 * Se monta como ordersContent en la ruta /customer del SplitLayout.
 * Lee y escribe via useCart (localStorage 'morelivery_cart').
 * Al hacer "Ir a pagar" guarda en pendingOrder y navega a /customer/pagos.
 */

import { useNavigate } from 'react-router-dom';
import { useCart } from '../hooks/useCart';
import { useAuth } from '../contexts/AuthContext';
import { savePendingOrder } from '../utils/pendingOrder';
import { readSessionDelivery } from '../utils/sessionDelivery';

const fmt = cents => `$${((cents ?? 0) / 100).toFixed(2)}`;

function EmptyState() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100%', padding: '2rem 1.5rem',
      textAlign: 'center', color: 'var(--text-tertiary)',
    }}>
      <span style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🛒</span>
      <p style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
        Tu carrito está vacío
      </p>
      <p style={{ fontSize: '0.8rem', lineHeight: 1.5 }}>
        Agrega productos desde la página de una tienda.
      </p>
    </div>
  );
}

export default function CustomerCart() {
  const navigate = useNavigate();
  const { auth } = useAuth();
  const { cart, adjustItem, clearCart } = useCart();

  if (!cart || cart.items.length === 0) {
    return <EmptyState />;
  }

  const subtotal    = cart.total_cents;
  const serviceFee  = Math.round(subtotal * 0.05);
  const deliveryFee = Math.round(subtotal * 0.10);
  // Propina: se elige en Payments, aquí se muestra 0 como placeholder
  const tipCents    = 0;
  const total       = subtotal + serviceFee + deliveryFee + tipCents;

  function handleCheckout() {
    // Inyectar coordenadas guardadas en sesión si existen
    const savedPos = readSessionDelivery(auth.token);
    savePendingOrder({
      restaurantId:   cart.restaurantId,
      items:          cart.items.map(({ menuItemId, quantity }) => ({ menuItemId, quantity })),
      items_detail:   cart.items.map(({ menuItemId, quantity, name, price_cents }) => ({
        menuItemId, quantity, name, price_cents,
      })),
      subtotal_cents: subtotal,
      tip_cents:      0,
      ...(savedPos ? {
        delivery_lat:     savedPos.lat,
        delivery_lng:     savedPos.lng,
        delivery_address: savedPos.label,
      } : {}),
    });
    navigate('/customer/pagos');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{
        padding: '0.75rem 1rem 0.6rem',
        borderBottom: '1px solid var(--border-light)',
        flexShrink: 0,
      }}>
        <p style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-tertiary)',
          textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
          Tu carrito
        </p>
      </div>

      {/* Lista de items — scrollable */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem 0.75rem' }}>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {cart.items.map(item => (
            <li key={item.menuItemId} style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              padding: '0.5rem 0',
              borderBottom: '1px solid var(--border-light)',
            }}>
              {/* Nombre + precio unitario */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.875rem', fontWeight: 600,
                  color: 'var(--text-primary)', whiteSpace: 'nowrap',
                  overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {item.name}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
                  {fmt(item.price_cents)} c/u
                </div>
              </div>

              {/* Controles cantidad */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}>
                <button
                  onClick={() => adjustItem(item.menuItemId, -1)}
                  style={{
                    width: 26, height: 26, borderRadius: '50%', border: '1.5px solid var(--border)',
                    background: 'var(--bg-card)', cursor: 'pointer', fontSize: '1rem',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--text-primary)', minHeight: 'unset', padding: 0,
                    fontWeight: 700, lineHeight: 1,
                  }}>
                  −
                </button>
                <span style={{ minWidth: 20, textAlign: 'center', fontSize: '0.9rem',
                  fontWeight: 700, color: 'var(--text-primary)' }}>
                  {item.quantity}
                </span>
                <button
                  onClick={() => adjustItem(item.menuItemId, +1)}
                  style={{
                    width: 26, height: 26, borderRadius: '50%', border: '1.5px solid var(--brand)',
                    background: 'var(--brand)', cursor: 'pointer', fontSize: '1rem',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', minHeight: 'unset', padding: 0,
                    fontWeight: 700, lineHeight: 1,
                  }}>
                  +
                </button>
              </div>

              {/* Precio total del item */}
              <div style={{ minWidth: 52, textAlign: 'right', fontSize: '0.875rem',
                fontWeight: 700, color: 'var(--text-primary)', flexShrink: 0 }}>
                {fmt(item.price_cents * item.quantity)}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Desglose + botón — fixed al fondo del panel */}
      <div style={{
        padding: '0.75rem 1rem',
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-card)',
        flexShrink: 0,
      }}>
        {/* Desglose */}
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.6rem' }}>
          {[
            ['Subtotal',        subtotal],
            ['Servicio (5%)',   serviceFee],
            ['Envío (10%)',     deliveryFee],
          ].map(([label, val]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between',
              marginBottom: '0.2rem' }}>
              <span>{label}</span>
              <span>{fmt(val)}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between',
            fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: '0.2rem' }}>
            <span>Propina</span>
            <span style={{ fontSize: '0.75rem' }}>Se elige al pagar</span>
          </div>
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            fontWeight: 800, fontSize: '0.95rem', color: 'var(--text-primary)',
            borderTop: '1px solid var(--border)', paddingTop: '0.4rem', marginTop: '0.3rem',
          }}>
            <span>Total estimado</span>
            <span>{fmt(total)}</span>
          </div>
        </div>

        {/* Botón Ir a pagar */}
        <button
          className="btn-primary"
          style={{ width: '100%', padding: '0.65rem', fontSize: '0.9rem', fontWeight: 800 }}
          onClick={handleCheckout}>
          Ir a pagar · {fmt(total)}
        </button>

        {/* Vaciar carrito */}
        <button
          onClick={clearCart}
          style={{
            width: '100%', marginTop: '0.4rem', background: 'none', border: 'none',
            cursor: 'pointer', fontSize: '0.75rem', color: 'var(--text-tertiary)',
            padding: '0.2rem', minHeight: 'unset',
          }}>
          Vaciar carrito
        </button>
      </div>
    </div>
  );
}
