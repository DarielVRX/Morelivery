import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AUTH_EXPIRED_EVENT, API_BASE } from '../api/client';
import { clearSessionDelivery } from '../utils/sessionDelivery';

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

  const login = useCallback((payload) => setAuth(payload), []);
  const logout = useCallback((reason) => {
    // Limpiar dirección de sesión al salir
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      const token = stored ? JSON.parse(stored)?.token : null;
      if (token) clearSessionDelivery(token);
    } catch (_) {}
    if (reason === 'suspended') {
      // Emitir evento global para que la UI muestre el aviso
      window.dispatchEvent(new CustomEvent('account_suspended'));
    }
    setAuth({ token: '', user: null });
  }, []);

  // Escuchar evento global de token expirado — hacer logout automático
  useEffect(() => {
    function handleExpired() { logout(); }
    window.addEventListener(AUTH_EXPIRED_EVENT, handleExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleExpired);
  }, [logout]);

  // Escuchar account_suspended via SSE — forzar logout con aviso
  useEffect(() => {
    if (!auth.token) return;
    const url = `${API_BASE}/api/events?token=${encodeURIComponent(auth.token)}`;
    // Reutilizar la conexión SSE existente no es posible desde aquí —
    // escuchamos el evento global que dispara CustomerOrders/useRealtimeOrders
    function handleSuspended() { logout('suspended'); }
    window.addEventListener('sse_account_suspended', handleSuspended);
    return () => window.removeEventListener('sse_account_suspended', handleSuspended);
  }, [auth.token, logout]);
  const patchUser = useCallback((patch) =>
    setAuth(prev => ({ ...prev, user: { ...(prev.user || {}), ...patch } }))
  , []);

  const value = useMemo(() => ({ auth, login, logout, patchUser }), [auth, login, logout, patchUser]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

