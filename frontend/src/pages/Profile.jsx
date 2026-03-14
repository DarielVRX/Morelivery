import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

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

  useEffect(() => { coloniaRef.current = colonia; }, [colonia]);

  // Buscar CP cuando cambia (debounce 600ms)
  useEffect(() => {
    const cp = postalCode.trim();
    if (cp.length !== 5 || !/^\d{5}$/.test(cp)) {
      setCpError('');
      setColoniasList([]);
      return;
    }
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
    <label>
    Código postal
    <div style={{ position:'relative', ...(cpLoading ? BUSY_FIELD_STYLE : {}) }}>
    <input
    value={postalCode}
    onChange={e => setPostalCode(e.target.value.replace(/\D/g, '').slice(0, 5))}
    placeholder="Ej: 44100"
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
    </label>

    {/* Estado y Ciudad — auto-rellenados o manuales */}
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.55rem' }}>
    <label>
    Estado
    <input value={estado} onChange={e => setEstado(e.target.value)} placeholder="Jalisco" disabled={cpLoading} />
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
      <div style={{ display:'flex', gap:'0.4rem', alignItems:'center' }}>
      <select
      value={colonia}
      onChange={e => setColonia(e.target.value)}
      disabled={cpLoading}
      style={{ flex:1 }}
      >
      <option value="">Seleccionar colonia…</option>
      {coloniasList.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      </div>
    ) : (
      <input value={colonia} onChange={e => setColonia(e.target.value)} placeholder="Ej: Col. Centro" />
    )}
    {coloniasList.length > 0 && (
      <span style={{ fontSize:'0.72rem', color:'var(--gray-400)', marginTop:'0.2rem', display:'block' }}>
      O escribe directamente:
      <input
      value={colonia}
      onChange={e => setColonia(e.target.value)}
      disabled={cpLoading}
      placeholder="Colonia manual"
      style={{ marginTop:'0.25rem' }}
      />
      </span>
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


    <div style={{ padding:'0.6rem 0.7rem', border:'1px solid var(--gray-200)', borderRadius:8, background:'#fafafa' }}>
    <div style={{ display:'flex', justifyContent:'space-between', gap:'0.5rem', alignItems:'center', flexWrap:'wrap' }}>
    <span style={{ fontSize:'0.78rem', color:'var(--gray-600)' }}>
    Notificaciones push:{' '}
    <strong>
    {notifStatus === 'granted'
      ? (notifEnabled ? 'Activo' : 'Pausado')
      : notifStatus === 'denied'
      ? 'Bloqueado'
      : notifStatus === 'default'
      ? 'Pendiente'
  : 'No soportado'}
  </strong>
  </span>
  <button type="button" className="btn-sm" onClick={toggleNotifEnabled}>
  {notifStatus === 'granted' && notifEnabled ? 'Pausar notificaciones' : 'Activar notificaciones'}
  </button>
  </div>
  {notifMsg && <div style={{ marginTop:'0.35rem', fontSize:'0.74rem', color:'var(--gray-500)' }}>{notifMsg}</div>}

  <div style={{ marginTop:'0.45rem', display:'flex', justifyContent:'space-between', alignItems:'center', gap:'0.5rem', flexWrap:'wrap' }}>
  <span style={{ fontSize:'0.76rem', color:'var(--gray-600)' }}>Notificaciones de alta prioridad</span>
  <button type="button" className="btn-sm" onClick={toggleHighPriorityNotifs}>
  {highPriorityNotifs ? 'Activadas' : 'Desactivadas'}
  </button>
  </div>
  </div>

  {/* Botón Buscar pin */}
  <div style={{ display:'flex', gap:'0.4rem', alignItems:'center' }}>
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
    <span style={{ fontSize:'0.75rem', color:'var(--success)', fontWeight:600 }}>
    🏠 Pin guardado
    </span>
  )}
  {hasHomePin && (
    <button
    type="button"
    disabled={pinSaving}
    onClick={async () => { await persistHomePin(null, null); }}
    style={{ background:'none', border:'none', color:'var(--error)', cursor:'pointer', fontSize:'0.75rem', fontWeight:600, marginLeft:'auto' }}
    >
    {pinSaving ? 'Borrando…' : 'Borrar'}
    </button>
  )}
  </div>
  {searchError && <span style={{ fontSize:'0.72rem', color:'var(--error)', display:'block' }}>{searchError}</span>}

  {/* Modal mapa pin */}
  {showPinMap && (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:9999, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'1rem' }}>
    <div style={{ background:'#fff', borderRadius:12, width:'100%', maxWidth:480, overflow:'hidden', boxShadow:'0 8px 32px rgba(0,0,0,0.25)' }}>
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
