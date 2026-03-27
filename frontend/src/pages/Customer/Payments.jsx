// frontend/src/pages/Customer/Payments.jsx
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { readPendingOrder, clearPendingOrder, savePendingOrder } from '../../utils/pendingOrder';
import { useCart } from '../../hooks/useCart';
import { readSessionDelivery, saveSessionDelivery } from '../../utils/sessionDelivery';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import AddressSearchBar from '../../features/customer/AddressSearchBar.jsx';

// Inicializar Stripe una sola vez fuera del componente
const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '');

// ── Iconos SVG ────────────────────────────────────────────────────────────────
function IconPin()     { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>; }
function IconPackage() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>; }
function IconWarning() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>; }
function IconCash()    { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>; }
function IconCard()    { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>; }
function IconLock()    { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>; }

// ── Formulario Stripe (debe estar dentro de <Elements>) ───────────────────────
function StripeCardForm({ onSuccess, onError, sending, setSending, orderPayload, token, clearCart }) {
  const stripe   = useStripe();
  const elements = useElements();
  const navigate = useNavigate();

  async function handleStripeSubmit(e) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSending(true);
    try {
      // 1. Crear el pedido en el backend
      const order = await apiFetch('/orders', {
        method: 'POST',
        body: JSON.stringify({ ...orderPayload, payment_method: 'card' }),
      }, token);

      const orderId = order?.id || order?.order?.id;
      if (!orderId) throw new Error('No se pudo crear el pedido.');

      // 2. Crear el PaymentIntent en Stripe vía nuestro backend
      const intentData = await apiFetch('/payments/intent', {
        method: 'POST',
        body: JSON.stringify({
          orderId,
          amount_cents: orderPayload.total_cents,
          method: 'card',
        }),
      }, token);

      if (!intentData?.clientSecret) throw new Error('No se recibió client_secret de Stripe.');

      // 3. Confirmar el pago con Stripe.js (el usuario interactúa con el PaymentElement)
      const { error: stripeError } = await stripe.confirmPayment({
        elements,
        clientSecret: intentData.clientSecret,
        confirmParams: {
          return_url: `${window.location.origin}/customer/orders`,
        },
        redirect: 'if_required',
      });

      if (stripeError) {
        throw new Error(stripeError.message || 'El pago fue rechazado.');
      }

      // 4. Éxito
      clearPendingOrder();
      clearCart();
      onSuccess('¡Pedido confirmado y pago procesado! Puedes seguirlo en Mis Pedidos.');
      setTimeout(() => navigate('/customer'), 1800);

    } catch (err) {
      onError(err.message || 'Error al procesar el pago.');
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={handleStripeSubmit}>
      <div style={{
        background: 'var(--bg-sunken)', border: '1px solid var(--gray-200)',
        borderRadius: 10, padding: '1rem', marginBottom: '1rem',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.4rem',
          marginBottom: '0.875rem', fontSize: '0.875rem',
          fontWeight: 700, color: 'var(--text-secondary)',
        }}>
          <IconLock /> Pago seguro con Stripe
        </div>

        {/* PaymentElement de Stripe — maneja la UI de la tarjeta */}
        <PaymentElement options={{ layout: 'tabs' }} />

        <div style={{
          marginTop: '0.75rem', padding: '0.5rem 0.75rem',
          background: '#f0fdf4', border: '1px solid #bbf7d0',
          borderRadius: 8, fontSize: '0.78rem', color: '#166534',
          display: 'flex', alignItems: 'center', gap: '0.35rem',
        }}>
          <IconLock /> Tus datos de pago son procesados directamente por Stripe y nunca pasan por nuestros servidores.
        </div>
      </div>

      <button
        type="submit"
        className="btn-primary"
        style={{ width: '100%', padding: '0.75rem', fontSize: '0.95rem' }}
        disabled={sending || !stripe || !elements}
      >
        {sending ? 'Procesando…' : 'Confirmar pedido — Tarjeta'}
      </button>
    </form>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function CustomerPayments({ onOrderUpdate } = {}) {
  const { auth }  = useAuth();
  const navigate  = useNavigate();
  const { cart, clearCart } = useCart();

  const [draft,    setDraft]    = useState(null);
  const [sending,  setSending]  = useState(false);
  const [methods,  setMethods]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [method,   setMethod]   = useState('cash');
  const [msg,      setMsg]      = useState('');
  const [msgType,  setMsgType]  = useState('ok');
  const [clientSecret, setClientSecret] = useState(null);

  // Dirección de entrega
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryLat,     setDeliveryLat]     = useState(null);
  const [deliveryLng,     setDeliveryLng]     = useState(null);
  const [fromGps,         setFromGps]         = useState(false);
  const [gpsPos,          setGpsPos]          = useState(null);
  const [tipCents,        setTipCents]        = useState(0);

  const initialPos = deliveryLat
    ? { lat: deliveryLat, lng: deliveryLng }
    : (auth.user?.home_lat ? { lat: Number(auth.user.home_lat), lng: Number(auth.user.home_lng) } : null);

  // SSE bus
  useEffect(() => {
    if (typeof onOrderUpdate !== 'function') return;
    const refresh = () => { const d = readPendingOrder(); if (d) setDraft(d); };
    onOrderUpdate(refresh);
    return () => onOrderUpdate(null);
  }, [onOrderUpdate]);

  // GPS
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      pos => setGpsPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { timeout: 5000, maximumAge: 60000 },
    );
  }, []);

  // Leer draft
  useEffect(() => {
    let d = readPendingOrder();
    if (!d && cart && cart.items.length > 0) {
      d = {
        restaurantId:   cart.restaurantId,
        items:          cart.items.map(({ menuItemId, quantity }) => ({ menuItemId, quantity })),
        items_detail:   cart.items.map(({ menuItemId, quantity, name, price_cents }) => ({ menuItemId, quantity, name, price_cents })),
        subtotal_cents: cart.total_cents,
        tip_cents:      0,
      };
    }
    if (d) {
      setDraft(d);
      const addr = d.delivery_address || '';
      const lat  = d.delivery_lat ?? null;
      const lng  = d.delivery_lng ?? null;
      if (!lat || !lng) {
        const sessionPos = readSessionDelivery(auth.token);
        if (sessionPos) {
          setDeliveryAddress(sessionPos.label || '');
          setDeliveryLat(sessionPos.lat);
          setDeliveryLng(sessionPos.lng);
        } else {
          setDeliveryAddress(addr); setDeliveryLat(lat); setDeliveryLng(lng);
        }
      } else {
        setDeliveryAddress(addr); setDeliveryLat(lat); setDeliveryLng(lng);
      }
      setFromGps(!!d.delivery_from_gps);
      setTipCents(d.tip_cents || 0);
    }
  }, [auth.token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Métodos disponibles
  useEffect(() => {
    apiFetch('/payments/methods', {}, auth.token)
      .then(d => {
        const list = (d.methods || [])
          .filter(m => m.id !== 'spei' && m.id !== 'bank')
          .map(m => ({ ...m, available: true, coming_soon: false }));
        setMethods(list);
      })
      .catch(() => setMethods([
        { id: 'cash', label: 'Efectivo al entregar',      available: true },
        { id: 'card', label: 'Tarjeta de crédito/débito', available: true },
      ]))
      .finally(() => setLoading(false));
  }, [auth.token]);

  function flash(text, type = 'ok') {
    setMsg(text); setMsgType(type === 'error' ? 'error' : 'ok');
    setTimeout(() => setMsg(''), 5000);
  }

  function handleAddressChange(pos) {
    const label = pos.label || '';
    const lat   = pos.lat != null ? Number(pos.lat) : null;
    const lng   = pos.lng != null ? Number(pos.lng) : null;
    const valid = Number.isFinite(lat) && Number.isFinite(lng);
    setDeliveryAddress(label);
    if (valid) {
      setDeliveryLat(lat); setDeliveryLng(lng);
      saveSessionDelivery({ lat, lng, label }, auth.token);
      savePendingOrder({ ...draft, delivery_address: label, delivery_lat: lat, delivery_lng: lng, delivery_from_gps: false });
      setDraft(prev => prev ? { ...prev, delivery_address: label, delivery_lat: lat, delivery_lng: lng, delivery_from_gps: false } : prev);
    } else {
      setFromGps(false);
    }
  }

  // Resolver coordenadas finales
  function resolveCoords() {
    let lat = deliveryLat != null ? Number(deliveryLat) : null;
    let lng = deliveryLng != null ? Number(deliveryLng) : null;
    let addr = deliveryAddress;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) { lat = null; lng = null; }
    if (!lat || !lng) {
      const po = readPendingOrder();
      if (po?.delivery_lat && po?.delivery_lng) { lat = po.delivery_lat; lng = po.delivery_lng; addr = addr || po.delivery_address || ''; }
    }
    if (!lat || !lng) {
      const sp = readSessionDelivery(auth.token);
      if (sp?.lat && sp?.lng) { lat = sp.lat; lng = sp.lng; addr = addr || sp.label || ''; }
    }
    return { lat, lng, addr };
  }

  // ── Flujo efectivo ────────────────────────────────────────────────────────
  async function handleCashSave() {
    if (!draft) { flash('No hay un pedido pendiente. Vuelve a la tienda y selecciona productos.', 'error'); return; }
    setSending(true);
    try {
      const { lat, lng, addr } = resolveCoords();
      const body = {
        restaurantId:   draft.restaurantId,
        items:          draft.items || [],
        payment_method: 'cash',
        tip_cents:      tipCents,
        ...(addr?.trim() ? { delivery_address: addr } : {}),
        ...(lat  != null ? { delivery_lat: lat }      : {}),
        ...(lng  != null ? { delivery_lng: lng }      : {}),
      };
      await apiFetch('/orders', { method: 'POST', body: JSON.stringify(body) }, auth.token);
      clearPendingOrder(); clearCart();
      flash('¡Pedido confirmado! Puedes seguirlo en Mis Pedidos.');
      setTimeout(() => navigate('/customer'), 1800);
    } catch (e) {
      flash(e.message || 'Error al crear el pedido.', 'error');
    } finally {
      setSending(false);
    }
  }

  // ── Construir payload para Stripe (se pasa al subcomponente) ──────────────
  const { lat: finalLat, lng: finalLng, addr: finalAddr } = resolveCoords();
  const subtotal    = draft?.subtotal_cents || 0;
  const serviceFee  = Math.round(subtotal * 0.05);
  const deliveryFee = Math.round(subtotal * 0.10);
  const totalCents  = subtotal + serviceFee + deliveryFee + tipCents;

  const orderPayload = draft ? {
    restaurantId:   draft.restaurantId,
    items:          draft.items || [],
    tip_cents:      tipCents,
    total_cents:    totalCents,
    ...(finalAddr?.trim() ? { delivery_address: finalAddr } : {}),
    ...(finalLat  != null ? { delivery_lat: finalLat }      : {}),
    ...(finalLng  != null ? { delivery_lng: finalLng }      : {}),
  } : null;

  const fmt = cents => `$${((cents ?? 0) / 100).toFixed(2)}`;

  if (loading) return (
    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-tertiary)' }}>Cargando…</div>
  );

  return (
    <div style={{ padding: '1rem', maxWidth: 480, margin: '0 auto' }}>

      {/* ── Pedido pendiente + dirección ── */}
      {draft && (
        <div style={{
          background: 'var(--bg-sunken)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '0.75rem', marginBottom: '1.25rem',
          fontSize: '0.82rem', color: 'var(--text-secondary)',
        }}>
          <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.4rem' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><IconPackage /> Pedido pendiente</span>
          </div>
          {draft.items?.length > 0 && (
            <div style={{ marginBottom: '0.4rem' }}>
              {draft.items.length} producto{draft.items.length !== 1 ? 's' : ''}
            </div>
          )}
          {fromGps && (
            <div style={{
              background: '#fffbeb', border: '1px solid #fde68a',
              borderRadius: 8, padding: '0.5rem 0.65rem', marginBottom: '0.5rem',
              fontSize: '0.78rem', color: '#92400e', display: 'flex', alignItems: 'flex-start', gap: '0.4rem',
            }}>
              <span style={{ flexShrink: 0, display: 'flex' }}><IconWarning /></span>
              <span>La dirección de entrega se detectó desde tu GPS. Confirma que es correcta o cámbiala.</span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
            <div style={{
              fontSize: '0.8rem',
              color: deliveryAddress ? 'var(--text-primary)' : 'var(--warn)',
              fontWeight: deliveryAddress ? 400 : 600, flex: 1, minWidth: 0,
            }}>
              {deliveryAddress
                ? <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}><IconPin />{deliveryAddress}</span>
                : <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}><IconWarning />Sin dirección de entrega</span>
              }
            </div>
            <AddressSearchBar
              variant="default"
              userPos={gpsPos}
              homeAddress={auth.user?.address || null}
              homePos={auth.user?.home_lat ? { lat: Number(auth.user.home_lat), lng: Number(auth.user.home_lng) } : null}
              initialPos={initialPos}
              onSelectPos={handleAddressChange}
            />
          </div>
        </div>
      )}

      {/* ── Resumen de productos ── */}
      {draft?.items_detail?.length > 0 && (
        <div style={{
          background: 'var(--bg-sunken)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '0.75rem', marginBottom: '1.25rem',
        }}>
          <p style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
            Productos
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 0.75rem' }}>
            {draft.items_detail.map((it, i) => (
              <li key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                <span>{it.quantity > 1 ? `${it.quantity}× ` : ''}{it.name}</span>
                <span style={{ flexShrink: 0, marginLeft: '0.5rem' }}>{fmt(it.price_cents * it.quantity)}</span>
              </li>
            ))}
          </ul>

          {/* Selector propina */}
          <p style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>
            Agradecimiento al conductor
          </p>
          <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            {[{ pct: 0, label: '—' }, { pct: 5, label: '5%' }, { pct: 10, label: '10%' }, { pct: 20, label: '20%' }].map(({ pct, label }) => {
              const v = pct === 0 ? 0 : Math.round(subtotal * pct / 100);
              const sel = tipCents === v;
              return (
                <button key={pct} onClick={() => { setTipCents(v); savePendingOrder({ ...draft, tip_cents: v }); }}
                  style={{
                    padding: '0.25rem 0.55rem', cursor: 'pointer', fontSize: '0.78rem',
                    border: `1.5px solid ${sel ? 'var(--success)' : 'var(--border)'}`,
                    borderRadius: 6,
                    background: sel ? 'var(--success-bg)' : 'var(--bg-card)',
                    color: sel ? 'var(--success)' : 'var(--text-secondary)',
                    fontWeight: sel ? 700 : 400, minHeight: 'unset',
                  }}>
                  {label}{pct > 0 && subtotal > 0 ? ` (${fmt(v)})` : ''}
                </button>
              );
            })}
          </div>

          {/* Desglose */}
          <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', borderTop: '1px solid var(--border-light)', paddingTop: '0.6rem' }}>
            {[['Subtotal', subtotal], ['Servicio (5%)', serviceFee], ['Envío (10%)', deliveryFee]].map(([label, val]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.15rem' }}>
                <span>{label}</span><span>{fmt(val)}</span>
              </div>
            ))}
            {tipCents > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--success)', marginBottom: '0.15rem' }}>
                <span>Agradecimiento</span><span>+{fmt(tipCents)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: '0.95rem', color: 'var(--text-primary)', marginTop: '0.4rem', paddingTop: '0.4rem', borderTop: '1px solid var(--border)' }}>
              <span>Total</span><span>{fmt(totalCents)}</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Selector de método ── */}
      <h2 style={{ fontSize: '1.05rem', fontWeight: 800, marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <IconCard /> Método de pago
      </h2>
      <p style={{ fontSize: '0.82rem', color: 'var(--gray-500)', marginBottom: '1.25rem' }}>
        Elige cómo quieres pagar tus pedidos.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem' }}>
        {methods.map(m => (
          <label key={m.id} style={{
            display: 'flex', alignItems: 'center', gap: '0.75rem',
            padding: '0.75rem 1rem', borderRadius: 10, cursor: 'pointer',
            border: `2px solid ${method === m.id ? 'var(--brand)' : 'var(--gray-200)'}`,
            background: method === m.id ? 'var(--brand-light)' : 'var(--bg-card)',
          }}>
            <input type="radio" name="method" value={m.id}
              checked={method === m.id}
              onChange={() => setMethod(m.id)}
              style={{ accentColor: 'var(--brand)', flexShrink: 0, width: 16, height: 16 }}
            />
            <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>
              {m.id === 'cash' ? <IconCash /> : <IconCard />}
            </span>
            <span style={{ fontWeight: 700, fontSize: '0.875rem', whiteSpace: 'nowrap' }}>{m.label}</span>
          </label>
        ))}
      </div>

      {/* ── Efectivo ── */}
      {method === 'cash' && (
        <button
          className="btn-primary"
          style={{ width: '100%', padding: '0.75rem', fontSize: '0.95rem' }}
          disabled={sending || !draft}
          onClick={handleCashSave}
        >
          {sending ? 'Procesando…' : !draft ? 'Sin pedido pendiente' : 'Confirmar pedido — Efectivo'}
        </button>
      )}

      {/* ── Tarjeta con Stripe Elements ── */}
      {method === 'card' && draft && stripePromise && (
        <Elements stripe={stripePromise} options={{ mode: 'payment', amount: totalCents, currency: 'mxn' }}>
          <StripeCardForm
            onSuccess={text => flash(text, 'ok')}
            onError={text => flash(text, 'error')}
            sending={sending}
            setSending={setSending}
            orderPayload={orderPayload}
            token={auth.token}
            clearCart={clearCart}
          />
        </Elements>
      )}

      {method === 'card' && !draft && (
        <button className="btn-primary" style={{ width: '100%', padding: '0.75rem', fontSize: '0.95rem' }} disabled>
          Sin pedido pendiente
        </button>
      )}

      {!draft && (
        <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginTop: '0.5rem', textAlign: 'center' }}>
          Selecciona productos en una tienda antes de pagar.
        </p>
      )}

      {msg && (
        <div className={`flash ${msgType === 'error' ? 'flash-error' : 'flash-ok'}`} style={{ marginTop: '0.75rem' }}>
          {msg}
        </div>
      )}
    </div>
  );
}
