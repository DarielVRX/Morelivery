// frontend/src/pages/Customer/Payments.jsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { readPendingOrder, clearPendingOrder, savePendingOrder } from '../../utils/pendingOrder';
import { useCart } from '../../hooks/useCart';
import { readSessionDelivery, saveSessionDelivery } from '../../utils/sessionDelivery';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import AddressSearchBar from '../../features/customer/AddressSearchBar.jsx';

// ── Stripe singleton — cargado a nivel de módulo ──────────────────────────────
const stripePromise = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)
  : Promise.resolve(null);

// ── Icons ─────────────────────────────────────────────────────────────────────
function IconPin()     { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>; }
function IconPackage() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>; }
function IconWarning() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>; }
function IconCash()    { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>; }
function IconCard()    { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>; }
function IconLock()    { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>; }

// ── CheckoutForm — dentro del contexto Elements ───────────────────────────────
function CheckoutForm({ grandTotal, onSuccess, onError }) {
  const stripe   = useStripe();
  const elements = useElements();
  const [ready,  setReady]  = useState(false);
  const [paying, setPaying] = useState(false);
  const fmt = cents => `$${((cents ?? 0) / 100).toFixed(2)}`;

  async function handlePay() {
    if (!stripe || !elements) return;
    setPaying(true);
    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: window.location.href },
        redirect: 'if_required',
      });
      if (error) onError(error.message || 'Pago rechazado');
      else if (paymentIntent?.status === 'succeeded') onSuccess(paymentIntent);
      else onError('Estado de pago inesperado. Contacta a soporte.');
    } catch (e) {
      onError(e.message || 'Error inesperado al procesar el pago');
    } finally { setPaying(false); }
  }

  return (
    <div>
      {/* Overlay bloqueante mientras Stripe procesa */}
      {paying && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:9999,
          display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div style={{ background:'var(--bg-card)', borderRadius:16, padding:'2rem 2.5rem',
            textAlign:'center', maxWidth:280, width:'90%' }}>
            <div style={{ width:40, height:40, border:'3px solid var(--brand)',
              borderTopColor:'transparent', borderRadius:'50%',
              animation:'spin 0.8s linear infinite', margin:'0 auto 1rem' }} />
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            <div style={{ fontWeight:700, fontSize:'1rem', marginBottom:'0.25rem' }}>Procesando pago…</div>
            <div style={{ fontSize:'0.82rem', color:'var(--text-tertiary)' }}>No cierres esta pantalla</div>
          </div>
        </div>
      )}

      <PaymentElement
        onReady={() => setReady(true)}
        options={{ layout: 'tabs', fields: { billingDetails: { address: 'never' } } }}
      />

      {!ready && (
        <div style={{ padding:'1rem', textAlign:'center', color:'var(--text-tertiary)', fontSize:'0.82rem' }}>
          Cargando formulario de pago…
        </div>
      )}

      <div style={{ display:'flex', alignItems:'center', gap:'0.35rem', fontSize:'0.72rem',
        color:'var(--text-tertiary)', margin:'0.75rem 0', justifyContent:'center' }}>
        <IconLock /> Pago procesado de forma segura por Stripe
      </div>

      <button className="btn-primary"
        style={{ width:'100%', padding:'0.75rem', fontSize:'0.95rem' }}
        disabled={!ready || paying || !stripe}
        onClick={handlePay}>
        {paying ? 'Procesando…' : `Pagar ${fmt(grandTotal)}`}
      </button>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function CustomerPayments({ onOrderUpdate } = {}) {
  const { auth }  = useAuth();
  const navigate  = useNavigate();
  const { cart, clearCart } = useCart();

  const [draft,           setDraft]           = useState(null);
  const [sending,         setSending]         = useState(false);
  const [methods,         setMethods]         = useState([]);
  const [loading,         setLoading]         = useState(true);
  const [method,          setMethod]          = useState('cash');
  const [msg,             setMsg]             = useState('');
  const [msgType,         setMsgType]         = useState('ok');
  const [tipCents,        setTipCents]        = useState(0);
  const [clientSecret,    setClientSecret]    = useState(null);
  const [stripeStep,      setStripeStep]      = useState('idle'); // idle | creating | paying | done
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryLat,     setDeliveryLat]     = useState(null);
  const [deliveryLng,     setDeliveryLng]     = useState(null);
  const [fromGps,         setFromGps]         = useState(false);
  const [gpsPos,          setGpsPos]          = useState(null);

  const initialPos = deliveryLat
    ? { lat: deliveryLat, lng: deliveryLng }
    : (auth.user?.home_lat ? { lat: Number(auth.user.home_lat), lng: Number(auth.user.home_lng) } : null);

  useEffect(() => {
    if (typeof onOrderUpdate !== 'function') return;
    const refresh = () => { const d = readPendingOrder(); if (d) setDraft(d); };
    onOrderUpdate(refresh);
    return () => onOrderUpdate(null);
  }, [onOrderUpdate]);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      pos => setGpsPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {}, { timeout: 5000, maximumAge: 60000 }
    );
  }, []);

  useEffect(() => {
    let d = readPendingOrder();
    if (!d && cart?.items?.length > 0) {
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
      const lat = d.delivery_lat ?? null;
      const lng = d.delivery_lng ?? null;
      if (!lat || !lng) {
        const sp = readSessionDelivery(auth.token);
        if (sp) { setDeliveryAddress(sp.label || ''); setDeliveryLat(sp.lat); setDeliveryLng(sp.lng); }
        else { setDeliveryAddress(d.delivery_address || ''); setDeliveryLat(lat); setDeliveryLng(lng); }
      } else {
        setDeliveryAddress(d.delivery_address || ''); setDeliveryLat(lat); setDeliveryLng(lng);
      }
      setFromGps(!!d.delivery_from_gps);
      setTipCents(d.tip_cents || 0);
    }
  }, [auth.token]); // eslint-disable-line

  useEffect(() => {
    apiFetch('/payments/methods', {}, auth.token)
      .then(d => setMethods((d.methods || []).filter(m => m.id !== 'spei' && m.id !== 'bank')))
      .catch(() => setMethods([
        { id: 'cash', label: 'Efectivo al entregar',      available: true },
        { id: 'card', label: 'Tarjeta de crédito/débito', available: !!import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY },
      ]))
      .finally(() => setLoading(false));
  }, [auth.token]);

  function flash(text, type = 'ok') {
    setMsg(text); setMsgType(type);
    if (type !== 'error') setTimeout(() => setMsg(''), 5000);
  }

  function handleAddressChange(pos) {
    const label = pos.label || '';
    const lat   = pos.lat != null ? Number(pos.lat) : null;
    const lng   = pos.lng != null ? Number(pos.lng) : null;
    setDeliveryAddress(label);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      setDeliveryLat(lat); setDeliveryLng(lng);
      saveSessionDelivery({ lat, lng, label }, auth.token);
      savePendingOrder({ ...draft, delivery_address: label, delivery_lat: lat, delivery_lng: lng, delivery_from_gps: false });
      setDraft(prev => prev ? { ...prev, delivery_address: label, delivery_lat: lat, delivery_lng: lng } : prev);
    } else { setFromGps(false); }
  }

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

  const subtotal    = draft?.subtotal_cents || 0;
  const serviceFee  = Math.round(subtotal * 0.05);
  const deliveryFee = Math.round(subtotal * 0.10);
  const grandTotal  = subtotal + serviceFee + deliveryFee + tipCents;
  const fmt         = cents => `$${((cents ?? 0) / 100).toFixed(2)}`;

  async function handleCash() {
    if (!draft) { flash('No hay un pedido pendiente.', 'error'); return; }
    const { lat, lng, addr } = resolveCoords();
    setSending(true);
    try {
      await apiFetch('/orders', { method: 'POST', body: JSON.stringify({
        restaurantId: draft.restaurantId, items: draft.items || [],
        payment_method: 'cash', tip_cents: tipCents,
        ...(addr?.trim() ? { delivery_address: addr } : {}),
        ...(lat != null  ? { delivery_lat: lat }       : {}),
        ...(lng != null  ? { delivery_lng: lng }       : {}),
      })}, auth.token);
      clearPendingOrder(); clearCart();
      flash('¡Pedido confirmado! Puedes seguirlo en Mis Pedidos.');
      setTimeout(() => navigate('/customer'), 1800);
    } catch (e) { flash(e.message || 'Error al crear el pedido.', 'error'); }
    finally { setSending(false); }
  }

  async function handleCardStart() {
    if (!draft) { flash('No hay un pedido pendiente.', 'error'); return; }
    if (!import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY) { flash('Pago con tarjeta no disponible.', 'error'); return; }
    const { lat, lng } = resolveCoords();
    if (!lat || !lng) { flash('Selecciona una dirección de entrega antes de continuar.', 'error'); return; }
    if (grandTotal < 1000) { flash('El monto mínimo para pago con tarjeta es $10.00 MXN.', 'error'); return; }

    setStripeStep('creating'); setSending(true);
    try {
      const intentRes = await apiFetch('/payments/intent', {
        method: 'POST',
        body: JSON.stringify({ amount_cents: grandTotal, method: 'card' }),
      }, auth.token);
      if (!intentRes.clientSecret) throw new Error('No se recibió clientSecret de Stripe');
      setClientSecret(intentRes.clientSecret);
      setStripeStep('paying');
    } catch (e) {
      flash(e.message || 'Error al iniciar el pago.', 'error');
      setStripeStep('idle');
    } finally { setSending(false); }
  }

  async function handlePaymentSuccess(paymentIntent) {
    setStripeStep('creating');
    const { lat, lng, addr } = resolveCoords();
    try {
      await apiFetch('/orders', { method: 'POST', body: JSON.stringify({
        restaurantId:             draft.restaurantId,
        items:                    draft.items || [],
        payment_method:           'card',
        tip_cents:                tipCents,
        stripe_payment_intent_id: paymentIntent.id,
        ...(addr?.trim() ? { delivery_address: addr } : {}),
        ...(lat != null  ? { delivery_lat: lat }       : {}),
        ...(lng != null  ? { delivery_lng: lng }       : {}),
      })}, auth.token);
      clearPendingOrder(); clearCart();
      setStripeStep('done');
      setTimeout(() => navigate('/customer'), 2000);
    } catch (e) {
      flash(
        `Pago exitoso pero error al crear el pedido: ${e.message}. ` +
        `Referencia de pago: ${paymentIntent.id}. Contacta a soporte.`,
        'error'
      );
      setStripeStep('idle');
    }
  }

  function handlePaymentError(errorMsg) {
    flash(errorMsg, 'error');
    setStripeStep('idle');
    setClientSecret(null);
  }

  if (loading) return (
    <div style={{ padding:'2rem', textAlign:'center', color:'var(--text-tertiary)' }}>Cargando…</div>
  );

  return (
    <div style={{ padding:'1rem', maxWidth:480, margin:'0 auto' }}>

      {/* Resumen + dirección */}
      {draft && (
        <div style={{ background:'var(--bg-sunken)', border:'1px solid var(--border)',
          borderRadius:10, padding:'0.75rem', marginBottom:'1.25rem',
          fontSize:'0.82rem', color:'var(--text-secondary)' }}>
          <div style={{ fontWeight:700, color:'var(--text-primary)', marginBottom:'0.4rem',
            display:'flex', alignItems:'center', gap:'0.4rem' }}>
            <IconPackage /> Pedido pendiente
          </div>
          {draft.items?.length > 0 && (
            <div style={{ marginBottom:'0.4rem' }}>
              {draft.items.length} producto{draft.items.length !== 1 ? 's' : ''}
            </div>
          )}
          {fromGps && (
            <div style={{ background:'var(--warn-bg)', border:'1px solid var(--warn-border)',
              borderRadius:8, padding:'0.5rem 0.65rem', marginBottom:'0.5rem',
              fontSize:'0.78rem', color:'var(--warn)', display:'flex', alignItems:'flex-start', gap:'0.4rem' }}>
              <span style={{ flexShrink:0, display:'flex' }}><IconWarning /></span>
              <span>Dirección detectada por GPS. Confirma que es correcta.</span>
            </div>
          )}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'0.5rem', flexWrap:'wrap' }}>
            <div style={{ fontSize:'0.8rem', color: deliveryAddress ? 'var(--text-primary)' : 'var(--warn)',
              fontWeight: deliveryAddress ? 400 : 600, flex:1, minWidth:0 }}>
              {deliveryAddress
                ? <span style={{ display:'flex', alignItems:'center', gap:'0.3rem' }}><IconPin />{deliveryAddress}</span>
                : <span style={{ display:'flex', alignItems:'center', gap:'0.3rem' }}><IconWarning />Sin dirección de entrega</span>
              }
            </div>
            <AddressSearchBar variant="default" userPos={gpsPos}
              homeAddress={auth.user?.address || null}
              homePos={auth.user?.home_lat ? { lat: Number(auth.user.home_lat), lng: Number(auth.user.home_lng) } : null}
              initialPos={initialPos} onSelectPos={handleAddressChange} />
          </div>
        </div>
      )}

      {/* Desglose — solo en idle */}
      {draft?.items_detail?.length > 0 && stripeStep === 'idle' && (
        <div style={{ background:'var(--bg-sunken)', border:'1px solid var(--border)',
          borderRadius:10, padding:'0.75rem', marginBottom:'1.25rem' }}>
          <p style={{ fontSize:'0.72rem', fontWeight:700, color:'var(--text-tertiary)',
            textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'0.5rem' }}>Productos</p>
          <ul style={{ listStyle:'none', padding:0, margin:'0 0 0.75rem' }}>
            {draft.items_detail.map((it, i) => (
              <li key={i} style={{ display:'flex', justifyContent:'space-between',
                fontSize:'0.82rem', color:'var(--text-secondary)', marginBottom:'0.2rem' }}>
                <span>{it.quantity > 1 ? `${it.quantity}× ` : ''}{it.name}</span>
                <span style={{ flexShrink:0, marginLeft:'0.5rem' }}>{fmt(it.price_cents * it.quantity)}</span>
              </li>
            ))}
          </ul>

          {/* Propina — disponible para ambos métodos */}
          <p style={{ fontSize:'0.72rem', fontWeight:700, color:'var(--text-tertiary)',
            textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'0.4rem' }}>
            Agradecimiento al conductor
          </p>
          <div style={{ display:'flex', gap:'0.25rem', flexWrap:'wrap', marginBottom:'0.75rem' }}>
            {[{pct:0,label:'—'},{pct:5,label:'5%'},{pct:10,label:'10%'},{pct:20,label:'20%'}].map(({pct, label}) => {
              const v = pct === 0 ? 0 : Math.round(subtotal * pct / 100);
              const sel = tipCents === v;
              return (
                <button key={pct} onClick={() => { setTipCents(v); savePendingOrder({ ...draft, tip_cents: v }); }}
                  style={{ padding:'0.25rem 0.55rem', cursor:'pointer', fontSize:'0.78rem',
                    border:`1.5px solid ${sel ? 'var(--success)' : 'var(--border)'}`,
                    borderRadius:6, background: sel ? 'var(--success-bg)' : 'var(--bg-card)',
                    color: sel ? 'var(--success)' : 'var(--text-secondary)',
                    fontWeight: sel ? 700 : 400, minHeight:'unset' }}>
                  {label}{pct > 0 && subtotal > 0 ? ` (${fmt(v)})` : ''}
                </button>
              );
            })}
          </div>

          <div style={{ fontSize:'0.82rem', color:'var(--text-secondary)',
            borderTop:'1px solid var(--border-light)', paddingTop:'0.6rem' }}>
            {[['Subtotal', subtotal],['Servicio (5%)', serviceFee],['Envío (10%)', deliveryFee]].map(([label, val]) => (
              <div key={label} style={{ display:'flex', justifyContent:'space-between', marginBottom:'0.15rem' }}>
                <span>{label}</span><span>{fmt(val)}</span>
              </div>
            ))}
            {tipCents > 0 && (
              <div style={{ display:'flex', justifyContent:'space-between', color:'var(--success)', marginBottom:'0.15rem' }}>
                <span>Agradecimiento</span><span>+{fmt(tipCents)}</span>
              </div>
            )}
            <div style={{ display:'flex', justifyContent:'space-between', fontWeight:800,
              fontSize:'0.95rem', color:'var(--text-primary)', marginTop:'0.4rem',
              paddingTop:'0.4rem', borderTop:'1px solid var(--border)' }}>
              <span>Total</span><span>{fmt(grandTotal)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Selector de método + botón */}
      {stripeStep === 'idle' && (
        <>
          <h2 style={{ fontSize:'1.05rem', fontWeight:800, marginBottom:'0.25rem',
            display:'flex', alignItems:'center', gap:'0.5rem' }}>
            <IconCard /> Método de pago
          </h2>
          <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem', marginBottom:'1.5rem' }}>
            {methods.map(m => (
              <label key={m.id} style={{ display:'flex', alignItems:'center', gap:'0.75rem',
                padding:'0.75rem 1rem', borderRadius:10,
                cursor: m.available ? 'pointer' : 'not-allowed',
                border:`2px solid ${method===m.id ? 'var(--brand)' : 'var(--border)'}`,
                background: method===m.id ? 'var(--brand-light)' : 'var(--bg-card)',
                opacity: m.available ? 1 : 0.5 }}>
                <input type="radio" name="method" value={m.id}
                  checked={method===m.id} disabled={!m.available}
                  onChange={() => m.available && setMethod(m.id)}
                  style={{ accentColor:'var(--brand)', flexShrink:0, width:16, height:16 }} />
                <span style={{ fontSize:'1.1rem', flexShrink:0 }}>
                  {m.id === 'cash' ? <IconCash /> : <IconCard />}
                </span>
                <div>
                  <span style={{ fontWeight:700, fontSize:'0.875rem' }}>{m.label}</span>
                  {m.coming_soon && <span style={{ fontSize:'0.7rem', color:'var(--text-tertiary)', marginLeft:6 }}>Próximamente</span>}
                </div>
              </label>
            ))}
          </div>
          <button className="btn-primary"
            style={{ width:'100%', padding:'0.75rem', fontSize:'0.95rem' }}
            disabled={sending || !draft}
            onClick={method === 'cash' ? handleCash : handleCardStart}>
            {sending ? 'Procesando…'
              : !draft ? 'Sin pedido pendiente'
              : method === 'cash' ? 'Confirmar pedido — Efectivo'
              : 'Continuar con tarjeta'}
          </button>
        </>
      )}

      {/* Spinner — creando intent o pedido */}
      {stripeStep === 'creating' && (
        <div style={{ padding:'2rem', textAlign:'center', color:'var(--text-tertiary)' }}>
          <div style={{ width:36, height:36, border:'3px solid var(--brand)',
            borderTopColor:'transparent', borderRadius:'50%',
            animation:'spin 0.8s linear infinite', margin:'0 auto 1rem' }} />
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          Preparando pago…
        </div>
      )}

      {/* Stripe Elements — envuelto en Elements provider */}
      {stripeStep === 'paying' && clientSecret && (
        <div>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'1rem' }}>
            <h2 style={{ fontSize:'1.05rem', fontWeight:800, display:'flex', alignItems:'center', gap:'0.5rem' }}>
              <IconLock /> Pago seguro
            </h2>
            <button onClick={() => { setStripeStep('idle'); setClientSecret(null); }}
              style={{ background:'none', border:'none', cursor:'pointer', fontSize:'0.8rem',
                color:'var(--text-tertiary)', minHeight:'unset' }}>
              ← Volver
            </button>
          </div>
          <div style={{ background:'var(--bg-sunken)', border:'1px solid var(--border)',
            borderRadius:10, padding:'0.75rem', marginBottom:'1rem', fontSize:'0.82rem' }}>
            Total a cobrar: <strong>{fmt(grandTotal)}</strong>
            {tipCents > 0 && <span style={{ color:'var(--success)', marginLeft:6 }}>(incl. {fmt(tipCents)} de agradecimiento)</span>}
          </div>
          <Elements stripe={stripePromise} options={{ clientSecret, locale: 'es' }}>
            <CheckoutForm
              grandTotal={grandTotal}
              onSuccess={handlePaymentSuccess}
              onError={handlePaymentError}
            />
          </Elements>
        </div>
      )}

      {/* Éxito */}
      {stripeStep === 'done' && (
        <div style={{ padding:'2rem', textAlign:'center' }}>
          <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="var(--success)"
            strokeWidth="2" strokeLinecap="round" style={{ margin:'0 auto 0.75rem', display:'block' }}>
            <circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/>
          </svg>
          <div style={{ fontWeight:700, fontSize:'1.1rem', color:'var(--success)' }}>¡Pago exitoso!</div>
          <div style={{ fontSize:'0.85rem', color:'var(--text-tertiary)', marginTop:'0.4rem' }}>Redirigiendo…</div>
        </div>
      )}

      {!draft && stripeStep === 'idle' && (
        <p style={{ fontSize:'0.8rem', color:'var(--text-tertiary)', marginTop:'0.5rem', textAlign:'center' }}>
          Selecciona productos en una tienda antes de pagar.
        </p>
      )}

      {msg && (
        <div className={`flash ${msgType === 'error' ? 'flash-error' : 'flash-ok'}`}
          style={{ marginTop:'0.75rem' }}>
          {msg}
        </div>
      )}
    </div>
  );
}
