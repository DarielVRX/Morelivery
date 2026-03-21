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

// ── CP AddressSearchBar — siempre abierto, solo CP numérico ──────────────────
function CPSearchBar({ onSelectPos }) {
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
    setShowMap(false); setResults([]); setInputVal('');
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
        setResults([]); setInputVal('');
        setGpsLoading(false);
      },
      () => setGpsLoading(false),
      { timeout: 6000, maximumAge: 30000 }
    );
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      {/* Barra siempre visible */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px',
        background: 'var(--bg-sunken)', border: '1px solid var(--border)',
        borderRadius: 10, padding: '4px 6px' }}>
        <button type="button" onClick={selectGPS} disabled={gpsLoading}
          title="Usar mi ubicación GPS"
          style={{ background: 'none', border: 'none', cursor: gpsLoading ? 'default' : 'pointer',
            padding: '4px', borderRadius: 6, display: 'flex', alignItems: 'center',
            opacity: gpsLoading ? 0.5 : 1, minHeight: 'unset', flexShrink: 0 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="4.5"/>
            <line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/>
            <line x1="4.22" y1="4.22" x2="6.34" y2="6.34"/><line x1="17.66" y1="17.66" x2="19.78" y2="19.78"/>
            <line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/>
            <line x1="4.22" y1="19.78" x2="6.34" y2="17.66"/><line x1="17.66" y1="6.34" x2="19.78" y2="4.22"/>
          </svg>
        </button>
        <input value={inputVal} inputMode="numeric" maxLength={5}
          onChange={e => doSearch(e.target.value)}
          placeholder="Código postal…"
          style={{ flex: 1, background: 'none', border: 'none', outline: 'none',
            color: 'var(--text-primary)', fontSize: '13px', minWidth: 0 }} />
        {searching && <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', flexShrink: 0 }}>…</span>}
        <button type="button" onClick={() => setShowMap(true)} title="Elegir en mapa"
          style={{ background: 'var(--bg-raised)', border: 'none', cursor: 'pointer',
            padding: '3px 5px', borderRadius: 5, minHeight: 'unset', flexShrink: 0,
            color: 'var(--text-secondary)', display: 'flex', alignItems: 'center' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
            <line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>
          </svg>
        </button>
      </div>

      {/* Dropdown resultados */}
      {results.length > 0 && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', zIndex: 200, overflow: 'hidden' }}>
          {results.map((item, i) => (
            <button type="button" key={i} onClick={() => { onSelectPos(item); setResults([]); setInputVal(''); }}
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

      {/* Modal mapa MapLibre */}
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


export default function ProfilePage() {
  const { auth, patchUser, logout } = useAuth();
  const user = auth.user;

  // Datos personales
  const [alias, setAlias]             = useState(user?.alias || user?.display_name || user?.full_name || '');
  // Descomponer address guardado en calle + número al inicializar
  const _savedAddress = user?.address && user.address !== 'address-pending' ? user.address : '';
  const _calleInit    = _savedAddress.replace(/\s+\d+[a-zA-Z]?\s*$/, '').trim();
  const _numInit      = _savedAddress.match(/\s+(\d+[a-zA-Z]?)\s*$/)?.[1] || '';
  const [calle,   setCalle]   = useState(_calleInit);
  const [numero,  setNumero]  = useState(_numInit);
  const [profileMsg, setProfileMsg]   = useState('');
  const [profileErr, setProfileErr]   = useState(false);

  // Dirección estructurada
  const [estado,       setEstado]       = useState(user?.estado   || '');
  const [ciudad,       setCiudad]       = useState(user?.ciudad   || '');
  const [colonia,      setColonia]      = useState(user?.colonia  || '');
  const [coloniasList, setColoniasList] = useState([]);
  const coloniaRef = useRef(user?.colonia || '');


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
  const [usernameStatus,   setUsernameStatus]   = useState('idle'); // idle | checking | available | taken | error
  const [currentPassword,  setCurrentPassword]  = useState('');
  const [newPassword,      setNewPassword]       = useState('');
  const [confirmPassword,  setConfirmPassword]   = useState('');
  const [pwdMsg,  setPwdMsg]  = useState('');
  const [pwdErr,  setPwdErr]  = useState(false);
  const usernameTimerRef = useRef(null);

  // Eliminar cuenta
  const [deleteMsg, setDeleteMsg] = useState('');
  const [deleteErr, setDeleteErr] = useState(false);

  function handleUsernameChange(val) {
    setLoginUsername(val);
    setUsernameStatus('idle');
    clearTimeout(usernameTimerRef.current);
    const trimmed = val.trim();
    if (!trimmed || trimmed === user?.username) return;
    if (trimmed.length < 3) { setUsernameStatus('error'); return; }
    setUsernameStatus('checking');
    usernameTimerRef.current = setTimeout(async () => {
      try {
        await apiFetch(`/auth/check-username?username=${encodeURIComponent(trimmed)}`, {}, auth.token);
        setUsernameStatus('available');
      } catch (e) {
        setUsernameStatus(e.message?.includes('disponible') || e.message?.includes('taken') ? 'taken' : 'error');
      }
    }, 500);
  }

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
        const parts = [colonia, ciudad, estado].filter(Boolean);
        finalAddress = finalAddress || parts.join(', ');
      }

      const body = {
        displayName:  alias.trim(),
        address:      finalAddress || undefined,
        colonia:      colonia      || undefined,
        estado:       estado       || undefined,
        ciudad:       ciudad       || undefined,
        homeLat:      homeLat      ?? undefined,
        homeLng:      homeLng      ?? undefined,
      };

      const data = await apiFetch('/auth/profile', { method:'PATCH', body: JSON.stringify(body) }, auth.token);
      patchUser({
        alias:     data.profile.alias ?? data.profile.displayName,
        full_name: data.profile.alias ?? data.profile.displayName,
        address:   data.profile.address,
        colonia:   data.profile.colonia,
        estado:    data.profile.estado,
        ciudad:    data.profile.ciudad,
        home_lat:  data.profile.home_lat,
        home_lng:  data.profile.home_lng,
      });
      const newAlias = data.profile.alias ?? data.profile.displayName;
      if (newAlias) setAlias(newAlias);
      if (data.profile.address) {
        const saved  = data.profile.address;
        setCalle(saved.replace(/\s+\d+[a-zA-Z]?\s*$/, '').trim());
        setNumero(saved.match(/\s+(\d+[a-zA-Z]?)\s*$/)?.[1] || '');
      }
      if (data.profile.home_lat) setHomeLat(data.profile.home_lat);
      if (data.profile.home_lng) setHomeLng(data.profile.home_lng);
      setProfileMsg('Perfil actualizado'); setProfileErr(false);
    } catch (e) { setProfileMsg(e.message); setProfileErr(true); }
  }

  async function changePasswordAndLogin() {
    if (!currentPassword) { setPwdMsg('Ingresa tu contraseña actual para confirmar cambios'); setPwdErr(true); return; }
    const changingPwd  = !!newPassword;
    const changingUser = loginUsername.trim() && loginUsername.trim() !== user?.username;
    if (!changingPwd && !changingUser) { setPwdMsg('No hay cambios que guardar'); setPwdErr(false); return; }
    if (changingUser && usernameStatus === 'taken') { setPwdMsg('Ese nombre de usuario ya está en uso'); setPwdErr(true); return; }
    if (changingUser && usernameStatus === 'checking') { setPwdMsg('Espera — verificando disponibilidad del usuario'); setPwdErr(true); return; }
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
      setPwdMsg(changingPwd && changingUser ? 'Contraseña y nombre de usuario actualizados' : changingPwd ? 'Contraseña actualizada' : 'Nombre de usuario actualizado');
      setPwdErr(false);
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      setUsernameStatus('idle');
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

    {/* Código postal */}
    <div>
      <span style={{ fontSize:'0.875rem', fontWeight:500, display:'block', marginBottom:'0.3rem' }}>Código postal</span>
      <CPSearchBar onSelectPos={pos => { setHomeLat(pos.lat); setHomeLng(pos.lng); }} />
    </div>

    {/* Estado y Ciudad — auto-rellenados o manuales */}
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.55rem' }}>
    <label>
    Estado
    <input value={estado} onChange={e => setEstado(e.target.value)} placeholder="Michoacán" />
    </label>
    <label>
    Municipio / Ciudad
    <input value={ciudad} onChange={e => setCiudad(e.target.value)} placeholder="Morelia" />
    </label>
    </div>

    {/* Colonia */}
    <label>
    Colonia
    {coloniasList.length > 0 ? (
      <select value={colonia} onChange={e => { setColonia(e.target.value); coloniaRef.current = e.target.value; }}>
      <option value="">Seleccionar colonia…</option>
      {coloniasList.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
    ) : (
      <input value={colonia} onChange={e => { setColonia(e.target.value); coloniaRef.current = e.target.value; }} placeholder="Ej: Col. Centro" />
    )}
    </label>

    {/* Calle y número */}
    <div style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:'0.55rem', alignItems:'end' }}>
    <label>
    Calle
    <input value={calle} onChange={e => setCalle(e.target.value)} placeholder="Ej: Av. Revolución" />
    </label>
    <label style={{ width:90 }}>
    Número
    <input value={numero} onChange={e => setNumero(e.target.value)} placeholder="1234" />
    </label>
    </div>

    {/* Pin casa — solo estado */}
    {homeLat && homeLng && (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'0.5rem' }}>
        <span style={{ fontSize:'0.75rem', color:'var(--success)', fontWeight:600 }}>🏠 Ubicación guardada</span>
        <button type="button" style={{ background:'none', border:'none', color:'var(--error)', cursor:'pointer', fontSize:'0.75rem', fontWeight:600 }}
          onClick={() => { setHomeLat(null); setHomeLng(null); }}>
          Borrar
        </button>
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
  El nombre de usuario es público y visible en la plataforma. La contraseña protege el acceso a tu cuenta.
  </p>
  <div style={{ display:'flex', flexDirection:'column', gap:'0.55rem', marginBottom:'0.65rem' }}>
  <div>
    <label style={{ display:'block', marginBottom:'0.25rem' }}>
      Nombre de usuario
    </label>
    <div style={{ position:'relative' }}>
      <input value={loginUsername} onChange={e => handleUsernameChange(e.target.value)}
        placeholder="Ej: juangarcia91" autoComplete="username"
        style={{ paddingRight: '2.2rem' }} />
      {usernameStatus === 'checking' && (
        <span style={{ position:'absolute', right:'0.6rem', top:'50%', transform:'translateY(-50%)', fontSize:'0.72rem', color:'var(--text-tertiary)' }}>…</span>
      )}
      {usernameStatus === 'available' && (
        <span style={{ position:'absolute', right:'0.6rem', top:'50%', transform:'translateY(-50%)', fontSize:'0.8rem', color:'var(--success)' }}>✓</span>
      )}
      {usernameStatus === 'taken' && (
        <span style={{ position:'absolute', right:'0.6rem', top:'50%', transform:'translateY(-50%)', fontSize:'0.8rem', color:'var(--error)' }}>✗</span>
      )}
    </div>
    {usernameStatus === 'taken' && (
      <span style={{ fontSize:'0.72rem', color:'var(--error)', marginTop:'0.2rem', display:'block' }}>Ese nombre ya está en uso</span>
    )}
    {usernameStatus === 'error' && loginUsername.trim().length < 3 && (
      <span style={{ fontSize:'0.72rem', color:'var(--error)', marginTop:'0.2rem', display:'block' }}>Mínimo 3 caracteres</span>
    )}
  </div>
  <label>Contraseña actual <span style={{ fontWeight:400, color:'var(--text-tertiary)', fontSize:'0.78rem' }}>(requerida para guardar cambios)</span>
  <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)}
  autoComplete="current-password" />
  </label>
  <label>Nueva contraseña <span style={{ fontWeight:400, color:'var(--text-tertiary)', fontSize:'0.78rem' }}>(opcional)</span>
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
  <button className="btn-primary btn-sm" onClick={changePasswordAndLogin}
    disabled={usernameStatus === 'checking' || usernameStatus === 'taken'}>
    Guardar cambios
  </button>
  <Flash text={pwdMsg} isError={pwdErr} />
  </Collapsible>

  {/* Administración */}
  <Collapsible title="Administración de cuenta">
  <p style={{ fontSize:'0.85rem', color:'var(--gray-600)', marginBottom:'0.75rem' }}>
  Eliminar tu cuenta es permanente. No podrás recuperarla ni tienes pedidos activos pendientes.
  </p>
  <button className="btn-danger btn-sm" onClick={deleteAccount}>Eliminar cuenta</button>
  <Flash text={deleteMsg} isError={deleteErr} />
  </Collapsible>

  {/* Cerrar sesión — al fondo */}
  <button
  onClick={logout}
  className="btn-sm"
  style={{
    width:'100%', padding:'0.7rem',
    marginTop:'0.25rem', marginBottom:'0.75rem',
    fontWeight:700, fontSize:'0.9rem',
  }}
  >
  Cerrar sesión
  </button>
  </div>
  );
}
