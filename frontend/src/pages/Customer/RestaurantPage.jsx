import { useEffect, useRef, useState } from 'react';
import { readPendingOrder, savePendingOrder, schedulePendingOrderExpiry, cancelPendingOrderExpiry } from '../../utils/pendingOrder';
import { useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
// ── Iconos SVG ────────────────────────────────────────────────────────────────
function IconPin()      { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{display:'block'}}><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>; }
function IconMap()      { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{display:'block'}}><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>; }
function IconSearch()   { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{display:'block'}}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>; }
function IconWarning()  { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{display:'block'}}><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>; }
function IconStore()    { return <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{display:'block'}}><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H5a1 1 0 01-1-1V9.5z"/><path d="M9 21V12h6v9"/></svg>; }
function IconStoreXL()  { return <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" style={{display:'block'}}><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H5a1 1 0 01-1-1V9.5z"/><path d="M9 21V12h6v9"/></svg>; }



// ── MapLibre tile styles — same as DriverMap ─────────────────────────────────
const STADIA_KEY  = import.meta.env?.VITE_STADIA_KEY || '';
const STYLE_LIGHT = STADIA_KEY
  ? `https://tiles.stadiamaps.com/styles/alidade_smooth.json?api_key=${STADIA_KEY}`
  : 'https://tiles.openfreemap.org/styles/bright';
const STYLE_DARK  = STADIA_KEY
  ? `https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json?api_key=${STADIA_KEY}`
  : 'https://tiles.openfreemap.org/styles/bright';

