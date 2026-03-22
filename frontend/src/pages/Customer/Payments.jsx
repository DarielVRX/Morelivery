// frontend/src/pages/Customer/Payments.jsx
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { readPendingOrder, clearPendingOrder, savePendingOrder } from '../../utils/pendingOrder';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import AddressSearchBar from '../../features/customer/AddressSearchBar.jsx';

// ── Iconos SVG ────────────────────────────────────────────────────────────────
function IconPin()      { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>; }
function IconPackage()  { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>; }
function IconWarning()  { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>; }
function IconCash()     { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>; }
function IconCard()     { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>; }
function IconBank()     { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/></svg>; }
function IconLock()     { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>; }

function CardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
    style={{ width:20, height:20, verticalAlign:'middle' }}>
    <rect x="2" y="5" width="20" height="14" rx="2"/>
    <path d="M2 10h20"/>
    </svg>
  );
}

function formatCard(v)   { return v.replace(/\D/g,'').slice(0,16).replace(/(\d{4})(?=\d)/g,'$1 '); }
function formatExpiry(v) { return v.replace(/\D/g,'').slice(0,4).replace(/(\d{2})(\d)/,'$1/$2'); }

export default function CustomerPayments() {
  const { auth }  = useAuth();
  const navigate  = useNavigate();

  const [draft,    setDraft]    = useState(null);
  const [sending,  setSending]  = useState(false);
  const [methods,  setMethods]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [method,   setMethod]   = useState('cash');
  const [msg,      setMsg]      = useState('');
  const [msgType,  setMsgType]  = useState('ok');

  // Dirección de entrega — se puede cambiar aquí
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryLat,     setDeliveryLat]     = useState(null);
  const [deliveryLng,     setDeliveryLng]     = useState(null);
  const [fromGps,         setFromGps]         = useState(false);
  const [gpsPos,          setGpsPos]          = useState(null);

  const [tipCents, setTipCents] = useState(0);

  // Card fields
  const [cardNum,  setCardNum]  = useState('');
  const [expiry,   setExpiry]   = useState('');
  const [cvv,      setCvv]      = useState('');
  const [name,     setName]     = useState('');

  // GPS para el AddressSearchBar
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      pos => setGpsPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { timeout: 5000, maximumAge: 60000 }
    );
  }, []);

  // Leer draft de pedido pendiente
  useEffect(() => {
    const d = readPendingOrder();
    if (d) {
      setDraft(d);
      setDeliveryAddress(d.delivery_address || '');
      setDeliveryLat(d.delivery_lat ?? null);
      setDeliveryLng(d.delivery_lng ?? null);
      setFromGps(!!d.delivery_from_gps);
      setTipCents(d.tip_cents || 0);
    }
  }, []);

  useEffect(() => {
    apiFetch('/payments/methods', {}, auth.token)
    .then(d => {
      const list = (d.methods || [])
        .filter(m => m.id !== 'spei' && m.id !== 'bank')
        .map(m => ({ ...m, available: true, coming_soon: false }));
      setMethods(list);
    })
    .catch(() => setMethods([
      { id:'cash', label:'Efectivo al entregar',      available:true },
      { id:'card', label:'Tarjeta de crédito/débito', available:true },
    ]))
    .finally(() => setLoading(false));
  }, [auth.token]);

  function flash(text, type = 'ok') {
    setMsg(text); setMsgType(type === 'error' ? 'error' : 'ok');
    setTimeout(() => setMsg(''), 5000);
  }

  function handleAddressChange(pos) {
    const label = pos.label || '';
    const lat   = pos.lat   ?? null;
    const lng   = pos.lng   ?? null;
    setDeliveryAddress(label);
    setDeliveryLat(lat);
    setDeliveryLng(lng);
    setFromGps(false);
    savePendingOrder({
      ...draft,
      delivery_address:  label,
      delivery_lat:      lat,
      delivery_lng:      lng,
      delivery_from_gps: false,
    });
    setDraft(prev => prev ? { ...prev, delivery_address: label, delivery_lat: lat, delivery_lng: lng, delivery_from_gps: false } : prev);
  }

  async function handleSave() {
    if (!draft) {
      flash('No hay un pedido pendiente. Vuelve a la tienda y selecciona productos.', 'error');
      return;
    }
    setSending(true);
    try {
      const body = {
        restaurantId:     draft.restaurantId,
        items:            draft.items || [],
        payment_method:   method,
        tip_cents:        tipCents,
        delivery_address: deliveryAddress,
        delivery_lat:     deliveryLat,
        delivery_lng:     deliveryLng,
        ...(method === 'card' ? { card_name: name, card_last4: cardNum.replace(/\s/g,'').slice(-4) } : {}),
      };
      await apiFetch('/orders', { method: 'POST', body: JSON.stringify(body) }, auth.token);
      clearPendingOrder();
      flash('¡Pedido confirmado! Puedes seguirlo en Mis Pedidos.');
      setTimeout(() => navigate('/customer'), 1800);
    } catch (e) {
      flash(e.message || 'Error al crear el pedido.', 'error');
    } finally {
      setSending(false);
    }
  }

  if (loading) return (
    <div style={{ padding:'2rem', textAlign:'center', color:'var(--text-tertiary)' }}>Cargando…</div>
  );

  return (
    <div style={{ padding:'1rem', maxWidth:480, margin:'0 auto' }}>

    {/* ── Pedido pendiente + dirección de entrega ── */}
    {draft && (
      <div style={{ background:'var(--bg-sunken)', border:'1px solid var(--border)',
        borderRadius:10, padding:'0.75rem', marginBottom:'1.25rem',
        fontSize:'0.82rem', color:'var(--text-secondary)' }}>
        <div style={{ fontWeight:700, color:'var(--text-primary)', marginBottom:'0.4rem' }}>
        <span style={{display:'flex',alignItems:'center',gap:'0.4rem'}}><IconPackage /> Pedido pendiente</span>
        </div>
        {draft.items?.length > 0 && (
          <div style={{ marginBottom:'0.4rem' }}>
          {draft.items.length} producto{draft.items.length !== 1 ? 's' : ''}
          </div>
        )}

        {/* Alerta GPS */}
        {fromGps && (
          <div style={{ background:'#fffbeb', border:'1px solid #fde68a',
            borderRadius:8, padding:'0.5rem 0.65rem', marginBottom:'0.5rem',
            fontSize:'0.78rem', color:'#92400e', display:'flex', alignItems:'flex-start', gap:'0.4rem' }}>
            <span style={{ flexShrink:0, display:'flex' }}><IconWarning /></span>
            <span>La dirección de entrega se detectó desde tu GPS. Confirma que es correcta o cámbiala.</span>
            </div>
        )}

        {/* Dirección actual + botón cambiar */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
          gap:'0.5rem', flexWrap:'wrap' }}>
          <div style={{ fontSize:'0.8rem', color: deliveryAddress ? 'var(--text-primary)' : 'var(--warn)',
            fontWeight: deliveryAddress ? 400 : 600, flex:1, minWidth:0 }}>
            {deliveryAddress
              ? <span style={{display:'flex',alignItems:'center',gap:'0.3rem'}}><IconPin />{deliveryAddress}</span>
              : <span style={{display:'flex',alignItems:'center',gap:'0.3rem'}}><IconWarning />Sin dirección de entrega</span>
            }
            </div>
            <AddressSearchBar
              variant="default"
              userPos={gpsPos}
              homeAddress={auth.user?.address || null}
              onSelectPos={handleAddressChange}
            />
            </div>
            </div>
    )}

    {/* ── Resumen de productos ── */}
    {draft?.items_detail?.length > 0 && (() => {
      const subtotal    = draft.subtotal_cents || 0;
      const serviceFee  = Math.round(subtotal * 0.05);
      const deliveryFee = Math.round(subtotal * 0.10);
      const total       = subtotal + serviceFee + deliveryFee + tipCents;
      const fmt         = cents => `$${((cents ?? 0) / 100).toFixed(2)}`;
      return (
        <div style={{ background:'var(--bg-sunken)', border:'1px solid var(--border)',
          borderRadius:10, padding:'0.75rem', marginBottom:'1.25rem' }}>

          {/* Lista de productos */}
          <p style={{ fontSize:'0.72rem', fontWeight:700, color:'var(--text-tertiary)',
            textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'0.5rem' }}>
            Productos
          </p>
          <ul style={{ listStyle:'none', padding:0, margin:'0 0 0.75rem' }}>
            {draft.items_detail.map((it, i) => (
              <li key={i} style={{ display:'flex', justifyContent:'space-between',
                fontSize:'0.82rem', color:'var(--text-secondary)', marginBottom:'0.2rem' }}>
                <span>{it.quantity > 1 ? `${it.quantity}× ` : ''}{it.name}</span>
                <span style={{ flexShrink:0, marginLeft:'0.5rem' }}>{fmt(it.price_cents * it.quantity)}</span>
              </li>
            ))}
          </ul>

          {/* Selector de agradecimiento */}
          <p style={{ fontSize:'0.72rem', fontWeight:700, color:'var(--text-tertiary)',
            textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'0.4rem' }}>
            Agradecimiento al conductor
          </p>
          <div style={{ display:'flex', gap:'0.25rem', flexWrap:'wrap', marginBottom:'0.75rem' }}>
            {[{pct:0,label:'—'},{pct:5,label:'5%'},{pct:10,label:'10%'},{pct:20,label:'20%'}].map(({pct, label}) => {
              const v = pct === 0 ? 0 : Math.round(subtotal * pct / 100);
              const sel = tipCents === v;
              return (
                <button key={pct} onClick={() => {
                  setTipCents(v);
                  savePendingOrder({ ...draft, tip_cents: v });
                }}
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

          {/* Desglose */}
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
              <span>Total</span><span>{fmt(total)}</span>
            </div>
          </div>
        </div>
      );
    })()}

    <h2 style={{ fontSize:'1.05rem', fontWeight:800, marginBottom:'0.25rem', display:'flex', alignItems:'center', gap:'0.5rem' }}><IconCard /> Método de pago</h2>
    <p style={{ fontSize:'0.82rem', color:'var(--gray-500)', marginBottom:'1.25rem' }}>
    Elige cómo quieres pagar tus pedidos.
    </p>

    {/*Selector de método*/}
    <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem', marginBottom:'1.5rem' }}>
    {methods.map(m => (
      <label key={m.id} style={{
        display:'flex', alignItems:'center', gap:'0.75rem',
        padding:'0.75rem 1rem', borderRadius:10, cursor:'pointer',
        border:`2px solid ${method===m.id ? 'var(--brand)' : 'var(--gray-200)'}`,
                       background: method===m.id ? 'var(--brand-light)' : 'var(--bg-card)',
      }}>
      <input type="radio" name="method" value={m.id}
      checked={method===m.id}
      onChange={() => setMethod(m.id)}
      style={{ accentColor:'var(--brand)', flexShrink:0, width:16, height:16 }} />
      <span style={{ fontSize:'1.1rem', flexShrink:0 }}>
      {m.id==='cash' ? <IconCash /> : m.id==='card' ? <IconCard /> : <IconBank />}
      </span>
      <span style={{ fontWeight:700, fontSize:'0.875rem', whiteSpace:'nowrap' }}>{m.label}</span>
      </label>
    ))}
    </div>

    {/* ── Formulario tarjeta ── */}
    {method === 'card' && (
      <div style={{ background:'var(--bg-sunken)', border:'1px solid var(--gray-200)',
        borderRadius:10, padding:'1rem', marginBottom:'1rem' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'0.4rem', marginBottom:'0.875rem',
          fontSize:'0.875rem', fontWeight:700, color:'var(--text-secondary)' }}>
          <CardIcon /> Datos de tarjeta
          </div>
          <label style={{ display:'block', marginBottom:'0.6rem', fontSize:'0.82rem', fontWeight:600 }}>
          Nombre en la tarjeta
          <input type="text" value={name} onChange={e => setName(e.target.value)}
          placeholder="Como aparece en la tarjeta"
          style={{ display:'block', width:'100%', marginTop:4, boxSizing:'border-box' }} />
          </label>
          <label style={{ display:'block', marginBottom:'0.6rem', fontSize:'0.82rem', fontWeight:600 }}>
          Número de tarjeta
          <input type="text" inputMode="numeric" value={cardNum}
          onChange={e => setCardNum(formatCard(e.target.value))}
          placeholder="1234 5678 9012 3456" maxLength={19}
          style={{ display:'block', width:'100%', marginTop:4, fontFamily:'monospace', boxSizing:'border-box' }} />
          </label>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.6rem', marginBottom:'0.75rem' }}>
          <label style={{ fontSize:'0.82rem', fontWeight:600 }}>
          Vencimiento
          <input type="text" inputMode="numeric" value={expiry}
          onChange={e => setExpiry(formatExpiry(e.target.value))}
          placeholder="MM/AA" maxLength={5}
          style={{ display:'block', width:'100%', marginTop:4, boxSizing:'border-box' }} />
          </label>
          <label style={{ fontSize:'0.82rem', fontWeight:600 }}>
          CVV
          <input type="text" inputMode="numeric" value={cvv}
          onChange={e => setCvv(e.target.value.replace(/\D/g,'').slice(0,4))}
          placeholder="123" maxLength={4}
          style={{ display:'block', width:'100%', marginTop:4, boxSizing:'border-box' }} />
          </label>
          </div>
          <div style={{ padding:'0.5rem 0.75rem', background:'#fffbeb',
            border:'1px solid #fde68a', borderRadius:8, fontSize:'0.78rem', color:'#92400e' }}>
            <span style={{display:'inline-flex',alignItems:'center',gap:'0.35rem'}}><IconLock />Procesador pendiente de integración. Los datos no se envían a ningún servidor.</span>
            </div>
            </div>
    )}

    <button className="btn-primary"
    style={{ width:'100%', padding:'0.75rem', fontSize:'0.95rem' }}
    disabled={sending || !draft}
    onClick={handleSave}>
    {sending ? 'Procesando…'
      : !draft ? 'Sin pedido pendiente'
      : method === 'cash' ? 'Confirmar pedido — Efectivo'
      : method === 'card' ? 'Confirmar pedido — Tarjeta'
      : 'Confirmar pedido'}
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
