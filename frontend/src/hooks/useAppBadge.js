// hooks/useAppBadge.js
// Mantiene el badge del ícono de la app sincronizado con el estado del usuario.
// - Driver: número de ofertas pendientes + pedidos activos
// - Restaurant: número de pedidos activos
// - Customer: número de pedidos activos sin entregar
//
// Usa la Badging API nativa (Chrome/Android/Desktop). En iOS aún no soportada.
// El SW también actualiza el badge desde notificaciones push — este hook
// es el complemento para cuando la app está en primer plano.

import { useEffect } from 'react';

async function setBadge(count) {
  if (!('setAppBadge' in navigator)) return;
  try {
    if (count > 0) {
      await navigator.setAppBadge(count);
    } else {
      await navigator.clearAppBadge();
    }
  } catch (_) {}
}

/**
 * @param {number} count — número a mostrar en el badge (0 = limpiar)
 */
export function useAppBadge(count) {
  useEffect(() => {
    setBadge(count);
    // Limpiar al desmontar / salir
    return () => { setBadge(0); };
  }, [count]);
}

/**
 * Limpia el badge inmediatamente (para llamar al volver al foco).
 */
export function clearAppBadge() {
  setBadge(0);
}
