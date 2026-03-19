import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { apiFetch } from '../api/client';

const ROLE_LABELS = { customer:'Cliente', restaurant:'Tienda', driver:'Conductor', admin:'Administrador' };

// ── Icons ─────────────────────────────────────────────────────────────────────
function IconHome()     { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H5a1 1 0 01-1-1V9.5z"/><path d="M9 21V12h6v9"/></svg>; }
function IconSchedule() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>; }
function IconClock()    { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>; }
function IconProfile()  { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>; }

// GPS pin icon — más reconocible que un mapa
function IconPin() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
      <circle cx="12" cy="9" r="2.5" fill="currentColor" stroke="none"/>
    </svg>
  );
}

function IconSun() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4.5"/>
      <line x1="12" y1="2"    x2="12" y2="5"/>
      <line x1="12" y1="19"   x2="12" y2="22"/>
      <line x1="4.22" y1="4.22"  x2="6.34" y2="6.34"/>
      <line x1="17.66" y1="17.66" x2="19.78" y2="19.78"/>
      <line x1="2"  y1="12"  x2="5"  y2="12"/>
      <line x1="19" y1="12"  x2="22" y2="12"/>
      <line x1="4.22" y1="19.78" x2="6.34" y2="17.66"/>
      <line x1="17.66" y1="6.34" x2="19.78" y2="4.22"/>
    </svg>
  );
}

function IconMoon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  );
}

function IconSearch() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7"/>
      <line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  );
}

function getNavItems(role) {
  if (role === 'customer')   return [{ to:'/customer', label:'Inicio', Icon:IconHome }];
  if (role === 'restaurant') return [{ to:'/restaurant', label:'Inicio', Icon:IconHome },{ to:'/restaurant/horario', label:'Horario', Icon:IconSchedule }];
  if (role === 'driver')     return [{ to:'/driver', label:'Inicio', Icon:IconHome },{ to:'/driver/ganancias', label:'Ganancias', Icon:IconClock }];
  return [];
}

function isActive(to, pathname) {
  if (to === '/restaurant') return pathname === '/restaurant';
  if (['/customer','/driver'].includes(to)) return pathname === to;
  return pathname.startsWith(to);
}

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000, toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2-lat1), dLng = toRad(lng2-lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ── Geocoding ─────────────────────────────────────────────────────────────────
// Photon (Komoot) para búsqueda forward: mejor autocompletar, ~5 req/s vs ~1 req/s Nominatim
// Nominatim solo para geocodificación inversa (coords → dirección), que Photon no tiene

// Bounding box de Morelia + municipios vecinos (lon_min,lat_min,lon_max,lat_max)
const MORELIA_BBOX = '-101.5,19.5,-100.9,19.9';

// Photon forward search — limitado al bbox de Morelia
async function nominatimSearch(query) {
  if (!query.trim()) return [];
  try {
    const [lonMin, latMin, lonMax, latMax] = MORELIA_BBOX.split(',');
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query + ' Morelia')}&limit=6&lang=es&bbox=${lonMin},${latMin},${lonMax},${latMax}`;
    const r = await fetch(url);
    const data = await r.json();
    return (data.features || []).map(f => {
      const p = f.properties;
      const parts = [
        p.name !== p.street ? p.name : null,  // skip name if same as street
        p.street,
        p.housenumber,
        p.suburb || p.district,
        p.city || p.town || 'Morelia',
      ].filter(Boolean);
      // Remove duplicate consecutive parts
      const deduped = parts.filter((v, i) => v !== parts[i-1]);
      return {
        label: deduped.join(', ') || p.name || 'Sin nombre',
        lat: f.geometry.coordinates[1],
        lng: f.geometry.coordinates[0],
        raw: f,
      };
    });
  } catch (_) { return []; }
}

// Nominatim reverse — solo para obtener dirección desde coordenadas GPS
async function nominatimReverse(lat, lng) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&countrycodes=mx&accept-language=es`,
      { headers: { 'Accept-Language': 'es', 'User-Agent': 'Morelivery/1.0' } }
    );
    const data = await r.json();
    const a = data.address || {};
    return [a.road, a.house_number, a.suburb || a.neighbourhood, a.city || 'Morelia']
      .filter(Boolean).join(', ') || data.display_name?.split(',').slice(0,3).join(',') || null;
  } catch (_) { return null; }
}

