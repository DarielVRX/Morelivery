// frontend/src/api/client.js

export const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export async function apiFetch(path, options = {}, token = null) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    let message = `Error ${res.status}`;
    try {
      const body = await res.json();
      message = body.error || body.message || message;
    } catch (_) {}
    throw new Error(message);
  }

  // SSE y respuestas vac\u00edas no son JSON
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return res;

  return res.json();
}
