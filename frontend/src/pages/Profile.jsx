import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { validatePassword } from '../utils/passwordUtils.jsx';
import { AccountManagementSection, PersonalInfoSection, ProfileHeaderCard, ProfileSecuritySection, ProfileSettingsSection } from '../features/profile/sections';
import { usePermissions } from '../hooks/usePermissions';


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


  const {
    status:          permStatus,
    loading:         permLoading,
    msg:             permMsg,
    requestAll:      requestAllPermissions,
    requestWakeLock,
  } = usePermissions(auth.token, user?.role);

  const notifStatus = permStatus.notifications;
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
    await requestAllPermissions();
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
      const pwdValidation = validatePassword(newPassword);
      if (pwdValidation) { setPwdMsg(pwdValidation); setPwdErr(true); return; }
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

      <ProfileHeaderCard alias={alias} avatarLetter={avatarLetter} role={user?.role} />

      <PersonalInfoSection
        authToken={auth.token}
        alias={alias}
        setAlias={setAlias}
        homeLat={homeLat}
        homeLng={homeLng}
        onSelectAddress={({ lat, lng, estado: nextEstado, ciudad: nextCiudad, colonia: nextColonia, postalCode: cp, colonias }) => {
          if (lat != null) setHomeLat(lat);
          if (lng != null) setHomeLng(lng);
          if (nextEstado != null) setEstado(nextEstado);
          if (nextCiudad != null) setCiudad(nextCiudad);
          if (nextColonia != null && nextColonia !== '') setColonia(nextColonia);
          if (cp != null) setPostalCode(cp);
          if (colonias?.length) setColoniasList(colonias);
        }}
        estado={estado}
        setEstado={setEstado}
        ciudad={ciudad}
        setCiudad={setCiudad}
        colonia={colonia}
        setColonia={setColonia}
        coloniasList={coloniasList}
        calle={calle}
        setCalle={setCalle}
        numero={numero}
        setNumero={setNumero}
        onClearHomePin={() => { setHomeLat(null); setHomeLng(null); }}
        onSave={saveProfile}
        message={profileMsg}
        isError={profileErr}
      />

      <ProfileSettingsSection
        userRole={user?.role}
        permStatus={permStatus}
        permLoading={permLoading}
        permMsg={permMsg}
        notifStatus={notifStatus}
        notifEnabled={notifEnabled}
        highPriorityNotifs={highPriorityNotifs}
        notifMsg={notifMsg}
        onToggleNotifEnabled={toggleNotifEnabled}
        onToggleHighPriority={toggleHighPriorityNotifs}
        onRequestWakeLock={requestWakeLock}
        onRequestAllPermissions={requestAllPermissions}
        theme={theme}
        onApplyTheme={applyTheme}
        reducedMotion={reducedMotion}
        onToggleReducedMotion={toggleReducedMotion}
        isInstalled={isInstalled}
        deferredInstall={deferredInstall}
        onTriggerInstallPrompt={triggerInstallPrompt}
        onRefreshOfflineCache={refreshOfflineCache}
        offlineCacheMsg={offlineCacheMsg}
      />

      <ProfileSecuritySection
        loginUsername={loginUsername}
        onChangeUsername={handleUsernameChange}
        usernameStatus={usernameStatus}
        currentPassword={currentPassword}
        setCurrentPassword={setCurrentPassword}
        newPassword={newPassword}
        setNewPassword={setNewPassword}
        confirmPassword={confirmPassword}
        setConfirmPassword={setConfirmPassword}
        onSave={changePasswordAndLogin}
        message={pwdMsg}
        isError={pwdErr}
      />

      <AccountManagementSection
        deleteConfirm={deleteConfirm}
        onDeleteAccount={deleteAccount}
        deletePwd={deletePwd}
        setDeletePwd={setDeletePwd}
        deleteLoading={deleteLoading}
        onCancelDelete={() => { setDeleteConfirm(false); setDeletePwd(''); setDeleteMsg(''); }}
        message={deleteMsg}
        isError={deleteErr}
      />

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