// ── GPS Panel Component ───────────────────────────────────────────────────────
function GpsPanel({ user, onLocationConfirmed, onClose }) {
  const [query,      setQuery]      = useState('');
  const [results,    setResults]    = useState([]);
  const [searching,  setSearching]  = useState(false);
  const [currentPos, setCurrentPos] = useState(null);
  const [currentLabel, setCurrentLabel] = useState('Obteniendo posición…');
  const [confirmed,  setConfirmed]  = useState(null); // { lat, lng, label }
  const [mismatch,   setMismatch]   = useState(false);
  const debounceRef = useRef(null);

  const homeLatNum = Number(user?.home_lat);
  const homeLngNum = Number(user?.home_lng);
  const hasHome = Number.isFinite(homeLatNum) && Number.isFinite(homeLngNum);

  // Get current GPS on mount
  useEffect(() => {
    if (!navigator.geolocation) { setCurrentLabel('GPS no disponible'); return; }
    navigator.geolocation.getCurrentPosition(
      async pos => {
        const { latitude: lat, longitude: lng } = pos.coords;
        setCurrentPos({ lat, lng });
        const label = await nominatimReverse(lat, lng);
        setCurrentLabel(label || `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
        if (hasHome) {
          const dist = haversineM(lat, lng, homeLatNum, homeLngNum);
          setMismatch(dist > 500);
        }
      },
      () => setCurrentLabel('No se pudo obtener GPS'),
      { timeout: 6000, maximumAge: 30000 }
    );
  }, []);

  // Debounced search
  function handleQueryChange(v) {
    setQuery(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!v.trim()) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      const res = await nominatimSearch(v);
      setResults(res);
      setSearching(false);
    }, 350);
  }

  function selectResult(r) {
    setQuery(r.label);
    setResults([]);
    setConfirmed({ lat: r.lat, lng: r.lng, label: r.label });
  }

  function useCurrentGps() {
    if (!currentPos) return;
    setConfirmed({ lat: currentPos.lat, lng: currentPos.lng, label: currentLabel });
    setQuery('');
    setResults([]);
  }

  function useHome() {
    if (!hasHome) return;
    const homeLabel = user?.address || `${homeLatNum.toFixed(5)}, ${homeLngNum.toFixed(5)}`;
    setConfirmed({ lat: homeLatNum, lng: homeLngNum, label: homeLabel });
    setQuery('');
    setResults([]);
  }

  function confirm() {
    if (!confirmed) return;
    onLocationConfirmed?.(confirmed);
    onClose();
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'var(--bg-overlay)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: 'var(--bg-card)', borderRadius: '20px 20px 0 0',
        padding: '1.25rem', width: '100%', maxWidth: 520,
        boxShadow: '0 -4px 32px rgba(0,0,0,0.2)',
        paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))',
        maxHeight: '80vh', display: 'flex', flexDirection: 'column',
      }}>
        {/* Handle bar */}
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)',
          margin: '0 auto 1rem', flexShrink: 0 }} />

        <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-primary)',
          marginBottom: '0.75rem', flexShrink: 0 }}>
          📍 Ubicación de entrega
        </div>

        {/* Mismatch warning */}
        {mismatch && (
          <div style={{ background: 'var(--warn-bg)', border: '1px solid var(--warn-border)',
            borderRadius: 8, padding: '0.5rem 0.75rem', marginBottom: '0.75rem',
            fontSize: '0.8rem', color: 'var(--warn)', flexShrink: 0 }}>
            ⚠️ Tu ubicación actual difiere más de 500m de tu dirección guardada
          </div>
        )}

        {/* Search input */}
        <div style={{ position: 'relative', flexShrink: 0, marginBottom: '0.5rem' }}>
          <div className="search-bar">
            <IconSearch />
            <input
              value={query}
              onChange={e => handleQueryChange(e.target.value)}
              placeholder="Buscar calle y número en Morelia…"
              autoFocus
            />
            {searching && <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>…</span>}
            {query && !searching && (
              <button className="search-bar-clear" onClick={() => { setQuery(''); setResults([]); }}>✕</button>
            )}
          </div>

          {/* Search results dropdown */}
          {results.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: '0 0 var(--radius) var(--radius)',
              boxShadow: 'var(--panel-shadow)', maxHeight: 200, overflowY: 'auto',
            }}>
              {results.map((r, i) => (
                <button key={i} onClick={() => selectResult(r)}
                  style={{ width: '100%', textAlign: 'left', padding: '0.6rem 0.875rem',
                    border: 'none', borderBottom: `1px solid var(--border-light)`,
                    background: 'transparent', cursor: 'pointer', fontSize: '0.82rem',
                    color: 'var(--text-primary)', display: 'block', minHeight: 'unset' }}>
                  <span style={{ color: 'var(--brand)', marginRight: 6 }}>📍</span>
                  {r.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Quick options */}
        <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.75rem', flexShrink: 0 }}>
          {currentPos && (
            <button className={`chip${confirmed?.label === currentLabel ? ' active' : ''}`}
              onClick={useCurrentGps} style={{ fontSize: '0.75rem' }}>
              📍 Ubicación actual
            </button>
          )}
          {hasHome && (
            <button className={`chip${confirmed?.lat === homeLatNum ? ' active' : ''}`}
              onClick={useHome} style={{ fontSize: '0.75rem' }}>
              🏠 Casa
            </button>
          )}
        </div>

        {/* Current GPS display */}
        <div style={{ background: 'var(--bg-raised)', borderRadius: 'var(--radius)',
          padding: '0.65rem 0.875rem', marginBottom: '0.75rem', flexShrink: 0 }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginBottom: '0.2rem' }}>
            GPS actual
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 500 }}>
            {currentLabel}
          </div>
        </div>

        {/* Selected location */}
        {confirmed && (
          <div style={{ background: 'var(--brand-light)', border: '1px solid var(--brand)',
            borderRadius: 'var(--radius)', padding: '0.65rem 0.875rem',
            marginBottom: '0.75rem', flexShrink: 0 }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--brand)', marginBottom: '0.2rem', fontWeight: 700 }}>
              ✓ Ubicación seleccionada
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>{confirmed.label}</div>
          </div>
        )}

        <button className="btn-primary" style={{ width: '100%', marginTop: 'auto', flexShrink: 0 }}
          disabled={!confirmed} onClick={confirm}>
          Confirmar ubicación
        </button>
      </div>
    </div>
  );
}

// ── Layout ─────────────────────────────────────────────────────────────────────
export default function Layout({ children }) {
  const { auth, logout, patchUser } = useAuth();
  const { toggle, isDark } = useTheme();
  const location  = useLocation();
  const navigate  = useNavigate();
  const [address,     setAddress]     = useState('');
  const [showGpsPanel, setShowGpsPanel] = useState(false);
  const [gpsMismatch,  setGpsMismatch]  = useState(false);
  const [confirmedLocation, setConfirmedLocation] = useState(null);

  const role  = auth.user?.role;
  const items = getNavItems(role);
  const displayName = auth.user?.alias || auth.user?.full_name || auth.user?.username || '';
  const showGpsBtn = auth.user && ['customer', 'driver'].includes(role);

  const shouldAskAddress = Boolean(
    auth.user && ['customer','restaurant'].includes(role) &&
    (!auth.user.address || auth.user.address === 'address-pending')
  );

  // Passive mismatch check on mount/login (no prompt)
  useEffect(() => {
    if (!auth.user?.home_lat || !auth.user?.home_lng) return;
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      pos => {
        const dist = haversineM(
          pos.coords.latitude, pos.coords.longitude,
          Number(auth.user.home_lat), Number(auth.user.home_lng)
        );
        setGpsMismatch(dist > 500);
      },
      () => {},
      { timeout: 5000, maximumAge: 60000 }
    );
  }, [auth.user?.home_lat, auth.user?.home_lng]);

  async function saveAddress() {
    if (!auth.token || !address.trim()) return;
    try {
      const data = await apiFetch('/auth/profile', { method:'PATCH', body: JSON.stringify({ address: address.trim() }) }, auth.token);
      patchUser({ address: data.profile.address });
      setAddress('');
    } catch (e) { console.error(e); }
  }

  function handleLocationConfirmed(loc) {
    setConfirmedLocation(loc);
    setGpsMismatch(false);
    // Store in sessionStorage so RestaurantPage can pick it up
    try { sessionStorage.setItem('morelivery_delivery_pos', JSON.stringify(loc)); } catch (_) {}
  }

  return (
    <div className="app-shell">
      {showGpsPanel && (
        <GpsPanel
          user={auth.user}
          onLocationConfirmed={handleLocationConfirmed}
          onClose={() => setShowGpsPanel(false)}
        />
      )}

      <header className="app-header">
        <Link to={auth.user ? `/${role}` : '/'} className="brand-block" style={{ textDecoration:'none' }}>
          <img className="brand-logo" src="/logo.svg" alt="Morelivery" />
          <div>
            <h1>Morelivery</h1>
            {role && <span className="role-pill">{ROLE_LABELS[role] || role}</span>}
          </div>
        </Link>

        {auth.user && items.length > 0 && (
          <nav className="nav-desktop" aria-label="Navegación principal">
            {items.map(({ to, label }) => (
              <Link key={to} to={to} className={isActive(to, location.pathname) ? 'active' : ''}>{label}</Link>
            ))}
            <button onClick={logout}>Salir</button>
          </nav>
        )}

        <div style={{ display:'flex', alignItems:'center', gap:'0.4rem', flexShrink:0 }}>

          {/* GPS mismatch inline warning */}
          {showGpsBtn && gpsMismatch && !showGpsPanel && (
            <button onClick={() => setShowGpsPanel(true)}
              style={{ display:'flex', alignItems:'center', gap:'0.3rem',
                background:'var(--warn-bg)', border:'1px solid var(--warn-border)',
                borderRadius:8, padding:'0.25rem 0.6rem', fontSize:'0.72rem',
                fontWeight:700, color:'var(--warn)', cursor:'pointer', minHeight:'unset' }}>
              ⚠️ Ubicación
            </button>
          )}

          {/* GPS button */}
          {showGpsBtn && (
            <button
              className="header-icon-btn"
              onClick={() => setShowGpsPanel(true)}
              title="Ubicación de entrega"
              aria-label="Ubicación"
              style={confirmedLocation ? { borderColor:'var(--success)', color:'var(--success)' } : {}}>
              <IconPin />
              {gpsMismatch && !confirmedLocation && <span className="dot-alert" />}
            </button>
          )}

          {/* Theme toggle */}
          <button
            className="header-icon-btn"
            onClick={toggle}
            title={isDark ? 'Tema claro' : 'Tema oscuro'}
            aria-label="Tema">
            {isDark ? <IconSun /> : <IconMoon />}
          </button>

          {/* Profile */}
          {auth.user && (
            <button
              onClick={() => navigate('/profile')}
              className={`user-name-btn${location.pathname === '/profile' ? ' active' : ''}`}
              title="Mi perfil">
              {displayName}
            </button>
          )}
        </div>
      </header>

      {shouldAskAddress && (
        <div style={{ background:'var(--warn-bg)', borderBottom:'1px solid var(--warn-border)', padding:'0.75rem 1.25rem' }}>
          <p style={{ fontSize:'0.85rem', fontWeight:600, color:'var(--warn)', marginBottom:'0.5rem' }}>
            Agrega tu dirección para poder hacer pedidos
          </p>
          <div style={{ display:'flex', gap:'0.5rem', maxWidth:420 }}>
            <input value={address} onChange={e => setAddress(e.target.value)}
              placeholder="Tu dirección de entrega"
              onKeyDown={e => e.key === 'Enter' && saveAddress()} />
            <button className="btn-primary" onClick={saveAddress} style={{ whiteSpace:'nowrap' }}>Guardar</button>
          </div>
        </div>
      )}

      <main className="page-content">{children}</main>

      {auth.user && items.length > 0 && (
        <nav className="nav-mobile" aria-label="Navegación">
          {items.map(({ to, label, Icon }) => (
            <button key={to}
              className={`nav-mobile-item${isActive(to, location.pathname) ? ' active' : ''}`}
              onClick={() => navigate(to)} aria-label={label}>
              <Icon /><span>{label}</span>
            </button>
          ))}
          <button
            className={`nav-mobile-item${location.pathname === '/profile' ? ' active' : ''}`}
            onClick={() => navigate('/profile')} aria-label="Perfil">
            <IconProfile /><span>Perfil</span>
          </button>
        </nav>
      )}
    </div>
  );
}
