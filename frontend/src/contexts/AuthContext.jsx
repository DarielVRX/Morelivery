import { createContext, useContext, useEffect, useMemo, useState } from 'react';

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

  useEffect(() => {
    if (auth?.token && auth?.user) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, [auth]);

  const value = useMemo(
    () => ({
      auth,
      login: (payload) => setAuth(payload),
      logout: () => setAuth({ token: '', user: null }),
      patchUser: (patch) => setAuth((prev) => ({ ...prev, user: { ...(prev.user || {}), ...patch } }))
    }),
    [auth]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
