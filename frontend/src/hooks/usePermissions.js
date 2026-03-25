// frontend/src/hooks/usePermissions.js
//
// Gestiona todos los permisos necesarios para el funcionamiento óptimo
// de la app como PWA en móvil:
//
//   - Notificaciones push (con suscripción VAPID)
//   - Geolocalización
//   - Persistent storage (evita que el OS elimine el SW en móvil)
//   - Wake lock (pantalla activa para drivers en ruta)
//   - Clipboard, Battery, Network Information
//
// Se llama desde App.jsx al detectar sesión activa por primera vez,
// y desde Profile.jsx para mostrar el estado actual y permitir reactivar.

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api/client';

const STORAGE_KEY   = 'morelivery_perms_requested';
const VAPID_PUB_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

// Convierte la VAPID public key de base64url a Uint8Array
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = window.atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

// ── Suscripción VAPID push ────────────────────────────────────────────────────
async function subscribeToPush(token) {
  if (!VAPID_PUB_KEY) {
    console.warn('[perms] VITE_VAPID_PUBLIC_KEY no definida — push subscription omitida');
    return null;
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    // Si ya hay suscripción activa, reutilizarla
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUB_KEY),
      });
    }
    // Enviar al backend para guardar/actualizar
    await apiFetch('/push/subscribe', {
      method: 'POST',
      body:   JSON.stringify(sub.toJSON()),
    }, token);
    return sub;
  } catch (e) {
    console.warn('[perms] push subscription error:', e.message);
    return null;
  }
}

// ── Nuevos permisos ───────────────────────────────────────────────────────────
export async function requestClipboardPermission() {
  if (!navigator.clipboard?.read) return 'unsupported';
  try {
    // Intenta leer texto vacío para solicitar permiso (navegadores modernos piden)
    await navigator.clipboard.readText();
    return 'granted';
  } catch (e) {
    if (e.name === 'NotAllowedError') return 'denied';
    if (e.name === 'NotFoundError') return 'empty';
    return 'error';
  }
}

export async function getBatteryStatus() {
  if (!('getBattery' in navigator)) return null;
  try {
    const battery = await navigator.getBattery();
    return {
      level: battery.level,
      charging: battery.charging,
      chargingTime: battery.chargingTime,
      dischargingTime: battery.dischargingTime,
    };
  } catch {
    return null;
  }
}

export function getNetworkInfo() {
  if (!('connection' in navigator)) return null;
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  return {
    type: conn.type,
    effectiveType: conn.effectiveType,
    downlink: conn.downlink,
    rtt: conn.rtt,
    saveData: conn.saveData,
  };
}

// ── Wake Lock con persistencia mejorada ───────────────────────────────────────
function setupWakeLockPersistence(wakeLockRef, setStatus) {
  // Re-adquirir cuando la página se vuelve visible O cuando la pantalla se desbloquea
  const reacquire = () => {
    if (document.visibilityState === 'visible' && !wakeLockRef.current) {
      navigator.wakeLock?.request('screen').then(lock => {
        wakeLockRef.current = lock;
        setStatus(s => ({ ...s, wakeLock: 'active' }));
        lock.addEventListener('release', () => {
          wakeLockRef.current = null;
          setStatus(s => ({ ...s, wakeLock: 'supported' }));
        });
      }).catch(() => {});
    }
  };

  document.addEventListener('visibilitychange', reacquire);
  // pageshow se dispara cuando la pantalla se desbloquea/la app vuelve de background
  window.addEventListener('pageshow', reacquire);
  // También cuando la pantalla se apaga/enciende (via pagehide)
  window.addEventListener('pagehide', () => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
    }
  });

  return () => {
    document.removeEventListener('visibilitychange', reacquire);
    window.removeEventListener('pageshow', reacquire);
    window.removeEventListener('pagehide', () => {});
  };
}

// ── Estado de cada permiso ────────────────────────────────────────────────────
function getInitialState() {
  return {
    notifications: typeof window !== 'undefined' && 'Notification' in window
    ? Notification.permission   // 'default' | 'granted' | 'denied'
    : 'unsupported',
    geolocation: typeof navigator !== 'undefined' && 'geolocation' in navigator
    ? 'unknown'                 // no hay API síncrona para leer el estado
    : 'unsupported',
    persistentStorage: 'unknown',
    wakeLock: typeof navigator !== 'undefined' && 'wakeLock' in navigator
    ? 'supported'
    : 'unsupported',
    clipboard: 'unknown',
    battery: null,
    network: null,
  };
}

