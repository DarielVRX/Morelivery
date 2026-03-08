// backend/src/modules/orders/assignment/listener.js
// ─────────────────────────────────────────────────────────────────────────────
// Evento: un driver establece conexión SSE o hace POST /listener.
//
// Cuando un driver se conecta/reactiva:
//   1. Verificar que esté disponible y bajo el límite de capacidad.
//   2. Expirar ofertas timeout existentes (mantener la DB limpia).
//   3. Buscar pedidos abiertos sin oferta activa.
//   4. Enquelar cada uno para que reciba oferta.
// ─────────────────────────────────────────────────────────────────────────────

import { log } from './constants.js';
import { getDriverProfile, getOpenOrdersWithoutPendingOffer } from './queries.js';
import { serializedOffer, hasActiveChain } from './queue.js';
import { offerNextDrivers } from './core.js';
import { expireTimedOutOffers } from './events.js';

/**
 * Llamar cuando un driver conecta o hace ping al listener.
 *
 * @param {string}   driverId
 * @param {Function} onOffer   Callback SSE
 * @returns {number}  Número de pedidos encolados
 */
export async function offerOrdersToDriver(driverId, onOffer) {
  console.log(`[assign] offerOrdersToDriver: driver=${driverId}`);

  // ── 1. Verificar perfil ───────────────────────────────────────────────────
  const profile = await getDriverProfile(driverId);
  if (!profile) {
    console.warn(`[assign] offerOrdersToDriver: driver=${driverId} sin perfil`);
    return 0;
  }

  const { is_available, active_count } = profile;
  console.log(`[assign] offerOrdersToDriver: driver=${driverId} is_available=${is_available} activos=${active_count}`);

  if (!is_available) {
    log(driverId, 'driver no disponible — skip');
    return 0;
  }

  // ── 2. Limpiar timeouts ───────────────────────────────────────────────────
  await expireTimedOutOffers(onOffer);

  // ── 3. Buscar pedidos abiertos ────────────────────────────────────────────
  const openOrders = await getOpenOrdersWithoutPendingOffer(5);
  console.log(
    `[assign] offerOrdersToDriver: ${openOrders.length} pedido(s) sin oferta activa`,
    openOrders.map(r => `order=${r.id} status=${r.status}`)
  );

  // ── 4. Encolar ────────────────────────────────────────────────────────────
  let enqueued = 0;
  for (const row of openOrders) {
    if (hasActiveChain(row.id)) {
      log(row.id, `ya tiene cadena activa — skip (offerOrdersToDriver driver=${driverId})`);
      continue;
    }
    serializedOffer(row.id, offerNextDrivers, onOffer);
    enqueued++;
  }

  console.log(`[assign] offerOrdersToDriver: driver=${driverId} listo — ${enqueued} pedido(s) encolados`);
  return enqueued;
}
