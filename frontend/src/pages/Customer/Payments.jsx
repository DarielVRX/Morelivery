// frontend/src/pages/Customer/Payments.jsx
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { readPendingOrder, clearPendingOrder, savePendingOrder } from '../../utils/pendingOrder';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';

const STADIA_KEY  = import.meta.env?.VITE_STADIA_KEY || '';
const STYLE_LIGHT = STADIA_KEY
? `https://tiles.stadiamaps.com/styles/alidade_smooth.json?api_key=${STADIA_KEY}`
: 'https://tiles.openfreemap.org/styles/bright';
const STYLE_DARK  = STADIA_KEY
? `https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json?api_key=${STADIA_KEY}`
: 'https://tiles.openfreemap.org/styles/bright';

async function nominatimReverse(lat, lng) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&countrycodes=mx&accept-language=es`,
      { headers: { 'Accept-Language':'es', 'User-Agent':'Morelivery/1.0' } }
    );
    const data = await r.json();
    const a = data.address || {};
    const parts = [a.road, a.house_number, a.suburb || a.neighbourhood, a.city || 'Morelia'].filter(Boolean);
    return parts.join(', ') || data.display_name?.split(',').slice(0,3).join(',') || null;
  } catch (_) { return null; }
}

// ── AddressSearchBar — clon exacto de Home/RestaurantPage ────────────────────
function AddressSearchBar({ userPos, homeAddress, onSelectPos }) {
  const [open,      setOpen]      = useState(false);
  const [showMap,   setShowMap]   = useState(false);
  const [pinPlaced, setPinPlaced] = useState(false);
  const [inputVal,  setInputVal]  = useState('');
  const [results,   setResults]   = useState([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef(null);
  const wrapRef     = useRef(null);
  const mapContRef  = useRef(null);
  const mapRef      = useRef(null);
  const markerRef   = useRef(null);
  const pendingPos  = useRef(null);

  useEffect(() => {
    function handler(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target) && !showMap) {
        setOpen(false); setResults([]);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMap]);

  useEffect(() => {
    if (!showMap) return;
    let cancelled = false;
    async function init() {
      await new Promise(r => setTimeout(r, 30));
      if (cancelled || !mapContRef.current) return;
      const { ensureMapLibreCSS, ensureMapLibreJS } = await import('../../utils/mapLibre');
      ensureMapLibreCSS();
      const ml = await ensureMapLibreJS();
      if (cancelled || !mapContRef.current) return;
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const center = userPos ? [userPos.lng, userPos.lat] : [-101.195, 19.706];
      const map = new ml.Map({
        container: mapContRef.current,
        style: isDark ? STYLE_DARK : STYLE_LIGHT,
        center, zoom: 14, attributionControl: false,
      });
      map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
      map.once('load', () => {
        if (!STADIA_KEY && isDark && mapContRef.current)
          mapContRef.current.style.filter = 'invert(1) hue-rotate(180deg) saturate(0.85) brightness(0.9)';
        map.resize();
      });
      map.on('click', e => {
        if (cancelled) return;
        const pos = { lat: e.lngLat.lat, lng: e.lngLat.lng };
        pendingPos.current = pos;
        setPinPlaced(true);
        if (markerRef.current) {
          markerRef.current.setLngLat([pos.lng, pos.lat]);
        } else {
          const el = document.createElement('div');
          el.style.cssText = 'font-size:24px;line-height:1;filter:drop-shadow(0 2px 4px #0005)';
          el.textContent = '📍';
          markerRef.current = new ml.Marker({ element: el, anchor:'bottom' })
          .setLngLat([pos.lng, pos.lat]).addTo(map);
        }
      });
      mapRef.current = map;
    }
    init().catch(() => {});
    return () => {
      cancelled = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      markerRef.current = null; pendingPos.current = null; setPinPlaced(false);
    };
  }, [showMap]);

  async function confirmMapPin() {
    const pos = pendingPos.current;
    if (!pos) return;
    const label = (await nominatimReverse(pos.lat, pos.lng))
    || `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`;
    onSelectPos({ ...pos, label });
    setShowMap(false); setOpen(false); setResults([]); setInputVal('');
  }

  function doSearch(val) {
    clearTimeout(debounceRef.current);
    if (!val.trim()) { setResults([]); setSearching(false); return; }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(val + ', Morelia, Michoacán')}&format=json&addressdetails=1&limit=6&countrycodes=mx&accept-language=es&viewbox=-101.5,19.9,-100.9,19.5&bounded=1`;
        const r = await fetch(url, { headers: { 'Accept-Language':'es', 'User-Agent':'Morelivery/1.0' } });
        const data = await r.json();
        const items = (data || []).map(item => {
          const a = item.address || {};
          const parts = [a.road, a.house_number, a.suburb || a.neighbourhood, a.city || 'Morelia'].filter(Boolean);
          return { label: parts.join(', ') || item.display_name?.split(',').slice(0,3).join(',') || 'Sin nombre', lat: Number(item.lat), lng: Number(item.lon) };
        }).filter(i => i.lat && i.lng);
        setResults(items);
      } catch (_) { setResults([]); }
      finally { setSearching(false); }
    }, 400);
  }

  function selectGPS() {
    if (userPos) onSelectPos({ lat: userPos.lat, lng: userPos.lng, label: 'Ubicación actual' });
    setOpen(false); setResults([]); setInputVal('');
  }

  function selectHome() {
    if (homeAddress) onSelectPos({ label: homeAddress, preset: 'home' });
    setOpen(false); setResults([]); setInputVal('');
  }

  const hasHome = !!homeAddress;

  return (
    <div ref={wrapRef} style={{ position:'relative' }}>
    {!open && !showMap && (
      <button onClick={() => setOpen(true)} title="Cambiar dirección de entrega"
      style={{ display:'flex', alignItems:'center', gap:'0.4rem',
        background:'var(--brand-light)', border:'1px solid var(--brand)',
                           borderRadius:8, padding:'0.3rem 0.65rem', cursor:'pointer',
                           fontSize:'0.78rem', fontWeight:600, color:'var(--brand)', minHeight:'unset' }}>
                           <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                           <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
                           <circle cx="12" cy="9" r="2.5"/>
                           </svg>
                           Cambiar
                           </button>
    )}

    {open && !showMap && (
      <div style={{ display:'flex', alignItems:'center', gap:'4px',
        background:'var(--bg-sunken)', border:'1px solid var(--border)',
                          borderRadius:10, padding:'4px 6px', minWidth:240 }}>
                          <button onClick={selectGPS} title="Ubicación actual" disabled={!userPos}
                          style={{ background:'none', border:'none', cursor: userPos ? 'pointer' : 'default',
                            padding:'4px', borderRadius:6, display:'flex', alignItems:'center',
                            opacity: userPos ? 1 : 0.4, minHeight:'unset', flexShrink:0 }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="4.5"/>
                            <line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/>
                            <line x1="4.22" y1="4.22" x2="6.34" y2="6.34"/><line x1="17.66" y1="17.66" x2="19.78" y2="19.78"/>
                            <line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/>
                            <line x1="4.22" y1="19.78" x2="6.34" y2="17.66"/><line x1="17.66" y1="6.34" x2="19.78" y2="4.22"/>
                            </svg>
                            </button>
                            <input autoFocus value={inputVal}
                            onChange={e => { setInputVal(e.target.value); doSearch(e.target.value); }}
                            placeholder="Buscar dirección…"
                            style={{ flex:1, background:'none', border:'none', outline:'none',
                              color:'var(--text-primary)', fontSize:'13px', minWidth:0 }}
                              />
                              {searching && <span style={{ fontSize:'11px', color:'var(--text-tertiary)', flexShrink:0 }}>…</span>}
                              <button onClick={() => { setShowMap(true); setOpen(false); }} title="Elegir en mapa"
                              style={{ background:'var(--bg-raised)', border:'none', cursor:'pointer',
                                padding:'3px 5px', borderRadius:5, minHeight:'unset', flexShrink:0,
                                color:'var(--text-secondary)', fontSize:'0.8rem' }}>🗺</button>
                                {hasHome && (
                                  <button onClick={selectHome} title="Casa"
                                  style={{ background:'none', border:'none', cursor:'pointer', padding:'4px',
                                    borderRadius:6, display:'flex', alignItems:'center', minHeight:'unset', flexShrink:0 }}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H5a1 1 0 01-1-1V9.5z"/>
                                    <polyline points="9 21 9 12 15 12 15 21"/>
                                    </svg>
                                    </button>
                                )}
                                <button onClick={() => { setOpen(false); setResults([]); setInputVal(''); }}
                                style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-tertiary)',
                                  fontSize:'13px', padding:'2px 4px', minHeight:'unset', flexShrink:0 }}>✕</button>
                                  </div>
    )}

    {open && !showMap && (results.length > 0 || searching) && (
      <div style={{ position:'absolute', top:'calc(100% + 4px)', right:0, left:0,
        minWidth:260, background:'var(--bg-card)', border:'1px solid var(--border)',
                                                               borderRadius:10, boxShadow:'0 8px 24px rgba(0,0,0,0.18)', zIndex:100, overflow:'hidden' }}>
                                                               {searching && <div style={{ padding:'0.6rem 0.875rem', fontSize:'0.8rem', color:'var(--text-tertiary)' }}>Buscando…</div>}
                                                               {results.map((item, i) => (
                                                                 <button key={i} onClick={() => { onSelectPos(item); setOpen(false); setResults([]); setInputVal(''); }}
                                                                 style={{ width:'100%', textAlign:'left', background:'none', border:'none',
                                                                   borderBottom: i < results.length-1 ? '1px solid var(--border-light)' : 'none',
                                                                                          padding:'0.55rem 0.875rem', cursor:'pointer', fontSize:'0.82rem',
                                                                                          color:'var(--text-primary)', display:'block', minHeight:'unset' }}>
                                                                                          📍 {item.label}
                                                                                          </button>
                                                               ))}
                                                               </div>
    )}

    {showMap && (
      <div style={{ position:'fixed', inset:0, zIndex:1000, background:'rgba(0,0,0,0.5)',
        display:'flex', alignItems:'center', justifyContent:'center' }}
        onClick={e => { if (e.target === e.currentTarget) setShowMap(false); }}>
        <div className="addr-map-modal">
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'0.75rem 1rem', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
          <span style={{ fontWeight:700, fontSize:'0.95rem' }}>📍 Elige tu ubicación</span>
          <button onClick={() => setShowMap(false)}
          style={{ background:'none', border:'none', cursor:'pointer', fontSize:'1.1rem',
            color:'var(--text-tertiary)', minHeight:'unset', padding:'2px 6px' }}>✕</button>
            </div>
            <div ref={mapContRef} style={{ flex:1, width:'100%', minHeight:0 }} />
            <div style={{ display:'flex', gap:'0.5rem', padding:'0.75rem 1rem',
              borderTop:'1px solid var(--border)', background:'var(--bg-card)', flexShrink:0 }}>
              <span style={{ flex:1, fontSize:'0.78rem', color:'var(--text-tertiary)', alignSelf:'center' }}>
              {pinPlaced ? '📍 Pin colocado — confirma o muévelo' : 'Toca el mapa para colocar un pin'}
              </span>
              <button onClick={confirmMapPin} disabled={!pinPlaced}
              className="btn-primary btn-sm" style={{ opacity: pinPlaced ? 1 : 0.45 }}>
              Confirmar
              </button>
              <button onClick={() => setShowMap(false)} className="btn-sm">Cancelar</button>
              </div>
              </div>
              </div>
    )}

    <style>{`
      .addr-map-modal {
        background: var(--bg-card);
        display: flex; flex-direction: column;
        width: 100%; height: 100dvh;
      }
      @media (min-width: 520px) {
        .addr-map-modal {
          width: 500px; height: 70dvh; max-height: 600px;
          border-radius: 12px;
        }
      }
      `}</style>
      </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────
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

  // Card fields
  const [cardNum,  setCardNum]  = useState('');
  const [expiry,   setExpiry]   = useState('');
  const [cvv,      setCvv]      = useState('');
  const [name,     setName]     = useState('');

  // SPEI fields
  const [speiRef,  setSpeiRef]  = useState('');

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
    }
  }, []);

  useEffect(() => {
    apiFetch('/payments/methods', {}, auth.token)
    .then(d => {
      const list = (d.methods || []).map(m => ({ ...m, available: true, coming_soon: false }));
      setMethods(list);
    })
    .catch(() => setMethods([
      { id:'cash', label:'Efectivo al entregar',      available:true },
      { id:'card', label:'Tarjeta de crédito/débito', available:true },
      { id:'spei', label:'SPEI / Transferencia',      available:true },
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
    setFromGps(false); // el usuario confirmó explícitamente
    // Actualizar draft en sessionStorage
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
        tip_cents:        draft.tip_cents || 0,
        delivery_address: deliveryAddress,
        delivery_lat:     deliveryLat,
        delivery_lng:     deliveryLng,
        ...(method === 'card' ? { card_name: name, card_last4: cardNum.replace(/\s/g,'').slice(-4) } : {}),
        ...(method === 'spei' ? { spei_ref: speiRef } : {}),
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
        📦 Pedido pendiente
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
            <span style={{ flexShrink:0 }}>⚠️</span>
            <span>La dirección de entrega se detectó desde tu GPS. Confirma que es correcta o cámbiala.</span>
            </div>
        )}

        {/* Dirección actual + botón cambiar */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
          gap:'0.5rem', flexWrap:'wrap' }}>
          <div style={{ fontSize:'0.8rem', color: deliveryAddress ? 'var(--text-primary)' : 'var(--warn)',
            fontWeight: deliveryAddress ? 400 : 600, flex:1, minWidth:0 }}>
            {deliveryAddress
              ? <span>📍 {deliveryAddress}</span>
              : <span>⚠️ Sin dirección de entrega</span>
            }
            </div>
            <AddressSearchBar
            userPos={gpsPos}
            homeAddress={auth.user?.address || null}
            onSelectPos={handleAddressChange}
            />
            </div>
            </div>
    )}

    <h2 style={{ fontSize:'1.05rem', fontWeight:800, marginBottom:'0.25rem' }}>💳 Método de pago</h2>
    <p style={{ fontSize:'0.82rem', color:'var(--gray-500)', marginBottom:'1.25rem' }}>
    Elige cómo quieres pagar tus pedidos.
    </p>

    // Selector de método
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
      {m.id==='cash' ? '💵' : m.id==='card' ? '💳' : '🏦'}
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
            🔒 Procesador pendiente de integración. Los datos no se envían a ningún servidor.
            </div>
            </div>
    )}

    {/* ── Formulario SPEI ── */}
    {method === 'spei' && (
      <div style={{ background:'var(--bg-sunken)', border:'1px solid #bfdbfe',
        borderRadius:10, padding:'1rem', marginBottom:'1rem' }}>
        <div style={{ fontSize:'0.875rem', fontWeight:700, color:'var(--text-secondary)', marginBottom:'0.75rem' }}>
        🏦 Transferencia SPEI
        </div>
        <label style={{ display:'block', marginBottom:'0.6rem', fontSize:'0.82rem', fontWeight:600 }}>
        Referencia (opcional)
        <input type="text" value={speiRef} onChange={e => setSpeiRef(e.target.value)}
        placeholder="Número de referencia o concepto"
        style={{ display:'block', width:'100%', marginTop:4, boxSizing:'border-box' }} />
        </label>
        <div style={{ padding:'0.5rem 0.75rem', background:'#eff6ff',
          border:'1px solid #bfdbfe', borderRadius:8, fontSize:'0.78rem', color:'#1e40af' }}>
          ℹ️ Al confirmar recibirás la CLABE destino y el monto a transferir.
          Procesador pendiente de integración.
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
  : 'Confirmar pedido — SPEI'}
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
