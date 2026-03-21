import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { savePendingOrder, schedulePendingOrderExpiry, cancelPendingOrderExpiry } from '../../utils/pendingOrder';
// ── Iconos SVG ────────────────────────────────────────────────────────────────
function IconPin()      { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{display:'block'}}><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>; }
function IconMap()      { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{display:'block'}}><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>; }
function IconSearch()   { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{display:'block'}}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>; }
function IconWarning()  { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{display:'block'}}><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>; }
function IconStore()    { return <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{display:'block'}}><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H5a1 1 0 01-1-1V9.5z"/><path d="M9 21V12h6v9"/></svg>; }
function IconStoreXL()  { return <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" style={{display:'block'}}><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H5a1 1 0 01-1-1V9.5z"/><path d="M9 21V12h6v9"/></svg>; }



function fmt(cents) { return `$${((cents ?? 0) / 100).toFixed(2)}`; }
function toDraft(items=[]) { const d={}; items.forEach(i=>{ d[i.menuItemId]=i.quantity; }); return d; }

function haversineKm(lat1,lng1,lat2,lng2) {
  const R=6371,toRad=x=>x*Math.PI/180;
  const dLat=toRad(lat2-lat1),dLng=toRad(lng2-lng1);
  const a=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

// ── Suggestion banner ────────────────────────────────────────────────────────
function SuggestionBanner({ order, onOpen, onDismiss }) {
  return (
    <div style={{
      background:'var(--warn-bg)', border:'2px solid var(--warn-border)',
      borderRadius:'var(--radius-lg)', padding:'0.875rem',
      marginBottom:'0.75rem', position:'relative',
    }}>
      <button onClick={onDismiss} style={{
        position:'absolute', top:8, right:8, width:32, height:32,
        borderRadius:'50%', border:'none', background:'var(--bg-raised)',
        cursor:'pointer', fontSize:'1rem', display:'flex', alignItems:'center',
        justifyContent:'center', color:'var(--text-tertiary)', minHeight:'unset',
      }}>✕</button>
      <p style={{ fontWeight:700, fontSize:'0.875rem', color:'var(--warn)', marginBottom:'0.5rem', paddingRight:'2.5rem' }}>
        {order.restaurant_name} propone un cambio
      </p>
      <button className="btn-primary btn-sm" onClick={onOpen}>Ver propuesta →</button>
    </div>
  );
}

// ── Restaurant card ──────────────────────────────────────────────────────────
function RestaurantCard({ r, isHero, distKm, onClick }) {
  const stars = r.rating_avg != null && r.rating_count > 0;

  if (isHero) {
    return (
      <div className="restaurant-hero-card" onClick={onClick} style={{
        borderRadius:14, overflow:'hidden', position:'relative', cursor:'pointer',
        marginBottom:12, boxShadow:'0 4px 20px rgba(185,80,80,0.22)',
        border:'2px solid #c97b7b',
      }}>
        <div className="restaurant-hero-bg" style={{ position:'relative' }}>
          {r.profile_photo
            ? <img src={r.profile_photo} alt={r.name} style={{ width:'100%', height:180, objectFit:'cover', display:'block' }} />
            : <div style={{ width:'100%', height:180, background:'linear-gradient(135deg,#c97b7b,#9e4f4f)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <span style={{color:'rgba(255,255,255,0.7)'}}><IconStoreXL /></span>
              </div>
          }
          {/* gradient overlay */}
          <div style={{ position:'absolute', inset:0, background:'linear-gradient(to top, rgba(120,30,30,0.82) 0%, rgba(80,20,20,0.2) 60%, transparent 100%)' }} />
        </div>
        <div style={{ position:'absolute', bottom:0, left:0, right:0, padding:'0.75rem 1rem' }}>
          <div style={{ fontWeight:900, fontSize:'1.1rem', color:'#fff', lineHeight:1.2, marginBottom:'0.2rem',
            textShadow:'0 1px 4px rgba(0,0,0,0.5)' }}>{r.name}</div>
          <div style={{ fontSize:'0.78rem', color:'rgba(255,255,255,0.85)' }}>
            {stars && `★ ${Number(r.rating_avg).toFixed(1)} · `}
            {r.category && `${r.category} · `}
            {r.is_open ? 'Abierto ahora' : 'Cerrado'}
            {distKm != null && ` · ${distKm < 1 ? `${Math.round(distKm*1000)}m` : `${distKm.toFixed(1)}km`}`}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="restaurant-card" onClick={onClick} style={{
      borderRadius:10, overflow:'hidden', cursor:'pointer',
      border:'1px solid var(--border)',
      background:'var(--bg-card)',
      boxShadow:'0 1px 6px rgba(0,0,0,0.06)',
      transition:'transform 0.15s, box-shadow 0.15s',
    }}>
      <div style={{ position:'relative' }}>
        {r.profile_photo
          ? <img src={r.profile_photo} alt={r.name} style={{ width:'100%', height:100, objectFit:'cover', display:'block', opacity: r.is_open ? 1 : 0.55 }} />
          : <div style={{ width:'100%', height:100, background:'linear-gradient(135deg,#e3aaaa33,#c97b7b22)', display:'flex', alignItems:'center', justifyContent:'center', opacity: r.is_open ? 1 : 0.55 }}>
              <span style={{color:'var(--text-tertiary)'}}><IconStore /></span>
            </div>
        }
        <div style={{ position:'absolute', inset:0, background:'linear-gradient(to top, rgba(0,0,0,0.35) 0%, transparent 60%)' }} />
      </div>
      <div style={{ padding:'0.5rem 0.65rem 0.6rem' }}>
        <div style={{ fontWeight:700, fontSize:'0.875rem', color:'var(--text-primary)', opacity: r.is_open ? 1 : 0.55, marginBottom:'0.15rem' }}>{r.name}</div>
        <div style={{ display:'flex', alignItems:'center', gap:'0.3rem', fontSize:'0.75rem', color:'var(--text-tertiary)', flexWrap:'wrap' }}>
          {stars && <span style={{ color:'#c97b7b', fontWeight:700 }}>★ {Number(r.rating_avg).toFixed(1)}</span>}
          {stars && r.category && <span>·</span>}
          {r.category && <span>{r.category}</span>}
          {distKm != null && <><span>·</span><span>{distKm < 1 ? `${Math.round(distKm*1000)}m` : `${distKm.toFixed(1)}km`}</span></>}
        </div>
        <div style={{ marginTop:'0.3rem' }}>
          {r.is_open
            ? <span style={{ fontSize:'0.68rem', fontWeight:700, color:'#16a34a' }}>● Abierto</span>
            : <span style={{ fontSize:'0.68rem', color:'var(--text-tertiary)' }}>Cerrado</span>
          }
        </div>
      </div>
    </div>
  );
}

// ── MapLibre styles — same as DriverMap ──────────────────────────────────────
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

// ── Address search bar (inline, expandable) + MapLibre map pick ───────────────
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

  // Init MapLibre when showMap becomes true
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
      {/* Trigger — pin icon */}
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

      {/* Expanded bar */}
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

      {/* Results dropdown */}
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

      {/* Map overlay — full width mobile, 500px desktop */}
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

export default function CustomerHome() {
  const { auth } = useAuth();
  const navigate  = useNavigate();

  const [restaurants, setRestaurants] = useState([]);
  const [menuCache,   setMenuCache]   = useState({});
  const [loading,     setLoading]     = useState(true);
  const [userPos,     setUserPos]     = useState(null);
  const [deliveryPos, setDeliveryPos] = useState(null); // {lat,lng,label} | null = use GPS

  // Search & sort
  const [query,       setQuery]       = useState('');
  // sortBy: 'default' | 'rating_asc' | 'rating_desc' | 'distance_asc' | 'distance_desc'
  const [sortBy,      setSortBy]      = useState('default');

  // Suggestions
  const [pendingSugg,   setPendingSugg]   = useState([]);
  const [suggFor,       setSuggFor]       = useState('');
  const [suggDrafts,    setSuggDrafts]    = useState({});
  const [dismissedSugg, setDismissedSugg] = useState(new Set());
  const [msg,           setMsg]           = useState('');
  const loadSuggRef = useRef(null);

  // GPS
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      pos => setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { timeout: 5000, maximumAge: 60000 }
    );
  }, []);

  // Draft de ubicación: iniciar TTL al salir, cancelar al volver
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

  async function loadSuggestions() {
    if (!auth.token) return;
    try {
      const d = await apiFetch('/orders/my', {}, auth.token);
      const pending = (d.orders||[]).filter(o =>
        o.suggestion_status==='pending_customer' && (o.suggestion_items||[]).length>0
      );
      setPendingSugg(pending);
    } catch (_) {}
  }

  useEffect(() => { loadSuggRef.current = loadSuggestions; });

  useEffect(() => {
    apiFetch('/restaurants')
      .then(d => setRestaurants(d.restaurants||[]))
      .catch(()=>{})
      .finally(()=>setLoading(false));
    if (auth.token) loadSuggestions();
  }, [auth.token]);

  async function ensureMenu(restaurantId) {
    if (menuCache[restaurantId]) return;
    try {
      const d = await apiFetch(`/restaurants/${restaurantId}/menu`, {}, auth.token);
      setMenuCache(prev => ({ ...prev, [restaurantId]: d.menu || [] }));
    } catch (_) {}
  }

  useEffect(() => {
    if (!query.trim()) return;
    restaurants.forEach(r => ensureMenu(r.id));
  }, [query, restaurants]);

  function openSugg(order) {
    setSuggFor(order.id);
    setSuggDrafts(prev => ({ ...prev, [order.id]: prev[order.id]||toDraft(order.suggestion_items||[]) }));
    if (order.restaurant_id) ensureMenu(order.restaurant_id);
  }

  function adjustSugg(orderId, menuItemId, delta) {
    setSuggDrafts(prev => {
      const cur = prev[orderId]||{};
      return { ...prev, [orderId]: { ...cur, [menuItemId]: Math.max(0,(cur[menuItemId]||0)+delta) } };
    });
  }

  async function respondSugg(orderId, accepted) {
    try {
      const body = { accepted };
      if (accepted) {
        const draft = suggDrafts[orderId] || {};
        const items = Object.entries(draft).filter(([,q])=>Number(q)>0).map(([menuItemId,qty])=>({ menuItemId, quantity:Number(qty) }));
        if (items.length>0) body.items = items;
      }
      await apiFetch(`/orders/${orderId}/suggestion-response`, { method:'PATCH', body: JSON.stringify(body) }, auth.token);
      setSuggFor(''); loadSuggestions();
    } catch (e) { setMsg(e.message); }
  }

  // ── Sort toggle helpers ───────────────────────────────────────────────────
  function toggleRating() {
    setSortBy(s => s === 'rating_desc' ? 'rating_asc' : 'rating_desc');
  }
  function toggleDistance() {
    setSortBy(s => s === 'distance_asc' ? 'distance_desc' : 'distance_asc');
  }

  // ── Filtered + sorted restaurants ────────────────────────────────────────
  const posForSort = userPos; // GPS used for distance sort

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();

    let list = restaurants.filter(r => {
      if (!q) return true;
      if (r.name?.toLowerCase().includes(q)) return true;
      if (r.category?.toLowerCase().includes(q)) return true;
      const menu = menuCache[r.id] || [];
      return menu.some(item => item.name?.toLowerCase().includes(q));
    });

    if (sortBy === 'rating_desc') {
      list = [...list].sort((a,b) => (Number(b.rating_avg)||0) - (Number(a.rating_avg)||0));
    } else if (sortBy === 'rating_asc') {
      list = [...list].sort((a,b) => (Number(a.rating_avg)||0) - (Number(b.rating_avg)||0));
    } else if (sortBy === 'distance_asc' && posForSort) {
      list = [...list].sort((a,b) => {
        const da = a.lat ? haversineKm(posForSort.lat,posForSort.lng,Number(a.lat),Number(a.lng)) : 999;
        const db = b.lat ? haversineKm(posForSort.lat,posForSort.lng,Number(b.lat),Number(b.lng)) : 999;
        return da - db;
      });
    } else if (sortBy === 'distance_desc' && posForSort) {
      list = [...list].sort((a,b) => {
        const da = a.lat ? haversineKm(posForSort.lat,posForSort.lng,Number(a.lat),Number(a.lng)) : 999;
        const db = b.lat ? haversineKm(posForSort.lat,posForSort.lng,Number(b.lat),Number(b.lng)) : 999;
        return db - da;
      });
    } else {
      // Default: open first, then by name
      list = [...list].sort((a,b) => {
        if (a.is_open !== b.is_open) return a.is_open ? -1 : 1;
        return (a.name || '').localeCompare(b.name || '');
      });
    }

    return list;
  }, [restaurants, query, sortBy, posForSort, menuCache]);

  const visibleSugg = pendingSugg.filter(o => !dismissedSugg.has(o.id));

  function getDistKm(r) {
    if (!userPos || !r.lat || !r.lng) return null;
    return haversineKm(userPos.lat, userPos.lng, Number(r.lat), Number(r.lng));
  }

  const heroRest   = filtered[0] || null;
  const restOfList = filtered.slice(1);

  const homeAddress = auth.user?.address || null;

  // Sort chip helpers
  const ratingActive   = sortBy === 'rating_desc' || sortBy === 'rating_asc';
  const distanceActive = sortBy === 'distance_asc' || sortBy === 'distance_desc';
  const ratingIcon     = sortBy === 'rating_asc'    ? '↑' : '↓';
  const distanceIcon   = sortBy === 'distance_desc' ? '↑' : '↓';

  if (loading) return (
    <div style={{ padding:'2rem', textAlign:'center', color:'var(--text-tertiary)' }}>Cargando…</div>
  );

  return (
    <div style={{ backgroundColor:'var(--bg-base)', minHeight:'100vh', padding:'1rem' }}>

      {/* ── Sugerencias ─────────────────────────────────────────────── */}
      {visibleSugg.map(order => {
        if (suggFor === order.id) return (
          <div key={`sug-${order.id}`} style={{
            background:'var(--warn-bg)', border:'2px solid var(--warn-border)',
            borderRadius:'var(--radius-lg)', padding:'0.875rem', marginBottom:'0.75rem',
          }}>
            <p style={{ fontWeight:700, fontSize:'0.875rem', color:'var(--warn)', marginBottom:'0.5rem' }}>
              Ajusta las cantidades o acepta la propuesta:
            </p>
            <div style={{ display:'flex', flexDirection:'column', gap:'0.3rem', marginBottom:'0.65rem' }}>
              {(menuCache[order.restaurant_id] || order.suggestion_items || []).map(item => {
                const id  = item.id || item.menuItemId;
                const qty = (suggDrafts[order.id]||{})[id] ?? (order.suggestion_items||[]).find(s=>s.menuItemId===id)?.quantity ?? 0;
                return (
                  <div key={id} style={{
                    display:'flex', alignItems:'center', gap:'0.5rem',
                    background: qty>0 ? 'var(--brand-light)':'var(--bg-card)',
                    border:`1px solid ${qty>0?'var(--brand)':'var(--border)'}`,
                    borderRadius:6, padding:'0.4rem 0.75rem',
                  }}>
                    <span style={{ flex:1, fontSize:'0.875rem', fontWeight:qty>0?600:400, color:'var(--text-primary)' }}>{item.name}</span>
                    <span style={{ fontSize:'0.75rem', color:'var(--text-tertiary)' }}>{fmt(item.price_cents||item.unitPriceCents||0)}</span>
                    <div className="qty-control">
                      <button className="qty-btn" disabled={qty===0} onClick={()=>adjustSugg(order.id,id,-1)}>−</button>
                      <span className="qty-num">{qty}</span>
                      <button className="qty-btn add" onClick={()=>adjustSugg(order.id,id,1)}>+</button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ display:'flex', gap:'0.4rem', flexWrap:'wrap' }}>
              <button className="btn-primary btn-sm" onClick={()=>respondSugg(order.id,true)}>Aceptar</button>
              <button className="btn-sm btn-danger" onClick={()=>respondSugg(order.id,false)}>Rechazar</button>
              <button className="btn-sm" style={{ color:'var(--danger)', borderColor:'var(--danger-border)' }}
                onClick={async()=>{
                  const note = window.prompt('Motivo de cancelación (obligatorio):');
                  if (!note?.trim()) return;
                  try {
                    await apiFetch(`/orders/${order.id}/cancel`, { method:'PATCH', body: JSON.stringify({ note }) }, auth.token);
                    setSuggFor(''); loadSuggestions();
                  } catch(e) { setMsg(e.message); }
                }}>Cancelar pedido</button>
              <button className="btn-sm" onClick={()=>setSuggFor('')}>← Volver</button>
            </div>
          </div>
        );
        return (
          <SuggestionBanner
            key={`sug-${order.id}`}
            order={order}
            onOpen={() => openSugg(order)}
            onDismiss={() => setDismissedSugg(s => new Set([...s, order.id]))}
          />
        );
      })}

      {msg && <p className="flash flash-error" style={{ marginBottom:'0.5rem' }}>{msg}</p>}

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div style={{
        margin:'-1rem -1rem 0', padding:'1rem 1rem 0.75rem',
        background:'linear-gradient(135deg, #c97b7b 0%, #b56060 60%, #9e4f4f 100%)',
      }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'14px' }}>
          <div>
            <div style={{ fontSize:'12px', color:'rgba(255,255,255,0.75)', fontWeight:600 }}>
              {auth.user?.alias ? `Hola, ${auth.user.alias.split(' ')[0] || auth.user.alias} 👋` : 'Bienvenido 👋'}
            </div>
            <div style={{ fontSize:'22px', fontWeight:900, color:'#fff', lineHeight:1.1, marginTop:2 }}>
              ¿Qué se te antoja?
            </div>
          </div>
          {/* Address search trigger */}
          <AddressSearchBar
            userPos={userPos}
            homeAddress={homeAddress}
            onSelectPos={pos => {
              setDeliveryPos(pos);
              // Guardar draft — se reutiliza en RestaurantPage
              if (pos?.lat && pos?.lng) {
                savePendingOrder({ delivery_lat: pos.lat, delivery_lng: pos.lng, delivery_address: pos.label });
              }
            }}
          />
        </div>

        {/* Active delivery address indicator */}
        {deliveryPos && (
          <div style={{
            display:'flex', alignItems:'center', gap:'6px',
            fontSize:'11px', color:'rgba(255,255,255,0.8)',
            marginBottom:'8px',
          }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
              <circle cx="12" cy="9" r="2.5"/>
            </svg>
            <span style={{ opacity:0.9 }}>{deliveryPos.label}</span>
            <button
              onClick={() => setDeliveryPos(null)}
              style={{ background:'none', border:'none', color:'rgba(255,255,255,0.6)', fontSize:'11px', cursor:'pointer', minHeight:'unset', padding:'0 2px' }}
            >✕</button>
          </div>
        )}

        {/* Search bar */}
        <div className="search-bar" style={{ background:'rgba(255,255,255,0.15)', border:'1px solid rgba(255,255,255,0.25)' }}>
          <span className="search-bar-icon" style={{ color:'rgba(255,255,255,0.7)', display:'flex' }}><IconSearch /></span>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar tienda o producto…"
            style={{ color:'#fff', fontSize:'14px' }}
          />
          {query && (
            <button className="search-bar-clear" style={{ color:'rgba(255,255,255,0.7)' }} onClick={() => setQuery('')}>✕</button>
          )}
        </div>

        {/* Sort chips — Rating y Distancia con toggle */}
        <div className="filter-chips" style={{ marginTop:'10px', paddingBottom:'12px' }}>
          <button
            className={`chip${ratingActive ? ' active' : ''}`}
            onClick={toggleRating}
            style={!ratingActive ? { background:'rgba(255,255,255,0.12)', borderColor:'rgba(255,255,255,0.2)', color:'rgba(255,255,255,0.85)' } : {}}
          >
            ★ Rating {ratingActive && ratingIcon}
          </button>
          <button
            className={`chip${distanceActive ? ' active' : ''}`}
            onClick={toggleDistance}
            disabled={!userPos}
            style={!distanceActive ? { background:'rgba(255,255,255,0.12)', borderColor:'rgba(255,255,255,0.2)', color:'rgba(255,255,255,0.85)', opacity: userPos ? 1 : 0.45 } : { opacity: userPos ? 1 : 0.45 }}
          >
            <span style={{display:'inline-flex',alignItems:'center',gap:'0.25rem'}}><IconPin />Distancia {distanceActive && distanceIcon}</span>
          </button>
        </div>
      </div>

      {/* ── Restaurant list ───────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div style={{ textAlign:'center', padding:'2rem', color:'var(--text-tertiary)' }}>
          <div style={{ marginBottom:'0.5rem', display:'flex', justifyContent:'center', color:'var(--text-tertiary)', fontSize:'2.5rem' }}><svg width='40' height='40' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round'><circle cx='11' cy='11' r='8'/><line x1='21' y1='21' x2='16.65' y2='16.65'/></svg></div>
          <div style={{ fontWeight:600 }}>Sin resultados</div>
          <div style={{ fontSize:'0.85rem', marginTop:'0.25rem' }}>
            {query ? `No encontramos "${query}"` : 'No hay tiendas disponibles'}
          </div>
        </div>
      ) : (
        <div style={{ marginTop:'16px' }}>
          <div className="section-row">
            <div className="section-row-title">
              {query ? `Resultados (${filtered.length})` : 'Tiendas cerca de ti'}
            </div>
          </div>

          {heroRest && (
            <RestaurantCard
              r={heroRest}
              isHero={true}
              distKm={getDistKm(heroRest)}
              onClick={() => navigate(`/customer/r/${heroRest.id}`)}
            />
          )}

          <div className="restaurants-grid">
            {restOfList.map(r => (
              <RestaurantCard
                key={r.id}
                r={r}
                isHero={false}
                distKm={getDistKm(r)}
                onClick={() => navigate(`/customer/r/${r.id}`)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
