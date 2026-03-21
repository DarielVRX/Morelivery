import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

const STADIA_KEY  = import.meta.env?.VITE_STADIA_KEY || '';
const STYLE_LIGHT = STADIA_KEY
  ? `https://tiles.stadiamaps.com/styles/alidade_smooth.json?api_key=${STADIA_KEY}`
  : 'https://tiles.openfreemap.org/styles/bright';
const STYLE_DARK  = STADIA_KEY
  ? `https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json?api_key=${STADIA_KEY}`
  : 'https://tiles.openfreemap.org/styles/bright';

// ── CP AddressSearchBar ───────────────────────────────────────────────────────
// Mismo patrón que RestaurantPage/Payments pero limitado a búsqueda por CP.
function CPSearchBar({ onSelectPos }) {
  const [open,      setOpen]      = useState(false);
  const [showMap,   setShowMap]   = useState(false);
  const [pinPlaced, setPinPlaced] = useState(false);
  const [inputVal,  setInputVal]  = useState('');
  const [results,   setResults]   = useState([]);
  const [searching, setSearching] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
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

  // Inicializar mapa MapLibre cuando showMap = true
  useEffect(() => {
    if (!showMap) return;
    let cancelled = false;
    async function init() {
      await new Promise(r => setTimeout(r, 30));
      if (cancelled || !mapContRef.current) return;
      const { ensureMapLibreCSS, ensureMapLibreJS } = await import('../utils/mapLibre');
      ensureMapLibreCSS();
      const ml = await ensureMapLibreJS();
      if (cancelled || !mapContRef.current) return;
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const map = new ml.Map({
        container: mapContRef.current,
        style: isDark ? STYLE_DARK : STYLE_LIGHT,
        center: [-101.195, 19.706], zoom: 13, attributionControl: false,
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
          markerRef.current = new ml.Marker({ element: el, anchor: 'bottom' })
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
    onSelectPos({ lat: pos.lat, lng: pos.lng });
    setShowMap(false); setOpen(false); setResults([]); setInputVal('');
  }

  function doSearch(val) {
    clearTimeout(debounceRef.current);
    const cp = val.replace(/\D/g, '').slice(0, 5);
    setInputVal(cp);
    if (cp.length !== 5) { setResults([]); setSearching(false); return; }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cp + ', Morelia, Michoacán')}&format=json&addressdetails=1&limit=4&countrycodes=mx&accept-language=es`;
        const r = await fetch(url, { headers: { 'Accept-Language': 'es', 'User-Agent': 'Morelivery/1.0' } });
        const data = await r.json();
        const items = (data || []).map(item => {
          const a = item.address || {};
          const parts = [a.road, a.suburb || a.neighbourhood, a.city || 'Morelia'].filter(Boolean);
          return { label: parts.join(', ') || item.display_name?.split(',').slice(0, 3).join(',') || cp, lat: Number(item.lat), lng: Number(item.lon) };
        }).filter(i => i.lat && i.lng);
        setResults(items);
      } catch (_) { setResults([]); }
      finally { setSearching(false); }
    }, 400);
  }

  function selectGPS() {
    setGpsLoading(true);
    navigator.geolocation?.getCurrentPosition(
      pos => {
        onSelectPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setOpen(false); setResults([]); setInputVal('');
        setGpsLoading(false);
      },
      () => setGpsLoading(false),
      { timeout: 6000, maximumAge: 30000 }
    );
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      {!open && !showMap && (
        <button type="button" onClick={() => setOpen(true)}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem',
            background: 'var(--brand-light)', border: '1px solid var(--brand)',
            borderRadius: 8, padding: '0.3rem 0.65rem', cursor: 'pointer',
            fontSize: '0.78rem', fontWeight: 600, color: 'var(--brand)', minHeight: 'unset' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
            <circle cx="12" cy="9" r="2.5"/>
          </svg>
          Buscar CP en mapa
        </button>
      )}

      {open && !showMap && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px',
          background: 'var(--bg-sunken)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '4px 6px', minWidth: 220 }}>
          <button type="button" onClick={selectGPS} disabled={gpsLoading}
            title="Usar mi ubicación GPS"
            style={{ background: 'none', border: 'none', cursor: 'pointer',
              padding: '4px', borderRadius: 6, display: 'flex', alignItems: 'center',
              minHeight: 'unset', flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="4.5"/>
              <line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/>
              <line x1="4.22" y1="4.22" x2="6.34" y2="6.34"/><line x1="17.66" y1="17.66" x2="19.78" y2="19.78"/>
              <line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/>
              <line x1="4.22" y1="19.78" x2="6.34" y2="17.66"/><line x1="17.66" y1="6.34" x2="19.78" y2="4.22"/>
            </svg>
          </button>
          <input autoFocus value={inputVal} inputMode="numeric" maxLength={5}
            onChange={e => doSearch(e.target.value)}
            placeholder="Código postal…"
            style={{ flex: 1, background: 'none', border: 'none', outline: 'none',
              color: 'var(--text-primary)', fontSize: '13px', minWidth: 0 }} />
          {searching && <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', flexShrink: 0 }}>…</span>}
          <button type="button" onClick={() => { setShowMap(true); setOpen(false); }} title="Elegir en mapa"
            style={{ background: 'var(--bg-raised)', border: 'none', cursor: 'pointer',
              padding: '3px 5px', borderRadius: 5, minHeight: 'unset', flexShrink: 0,
              color: 'var(--text-secondary)', display: 'flex', alignItems: 'center' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
              <line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>
            </svg>
          </button>
          <button type="button" onClick={() => { setOpen(false); setResults([]); setInputVal(''); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-tertiary)', fontSize: '13px', padding: '2px 4px',
              minHeight: 'unset', flexShrink: 0 }}>✕</button>
        </div>
      )}

      {open && !showMap && results.length > 0 && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', zIndex: 200, overflow: 'hidden' }}>
          {results.map((item, i) => (
            <button type="button" key={i} onClick={() => { onSelectPos(item); setOpen(false); setResults([]); setInputVal(''); }}
              style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none',
                borderBottom: i < results.length - 1 ? '1px solid var(--border-light)' : 'none',
                padding: '0.55rem 0.875rem', cursor: 'pointer', fontSize: '0.82rem',
                color: 'var(--text-primary)', display: 'block', minHeight: 'unset' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
                  <circle cx="12" cy="9" r="2.5"/>
                </svg>
                {item.label}
              </span>
            </button>
          ))}
        </div>
      )}

      {showMap && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) setShowMap(false); }}>
          <div className="addr-map-modal">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <span style={{ fontWeight: 700, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
                  <circle cx="12" cy="9" r="2.5"/>
                </svg>
                Elige tu ubicación
              </span>
              <button type="button" onClick={() => setShowMap(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem',
                  color: 'var(--text-tertiary)', minHeight: 'unset', padding: '2px 6px' }}>✕</button>
            </div>
            <div ref={mapContRef} style={{ flex: 1, width: '100%', minHeight: 0 }} />
            <div style={{ display: 'flex', gap: '0.5rem', padding: '0.75rem 1rem',
              borderTop: '1px solid var(--border)', background: 'var(--bg-card)', flexShrink: 0 }}>
              <span style={{ flex: 1, fontSize: '0.78rem', color: 'var(--text-tertiary)', alignSelf: 'center' }}>
                {pinPlaced
                  ? <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>📍 Pin colocado — confirma o muévelo</span>
                  : 'Toca el mapa para colocar un pin'}
              </span>
              <button type="button" onClick={confirmMapPin} disabled={!pinPlaced}
                className="btn-primary btn-sm" style={{ opacity: pinPlaced ? 1 : 0.45 }}>
                Confirmar
              </button>
              <button type="button" onClick={() => setShowMap(false)} className="btn-sm">Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Collapsible({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const [wasOpened, setWasOpened] = useState(defaultOpen);

  function toggleOpen() {
    setOpen(prev => {
      const next = !prev;
      if (next) setWasOpened(true);
      return next;
    });
  }

  return (
    <div className="card" style={{ marginBottom:'0.75rem', padding:0, overflow:'hidden' }}>
    <button
    onClick={toggleOpen}
    style={{
      width:'100%', display:'flex', justifyContent:'space-between', alignItems:'center',
      padding:'0.85rem 1rem', background:'none', border:'none', cursor:'pointer',
      fontWeight:700, fontSize:'0.9rem', color:'var(--gray-800)',
          borderBottom: open ? '1px solid var(--gray-200)' : 'none',
    }}
    >
    <span>{title}</span>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition:'transform 0.2s' }}>
    <path d="M6 9l6 6 6-6"/>
    </svg>
    </button>
    {(open || wasOpened) && (
      <div style={{ padding: open ? '1rem' : 0, display: open ? 'block' : 'none' }}>
      {children}
      </div>
    )}
    </div>
  );
}

function Flash({ text, isError }) {
  if (!text) return null;
  return <p className={`flash ${isError ? 'flash-error' : 'flash-ok'}`} style={{ marginTop:'0.5rem' }}>{text}</p>;
}

const ROLE_LABELS = { customer:'Cliente', restaurant:'Tienda', driver:'Conductor', admin:'Administrador' };

function ensureLeafletCSS() {
  if (document.getElementById('leaflet-css')) return;
  const lnk = document.createElement('link');
  lnk.id = 'leaflet-css';
  lnk.rel = 'stylesheet';
  lnk.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  document.head.appendChild(lnk);
}

// Consulta de CP vía backend (proxy anti-CORS)
async function fetchColoniasByPostal(cp, token) {
  try {
    const result = await apiFetch(`/auth/postal/${cp}`, {}, token);
    return {
      estado: result?.estado || '',
      ciudad: result?.ciudad || '',
      colonias: Array.isArray(result?.colonias) ? result.colonias : [],
    };
  } catch {
    return null;
  }
}

const BUSY_FIELD_STYLE = { opacity: 0.7, pointerEvents: 'none' };

export default function ProfilePage() {
  const { auth, patchUser, logout } = useAuth();
  const user = auth.user;

  // Datos personales
  const [alias, setAlias]             = useState(user?.alias || user?.display_name || user?.full_name || '');
  const [address, setAddress]         = useState('');
  // Descomponer address guardado en calle + número al inicializar
  const _savedAddress = user?.address && user.address !== 'address-pending' ? user.address : '';
  const _calleInit    = _savedAddress.replace(/\s+\d+[a-zA-Z]?\s*$/, '').trim();
  const _numInit      = _savedAddress.match(/\s+(\d+[a-zA-Z]?)\s*$/)?.[1] || '';
  const [calle,   setCalle]   = useState(_calleInit);
  const [numero,  setNumero]  = useState(_numInit);
  const [profileMsg, setProfileMsg]   = useState('');
  const [profileErr, setProfileErr]   = useState(false);

  // Código postal + dirección estructurada
  const [postalCode,   setPostalCode]   = useState(user?.postal_code  || '');
  const [estado,       setEstado]       = useState(user?.estado        || '');
  const [ciudad,       setCiudad]       = useState(user?.ciudad        || '');
  const [colonia,      setColonia]      = useState(user?.colonia       || '');
  const [coloniasList, setColoniasList] = useState([]);
  const [cpLoading,    setCpLoading]    = useState(false);
  const [cpError,      setCpError]      = useState('');
  const cpTimerRef = useRef(null);
  const coloniaRef = useRef(colonia);


  const [notifStatus, setNotifStatus] = useState(
    (typeof window !== 'undefined' && 'Notification' in window)
    ? Notification.permission
    : 'unsupported'
  );
  const [notifMsg, setNotifMsg] = useState('');
  const [highPriorityNotifs, setHighPriorityNotifs] = useState(() => {
    try { return localStorage.getItem('morelivery_notif_priority') === 'high'; } catch { return false; }
  });
  const [notifEnabled, setNotifEnabled] = useState(() => {
    try { return localStorage.getItem('morelivery_notif_enabled') !== '0'; } catch { return true; }
  });

  // PWA: instalación y preferencias
  const [deferredInstall, setDeferredInstall] = useState(null);
  const [isInstalled, setIsInstalled]         = useState(
    typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches
  );
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('morelivery_theme') || 'system'; } catch { return 'system'; }
  });
  const [reducedMotion, setReducedMotion] = useState(() => {
    try { return localStorage.getItem('morelivery_reduced_motion') === '1'; } catch { return false; }
  });
  const [offlineCacheMsg, setOfflineCacheMsg] = useState('');

  useEffect(() => {
    const handler = e => { e.preventDefault(); setDeferredInstall(e); };
    window.addEventListener('beforeinstallprompt', handler);
    const mq = window.matchMedia('(display-mode: standalone)');
    const mqHandler = e => setIsInstalled(e.matches);
    mq.addEventListener('change', mqHandler);
    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      mq.removeEventListener('change', mqHandler);
    };
  }, []);

  function applyTheme(val) {
    setTheme(val);
    try { localStorage.setItem('morelivery_theme', val); } catch (_) {}
    const root = document.documentElement;
    if (val === 'dark')  root.setAttribute('data-theme', 'dark');
    else if (val === 'light') root.removeAttribute('data-theme');
    else {
      // system
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (prefersDark) root.setAttribute('data-theme', 'dark');
      else root.removeAttribute('data-theme');
    }
  }

  function toggleReducedMotion() {
    setReducedMotion(prev => {
      const next = !prev;
      try { localStorage.setItem('morelivery_reduced_motion', next ? '1' : '0'); } catch (_) {}
      document.documentElement.style.setProperty('--transition-speed', next ? '0ms' : '');
      return next;
    });
  }

  async function triggerInstallPrompt() {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    const { outcome } = await deferredInstall.userChoice;
    if (outcome === 'accepted') { setIsInstalled(true); setDeferredInstall(null); }
  }

  async function refreshOfflineCache() {
    setOfflineCacheMsg('');
    if (!('serviceWorker' in navigator)) {
      setOfflineCacheMsg('Service Worker no disponible en este navegador.');
      return;
    }
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg?.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        setOfflineCacheMsg('Actualización aplicada. Recarga para ver cambios.');
      } else if (reg) {
        await reg.update();
        setOfflineCacheMsg('Caché verificado — estás en la versión más reciente.');
      } else {
        setOfflineCacheMsg('Sin service worker registrado.');
      }
    } catch {
      setOfflineCacheMsg('Error al verificar la actualización.');
    }
    setTimeout(() => setOfflineCacheMsg(''), 5000);
  }

  async function enablePushNotifications() {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setNotifMsg('Este dispositivo no soporta notificaciones web.');
      return;
    }
    try {
      if ('serviceWorker' in navigator) {
        await navigator.serviceWorker.register('/sw.js');
      }
      let permission = Notification.permission;
      if (permission === 'default') {
        permission = await Notification.requestPermission();
      }
      setNotifStatus(permission);
      if (permission === 'granted') {
        try { localStorage.setItem('morelivery_notif_enabled', '1'); } catch (_) {}
        setNotifEnabled(true);
        setNotifMsg('Notificaciones activadas correctamente.');
      } else if (permission === 'denied') {
        try { localStorage.setItem('morelivery_notif_enabled', '0'); } catch (_) {}
        setNotifEnabled(false);
        setNotifMsg('Permiso bloqueado. Actívalo en ajustes del navegador/sitio.');
      } else {
        setNotifMsg('Solicitud cerrada sin cambios.');
      }
    } catch {
      setNotifMsg('No se pudo solicitar permiso de notificaciones.');
    }
  }


  function toggleHighPriorityNotifs() {
    setHighPriorityNotifs(prev => {
      const next = !prev;
      try { localStorage.setItem('morelivery_notif_priority', next ? 'high' : 'normal'); } catch (_) {}
      return next;
    });
  }

  function toggleNotifEnabled() {
    if (notifStatus !== 'granted') {
      enablePushNotifications();
      return;
    }
    setNotifEnabled(prev => {
      const next = !prev;
      try { localStorage.setItem('morelivery_notif_enabled', next ? '1' : '0'); } catch (_) {}
      setNotifMsg(next ? 'Notificaciones activas.' : 'Notificaciones pausadas para este dispositivo.');
      return next;
    });
  }

  // Pin Casa
  const [homeLat, setHomeLat] = useState(user?.home_lat ?? null);
  const [homeLng, setHomeLng] = useState(user?.home_lng ?? null);

  // Seguridad
  const [loginUsername,    setLoginUsername]    = useState(user?.username || '');
  const [currentPassword,  setCurrentPassword]  = useState('');
  const [newPassword,      setNewPassword]       = useState('');
  const [confirmPassword,  setConfirmPassword]   = useState('');
  const [pwdMsg,  setPwdMsg]  = useState('');
  const [pwdErr,  setPwdErr]  = useState(false);

  // Eliminar cuenta
  const [deleteMsg, setDeleteMsg] = useState('');
  const [deleteErr, setDeleteErr] = useState(false);

  const lastSearchedCp = useRef(user?.postal_code || '');

  // Buscar CP cuando cambia (debounce 600ms)
  useEffect(() => {
    const cp = postalCode.trim();
    if (cp.length !== 5 || !/^\d{5}$/.test(cp)) {
      setCpError('');
      setColoniasList([]);
      return;
    }

    if (cp === lastSearchedCp.current) return;

    clearTimeout(cpTimerRef.current);
    cpTimerRef.current = setTimeout(async () => {
      setCpLoading(true);
      setCpError('');
      const result = await fetchColoniasByPostal(cp, auth.token);
      setCpLoading(false);
      if (!result) {
        setCpError('CP no encontrado — ingresa estado, ciudad y colonia manualmente');
        setColoniasList([]);
      } else {
        setEstado(result.estado || '');
        setCiudad(result.ciudad || '');
        setColoniasList(result.colonias || []);
        // Si la colonia actual no está en la lista nueva, usar la primera disponible
        if (result.colonias && result.colonias.length > 0 && !result.colonias.includes(coloniaRef.current)) {
          setColonia(result.colonias[0]);
        }
      }
    }, 600);
    return () => clearTimeout(cpTimerRef.current);
  }, [postalCode, auth.token]);

  // Estado para el modal del mapa de pin
  const [showPinMap,   setShowPinMap]   = useState(false);
  const [pinMapResult, setPinMapResult] = useState(null); // { lat, lng } encontrado
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError,   setSearchError]   = useState('');
  const [pinSaving, setPinSaving] = useState(false);
  const pinMapRef = useRef(null);
  const pinMapInstance = useRef(null);
  const pinMarkerRef = useRef(null);

  // Buscar pin por dirección ingresada (Nominatim con countrycodes=mx)
  async function searchPin() {
    const streetAddress = [calle.trim(), numero.trim()].filter(Boolean).join(' ');
    const parts = [streetAddress, colonia, ciudad, estado, postalCode].filter(Boolean);
    if (parts.length === 0) { setSearchError('Ingresa al menos calle o colonia para buscar'); return; }
    setSearchLoading(true);
    setSearchError('');
    try {
      const q = encodeURIComponent(parts.join(', '));
      const r = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${q}&countrycodes=mx&limit=5`,
        { headers: { 'Accept-Language': 'es' } }
      );
      const data = await r.json();
      if (data.length === 0) {
        setSearchError('No se encontró la dirección. El pin se colocó en tu ubicación actual.');
        // Intentar GPS como centro del mapa
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            pos => {
              setPinMapResult({ lat: pos.coords.latitude, lng: pos.coords.longitude });
            },
            () => setPinMapResult(null)
          );
        } else {
          setPinMapResult(null);
        }
        setShowPinMap(true);
      } else {
        const best = data[0];
        setPinMapResult({ lat: parseFloat(best.lat), lng: parseFloat(best.lon) });
        setSearchError('');
        setShowPinMap(true);
      }
    } catch {
      setSearchError('Error al buscar. Verifica tu conexión.');
    } finally {
      setSearchLoading(false);
    }
  }

  // Inicializar mapa Leaflet cuando se abre el modal
  useEffect(() => {
    if (!showPinMap || !pinMapRef.current) return;
    if (typeof window === 'undefined') return;

    const loadLeaflet = async () => {
      ensureLeafletCSS();
      const L = await import('leaflet');
      if (pinMapInstance.current) {
        pinMapInstance.current.remove();
        pinMapInstance.current = null;
      }
      // Centro: resultado de búsqueda, o home pin existente, o CDMX
      const center = pinMapResult
      ? [pinMapResult.lat, pinMapResult.lng]
      : (homeLat && homeLng ? [homeLat, homeLng] : [19.70595, -101.19498]);

      const map = L.map(pinMapRef.current, { center, zoom: pinMapResult ? 17 : 13 });
      pinMapInstance.current = map;
      setTimeout(() => map.invalidateSize(), 50);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
      }).addTo(map);

      // Pin draggable
      const icon = L.divIcon({
        html: '<div style="width:24px;height:24px;border-radius:50%;background:#dc2626;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.4)"></div>',
                             iconSize: [24, 24], iconAnchor: [12, 12], className: ''
      });
      const initPos = pinMapResult ? [pinMapResult.lat, pinMapResult.lng] : center;
      const marker = L.marker(initPos, { icon, draggable: true }).addTo(map);
      pinMarkerRef.current = marker;

      marker.on('dragend', () => {
        const p = marker.getLatLng();
        setPinMapResult({ lat: p.lat, lng: p.lng });
      });
      map.on('click', (e) => {
        marker.setLatLng(e.latlng);
        setPinMapResult({ lat: e.latlng.lat, lng: e.latlng.lng });
      });
    };
    loadLeaflet();
    return () => {
      if (pinMapInstance.current) { pinMapInstance.current.remove(); pinMapInstance.current = null; }
    };
  }, [showPinMap]);

  async function saveProfile() {
    if (!alias.trim()) { setProfileMsg('El nombre no puede estar vacío'); setProfileErr(true); return; }
    try {
      // Combinar calle + número en un solo string de dirección
      const calleVal  = calle.trim();
      const numeroVal = numero.trim();
      const streetAddress = [calleVal, numeroVal].filter(Boolean).join(' ');

      // Construir dirección compuesta si tenemos los campos estructurados
      let finalAddress = streetAddress;
      if (colonia && ciudad && estado) {
        const parts = [colonia, ciudad, estado, postalCode].filter(Boolean);
        finalAddress = finalAddress || parts.join(', ');
      }

      const body = {
        displayName:  alias.trim(),
        address:      finalAddress || undefined,
        postalCode:   postalCode   || undefined,
        colonia:      colonia      || undefined,
        estado:       estado       || undefined,
        ciudad:       ciudad       || undefined,
        homeLat:      homeLat      ?? undefined,
        homeLng:      homeLng      ?? undefined,
      };

      const data = await apiFetch('/auth/profile', { method:'PATCH', body: JSON.stringify(body) }, auth.token);
      patchUser({
        alias:        data.profile.alias ?? data.profile.displayName,
        full_name:    data.profile.alias ?? data.profile.displayName,
        address:      data.profile.address,
        postal_code:  data.profile.postal_code,
        colonia:      data.profile.colonia,
        estado:       data.profile.estado,
        ciudad:       data.profile.ciudad,
        home_lat:     data.profile.home_lat,
        home_lng:     data.profile.home_lng,
      });
      const newAlias = data.profile.alias ?? data.profile.displayName;
      if (newAlias)               setAlias(newAlias);
      if (data.profile.address) {
        const saved  = data.profile.address;
        const calleR = saved.replace(/\s+\d+[a-zA-Z]?\s*$/, '').trim();
        const numR   = saved.match(/\s+(\d+[a-zA-Z]?)\s*$/)?.[1] || '';
        setCalle(calleR);
        setNumero(numR);
        setAddress(saved);
      }
      if (data.profile.home_lat)  setHomeLat(data.profile.home_lat);
      if (data.profile.home_lng)  setHomeLng(data.profile.home_lng);
      setProfileMsg('Perfil actualizado'); setProfileErr(false);
    } catch (e) { setProfileMsg(e.message); setProfileErr(true); }
  }

  async function persistHomePin(lat, lng) {
    setPinSaving(true);
    setProfileMsg('');
    setProfileErr(false);
    try {
      const data = await apiFetch('/auth/profile', {
        method:'PATCH',
        body: JSON.stringify({ homeLat: lat, homeLng: lng })
      }, auth.token);

      patchUser({
        home_lat: data.profile?.home_lat ?? lat ?? null,
        home_lng: data.profile?.home_lng ?? lng ?? null,
      });
      setHomeLat(data.profile?.home_lat ?? lat ?? null);
      setHomeLng(data.profile?.home_lng ?? lng ?? null);
      setProfileMsg('Ubicación de casa guardada');
      setProfileErr(false);
      return true;
    } catch (e) {
      setProfileMsg(e.message || 'No se pudo guardar el pin');
      setProfileErr(true);
      return false;
    } finally {
      setPinSaving(false);
    }
  }

  async function changePasswordAndLogin() {
    if (!currentPassword) { setPwdMsg('Ingresa tu contraseña actual'); setPwdErr(true); return; }
    const changingPwd  = !!newPassword;
    const changingUser = loginUsername.trim() && loginUsername.trim() !== user?.username;
    if (!changingPwd && !changingUser) { setPwdMsg('No hay cambios que guardar'); setPwdErr(false); return; }
    if (changingPwd) {
      if (newPassword !== confirmPassword) { setPwdMsg('Las contraseñas no coinciden'); setPwdErr(true); return; }
      if (newPassword.length < 6) { setPwdMsg('Mínimo 6 caracteres'); setPwdErr(true); return; }
    }
    try {
      if (changingPwd) {
        await apiFetch('/auth/password', { method:'PATCH', body: JSON.stringify({ currentPassword, newPassword }) }, auth.token);
      }
      if (changingUser) {
        await apiFetch('/auth/login-username', { method:'PATCH', body: JSON.stringify({ currentPassword, newUsername: loginUsername.trim() }) }, auth.token);
        patchUser({ username: loginUsername.trim() });
      }
      setPwdMsg(changingPwd && changingUser ? 'Contraseña y usuario actualizados' : changingPwd ? 'Contraseña actualizada' : 'Usuario de acceso actualizado');
      setPwdErr(false);
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    } catch (e) { setPwdMsg(e.message); setPwdErr(true); }
  }

  async function deleteAccount() {
    if (!window.confirm('¿Eliminar tu cuenta permanentemente? Esta acción no se puede deshacer.')) return;
    try {
      await apiFetch('/auth/account', { method:'DELETE' }, auth.token);
      logout();
    } catch (e) { setDeleteMsg(e.message); setDeleteErr(true); }
  }

  const avatarLetter = (alias[0] || '?').toUpperCase();
  const hasHomePin = homeLat && homeLng;

  // ── Perf monitor — solo en dev, sin efecto en producción ──
  useEffect(() => {
    if (import.meta.env.PROD) return;

    // Long Tasks API — detecta bloques del hilo principal > 50ms
    let observer;
    if ('PerformanceObserver' in window) {
      try {
        observer = new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            console.warn(
              `[perf] Long task ${Math.round(entry.duration)}ms`,
                         entry.attribution?.[0]?.name || 'unknown'
            );
          }
        });
        observer.observe({ type: 'longtask', buffered: true });
      } catch (_) {}
    }

    // Frame rate monitor — detecta drops por debajo de 30fps
    let lastFrame = performance.now();
    let rafId;
    function checkFrame(now) {
      const delta = now - lastFrame;
      if (delta > 33) { // < 30fps
        console.warn(`[perf] Frame drop: ${Math.round(delta)}ms (${Math.round(1000/delta)}fps)`);
      }
      lastFrame = now;
      rafId = requestAnimationFrame(checkFrame);
    }
    rafId = requestAnimationFrame(checkFrame);

    return () => {
      observer?.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div>
    <h2 style={{ fontSize:'1.1rem', fontWeight:800, marginBottom:'1.25rem' }}>Mi perfil</h2>

    {/* Tarjeta de cuenta */}
    <div className="card" style={{ marginBottom:'0.75rem', display:'flex', gap:'0.75rem', alignItems:'center' }}>
    <div style={{ width:44, height:44, borderRadius:'50%', background:'var(--brand-light)', border:'2px solid var(--brand)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
    <span style={{ fontWeight:800, fontSize:'1.1rem', color:'var(--brand)' }}>{avatarLetter}</span>
    </div>
    <div>
    <div style={{ fontWeight:700 }}>{alias}</div>
    <div style={{ fontSize:'0.8rem', color:'var(--gray-600)' }}>{ROLE_LABELS[user?.role] || user?.role}</div>
    </div>
    </div>

    {/* Datos personales */}
    <Collapsible title="Datos personales" defaultOpen={false}>
    <p style={{ fontSize:'0.8rem', color:'var(--gray-500)', marginBottom:'0.65rem' }}>
    Este nombre se muestra a otros usuarios en la plataforma.
    </p>
    <div style={{ display:'flex', flexDirection:'column', gap:'0.55rem', marginBottom:'0.65rem' }}>

    <label>
    Nombre para mostrar
    <input value={alias} onChange={e => setAlias(e.target.value)} placeholder="Ej: Juan García" />
    </label>

    {/* Código postal con buscador en mapa */}
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.25rem' }}>
        <span style={{ fontSize:'0.875rem', fontWeight:500 }}>Código postal</span>
        <CPSearchBar onSelectPos={pos => {
          // Solo guardamos lat/lng del centro de zona; el CP se sigue editando a mano en el input de abajo
          setHomeLat(pos.lat); setHomeLng(pos.lng);
        }} />
      </div>
      <div style={{ position:'relative', ...(cpLoading ? BUSY_FIELD_STYLE : {}) }}>
        <input
          value={postalCode}
          onChange={e => setPostalCode(e.target.value.replace(/\D/g, '').slice(0, 5))}
          placeholder="Ej: 58000"
          maxLength={5}
          inputMode="numeric"
        />
        {cpLoading && (
          <span style={{ position:'absolute', right:'0.6rem', top:'50%', transform:'translateY(-50%)', fontSize:'0.75rem', color:'var(--gray-400)' }}>
            Buscando…
          </span>
        )}
      </div>
      {cpError && <span style={{ fontSize:'0.72rem', color:'var(--error)', marginTop:'0.2rem', display:'block' }}>{cpError}</span>}
    </div>

    {/* Estado y Ciudad — auto-rellenados o manuales */}
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.55rem' }}>
    <label>
    Estado
    <input value={estado} onChange={e => setEstado(e.target.value)} placeholder="Michoacán" disabled={cpLoading} />
    </label>
    <label>
    Municipio / Ciudad
    <input value={ciudad} onChange={e => setCiudad(e.target.value)} placeholder="Morelia" disabled={cpLoading} />
    </label>
    </div>

    {/* Colonia — dropdown si hay datos del CP, input manual si no */}
    <label>
    Colonia
    {coloniasList.length > 0 ? (
      <select value={colonia} onChange={e => { setColonia(e.target.value); coloniaRef.current = e.target.value; }} disabled={cpLoading}>
      <option value="">Seleccionar colonia…</option>
      {coloniasList.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
    ) : (
      <input
      value={colonia}
      onChange={e => { setColonia(e.target.value); coloniaRef.current = e.target.value; }}
      placeholder="Ej: Col. Centro"
      disabled={cpLoading}
      />
    )}
    </label>

    {/* Calle y número — dos campos separados */}
    <div style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:'0.55rem', alignItems:'end' }}>
    <label>
    Calle
    <input value={calle} onChange={e => setCalle(e.target.value)}
    placeholder="Ej: Av. Revolución" disabled={searchLoading} />
    </label>
    <label style={{ width:90 }}>
    Número
    <input value={numero} onChange={e => setNumero(e.target.value)}
    placeholder="1234" disabled={searchLoading} />
    </label>
    </div>

    {/* Pin casa — botón buscar + estado + borrar */}
    <div style={{ display:'flex', gap:'0.4rem', alignItems:'center', flexWrap:'wrap' }}>
      <button
        type="button"
        className="btn-sm btn-primary"
        onClick={searchPin}
        disabled={searchLoading || cpLoading || pinSaving}
        style={{ whiteSpace:'nowrap' }}
      >
        {searchLoading ? 'Buscando…' : '📍 Buscar en mapa'}
      </button>
      {hasHomePin && (
        <span style={{ fontSize:'0.75rem', color:'var(--success)', fontWeight:600 }}>🏠 Pin guardado</span>
      )}
      {hasHomePin && (
        <button type="button" disabled={pinSaving}
          onClick={async () => { await persistHomePin(null, null); }}
          style={{ background:'none', border:'none', color:'var(--error)', cursor:'pointer', fontSize:'0.75rem', fontWeight:600, marginLeft:'auto' }}>
          {pinSaving ? 'Borrando…' : 'Borrar'}
        </button>
      )}
    </div>
    {searchError && <span style={{ fontSize:'0.72rem', color:'var(--error)', display:'block' }}>{searchError}</span>}

    {/* Modal mapa pin */}
    {showPinMap && (
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:9999, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'1rem' }}>
      <div style={{ background:'var(--bg-card)', borderRadius:12, width:'100%', maxWidth:480, overflow:'hidden', boxShadow:'0 8px 32px rgba(0,0,0,0.25)' }}>
      <div style={{ padding:'0.75rem 1rem', display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid var(--gray-200)' }}>
      <span style={{ fontWeight:700, fontSize:'0.9rem' }}>Confirmar ubicación</span>
      <button onClick={() => setShowPinMap(false)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'1.2rem', color:'var(--gray-400)' }}>✕</button>
      </div>
      <p style={{ fontSize:'0.78rem', color:'var(--gray-500)', margin:'0.5rem 1rem 0' }}>
      Arrastra el pin o toca el mapa para ajustar la ubicación exacta.
      </p>
      <div ref={pinMapRef} style={{ height:320, width:'100%' }} />
      <div style={{ padding:'0.75rem 1rem', display:'flex', gap:'0.5rem', justifyContent:'flex-end', borderTop:'1px solid var(--gray-200)' }}>
      <button className="btn-sm" onClick={() => setShowPinMap(false)}>Cancelar</button>
      <button className="btn-sm btn-primary" disabled={pinSaving} onClick={async () => {
        if (!pinMapResult) return;
        const saved = await persistHomePin(pinMapResult.lat, pinMapResult.lng);
        if (saved) setShowPinMap(false);
      }}>
      {pinSaving ? 'Guardando…' : 'Confirmar pin'}
      </button>
      </div>
      </div>
      </div>
    )}
    </div>
  <button className="btn-primary btn-sm" onClick={saveProfile}>Guardar cambios</button>
  <Flash text={profileMsg} isError={profileErr} />
  </Collapsible>

  {/* ── Configuración ── */}
  <Collapsible title="Configuración">
  <div style={{ display:'flex', flexDirection:'column', gap:'0.75rem' }}>

    {/* Notificaciones */}
    <div>
      <p style={{ fontSize:'0.72rem', fontWeight:700, color:'var(--text-tertiary)',
        textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'0.4rem' }}>
        Notificaciones
      </p>
      <div style={{ display:'flex', flexDirection:'column', gap:'0.4rem' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:'0.5rem', flexWrap:'wrap' }}>
          <span style={{ fontSize:'0.82rem', color:'var(--gray-600)' }}>
            Push:{' '}
            <strong>
              {notifStatus === 'granted' ? (notifEnabled ? 'Activo' : 'Pausado')
                : notifStatus === 'denied' ? 'Bloqueado'
                : notifStatus === 'default' ? 'Pendiente'
                : 'No soportado'}
            </strong>
          </span>
          <button type="button" className="btn-sm" onClick={toggleNotifEnabled}>
            {notifStatus === 'granted' && notifEnabled ? 'Pausar' : 'Activar'}
          </button>
        </div>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:'0.5rem', flexWrap:'wrap' }}>
          <span style={{ fontSize:'0.82rem', color:'var(--gray-600)' }}>Alta prioridad</span>
          <button type="button" className="btn-sm" onClick={toggleHighPriorityNotifs}>
            {highPriorityNotifs ? 'Activadas' : 'Desactivadas'}
          </button>
        </div>
        {notifMsg && <div style={{ fontSize:'0.74rem', color:'var(--gray-500)' }}>{notifMsg}</div>}
      </div>
    </div>

    {/* Apariencia */}
    <div>
      <p style={{ fontSize:'0.72rem', fontWeight:700, color:'var(--text-tertiary)',
        textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'0.4rem' }}>
        Apariencia
      </p>
      <div style={{ display:'flex', flexDirection:'column', gap:'0.4rem' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:'0.5rem', flexWrap:'wrap' }}>
          <span style={{ fontSize:'0.82rem', color:'var(--gray-600)' }}>Tema</span>
          <div style={{ display:'flex', gap:'0.25rem' }}>
            {[['system','Auto'],['light','Claro'],['dark','Oscuro']].map(([val, label]) => (
              <button key={val} type="button" onClick={() => applyTheme(val)}
                style={{ padding:'0.2rem 0.55rem', fontSize:'0.75rem', cursor:'pointer',
                  border:`1.5px solid ${theme === val ? 'var(--brand)' : 'var(--border)'}`,
                  borderRadius:6,
                  background: theme === val ? 'var(--brand-light)' : 'var(--bg-card)',
                  color: theme === val ? 'var(--brand)' : 'var(--text-secondary)',
                  fontWeight: theme === val ? 700 : 400, minHeight:'unset' }}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:'0.5rem', flexWrap:'wrap' }}>
          <span style={{ fontSize:'0.82rem', color:'var(--gray-600)' }}>Reducir animaciones</span>
          <button type="button" className="btn-sm" onClick={toggleReducedMotion}>
            {reducedMotion ? 'Activado' : 'Desactivado'}
          </button>
        </div>
      </div>
    </div>

    {/* Aplicación (PWA) */}
    <div>
      <p style={{ fontSize:'0.72rem', fontWeight:700, color:'var(--text-tertiary)',
        textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'0.4rem' }}>
        Aplicación
      </p>
      <div style={{ display:'flex', flexDirection:'column', gap:'0.4rem' }}>
        {!isInstalled && deferredInstall && (
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:'0.5rem', flexWrap:'wrap' }}>
            <span style={{ fontSize:'0.82rem', color:'var(--gray-600)' }}>Instalar en pantalla de inicio</span>
            <button type="button" className="btn-sm btn-primary" onClick={triggerInstallPrompt}>
              Instalar
            </button>
          </div>
        )}
        {isInstalled && (
          <div style={{ fontSize:'0.82rem', color:'var(--success)', fontWeight:600 }}>
            ✓ App instalada
          </div>
        )}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:'0.5rem', flexWrap:'wrap' }}>
          <span style={{ fontSize:'0.82rem', color:'var(--gray-600)' }}>Verificar actualización</span>
          <button type="button" className="btn-sm" onClick={refreshOfflineCache}>
            Actualizar
          </button>
        </div>
        {offlineCacheMsg && <div style={{ fontSize:'0.74rem', color:'var(--gray-500)' }}>{offlineCacheMsg}</div>}
      </div>
    </div>

  </div>
  </Collapsible>

  {/* Seguridad */}
  <Collapsible title="Seguridad">
  <p style={{ fontSize:'0.8rem', color:'var(--gray-500)', marginBottom:'0.65rem' }}>
  El usuario de acceso es el que usas para iniciar sesión. Es distinto al nombre que ven otros usuarios.
  </p>
  <div style={{ display:'flex', flexDirection:'column', gap:'0.55rem', marginBottom:'0.65rem' }}>
  <label>
  Usuario de acceso
  <input value={loginUsername} onChange={e => setLoginUsername(e.target.value)}
  placeholder="Ej: juangarcia91" autoComplete="username" />
  </label>
  <label>Contraseña actual (requerida)
  <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)}
  autoComplete="current-password" />
  </label>
  <label>Nueva contraseña (opcional)
  <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
  autoComplete="new-password" placeholder="Dejar vacío para no cambiar" />
  </label>
  {newPassword && (
    <label>Confirmar nueva contraseña
    <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
    autoComplete="new-password" />
    </label>
  )}
  </div>
  <button className="btn-primary btn-sm" onClick={changePasswordAndLogin}>Guardar cambios</button>
  <Flash text={pwdMsg} isError={pwdErr} />
  </Collapsible>

  {/* Cerrar sesión */}
  <button
  onClick={logout}
  className="btn-sm"
  style={{
    width:'100%', padding:'0.7rem',
    marginBottom:'0.75rem',
    fontWeight:700, fontSize:'0.9rem',
  }}
  >
  Cerrar sesión
  </button>

  {/* Administración */}
  <Collapsible title="Administración de cuenta">
  <p style={{ fontSize:'0.85rem', color:'var(--gray-600)', marginBottom:'0.75rem' }}>
  Eliminar tu cuenta es permanente. No podrás recuperarla ni tienes pedidos activos pendientes.
  </p>
  <button className="btn-danger btn-sm" onClick={deleteAccount}>Eliminar cuenta</button>
  <Flash text={deleteMsg} isError={deleteErr} />
  </Collapsible>
  </div>
  );
}
