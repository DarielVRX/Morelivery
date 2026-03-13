// utils/format.js — formateadores y constantes de dominio compartidas

export function fmt(cents) {
  return `$${((cents ?? 0) / 100).toFixed(2)}`;
}

export function getNotifPriorityMode() {
  try {
    return localStorage.getItem('morelivery_notif_priority') === 'high' ? 'high' : 'normal';
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
