import { createContext, useContext, useMemo, useState } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState({ token: '', user: null });

  const value = useMemo(
    () => ({
      auth,
      login: (payload) => setAuth(payload),
      logout: () => setAuth({ token: '', user: null })
    }),
    [auth]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
