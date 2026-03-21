// frontend/src/api/client.js

const RAW_API_BASE = (import.meta.env.VITE_API_URL || '').trim().replace(/\/$/, '');

// Normaliza base para evitar duplicar /api cuando VITE_API_URL ya lo incluye.
export const API_BASE = RAW_API_BASE.replace(/\/api$/i, '');

// Evento global que AuthContext escucha para hacer logout automático cuando el JWT expira
export const AUTH_EXPIRED_EVENT = 'morelivery:auth_expired';

export async function apiFetch(path, options = {}, token = null) {
  const normalizedPath = path.startsWith('/api/')
    ? path
    : `/api${path.startsWith('/') ? path : `/${path}`}`;

  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${normalizedPath}`, { ...options, headers });

  if (!res.ok) {
    // Token expirado o inválido — disparar evento global para que AuthContext haga logout
    if (res.status === 401 && token && !options.skipLogoutOn401) {
      window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
    }
    let message = `Error ${res.status}`;
    try {
      const body = await res.json();
      message = body.error || body.message || message;
    } catch (_) {}
    throw new Error(message);
  }

  // SSE y respuestas vacías no son JSON
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return res;

  return res.json();
}
