import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AUTH_EXPIRED_EVENT } from '../api/client';

// ── Suscripción push al iniciar sesión ────────────────────────────────────────
async function subscribePushForUser(token) {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (Notification.permission !== 'granted') return;
    const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
    if (!vapidKey) return;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const padding = '='.repeat((4 - vapidKey.length % 4) % 4);
      const base64  = (vapidKey + padding).replace(/-/g, '+').replace(/_/g, '/');
      const raw     = atob(base64);
      const key     = Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    }
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(sub.toJSON()),
    });
  } catch (_) {}
}

const AuthContext = createContext(null);
const STORAGE_KEY = 'morelivery_auth_v1';

function loadStoredAuth() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { token: '', user: null };
    const parsed = JSON.parse(raw);
    if (!parsed?.token || !parsed?.user) return { token: '', user: null };
    return parsed;
  } catch {
    return { token: '', user: null };
  }
}

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(() => loadStoredAuth());
  const persistTimer = useRef(null);

  // Re-suscribir push en sesiones previas (usuario ya tenía sesión al cargar la app)
  const pushSubscribed = useRef(false);
  useEffect(() => {
    if (!auth.token || pushSubscribed.current) return;
    pushSubscribed.current = true;
    subscribePushForUser(auth.token);
  }, [auth.token]);

  // Escritura a localStorage diferida \u2014 evita bloquear el hilo principal en cada keystroke
  // (el AuthContext re-renderiza cuando cambia auth.user, y antes escrib\u00eda a localStorage en cada render)
  useEffect(() => {
    clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      try {
        if (auth?.token && auth?.user) {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
        } else {
          window.localStorage.removeItem(STORAGE_KEY);
        }
      } catch (_) {}
    }, 300);
    return () => clearTimeout(persistTimer.current);
  }, [auth]);

  const login = useCallback((payload) => {
    setAuth(payload);
    // Suscribir push inmediatamente al iniciar sesión
    if (payload?.token) {
      // Pequeño delay para que el SW esté listo tras el primer login
      setTimeout(() => subscribePushForUser(payload.token), 1500);
    }
  }, []);

  // patchUser declarado ANTES de cualquier useEffect que lo use
  const patchUser = useCallback((patch) =>
    setAuth(prev => ({ ...prev, user: { ...(prev.user || {}), ...patch } }))
  , []);

  const logout = useCallback(() => {
    // Limpiar dirección de sesión al salir — import dinámico para evitar circular
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      const token = stored ? JSON.parse(stored)?.token : null;
      if (token) {
        import('../utils/sessionDelivery').then(({ clearSessionDelivery }) => {
          clearSessionDelivery(token);
        }).catch(() => {});
      }
    } catch (_) {}
    setAuth({ token: '', user: null });
  }, []);

  // Escuchar evento global de token expirado — hacer logout automático
  useEffect(() => {
    function handleExpired() { logout(); }
    window.addEventListener(AUTH_EXPIRED_EVENT, handleExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleExpired);
  }, [logout]);

  // Escuchar orders_blocked via SSE — marcar en el user object para bloquear UI
  useEffect(() => {
    function handleBlocked(e) {
      patchUser({ orders_blocked: true, orders_blocked_reason: e.detail?.reason || 'late_cancellation' });
    }
    window.addEventListener('sse_orders_blocked', handleBlocked);
    return () => window.removeEventListener('sse_orders_blocked', handleBlocked);
  }, [patchUser]);

  const value = useMemo(() => ({ auth, login, logout, patchUser }), [auth, login, logout, patchUser]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}


