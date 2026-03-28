import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AUTH_EXPIRED_EVENT } from '../api/client';

// ── Helpers ───────────────────────────────────────────────────────────────────
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

// ── Suscripción push ──────────────────────────────────────────────────────────
async function subscribePushForUser(token) {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (Notification.permission !== 'granted') return;
    const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
    if (!vapidKey) return;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
    }
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(sub.toJSON()),
    });
  } catch (_) {}
}

// ── Prompt de notificaciones ──────────────────────────────────────────────────
function showNotificationPrompt(role) {
  return new Promise(resolve => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const bg     = isDark ? '#1a1a1a' : '#ffffff';
    const text   = isDark ? '#f3f4f6' : '#1f2937';
    const sub    = isDark ? '#9ca3af' : '#6b7280';
    const brand  = '#c97f7f';

    const bodyText = role === 'driver'
      ? 'Recibe alertas de nuevas ofertas, actualizaciones de pedido y mensajes — incluso con la app en segundo plano.'
      : role === 'restaurant'
      ? 'Recibe alertas de pedidos nuevos, confirmaciones y cambios de estado en tiempo real.'
      : 'Recibe actualizaciones de tu pedido y mensajes del conductor en tiempo real.';

    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:9999;
      background:rgba(0,0,0,0.55);
      display:flex;align-items:flex-end;justify-content:center;
      padding:0 0 env(safe-area-inset-bottom,0px) 0;
      font-family:system-ui,-apple-system,sans-serif;
    `;
    overlay.innerHTML = `
      <div style="
        background:${bg};border-radius:18px 18px 0 0;
        padding:1.5rem 1.25rem 1.75rem;width:100%;max-width:480px;
        box-shadow:0 -4px 32px rgba(0,0,0,0.3);
      ">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="${brand}"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
          style="display:block;margin:0 auto 0.75rem">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        <h3 style="font-size:1.05rem;font-weight:800;text-align:center;margin:0 0 0.4rem;color:${text}">
          Activar notificaciones
        </h3>
        <p style="font-size:0.875rem;color:${sub};text-align:center;margin:0 0 1.25rem;line-height:1.5">
          ${bodyText}
        </p>
        <div style="display:flex;flex-direction:column;gap:0.6rem">
          <button id="notif-yes" style="
            background:${brand};color:#fff;border:none;border-radius:10px;
            padding:0.75rem;font-size:0.95rem;font-weight:700;cursor:pointer;
          ">Activar notificaciones</button>
          <button id="notif-no" style="
            background:none;border:none;color:${sub};
            padding:0.5rem;font-size:0.875rem;cursor:pointer;
          ">Ahora no</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#notif-yes').onclick = () => { document.body.removeChild(overlay); resolve(true); };
    overlay.querySelector('#notif-no').onclick  = () => { document.body.removeChild(overlay); resolve(false); };
  });
}

// ── Solicitar permiso según rol ───────────────────────────────────────────────
// driver/restaurant: siempre que no sea granted, incluyendo periódicamente (1/día)
// customer: cada login si no es granted
const NOTIF_LAST_PROMPT_KEY = (userId) => `notif_last_prompt_${userId}`;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

async function requestNotificationsForUser(token, userId, role) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'denied') return;

  if (Notification.permission === 'granted') {
    await subscribePushForUser(token);
    return;
  }

  // driver/restaurant: respetar el intervalo de 1 día para no ser invasivo
  if (role === 'driver' || role === 'restaurant') {
    try {
      const last = parseInt(localStorage.getItem(NOTIF_LAST_PROMPT_KEY(userId)) || '0', 10);
      if (Date.now() - last < ONE_DAY_MS) return;
    } catch (_) {}
  }
  // customer: sin restricción de tiempo — se pide en cada login

  // Esperar primera interacción (requerido iOS 16.4+), timeout 10s
  await new Promise(resolve => {
    const handler = () => {
      window.removeEventListener('pointerdown', handler);
      window.removeEventListener('keydown',     handler);
      resolve();
    };
    window.addEventListener('pointerdown', handler, { once: true });
    window.addEventListener('keydown',     handler, { once: true });
    setTimeout(resolve, 10000);
  });

  await new Promise(r => setTimeout(r, 800));

  // Guardar timestamp ANTES de mostrar — así si el usuario cierra la app no se pierde
  if (role === 'driver' || role === 'restaurant') {
    try { localStorage.setItem(NOTIF_LAST_PROMPT_KEY(userId), String(Date.now())); } catch (_) {}
  }

  const accepted = await showNotificationPrompt(role);
  if (!accepted) return;

  try {
    const result = await Notification.requestPermission();
    if (result === 'granted') {
      try { localStorage.setItem('morelivery_notif_enabled', '1'); } catch (_) {}
      await subscribePushForUser(token);
    }
  } catch (_) {}
}

// ── Context ───────────────────────────────────────────────────────────────────
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
  const [auth, setAuth]  = useState(() => loadStoredAuth());
  const persistTimer     = useRef(null);
  const promptScheduled  = useRef(false);

  function scheduleNotifRequest(token, user) {
    if (!token || !user) return;
    if (promptScheduled.current) return;
    promptScheduled.current = true;
    setTimeout(() => {
      requestNotificationsForUser(token, user.id, user.role)
        .finally(() => { promptScheduled.current = false; });
    }, 1500);
  }

  // Al cargar con sesión existente
  useEffect(() => {
    if (auth.token && auth.user) scheduleNotifRequest(auth.token, auth.user);
  }, []); // eslint-disable-line

  // Verificación periódica cada hora — muestra el prompt solo si pasó 1 día
  useEffect(() => {
    if (!auth.token || !auth.user) return;
    const interval = setInterval(() => {
      scheduleNotifRequest(auth.token, auth.user);
    }, 60 * 60 * 1000); // check cada hora, el throttle interno es 1 día
    return () => clearInterval(interval);
  }, [auth.token, auth.user?.id]); // eslint-disable-line

  // Escritura a localStorage diferida
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
    if (payload?.token && payload?.user) {
      promptScheduled.current = false;
      scheduleNotifRequest(payload.token, payload.user);
    }
  }, []); // eslint-disable-line

  const patchUser = useCallback((patch) =>
    setAuth(prev => ({ ...prev, user: { ...(prev.user || {}), ...patch } }))
  , []);

  const logout = useCallback(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      const token  = stored ? JSON.parse(stored)?.token : null;
      if (token) {
        import('../utils/sessionDelivery').then(({ clearSessionDelivery }) => {
          clearSessionDelivery(token);
        }).catch(() => {});
      }
    } catch (_) {}
    promptScheduled.current = false;
    setAuth({ token: '', user: null });
  }, []);

  useEffect(() => {
    function handleExpired() { logout(); }
    window.addEventListener(AUTH_EXPIRED_EVENT, handleExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleExpired);
  }, [logout]);

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
