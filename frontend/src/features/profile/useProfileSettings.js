import { useEffect, useState } from 'react';

import { usePermissions } from '../../hooks/usePermissions';
import { brandStorageKey } from '../../config/brand';

export function useProfileSettings(token, role) {
  const {
    status: permStatus,
    loading: permLoading,
    msg: permMsg,
    requestAll: requestAllPermissions,
    requestWakeLock,
  } = usePermissions(token, role);

  const notifStatus = permStatus.notifications;
  const [notifMsg, setNotifMsg] = useState('');
  const [highPriorityNotifs, setHighPriorityNotifs] = useState(() => {
    try { return localStorage.getItem(brandStorageKey('notif_priority')) === 'high'; } catch { return false; }
  });
  const [notifEnabled, setNotifEnabled] = useState(() => {
    try { return localStorage.getItem(brandStorageKey('notif_enabled')) !== '0'; } catch { return true; }
  });
  const [deferredInstall, setDeferredInstall] = useState(null);
  const [isInstalled, setIsInstalled] = useState(
    typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches
  );
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem(brandStorageKey('theme')) || 'system'; } catch { return 'system'; }
  });
  const [reducedMotion, setReducedMotion] = useState(() => {
    try { return localStorage.getItem(brandStorageKey('reduced_motion')) === '1'; } catch { return false; }
  });
  const [offlineCacheMsg, setOfflineCacheMsg] = useState('');

  useEffect(() => {
    const handler = (event) => {
      event.preventDefault();
      setDeferredInstall(event);
    };
    window.addEventListener('beforeinstallprompt', handler);
    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const mqHandler = (event) => setIsInstalled(event.matches);
    mediaQuery.addEventListener('change', mqHandler);
    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      mediaQuery.removeEventListener('change', mqHandler);
    };
  }, []);

  function applyTheme(value) {
    setTheme(value);
    try { localStorage.setItem(brandStorageKey('theme'), value); } catch (_) {}
    const root = document.documentElement;
    if (value === 'dark') root.setAttribute('data-theme', 'dark');
    else if (value === 'light') root.removeAttribute('data-theme');
    else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (prefersDark) root.setAttribute('data-theme', 'dark');
      else root.removeAttribute('data-theme');
    }
  }

  function toggleReducedMotion() {
    setReducedMotion((previous) => {
      const next = !previous;
      try { localStorage.setItem(brandStorageKey('reduced_motion'), next ? '1' : '0'); } catch (_) {}
      document.documentElement.style.setProperty('--transition-speed', next ? '0ms' : '');
      return next;
    });
  }

  async function triggerInstallPrompt() {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    const { outcome } = await deferredInstall.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredInstall(null);
    }
  }

  async function refreshOfflineCache() {
    setOfflineCacheMsg('');
    if (!('serviceWorker' in navigator)) {
      setOfflineCacheMsg('Service Worker no disponible en este navegador.');
      return;
    }
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration?.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        setOfflineCacheMsg('Actualización aplicada. Recarga para ver cambios.');
      } else if (registration) {
        await registration.update();
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
    setHighPriorityNotifs((previous) => {
      const next = !previous;
      try { localStorage.setItem(brandStorageKey('notif_priority'), next ? 'high' : 'normal'); } catch (_) {}
      return next;
    });
  }

  function toggleNotifEnabled() {
    if (notifStatus !== 'granted') {
      enablePushNotifications();
      return;
    }
    setNotifEnabled((previous) => {
      const next = !previous;
      try { localStorage.setItem(brandStorageKey('notif_enabled'), next ? '1' : '0'); } catch (_) {}
      setNotifMsg(next ? 'Notificaciones activas.' : 'Notificaciones pausadas para este dispositivo.');
      return next;
    });
  }

  return {
    permStatus,
    permLoading,
    permMsg,
    requestAllPermissions,
    requestWakeLock,
    notifStatus,
    notifMsg,
    notifEnabled,
    highPriorityNotifs,
    deferredInstall,
    isInstalled,
    theme,
    reducedMotion,
    offlineCacheMsg,
    applyTheme,
    toggleReducedMotion,
    triggerInstallPrompt,
    refreshOfflineCache,
    toggleHighPriorityNotifs,
    toggleNotifEnabled,
  };
}
