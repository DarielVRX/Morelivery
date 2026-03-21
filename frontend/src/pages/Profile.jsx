import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { validatePassword, PasswordStrength } from '../utils/passwordUtils.jsx';
import { Collapsible, CPSearchBar, Flash, ROLE_LABELS } from '../features/profile/components';


export default function ProfilePage() {
  const { auth, patchUser, logout } = useAuth();
  const user = auth.user;

  // Datos personales
  const [alias, setAlias] = useState(user?.alias || user?.display_name || user?.full_name || '');
  // Calle y número — desde campos estructurados si existen, fallback a parsear address string
  const _savedAddress = user?.address && user.address !== 'address-pending' ? user.address : '';
  const _hasStructured = !!(user?.calle || user?.numero);
  const _calleInit = user?.calle || (_hasStructured ? '' : _savedAddress.replace(/,\s*\d{5}\s*$/, '').replace(/,\s*[^,]+$/, '').replace(/,\s*[^,]+$/, '').replace(/,\s*[^,]+$/, '').replace(/\s+\d+[a-zA-Z]?\s*$/, '').trim());
  const _numInit   = user?.numero || (_hasStructured ? '' : _savedAddress.match(/\s+(\d+[a-zA-Z]?)\s*(?:,|$)/)?.[1] || '');
  const [calle,  setCalle]  = useState(_calleInit);
  const [numero, setNumero] = useState(_numInit);
  const [profileMsg, setProfileMsg]   = useState('');
  const [profileErr, setProfileErr]   = useState(false);

  // Dirección estructurada
  const [postalCode,   setPostalCode]   = useState(user?.postal_code || '');
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

  const [deleteMsg,      setDeleteMsg]      = useState('');
  const [deleteErr,      setDeleteErr]      = useState(false);
  const [deleteConfirm,  setDeleteConfirm]  = useState(false);
  const [deletePwd,      setDeletePwd]      = useState('');
  const [deleteLoading,  setDeleteLoading]  = useState(false);

  async function deleteAccount() {
    if (!deleteConfirm) { setDeleteConfirm(true); return; }
    if (!deletePwd.trim()) { setDeleteMsg('Ingresa tu contraseña para confirmar'); setDeleteErr(true); return; }
    setDeleteLoading(true);
    try {
      await apiFetch('/auth/account', { method: 'DELETE', body: JSON.stringify({ password: deletePwd }), skipLogoutOn401: true }, auth.token);
    } catch (e) {
      setDeleteMsg(e.message); setDeleteErr(true);
    } finally {
      setDeleteLoading(false);
    }
  }

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
        postalCode:   postalCode   || undefined,
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
      const pwdValidation = validatePassword(newPassword);  // ← agregar
      if (pwdValidation) { setPwdMsg(pwdValidation); setPwdErr(true); return; }  // ← agregar
    }
    try {
      if (changingPwd) {
        await apiFetch('/auth/password', { method:'PATCH', body: JSON.stringify({ currentPassword, newPassword }), skipLogoutOn401: true }, auth.token);
      }
      if (changingUser) {
        await apiFetch('/auth/login-username', { method:'PATCH', body: JSON.stringify({ currentPassword, newUsername: loginUsername.trim() }), skipLogoutOn401: true }, auth.token);
        patchUser({ username: loginUsername.trim() });
      }
      setPwdMsg(changingPwd && changingUser ? 'Contraseña y nombre de usuario actualizados' : changingPwd ? 'Contraseña actualizada' : 'Nombre de usuario actualizado');
      setPwdErr(false);
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      setUsernameStatus('idle');
    } catch (e) { setPwdMsg(e.message); setPwdErr(true); }
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
      <CPSearchBar
        token={auth.token}
        onSelectAddress={({ lat, lng, estado: e, ciudad: c, colonia: col, postalCode: cp }) => {
          if (lat != null)  setHomeLat(lat);
          if (lng != null)  setHomeLng(lng);
          if (e   != null)  setEstado(e);
          if (c   != null)  setCiudad(c);
          if (col != null)  { setColonia(col); coloniaRef.current = col; }
          if (cp  != null)  setPostalCode(cp);
        }}
      />
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
    <>
    <PasswordStrength pwd={newPassword} />
    <label>Confirmar nueva contraseña
    <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
    autoComplete="new-password" />
    </label>
    </>
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
  Eliminar tu cuenta es permanente e irreversible.
  </p>
  {!deleteConfirm ? (
    <button className="btn-danger btn-sm" onClick={deleteAccount}>Eliminar cuenta</button>
  ) : (
    <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
      <p style={{ fontSize:'0.82rem', color:'var(--error)', fontWeight:600, margin:0 }}>
        ¿Seguro? Esta acción no se puede deshacer.
      </p>
      <label style={{ fontSize:'0.82rem' }}>
        Ingresa tu contraseña para confirmar
        <input type="password" value={deletePwd} onChange={e => setDeletePwd(e.target.value)}
          autoComplete="current-password" placeholder="Tu contraseña"
          style={{ marginTop:'0.25rem' }} />
      </label>
      <div style={{ display:'flex', gap:'0.5rem' }}>
        <button className="btn-danger btn-sm" onClick={deleteAccount} disabled={deleteLoading}>
          {deleteLoading ? 'Eliminando…' : 'Confirmar eliminación'}
        </button>
        <button className="btn-sm" onClick={() => { setDeleteConfirm(false); setDeletePwd(''); setDeleteMsg(''); }}>
          Cancelar
        </button>
      </div>
    </div>
  )}
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
