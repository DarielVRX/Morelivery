// utils/format.js — formateadores y constantes de dominio compartidas
import { brandStorageKey } from '../config/brand';

export function fmt(cents) {
  return `$${((cents ?? 0) / 100).toFixed(2)}`;
}

export function formatShortDateTime(iso, locale = 'es') {
  return iso ? new Date(iso).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }) : '—';
}

export function formatShortDate(iso, locale = 'es-MX') {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function getNotifPriorityMode() {
  try {
    return localStorage.getItem(brandStorageKey('notif_priority')) === 'high' ? 'high' : 'normal';
  } catch (_) {
    return 'normal';
  }
}

export const STATUS_LABELS = {
  created:        'Recibido',
  assigned:       'Asignado',
  accepted:       'Aceptado',
  preparing:      'En preparación',
  ready:          'Listo para retiro',
  on_the_way:     'En camino',
  delivered:      'Entregado',
  cancelled:      'Cancelado',
  pending_driver: 'Buscando conductor',
};

export const ZONE_LABELS = {
  traffic:      '🚦 Tráfico pesado',
  construction: '🚧 Obra en construcción',
  accident:     '🚨 Accidente',
  flood:        '🌊 Inundación',
  blocked:      '⛔ Calle bloqueada',
  other:        '⚠️ Otro problema',
};
