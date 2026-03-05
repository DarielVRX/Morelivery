function normalizeApiUrl(raw) {
  const base = (raw || '').trim();
  if (!base) return 'http://localhost:4000/api';
  return base.endsWith('/api') ? base : `${base.replace(/\/$/, '')}/api`;
}

const API_URL = normalizeApiUrl(import.meta.env.VITE_API_URL);

export async function apiFetch(path, options = {}, token) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });

  const raw = await response.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { error: raw || 'Non-JSON response from API' };
  }

  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}