// ── Helpers ───────────────────────────────────────────────────────────────────
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371, toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2-lat1), dLng = toRad(lng2-lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function fmt(cents) { return `$${((cents ?? 0) / 100).toFixed(2)}`; }

// ── Nominatim geocoding ───────────────────────────────────────────────────────

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

// ── Product image ─────────────────────────────────────────────────────────────
function ProductImage({ src, name }) {
  const [err, setErr] = useState(false);
  if (!src || err) return (
    <div className="product-img-placeholder">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="9"/>
        <path d="M7 14c0-2.8 2.2-5 5-5s5 2.2 5 5"/>
        <path d="M9 9h.01M15 9h.01"/>
      </svg>
    </div>
  );
  return <img src={src} alt={name} onError={() => setErr(true)} className="product-img" />;
}

// ── Star picker ───────────────────────────────────────────────────────────────
function StarPicker({ value, onChange, label }) {
  return (
    <div style={{ marginBottom:'0.5rem' }}>
      <div style={{ fontSize:'0.78rem', color:'var(--text-secondary)', marginBottom:'0.25rem' }}>{label}</div>
      <div style={{ display:'flex', gap:'4px' }}>
        {[1,2,3,4,5].map(s => (
          <button key={s} onClick={() => onChange(s)}
            style={{ fontSize:'1.4rem', background:'none', border:'none', cursor:'pointer',
              color: s <= value ? '#f59e0b' : 'var(--border)', padding:0, minHeight:'unset', lineHeight:1 }}>
            ★
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Address search bar — clone exacto de Home ────────────────────────────────
function AddressSearchBar({ userPos, homeAddress, onSelectPos }) {
  const [open,       setOpen]       = useState(false);
  const [showMap,    setShowMap]    = useState(false);
  const [pinPlaced,  setPinPlaced]  = useState(false);
  const [inputVal,   setInputVal]   = useState('');
  const [results,    setResults]    = useState([]);
  const [searching,  setSearching]  = useState(false);
  const debounceRef  = useRef(null);
  const wrapRef      = useRef(null);
  const mapContRef   = useRef(null);
  const mapRef       = useRef(null);
  const markerRef    = useRef(null);
  const pendingPos   = useRef(null);

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
        <button onClick={() => setOpen(true)} title="Ubicación de entrega"
          style={{ background:'rgba(255,255,255,0.15)', border:'1px solid rgba(255,255,255,0.3)',
            borderRadius:8, width:32, height:32, display:'flex', alignItems:'center',
            justifyContent:'center', cursor:'pointer', flexShrink:0, minHeight:'unset', padding:0 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
            <circle cx="12" cy="9" r="2.5"/>
          </svg>
        </button>
      )}

      {open && !showMap && (
        <div style={{ display:'flex', alignItems:'center', gap:'4px',
          background:'rgba(255,255,255,0.15)', border:'1px solid rgba(255,255,255,0.35)',
          borderRadius:10, padding:'4px 6px', minWidth:240 }}>
          <button onClick={selectGPS} title="Ubicación actual" disabled={!userPos}
            style={{ background:'none', border:'none', cursor: userPos ? 'pointer' : 'default',
              padding:'4px', borderRadius:6, display:'flex', alignItems:'center',
              opacity: userPos ? 1 : 0.4, minHeight:'unset', flexShrink:0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
            style={{ flex:1, background:'none', border:'none', outline:'none', color:'#fff', fontSize:'13px', minWidth:0 }}
          />
          {searching && <span style={{ fontSize:'11px', color:'rgba(255,255,255,0.6)', flexShrink:0 }}>…</span>}
          <button onClick={() => { setShowMap(true); setOpen(false); }} title="Elegir en mapa"
            style={{ background:'rgba(255,255,255,0.2)', border:'none', cursor:'pointer',
              padding:'3px 5px', borderRadius:5, minHeight:'unset', flexShrink:0,
              color:'rgba(255,255,255,0.9)' }}><IconMap /></button>
          {hasHome && (
            <button onClick={selectHome} title="Casa"
              style={{ background:'none', border:'none', cursor:'pointer', padding:'4px',
                borderRadius:6, display:'flex', alignItems:'center', minHeight:'unset', flexShrink:0 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H5a1 1 0 01-1-1V9.5z"/>
                <polyline points="9 21 9 12 15 12 15 21"/>
              </svg>
            </button>
          )}
          <button onClick={() => { setOpen(false); setResults([]); setInputVal(''); }}
            style={{ background:'none', border:'none', cursor:'pointer', color:'rgba(255,255,255,0.7)',
              fontSize:'13px', padding:'2px 4px', minHeight:'unset', flexShrink:0 }}>✕</button>
        </div>
      )}

      {open && !showMap && (results.length > 0 || searching) && (
        <div style={{ position:'absolute', top:'calc(100% + 4px)', right:0, left: hasHome ? 'auto' : 0,
          minWidth:260, background:'var(--bg-card)', border:'1px solid var(--border)',
          borderRadius:10, boxShadow:'0 8px 24px rgba(0,0,0,0.18)', zIndex:100, overflow:'hidden' }}>
          {searching && <div style={{ padding:'0.6rem 0.875rem', fontSize:'0.8rem', color:'var(--text-tertiary)' }}>Buscando…</div>}
          {results.map((item, i) => (
            <button key={i} onClick={() => { onSelectPos(item); setOpen(false); setResults([]); setInputVal(''); }}
              style={{ width:'100%', textAlign:'left', background:'none', border:'none',
                borderBottom: i < results.length-1 ? '1px solid var(--border-light)' : 'none',
                padding:'0.55rem 0.875rem', cursor:'pointer', fontSize:'0.82rem',
                color:'var(--text-primary)', display:'block', minHeight:'unset' }}>
              <span style={{display:'inline-flex',alignItems:'center',gap:'0.35rem'}}><IconPin />{item.label}</span>
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
              <span style={{ fontWeight:700, fontSize:'0.95rem', display:'flex', alignItems:'center', gap:'0.4rem' }}><IconPin />Elige tu ubicación</span>
              <button onClick={() => setShowMap(false)}
                style={{ background:'none', border:'none', cursor:'pointer', fontSize:'1.1rem',
                  color:'var(--text-tertiary)', minHeight:'unset', padding:'2px 6px' }}>✕</button>
            </div>
            <div ref={mapContRef} style={{ flex:1, width:'100%', minHeight:0 }} />
            <div style={{ display:'flex', gap:'0.5rem', padding:'0.75rem 1rem',
              borderTop:'1px solid var(--border)', background:'var(--bg-card)', flexShrink:0 }}>
              <span style={{ flex:1, fontSize:'0.78rem', color:'var(--text-tertiary)', alignSelf:'center' }}>
                {pinPlaced ? <span style={{display:'inline-flex',alignItems:'center',gap:'0.3rem'}}><IconPin />Pin colocado — confirma o muévelo</span> : 'Toca el mapa para colocar un pin'}
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


// ── Main component ────────────────────────────────────────────────────────────
export default function RestaurantPage() {
  const { id }   = useParams();
  const { auth } = useAuth();
  const navigate = useNavigate();

  const [restaurant,    setRestaurant]    = useState(null);
  const [menu,          setMenu]          = useState([]);
  const [selectedItems, setSelectedItems] = useState({});
  const [loading,       setLoading]       = useState(true);
  const [msg,           setMsg]           = useState('');
  const [ordering,      setOrdering]      = useState(false);
  const [tipCents,      setTipCents]      = useState(0);
  const [sortBy,        setSortBy]        = useState('default');
  const [searchPos,     setSearchPos]     = useState(null);
  const [gpsPos,        setGpsPos]        = useState(null);
  const [toast,         setToast]         = useState(null); // {msg, type}

  // Rating
  const [ratingOrder,    setRatingOrder]    = useState(null);
  const [ratingRestStar, setRatingRestStar] = useState(0);
  const [ratingDrvStar,  setRatingDrvStar]  = useState(0);
  const [ratingComment,  setRatingComment]  = useState('');
  const [ratingLoading,  setRatingLoading]  = useState(false);
  const [ratedOrders,    setRatedOrders]    = useState(new Set());

  const isCustomer = auth.user?.role === 'customer';
  const hasAddress = Boolean(auth.user?.address && auth.user.address !== 'address-pending');

  // Load restaurant + menu
  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [restData, menuData] = await Promise.all([
          apiFetch(`/restaurants/${id}`),
          apiFetch(`/restaurants/${id}/menu`),
        ]);
        setRestaurant(restData.restaurant);
        setMenu((menuData.menu || []).filter(i => i.is_available !== false));
      } catch (_) {
        setMsg('Error cargando la tienda');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  // GPS — para centrar el mapa y calcular distancia home
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      pos => setGpsPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { timeout: 6000, maximumAge: 60000 }
    );
  }, []);

  // Leer draft de ubicación de Home o sesión anterior
  useEffect(() => {
    const draft = readPendingOrder();
    if (draft?.delivery_lat && draft?.delivery_lng) {
      setSearchPos({ lat: draft.delivery_lat, lng: draft.delivery_lng, label: draft.delivery_address || '' });
      return; // ya hay ubicación, no mostrar toast
    }
    // Sin draft — mostrar toast apropiado después de cargar GPS
    const timer = setTimeout(() => {
      const homeLatNum = Number(auth.user?.home_lat);
      const homeLngNum = Number(auth.user?.home_lng);
      const hasHome = Number.isFinite(homeLatNum) && Number.isFinite(homeLngNum);
      if (hasHome && gpsPos) {
        const dist = haversineKm(gpsPos.lat, gpsPos.lng, homeLatNum, homeLngNum);
        if (dist > 0.5) {
          setToast({ msg: '¿Te encuentras lejos de casa?', type: 'warn' });
          return;
        }
      }
      setToast({ msg: 'Por favor confirma tu ubicación', type: 'info' });
    }, 800);
    return () => clearTimeout(timer);
  }, [gpsPos]);

  // TTL del draft al salir
  useEffect(() => {
    function onHide()  { schedulePendingOrderExpiry(); }
    function onShow()  { if (document.visibilityState === 'visible') cancelPendingOrderExpiry(); }
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('pagehide', onHide);
    };
  }, []);

  // Order totals
  const subtotal    = Object.entries(selectedItems).reduce((sum, [itemId, qty]) => {
    const item = menu.find(i => i.id === itemId);
    return sum + (item ? item.price_cents * Number(qty) : 0);
  }, 0);
  const serviceFee  = Math.round(subtotal * 0.05);
  const deliveryFee = Math.round(subtotal * 0.10);
  const total       = subtotal + serviceFee + deliveryFee + tipCents;
  const itemCount   = Object.values(selectedItems).reduce((s, q) => s + Number(q), 0);

  // Distance / state derived from restaurant
  const restLat  = Number.isFinite(Number(restaurant?.lat)) ? Number(restaurant.lat) : null;
  const restLng  = Number.isFinite(Number(restaurant?.lng)) ? Number(restaurant.lng) : null;
  const refPos = searchPos || gpsPos;
  const distKm = (refPos && restLat !== null && restLng !== null)
  ? haversineKm(refPos.lat, refPos.lng, restLat, restLng) : null;
  const tooFar   = distKm !== null && distKm > 5;
  const isClosed = restaurant?.is_open === false;
  const canOrder = isCustomer && hasAddress && !isClosed && !tooFar && restLat !== null;

  // Measure order bar height so content isn't hidden behind fixed bar
  useEffect(() => {
    function update() {
      const bar = document.getElementById('order-bar');
      if (bar) document.documentElement.style.setProperty('--order-bar-h', bar.offsetHeight + 'px');
    }
    update();
    const bar = document.getElementById('order-bar');
    const obs = bar && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    if (obs) obs.observe(bar);
    return () => {
      obs?.disconnect();
      document.documentElement.style.removeProperty('--order-bar-h');
    };
  }, [isCustomer, isClosed, searchPos]);

  async function submitRating() {
    if (!ratingOrder || ratingRestStar < 1) return;
    setRatingLoading(true);
    try {
      await apiFetch(`/orders/${ratingOrder.id}/rating`, {
        method: 'POST',
        body: JSON.stringify({
          restaurant_stars: ratingRestStar,
          driver_stars: ratingDrvStar > 0 ? ratingDrvStar : undefined,
          comment: ratingComment.trim() || undefined,
        }),
      }, auth.token);
      setRatedOrders(prev => new Set([...prev, ratingOrder.id]));
      setRatingOrder(null); setRatingRestStar(0); setRatingDrvStar(0); setRatingComment('');
      setMsg('¡Gracias por tu calificación!');
      setTimeout(() => setMsg(''), 4000);
    } catch (e) {
      setMsg(e.message);
    } finally {
      setRatingLoading(false);
    }
  }

  function adjust(itemId, delta) {
    setSelectedItems(p => ({ ...p, [itemId]: Math.max(0, (Number(p[itemId]) || 0) + delta) }));
  }

  async function createOrder() {
    if (!auth.token) return navigate('/customer/login');
    if (!isCustomer) return setMsg('Solo los clientes pueden hacer pedidos');
    if (!hasAddress) return setMsg('Guarda tu dirección antes de hacer un pedido');
    const items = Object.entries(selectedItems)
      .filter(([, qty]) => Number(qty) > 0)
      .map(([menuItemId, quantity]) => ({ menuItemId, quantity: Number(quantity) }));
    if (items.length === 0) return setMsg('Selecciona al menos un producto');
    setOrdering(true);
    try {
      const body = { restaurantId: id, items, payment_method: paymentMethod, tip_cents: tipCents };
      if (searchPos) {
        body.delivery_address = searchPos.label;
        body.delivery_lat = searchPos.lat;
        body.delivery_lng = searchPos.lng;
      }
      await apiFetch('/orders', { method: 'POST', body: JSON.stringify(body) }, auth.token);
      setMsg('');
      setSelectedItems({});
      setTimeout(() => navigate('/customer'), 800);
    } catch (e) {
      setMsg(e.message);
    } finally {
      setOrdering(false);
    }
  }

  if (loading) return (
    <div style={{ padding:'3rem', textAlign:'center', color:'var(--text-tertiary)' }}>Cargando…</div>
  );

  return (
    <div style={{ backgroundColor:'var(--bg-base)', minHeight:'100vh' }}>

      {/* Toast de ubicación */}
      {toast && (
        <div style={{
          position:'fixed', top:'calc(var(--header-h, 56px) + 0.5rem)', left:'50%',
          transform:'translateX(-50%)', zIndex:900,
          background: toast.type === 'warn' ? 'var(--warn-bg)' : 'var(--bg-card)',
          border: `1px solid ${toast.type === 'warn' ? 'var(--warn-border)' : 'var(--border)'}`,
          borderRadius:10, padding:'0.6rem 1rem',
          boxShadow:'0 4px 16px rgba(0,0,0,0.14)',
          display:'flex', alignItems:'center', gap:'0.5rem',
          fontSize:'0.85rem', fontWeight:600, whiteSpace:'nowrap',
          color: toast.type === 'warn' ? 'var(--warn)' : 'var(--text-primary)',
          animation:'fadeInDown 0.25s ease',
        }}>
          <span style={{display:'inline-flex',alignItems:'center',gap:'0.4rem'}}>{toast.type === 'warn' ? <IconWarning /> : <IconPin />}{toast.msg}</span>
          <button onClick={() => setToast(null)}
            style={{ background:'none', border:'none', cursor:'pointer', fontSize:'0.9rem',
              color:'var(--text-tertiary)', minHeight:'unset', padding:'0 2px', marginLeft:4 }}>✕</button>
        </div>
      )}
      <style>{`@keyframes fadeInDown { from { opacity:0; transform:translateX(-50%) translateY(-8px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }`}</style>

      {/* Rating modal */}
      {ratingOrder && (
        <div style={{ position:'fixed', inset:0, background:'var(--bg-overlay)', zIndex:999,
          display:'flex', alignItems:'flex-end', justifyContent:'center' }}
          onClick={e => { if (e.target === e.currentTarget) setRatingOrder(null); }}>
          <div style={{ background:'var(--bg-card)', borderRadius:'20px 20px 0 0',
            padding:'1.5rem', width:'100%', maxWidth:480, boxShadow:'0 -4px 32px rgba(0,0,0,0.2)' }}>
            <h3 style={{ fontSize:'1rem', fontWeight:800, marginBottom:'1rem' }}>Calificar pedido</h3>
            <StarPicker value={ratingRestStar} onChange={setRatingRestStar} label="Tienda / Restaurante" />
            {ratingOrder.driver_id && (
              <StarPicker value={ratingDrvStar} onChange={setRatingDrvStar} label="Conductor (opcional)" />
            )}
            <textarea value={ratingComment} onChange={e => setRatingComment(e.target.value)}
              placeholder="Comentario opcional…" rows={2}
              style={{ width:'100%', marginBottom:'0.75rem', fontSize:'0.875rem', resize:'none', boxSizing:'border-box' }} />
            <div style={{ display:'flex', gap:'0.5rem' }}>
              <button className="btn-primary" style={{ flex:1 }}
                disabled={ratingRestStar < 1 || ratingLoading} onClick={submitRating}>
                {ratingLoading ? 'Enviando…' : 'Enviar calificación'}
              </button>
              <button className="btn-sm" onClick={() => setRatingOrder(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Hero header */}
      <div style={{
        background: restaurant?.profile_photo
          ? '#2a1a1a'
          : 'linear-gradient(135deg, #c97b7b 0%, #b56060 60%, #9e4f4f 100%)',
        position:'relative', overflow:'hidden', minHeight:140,
      }}>
        {restaurant?.profile_photo && (
          <>
            <img src={restaurant.profile_photo} alt={restaurant.name}
              style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover', opacity:0.35 }} />
            <div style={{ position:'absolute', inset:0,
              background:'linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.7) 100%)' }} />
          </>
        )}
        <div style={{ position:'relative', padding:'1rem 1rem 1.25rem', display:'flex', flexDirection:'column', gap:'0.5rem' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <button onClick={() => navigate(-1)}
              style={{ background:'rgba(255,255,255,0.15)', border:'1px solid rgba(255,255,255,0.3)',
                borderRadius:8, color:'#fff', padding:'0.3rem 0.65rem', fontSize:'0.82rem',
                fontWeight:600, cursor:'pointer', alignSelf:'flex-start', minHeight:'unset',
                display:'flex', alignItems:'center', gap:'0.3rem' }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Volver
            </button>
            <AddressSearchBar
              userPos={gpsPos}
              homeAddress={auth.user?.address || null}
              onSelectPos={pos => {
                setSearchPos(pos);
                setToast(null);
                if (pos?.lat && pos?.lng) savePendingOrder({ delivery_lat: pos.lat, delivery_lng: pos.lng, delivery_address: pos.label });
              }}
            />
          </div>

          <div style={{ display:'flex', gap:'0.875rem', alignItems:'flex-start' }}>
            {restaurant?.profile_photo
              ? <img src={restaurant.profile_photo} alt={restaurant.name}
                  style={{ width:56, height:56, borderRadius:'50%', objectFit:'cover',
                    border:'2px solid rgba(255,255,255,0.7)', flexShrink:0 }} />
              : <div style={{ width:56, height:56, borderRadius:'50%',
                  background:'rgba(255,255,255,0.2)', border:'2px solid rgba(255,255,255,0.4)',
                  display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                  <span style={{color:'rgba(255,255,255,0.7)'}}><IconStore /></span>
                </div>
            }
            <div style={{ flex:1 }}>
              <h2 style={{ fontSize:'1.15rem', fontWeight:900, margin:'0 0 0.2rem', color:'#fff',
                letterSpacing:'-0.02em' }}>{restaurant?.name}</h2>
              {restaurant?.address && (
                <p style={{ color:'rgba(255,255,255,0.8)', fontSize:'0.8rem', margin:'0 0 0.3rem' }}>
                  {restaurant.address}
                </p>
              )}
              <div style={{ display:'flex', gap:'0.5rem', alignItems:'center', flexWrap:'wrap' }}>
                {restaurant?.rating_avg != null && restaurant.rating_count > 0 && (
                  <span style={{ fontSize:'0.78rem', color:'rgba(255,255,255,0.9)',
                    display:'flex', alignItems:'center', gap:'0.2rem' }}>
                    <span style={{ color:'#fbbf24' }}>★</span>
                    {Number(restaurant.rating_avg).toFixed(1)}
                    <span style={{ opacity:0.7 }}>({restaurant.rating_count})</span>
                  </span>
                )}
                {distKm !== null && (
                  <span style={{ fontSize:'0.75rem', color:'rgba(255,255,255,0.8)', display:'inline-flex', alignItems:'center', gap:'0.2rem' }}>
                    <IconPin />{distKm < 1 ? `${Math.round(distKm*1000)}m` : `${distKm.toFixed(1)}km`}
                  </span>
                )}
                <span style={{
                  fontSize:'0.72rem', fontWeight:700,
                  color: isClosed ? 'rgba(255,255,255,0.55)' : '#fff',
                  background: isClosed ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.2)',
                  border:`1px solid ${isClosed ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.5)'}`,
                  borderRadius:10, padding:'0.15rem 0.55rem',
                }}>
                  {isClosed ? '· Cerrado' : '· Abierto'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content — padded to clear fixed bottom bar */}
      <div style={{ padding:'0.875rem 1rem',
        paddingBottom: isCustomer && !isClosed ? 'calc(var(--order-bar-h, 160px) + 0.5rem)' : '1rem'}}>

        {msg && <p className="flash flash-error" style={{ marginBottom:'0.75rem' }}>{msg}</p>}

        {isClosed && (
          <div style={{ background:'var(--bg-raised)', border:'1px solid var(--border)',
            borderRadius:'var(--radius)', padding:'0.75rem', marginBottom:'1rem',
            fontSize:'0.85rem', color:'var(--text-secondary)', textAlign:'center' }}>
            Esta tienda está cerrada. Puedes ver el menú pero no hacer pedidos.
          </div>
        )}

        {tooFar && (
          <div className="flash flash-error" style={{ marginBottom:'0.75rem' }}>
            Esta tienda está a {distKm?.toFixed(1)} km. Solo se aceptan pedidos dentro de 5 km.
          </div>
        )}

        {/* Menu */}
        <div style={{ fontWeight:800, fontSize:'0.85rem', color:'var(--text-tertiary)',
          textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:'0.75rem' }}>
          Menú
        </div>

        {menu.length === 0 ? (
          <p style={{ color:'var(--text-tertiary)' }}>Sin productos disponibles.</p>
        ) : (
          <>
            <div style={{ display:'flex', gap:'0.4rem', marginBottom:'0.6rem', alignItems:'center' }}>
              <span style={{ fontSize:'0.72rem', color:'var(--text-tertiary)', fontWeight:600 }}>Ordenar:</span>
              {[['default','Por defecto'],['asc','Menor precio'],['desc','Mayor precio']].map(([val, label]) => (
                <button key={val} onClick={() => setSortBy(val)}
                  className={`chip${sortBy===val?' active':''}`}
                  style={{ fontSize:'0.7rem', padding:'3px 9px' }}>
                  {label}
                </button>
              ))}
            </div>

            <ul style={{ listStyle:'none', padding:0, margin:0 }}>
              {[...menu].sort((a,b) => {
                if (sortBy === 'asc')  return (a.price_cents||0) - (b.price_cents||0);
                if (sortBy === 'desc') return (b.price_cents||0) - (a.price_cents||0);
                return 0;
              }).map(item => {
                const qty = Number(selectedItems[item.id]) || 0;
                return (
                  <li key={item.id} className="card"
                    style={{ display:'flex', gap:'0.75rem', alignItems:'center',
                      opacity: isClosed ? 0.65 : 1 }}>
                    <ProductImage src={item.image_url} name={item.name} />
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontWeight:700, fontSize:'0.95rem', color:'var(--text-primary)' }}>{item.name}</div>
                      {item.description && (
                        <div style={{ color:'var(--text-secondary)', fontSize:'0.82rem', margin:'0.1rem 0' }}>
                          {item.description}
                        </div>
                      )}
                      <div style={{ fontWeight:700, color:'var(--brand)', marginTop:'0.2rem' }}>
                        {fmt(item.price_cents)}
                      </div>
                    </div>
                    {isCustomer && !isClosed && (
                      <div className="qty-control" style={{ flexShrink:0 }}>
                        <button className="qty-btn" disabled={qty === 0} onClick={() => adjust(item.id, -1)}>−</button>
                        <span className="qty-num">{qty}</span>
                        <button className="qty-btn add" onClick={() => adjust(item.id, 1)}>+</button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}


      </div>

      {/* Sticky bottom bar */}
      {isCustomer && !isClosed && (
        <div id="order-bar" style={{ position:'fixed', bottom:0, left:0, right:0, zIndex:50,
          background:'var(--bg-card)', borderTop:'1px solid var(--border)',
          padding:'0.75rem 1rem', paddingBottom:'calc(0.75rem + var(--nav-h-mobile) + env(safe-area-inset-bottom, 0px))',
          boxShadow:'0 -4px 20px rgba(0,0,0,0.1)' }}>

          {searchPos?.label && (
            <div style={{ fontSize:'0.78rem', color:'var(--text-secondary)', marginBottom:'0.5rem',
              display:'flex', alignItems:'center', gap:'0.3rem' }}>
              <span style={{display:'inline-flex',alignItems:'center',gap:'0.3rem'}}><IconPin />{searchPos.label}</span>
              <button onClick={() => setSearchPos(null)}
                style={{ background:'none', border:'none', cursor:'pointer',
                  color:'var(--text-tertiary)', fontSize:'0.7rem', minHeight:'unset', padding:0 }}>✕</button>
            </div>
          )}
          {!searchPos && (
            <div style={{ fontSize:'0.78rem', color:'var(--warn)', marginBottom:'0.5rem', fontWeight:600 }}>
              <span style={{display:'inline-flex',alignItems:'center',gap:'0.3rem'}}>Toca <IconPin /> en el encabezado para indicar dónde entregar</span>
            </div>
          )}

          {!hasAddress && (
            <p style={{ fontSize:'0.82rem', color:'var(--warn)', marginBottom:'0.4rem', fontWeight:600 }}>
              Guarda tu dirección en Perfil antes de pedir
            </p>
          )}

          <button className="btn-primary"
            style={{ width:'100%', fontSize:'1rem', fontWeight:800, padding:'0.75rem' }}
            disabled={itemCount === 0 || tooFar || !isCustomer}
            onClick={() => {
              savePendingOrder({
                restaurantId:     id,
                items:            Object.entries(selectedItems).filter(([,q])=>Number(q)>0).map(([menuItemId,quantity])=>({ menuItemId, quantity:Number(quantity) })),
                items_detail:     Object.entries(selectedItems).filter(([,q])=>Number(q)>0).map(([menuItemId,quantity]) => {
                                    const item = menu.find(m => String(m.id) === String(menuItemId));
                                    return { menuItemId, quantity: Number(quantity), name: item?.name || '', price_cents: item?.price_cents || 0 };
                                  }),
                subtotal_cents:   subtotal,
                tip_cents:        tipCents,
                delivery_lat:     searchPos?.lat ?? gpsPos?.lat,
                delivery_lng:     searchPos?.lng ?? gpsPos?.lng,
                delivery_address: searchPos?.label || '',
                delivery_from_gps: !searchPos && !!gpsPos,
              });
              navigate('/customer/pagos');
            }}>
            {itemCount === 0 ? 'Selecciona productos'
              : tooFar ? `Tienda fuera de rango (${distKm?.toFixed(1)}km)`
              : `Ir a pagar · ${fmt(total)}`}
          </button>
        </div>
      )}

      {!isCustomer && auth.user && (
        <div style={{ padding:'1rem', textAlign:'center', color:'var(--text-tertiary)', fontSize:'0.85rem' }}>
          Solo los clientes pueden hacer pedidos.
        </div>
      )}
      {!auth.user && (
        <div style={{ padding:'1rem' }}>
          <button className="btn-primary" style={{ width:'100%' }}
            onClick={() => navigate('/customer/login')}>
            Iniciar sesión para pedir
          </button>
        </div>
      )}
    </div>
  );
}
