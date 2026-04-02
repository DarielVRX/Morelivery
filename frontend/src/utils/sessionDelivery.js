/**
 * sessionDelivery.js
 * Persiste la dirección de entrega del cliente en localStorage.
 *
 * - Scoped por userId del JWT. Si falla el decode, usa clave genérica.
 * - localStorage → persiste mientras el token exista (no se borra al cerrar tab).
 * - clearSessionDelivery() en logout para limpiar.
 *
 * @typedef {{ lat: number, lng: number, label: string }} DeliveryPos
 */

import { brandStorageKey } from '../config/brand';

const KEY_PREFIX = brandStorageKey('delivery_pos');

function userIdFromToken(token) {
  try {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    // Padding para base64
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded  = base64 + '=='.slice(0, (4 - base64.length % 4) % 4);
    const decoded = JSON.parse(atob(padded));
    return decoded.userId || decoded.sub || null;
  } catch {
    return null;
  }
}

function storageKey(token) {
  const uid = userIdFromToken(token);
  return uid ? `${KEY_PREFIX}_${uid}` : KEY_PREFIX;
}

/**
 * Lee la posición guardada.
 * @param {string|null} token  JWT del usuario autenticado
 * @returns {DeliveryPos|null}
 */
export function readSessionDelivery(token) {
  try {
    const raw = localStorage.getItem(storageKey(token));
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!Number.isFinite(Number(p?.lat)) || !Number.isFinite(Number(p?.lng))) return null;
    return { lat: Number(p.lat), lng: Number(p.lng), label: p.label || '' };
  } catch {
    return null;
  }
}

/**
 * Guarda la posición.
 * @param {{ lat: number, lng: number, label?: string }} pos
 * @param {string|null} token
 */
export function saveSessionDelivery(pos, token) {
  try {
    const lat = Number(pos?.lat);
    const lng = Number(pos?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    localStorage.setItem(
      storageKey(token),
      JSON.stringify({ lat, lng, label: pos.label || '' })
    );
  } catch {}
}

/**
 * Limpia la posición guardada. Llamar en logout.
 * @param {string|null} token
 */
export function clearSessionDelivery(token) {
  try {
    // Limpiar tanto la clave con userId como la genérica por si acaso
    localStorage.removeItem(storageKey(token));
    localStorage.removeItem(KEY_PREFIX);
  } catch {}
}
