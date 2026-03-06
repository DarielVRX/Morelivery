import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

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
  const logout = useCallback(() => setAuth({ token: '', user: null }), []);
  const patchUser = useCallback((patch) =>
    setAuth(prev => ({ ...prev, user: { ...(prev.user || {}), ...patch } }))
  , []);

  const value = useMemo(() => ({ auth, login, logout, patchUser }), [auth, login, logout, patchUser]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
