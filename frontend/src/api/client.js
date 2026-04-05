// frontend/src/api/client.js

const RAW_API_BASE = (import.meta.env.VITE_API_URL || '').trim().replace(/\/$/, '');
export const API_BASE = RAW_API_BASE.replace(/\/api$/i, '');

import { brandEventName, brandStorageKey } from '../config/brand';

export const AUTH_EXPIRED_EVENT = brandEventName('auth_expired');

const STORAGE_KEY    = brandStorageKey('auth_v1');
const REFRESH_KEY    = brandStorageKey('refresh_v1');

// ── Mutex para evitar refreshes concurrentes ──────────────────────────────────
let refreshPromise = null;

async function attemptRefresh() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const rt = window.localStorage.getItem(REFRESH_KEY);
      if (!rt) throw new Error('No refresh token');

      const res = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: rt }),
      });

      if (!res.ok) throw new Error('Refresh failed');

      const data = await res.json();
      // Actualizar tokens en localStorage
      try {
        const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}');
        stored.token = data.token;
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
        window.localStorage.setItem(REFRESH_KEY, data.refreshToken);
      } catch (storageError) {
        console.warn('[api] No se pudieron persistir tokens tras refresh:', storageError);
      }

      return data.token;
    } catch (refreshError) {
      console.warn('[api] Falló refresh de sesión:', refreshError);
      window.localStorage.removeItem(REFRESH_KEY);
      window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
      throw new Error('Session expired');
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function apiFetch(path, options = {}, token = null) {
  const normalizedPath = path.startsWith('/api/')
    ? path
    : `/api${path.startsWith('/') ? path : `/${path}`}`;

  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${normalizedPath}`, { ...options, headers });

  if (!res.ok) {
    // Token expirado — intentar refresh silencioso (solo si hay token y no es la ruta de refresh)
    if (res.status === 401 && token && !options.skipLogoutOn401 && !path.includes('/auth/refresh')) {
      try {
        const newToken = await attemptRefresh();
        // Reintentar la llamada original con el nuevo token
        const retryHeaders = { ...headers, 'Authorization': `Bearer ${newToken}` };
        const retry = await fetch(`${API_BASE}${normalizedPath}`, { ...options, headers: retryHeaders });
        if (!retry.ok) {
          if (retry.status === 401) window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
          let message = `Error ${retry.status}`;
          try {
            const body = await retry.json();
            message = body.error || body.message || message;
          } catch (parseError) {
            console.warn('[api] No se pudo parsear error de reintento:', parseError);
          }
          throw new Error(message);
        }
        const ct2 = retry.headers.get('content-type') || '';
        if (!ct2.includes('application/json')) return retry;
        return retry.json();
      } catch (refreshErr) {
        if (refreshErr.message === 'Session expired') throw new Error('Sesión expirada');
        throw refreshErr;
      }
    }

    if (res.status === 401 && token && !options.skipLogoutOn401) {
      window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
    }
    let message = `Error ${res.status}`;
    try {
      const body = await res.json();
      message = body.error || body.message || message;
    } catch (parseError) {
      console.warn('[api] No se pudo parsear respuesta de error:', parseError);
    }
    throw new Error(message);
  }

  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return res;

  return res.json();
}