// ── Hook principal ────────────────────────────────────────────────────────────
export function usePermissions(token, role) {
  const [status,   setStatus]   = useState(getInitialState);
  const [loading,  setLoading]  = useState(false);
  const [msg,      setMsg]      = useState('');
  const wakeLockRef = useRef(null);

  // Leer estado de persistent storage al montar
  useEffect(() => {
    if (!navigator.storage?.persisted) return;
    navigator.storage.persisted().then(persisted => {
      setStatus(s => ({ ...s, persistentStorage: persisted ? 'granted' : 'default' }));
    }).catch(() => {});
  }, []);

  // Leer network info (no es asíncrono)
  useEffect(() => {
    const updateNetwork = () => setStatus(s => ({ ...s, network: getNetworkInfo() }));
    updateNetwork();
    const conn = navigator.connection;
    if (conn) {
      conn.addEventListener('change', updateNetwork);
      return () => conn.removeEventListener('change', updateNetwork);
    }
  }, []);

  // ── Solicitar todos los permisos en secuencia ─────────────────────────────
  const requestAll = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setMsg('');

    // 1. Service Worker — base para notificaciones y push
    let reg = null;
    try {
      reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
    } catch (e) {
      console.warn('[perms] SW registration failed:', e.message);
    }

    // 2. Notificaciones
    let notifResult = Notification.permission;
    if (notifResult === 'default' && 'Notification' in window) {
      try {
        notifResult = await Notification.requestPermission();
      } catch (_) {}
    }
    setStatus(s => ({ ...s, notifications: notifResult }));

    // 3. Push subscription VAPID (solo si notificaciones granted)
    if (notifResult === 'granted' && reg && token) {
      await subscribeToPush(token);
      try { localStorage.setItem('morelivery_notif_enabled', '1'); } catch (_) {}
    }

    // 4. Geolocalización — crítico para driver, útil para customer
    if ('geolocation' in navigator) {
      try {
        // Usar permissions API si está disponible (no pide prompt, solo lee estado)
        if (navigator.permissions?.query) {
          const perm = await navigator.permissions.query({ name: 'geolocation' });
          if (perm.state === 'prompt') {
            // Solicitar explícitamente solo si no se ha decidido
            await new Promise((resolve) => {
              navigator.geolocation.getCurrentPosition(
                () => { setStatus(s => ({ ...s, geolocation: 'granted' })); resolve(); },
                                                       (err) => {
                                                         const state = err.code === 1 ? 'denied' : 'error';
                                                         setStatus(s => ({ ...s, geolocation: state }));
                                                         resolve();
                                                       },
                                                       { timeout: 8000, maximumAge: 60000 }
              );
            });
          } else {
            setStatus(s => ({ ...s, geolocation: perm.state }));
          }
        }
      } catch (_) {}
    }

    // 5. Persistent storage — evita que Android elimine el cache del SW
    if (navigator.storage?.persist) {
      try {
        const granted = await navigator.storage.persist();
        setStatus(s => ({ ...s, persistentStorage: granted ? 'granted' : 'denied' }));
      } catch (_) {}
    }

    // 6. Clipboard (solo verificar estado, no pedir automáticamente)
    const clipStatus = await requestClipboardPermission();
    setStatus(s => ({ ...s, clipboard: clipStatus }));

    // 7. Battery (no requiere permiso, solo lectura)
    const battery = await getBatteryStatus();
    setStatus(s => ({ ...s, battery }));

    // Marcar como solicitado para no volver a pedir automáticamente
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch (_) {}

    setLoading(false);
    setMsg('Permisos configurados.');
    setTimeout(() => setMsg(''), 3000);
  }, [token, role]);

  // ── Wake lock — activar/desactivar manualmente (solo para drivers) ─────────
  const requestWakeLock = useCallback(async () => {
    if (!('wakeLock' in navigator)) return;
    try {
      if (wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
        setStatus(s => ({ ...s, wakeLock: 'released' }));
      } else {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        setStatus(s => ({ ...s, wakeLock: 'active' }));
        wakeLockRef.current.addEventListener('release', () => {
          wakeLockRef.current = null;
          setStatus(s => ({ ...s, wakeLock: 'supported' }));
        });
      }
    } catch (e) {
      console.warn('[perms] wake lock error:', e.message);
    }
  }, []);

  // Re-adquirir wake lock si la página vuelve a ser visible (iOS/Android la libera al minimizar)
  useEffect(() => {
    if (status.wakeLock !== 'active') return;
    const cleanup = setupWakeLockPersistence(wakeLockRef, setStatus);
    return cleanup;
  }, [status.wakeLock]);

  // ── Auto-request al primer login (una sola vez) ───────────────────────────
  const autoRequested = useRef(false);
  useEffect(() => {
    if (!token) return;
    if (autoRequested.current) return;
    try {
      if (localStorage.getItem(STORAGE_KEY) === '1') return;
    } catch (_) {}

    // Esperar interacción del usuario antes de pedir (requerido en móvil)
    function onInteraction() {
      if (autoRequested.current) return;
      autoRequested.current = true;
      requestAll();
      window.removeEventListener('pointerdown', onInteraction);
      window.removeEventListener('keydown',     onInteraction);
    }
    window.addEventListener('pointerdown', onInteraction, { once: true });
    window.addEventListener('keydown',     onInteraction, { once: true });
    return () => {
      window.removeEventListener('pointerdown', onInteraction);
      window.removeEventListener('keydown',     onInteraction);
    };
  }, [token, requestAll]);

  return {
    status,           // estado de cada permiso
    loading,          // true mientras se están pidiendo
    msg,              // mensaje de feedback
    requestAll,       // llamar manualmente desde Profile
    requestWakeLock,  // toggle wake lock (solo drivers)
    subscribeToPush:  () => subscribeToPush(token), // re-suscribir si expiró
    // Funciones auxiliares para consultar estado actual de nuevos permisos
    getClipboardStatus: () => requestClipboardPermission(),
    getBatteryStatus:   () => getBatteryStatus(),
    getNetworkInfo:     () => getNetworkInfo(),
  };
}
