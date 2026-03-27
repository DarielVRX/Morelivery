// frontend/src/pages/Customer/Payments.jsx
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { readPendingOrder, clearPendingOrder, savePendingOrder } from '../../utils/pendingOrder';
import { useCart } from '../../hooks/useCart';
import { readSessionDelivery, saveSessionDelivery } from '../../utils/sessionDelivery';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import AddressSearchBar from '../../features/customer/AddressSearchBar.jsx';

// ── Icons ─────────────────────────────────────────────────────────────────────
function IconPin()     { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>; }
function IconPackage() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>; }
function IconWarning() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>; }
function IconCash()    { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>; }
function IconCard()    { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>; }
function IconMP()      { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/></svg>; }

const fmt = cents => `$${((cents ?? 0) / 100).toFixed(2)}`;

// ── Resultado de pago MP (después de redirigir de vuelta) ─────────────────────
function PaymentResult({ onRetry }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { auth } = useAuth();
  const { clearCart } = useCart();

  const status     = searchParams.get('status');
  const paymentId  = searchParams.get('payment_id');
  const [creating, setCreating] = useState(false);
  const [msg,      setMsg]      = useState('');

  // Si el pago fue aprobado, crear el pedido automáticamente
  useEffect(() => {
    if (status !== 'approved' || !paymentId) return;
    createOrder();
  }, []); // eslint-disable-line

  async function createOrder() {
    const draft = readPendingOrder();
    if (!draft) {
      setMsg('No se encontró el pedido pendiente. Contacta a soporte con tu ID de pago: ' + paymentId);
      return;
    }

    setCreating(true);
    try {
      // Resolver coords
      let lat = draft.delivery_lat ?? null;
      let lng = draft.delivery_lng ?? null;
      let addr = draft.delivery_address || '';
      if (!lat || !lng) {
        const sp = readSessionDelivery(auth.token);
        if (sp?.lat) { lat = sp.lat; lng = sp.lng; addr = addr || sp.label || ''; }
      }

      await apiFetch('/orders', { method: 'POST', body: JSON.stringify({
        restaurantId:   draft.restaurantId,
        items:          draft.items || [],
        payment_method: 'card',
        tip_cents:      draft.tip_cents || 0,
        mp_payment_id:  paymentId,
        ...(addr?.trim() ? { delivery_address: addr } : {}),
        ...(lat != null  ? { delivery_lat: lat }       : {}),
        ...(lng != null  ? { delivery_lng: lng }       : {}),
      })}, auth.token);

      clearPendingOrder();
      clearCart();
      navigate('/customer', { replace: true });
    } catch (e) {
      setMsg(`Pago exitoso pero error al crear el pedido: ${e.message}. Guarda tu ID de pago: ${paymentId} y contacta a soporte.`);
      setCreating(false);
    }
  }

  if (status === 'approved') {
    if (creating) return (
      <div style={{ padding:'2rem', textAlign:'center' }}>
        <div style={{ width:36, height:36, border:'3px solid var(--brand)',
          borderTopColor:'transparent', borderRadius:'50%',
          animation:'spin 0.8s linear infinite', margin:'0 auto 1rem' }} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <div style={{ fontWeight:700 }}>Pago aprobado. Creando tu pedido…</div>
        <div style={{ fontSize:'0.82rem', color:'var(--text-tertiary)', marginTop:'0.4rem' }}>No cierres esta pantalla</div>
      </div>
    );

    if (msg) return (
      <div style={{ padding:'1rem' }}>
        <div className="flash flash-error">{msg}</div>
        <button className="btn-primary" style={{ marginTop:'1rem', width:'100%' }}
          onClick={() => navigate('/customer')}>
          Ir a mis pedidos
        </button>
      </div>
    );
  }

  if (status === 'pending') return (
    <div style={{ padding:'2rem', textAlign:'center' }}>
      <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="var(--warn)"
        strokeWidth="2" strokeLinecap="round" style={{ margin:'0 auto 0.75rem', display:'block' }}>
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
      </svg>
      <div style={{ fontWeight:700, fontSize:'1.1rem', color:'var(--warn)' }}>Pago pendiente</div>
      <div style={{ fontSize:'0.85rem', color:'var(--text-tertiary)', marginTop:'0.4rem', marginBottom:'1.5rem' }}>
        Tu pago está siendo procesado. Te notificaremos cuando sea confirmado.
      </div>
      <button className="btn-primary" style={{ width:'100%' }} onClick={() => navigate('/customer')}>
        Ir a mis pedidos
      </button>
    </div>
  );

  // rejected o cualquier otro estado
  return (
    <div style={{ padding:'2rem', textAlign:'center' }}>
      <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="var(--danger)"
        strokeWidth="2" strokeLinecap="round" style={{ margin:'0 auto 0.75rem', display:'block' }}>
        <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
      </svg>
      <div style={{ fontWeight:700, fontSize:'1.1rem', color:'var(--danger)' }}>Pago rechazado</div>
      <div style={{ fontSize:'0.85rem', color:'var(--text-tertiary)', marginTop:'0.4rem', marginBottom:'1.5rem' }}>
        No se pudo procesar tu pago. Intenta con otro método o tarjeta.
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
        <button className="btn-primary" style={{ width:'100%' }} onClick={onRetry}>
          Intentar de nuevo
        </button>
        <button className="btn-sm" style={{ width:'100%' }} onClick={() => navigate('/customer')}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function CustomerPayments({ onOrderUpdate } = {}) {
  const { auth }  = useAuth();
  const navigate  = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { cart, clearCart } = useCart();

  const [draft,           setDraft]           = useState(null);
  const [sending,         setSending]         = useState(false);
  const [methods,         setMethods]         = useState([]);
  const [loading,         setLoading]         = useState(true);
  const [method,          setMethod]          = useState('cash');
  const [msg,             setMsg]             = useState('');
  const [msgType,         setMsgType]         = useState('ok');
  const [tipCents,        setTipCents]        = useState(0);
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryLat,     setDeliveryLat]     = useState(null);
  const [deliveryLng,     setDeliveryLng]     = useState(null);
  const [fromGps,         setFromGps]         = useState(false);
  const [gpsPos,          setGpsPos]          = useState(null);

  // Si MP redirigió de vuelta con status, mostrar resultado
  const mpStatus = searchParams.get('status');
  const [showResult, setShowResult] = useState(Boolean(mpStatus));

  function handleRetry() {
    setSearchParams({});
    setShowResult(false);
  }

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
        { id: 'cash', label: 'Efectivo al entregar',                    available: true },
        { id: 'card', label: 'Tarjeta / OXXO / Transferencia (MP)',     available: true },
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

  // ── Flujo efectivo ────────────────────────────────────────────────────────
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

  // ── Flujo MP — redirigir al checkout ─────────────────────────────────────
  async function handleMercadoPago() {
    if (!draft) { flash('No hay un pedido pendiente.', 'error'); return; }
    const { lat, lng } = resolveCoords();
    if (!lat || !lng) { flash('Selecciona una dirección de entrega antes de continuar.', 'error'); return; }
    if (grandTotal < 1000) { flash('El monto mínimo para pago digital es $10.00 MXN.', 'error'); return; }

    setSending(true);
    try {
      // Guardar draft con coords resueltas para recuperar al volver de MP
      const { addr } = resolveCoords();
      savePendingOrder({ ...draft, delivery_lat: lat, delivery_lng: lng, delivery_address: addr, tip_cents: tipCents });

      const res = await apiFetch('/payments/preference', {
        method: 'POST',
        body: JSON.stringify({
          amount_cents: grandTotal,
          description:  `Pedido Morelivery — ${draft.items?.length || 1} producto(s)`,
        }),
      }, auth.token);

      if (!res.initPoint) throw new Error('No se recibió URL de pago de Mercado Pago');

      // Redirigir al checkout de MP
      window.location.href = res.initPoint;
    } catch (e) {
      flash(e.message || 'Error al iniciar el pago con Mercado Pago.', 'error');
      setSending(false);
    }
  }

  if (loading) return (
    <div style={{ padding:'2rem', textAlign:'center', color:'var(--text-tertiary)' }}>Cargando…</div>
  );

  // Mostrar resultado de MP si regresó con status
  if (showResult) return (
    <div style={{ padding:'1rem', maxWidth:480, margin:'0 auto' }}>
      <PaymentResult onRetry={handleRetry} />
    </div>
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

      {/* Desglose */}
      {draft?.items_detail?.length > 0 && (
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

          {/* Propina — ambos métodos */}
          <p style={{ fontSize:'0.72rem', fontWeight:700, color:'var(--text-tertiary)',
            textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'0.4rem' }}>
            Agradecimiento al conductor
          </p>
          <div style={{ display:'flex', gap:'0.25rem', flexWrap:'wrap', marginBottom:'0.75rem' }}>
            {[{pct:0,label:'—'},{pct:5,label:'5%'},{pct:10,label:'10%'},{pct:20,label:'20%'}].map(({pct, label}) => {
              const v   = pct === 0 ? 0 : Math.round(subtotal * pct / 100);
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

      {/* Selector de método */}
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
              {m.id === 'cash' ? <IconCash /> : <IconMP />}
            </span>
            <div style={{ flex:1 }}>
              <span style={{ fontWeight:700, fontSize:'0.875rem' }}>{m.label}</span>
              {m.id === 'card' && m.available && (
                <div style={{ fontSize:'0.68rem', color:'var(--text-tertiary)', marginTop:2 }}>
                  Tarjeta, OXXO, transferencia SPEI y más
                </div>
              )}
              {m.coming_soon && <span style={{ fontSize:'0.7rem', color:'var(--text-tertiary)', marginLeft:6 }}>Próximamente</span>}
            </div>
          </label>
        ))}
      </div>

      {/* Info MP */}
      {method === 'card' && (
        <div style={{ background:'var(--bg-sunken)', border:'1px solid var(--border)',
          borderRadius:8, padding:'0.65rem 0.875rem', marginBottom:'1rem',
          fontSize:'0.78rem', color:'var(--text-secondary)' }}>
          Serás redirigido a <strong>Mercado Pago</strong> para completar tu pago de forma segura.
          Al finalizar regresarás automáticamente para confirmar tu pedido.
        </div>
      )}

      <button className="btn-primary"
        style={{ width:'100%', padding:'0.75rem', fontSize:'0.95rem' }}
        disabled={sending || !draft}
        onClick={method === 'cash' ? handleCash : handleMercadoPago}>
        {sending ? 'Procesando…'
          : !draft ? 'Sin pedido pendiente'
          : method === 'cash' ? 'Confirmar pedido — Efectivo'
          : `Pagar ${fmt(grandTotal)} con Mercado Pago`}
      </button>

      {!draft && (
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
