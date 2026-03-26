// frontend/src/features/driver/alerts/api.js
import { apiFetch } from '../../../api/client';

export async function fetchAllZones(token) {
  const [active, mine] = await Promise.all([
    apiFetch('/nav/zones/active'),
    token ? apiFetch('/nav/zones/mine', {}, token) : Promise.resolve({ zones: [] }),
  ]);
  const mineMap = new Map((mine.zones || []).map(z => [z.id, { ...z, is_mine: true }]));
  const merged = (active.zones || []).map(z => mineMap.has(z.id) ? mineMap.get(z.id) : z);
  for (const [id, z] of mineMap) {
    if (!merged.find(m => m.id === id)) merged.push(z);
  }
  return merged;
}

export async function fetchAllImpassable(token) {
  const [all, mine] = await Promise.all([
    apiFetch('/nav/road-prefs/impassable'),
    token ? apiFetch('/nav/road-prefs/impassable/mine', {}, token) : Promise.resolve({ reports: [] }),
  ]);
  const mineMap = new Map((mine.reports || []).map(r => [r.way_id, { ...r, is_mine: true }]));
  const merged = (all.reports || []).map(r => mineMap.has(r.way_id) ? mineMap.get(r.way_id) : r);
  for (const [wid, r] of mineMap) {
    if (!merged.find(m => m.way_id === wid)) merged.push(r);
  }
  return merged;
}

export async function fetchMyPreferences(token) {
  const data = await apiFetch('/nav/road-prefs/preferences', {}, token);
  return (data.preferences || []).map(p => ({ ...p, is_mine: true }));
}

export async function voteZone(id, vote, token) {
  return apiFetch(`/nav/zones/${id}/vote`, { method: 'POST', body: JSON.stringify({ vote }) }, token);
}

export async function deleteZone(id, token) {
  return apiFetch(`/nav/zones/${id}`, { method: 'DELETE' }, token);
}

// Votar un reporte impassable: confirm (×3 → activo en rutas) o dismiss (×3 → eliminar)
export async function voteImpassable(way_id, vote, token) {
  return apiFetch(`/nav/road-prefs/impassable/${way_id}/vote`,
    { method: 'POST', body: JSON.stringify({ vote }) }, token);
}

export async function updateImpassable(way_id, { estimated_duration, description }, token) {
  return apiFetch(`/nav/road-prefs/impassable/${way_id}`,
    { method: 'PATCH', body: JSON.stringify({ estimated_duration, description }) }, token);
}

export async function deleteImpassable(way_id, token) {
  return apiFetch(`/nav/road-prefs/impassable/${way_id}`, { method: 'DELETE' }, token);
}

export async function updatePreference(way_id, preference, token) {
  return apiFetch(`/nav/road-prefs/preference/${way_id}`,
    { method: 'PUT', body: JSON.stringify({ preference }) }, token);
}

export async function deletePreference(way_id, token) {
  return apiFetch(`/nav/road-prefs/preference/${way_id}`, { method: 'DELETE' }, token);
}

// ── Bag capacity ──────────────────────────────────────────────────────────────

export async function fetchBagCapacity(token) {
  const data = await apiFetch('/drivers/me/bag-capacity', {}, token);
  return Number(data.bag_capacity_liters ?? 25);
}

export async function updateBagCapacity(bag_capacity_liters, token) {
  return apiFetch('/drivers/me/bag-capacity', {
    method: 'PATCH',
    body: JSON.stringify({ bag_capacity_liters }),
  }, token);
}
