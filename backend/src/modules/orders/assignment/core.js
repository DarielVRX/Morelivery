// backend/src/modules/orders/assignment/core.js
//
// Lógica central del motor de asignación.
//
// RONDAS Y BATCH:
//   Ronda 1-5:  batch=1  (drivers de 1 en 1)
//   Ronda 6:    batch=5
//   Ronda 7+:   batch=10
//
// WRAPAROUND: los drivers elegibles se ordenan por driver_number.
// Si en la ronda N ya se ofertó a K drivers, se saltan los primeros K
// y se toman los siguientes batchSize (con wraparound circular).
//
// RONDAS SIMULTÁNEAS (batch>1):
//   - Los drivers con oferta pending NO se cuentan en el batch (skip, no vuelven a cola).
//   - Los advisory locks evitan asignaciones duplicadas.
//   - Si hay menos drivers disponibles que batchSize, se usan todos los disponibles.
//
// DRIVERS CON OFERTA PENDING (inactivos): se saltan sin incrementar ronda.

import { OFFER_TIMEOUT_SECONDS, log, logWarn } from './constants.js';
import {
  getOpenOrder, getPendingOffer, getOfferRound, markPendingDriver,
  getEligibleDrivers, getEligibleIdleDrivers,
} from './queries.js';
import { upsertOffer } from './offer.js';
import { applyOrderCooldownReduction } from './cooldown.js';
import { findCandidates } from '../../../engine/candidate-finder.js';
import { simulateDriverWithOrder } from '../../../engine/route-simulator.js';
import { scoreCandidate } from '../../../engine/scoring.js';
import { query } from '../../../config/db.js';

/**
 * Intenta enviar oferta(s) para el pedido dado.
 * Solo debe llamarse desde serializedOffer().
 */
export async function offerNextDrivers(orderId, onOffer) {
  log(`order=${orderId}`, 'offerNextDrivers: inicio');

  // ── 1. Verificar que el pedido sigue abierto ──────────────────────────────
  const orderRow = await getOpenOrder(orderId);
  if (!orderRow) {
    log(`order=${orderId}`, 'pedido no encontrado o ya asignado — abort');
    return 0;
  }

  // ── 2. Verificar que no hay oferta pending activa ─────────────────────────
  const existing = await getPendingOffer(orderId);
  if (existing) {
    log(`order=${orderId}`, `ya tiene oferta pending driver=${existing.driver_id} — abort`);
    return 0;
  }

  // ── 3. Calcular ronda y batchSize ─────────────────────────────────────────
  const pastCount = await getOfferRound(orderId);
  const round     = pastCount + 1;
  const batchSize = round <= 5 ? 1 : round === 6 ? 5 : 10;
  log(`order=${orderId}`, `ronda=${round} batch=${batchSize}`);

  // ── 4. Obtener drivers elegibles (sin cooldown, sin haber aceptado) ────────
  // Para batch=1 solo queremos drivers IDLE (sin pending en otro pedido).
  // Para batch>1 tomamos todos los elegibles — los que tengan pending serán
  // descartados por el advisory lock en upsertOffer (sin contar como ronda).
  const eligible = batchSize === 1
    ? await getEligibleIdleDrivers(orderId)
    : await getEligibleDrivers(orderId);

  log(`order=${orderId}`, `elegibles: ${eligible.length}`, {
    drivers: eligible.map(d => d.user_id),
  });

  if (eligible.length === 0) {
    log(`order=${orderId}`, 'sin candidatos elegibles → intentar reducción de cooldown');

    const reduced = await applyOrderCooldownReduction(orderId, orderRow.offer_cooldown_triggered);

    if (!reduced) {
      // Sin cooldowns que reducir: todos los drivers están en pending offer
      // en otro pedido, o sin disponibilidad. Esperar al próximo wake-up.
      logWarn(`order=${orderId}`, 'sin cooldown que reducir → pending_driver');
      await markPendingDriver(orderId);
      return 0;
    }

    if (reduced.newWaitSecs >= 1) {
      // Cooldown reducido pero el driver todavía espera — el ticker lo
      // detectará cuando expire y reencola automáticamente.
      log(`order=${orderId}`, `cooldown reducido a ${Math.round(reduced.newWaitSecs)}s → pending_driver`);
      await markPendingDriver(orderId);
      return 0;
    }

    // newWaitSecs < 1 → wait_until ya en el pasado → driver elegible ahora mismo.
    // Re-consultar elegibles con batch=1 para continuar el flujo normalmente.
    const immediateEligible = batchSize === 1
      ? await getEligibleIdleDrivers(orderId)
      : await getEligibleDrivers(orderId);

    if (immediateEligible.length === 0) {
      log(`order=${orderId}`, 'sin candidatos tras reducción inmediata → pending_driver');
      await markPendingDriver(orderId);
      return 0;
    }

    // Continuar con los candidatos recién liberados
    eligible.push(...immediateEligible);
  }

  // ── 5. Scoring + Wraparound circular ─────────────────────────────────────
  // Usa scoreCandidate() del motor para ordenar — corrige la inconsistencia
  // anterior donde se calculaba un score ad-hoc aquí en lugar de reutilizar
  // la función dedicada con todos sus parámetros configurables.
  let scoredEligible = eligible.map(d => ({ ...d, bagOverflowPct: 0 })); // fallback

  try {
    const coordsRow = await query(
      `SELECT restaurant_lat, restaurant_lng, delivery_lat, delivery_lng,
              o.customer_id,
              COALESCE(o.delivery_lat, cu.lat)  AS cust_lat,
              COALESCE(o.delivery_lng, cu.lng)  AS cust_lng,
              o.estimated_volume_liters
       FROM orders o
       JOIN users cu ON cu.id = o.customer_id
       WHERE o.id = $1`,
      [orderId]
    );

    if (coordsRow.rowCount > 0) {
      const coord = coordsRow.rows[0];
      const restaurantPos = {
        lat: Number(coord.restaurant_lat),
        lng: Number(coord.restaurant_lng),
      };
      const customerPos = {
        lat: Number(coord.cust_lat),
        lng: Number(coord.cust_lng),
      };
      const orderForSim = {
        id: orderId,
        estimated_volume_liters: Number(coord.estimated_volume_liters) || 0,
      };

      if (
        Number.isFinite(restaurantPos.lat) && Number.isFinite(customerPos.lat)
      ) {
        const { topDrivers } = await findCandidates(orderId, restaurantPos, customerPos);

        if (topDrivers.length > 0) {
          // Para rondas con batch > 1 correr simulación completa para obtener
          // bagOverflowPct y score definitivo. Para ronda 1-5 (batch=1) usar
          // scoreCandidate() sobre el envelope — más rápido, suficientemente preciso.
          const useFullSim = batchSize > 1;
          const nowSec = Date.now() / 1000;

          const scored = await Promise.all(
            topDrivers.map(async (env) => {
              try {
                let candidate = env;
                if (useFullSim) {
                  candidate = await simulateDriverWithOrder(
                    env, orderForSim, restaurantPos, customerPos, nowSec
                  );
                }
                const { totalCost } = scoreCandidate(
                  candidate,
                  { max_delivery_time_s: null },
                  candidate.driver?.disconnectPenalties ?? env.disconnectPenalties ?? 0
                );
                return {
                  driverId:       env.driver.id,
                  totalCost,
                  bagOverflowPct: candidate.bagOverflowPct ?? 0,
                };
              } catch {
                return { driverId: env.driver.id, totalCost: Infinity, bagOverflowPct: 0 };
              }
            })
          );

          const scoreMap = new Map(scored.map(s => [s.driverId, s]));

          scoredEligible = [...eligible]
            .map(d => ({
              ...d,
              bagOverflowPct: scoreMap.get(d.user_id)?.bagOverflowPct ?? 0,
            }))
            .sort((a, b) => {
              const sA = scoreMap.get(a.user_id)?.totalCost ?? Infinity;
              const sB = scoreMap.get(b.user_id)?.totalCost ?? Infinity;
              return sA - sB;
            });

          log(`order=${orderId}`, `scoreCandidate aplicado — ${topDrivers.length} candidatos`);
        }
      }
    }
  } catch (e) {
    log(`order=${orderId}`, `scoring fallback a driver_number: ${e.message}`);
  }

  // Wraparound circular sobre la lista ya ordenada por score
  const offset    = scoredEligible.length > 0 ? pastCount % scoredEligible.length : 0;
  const totalElg  = scoredEligible.length;
  const realBatch = Math.min(batchSize, totalElg);
  const batch     = [];
  for (let i = 0; i < realBatch; i++) {
    batch.push(scoredEligible[(offset + i) % totalElg]);
  }

  log(`order=${orderId}`, `batch final: ${batch.length}`, {
    drivers: batch.map(d => d.user_id),
    offset,
    realBatch,
  });

  // ── 6. Enviar ofertas ─────────────────────────────────────────────────────
  let sent = 0;
  for (const row of batch) {
    const ok = await upsertOffer(orderId, row.user_id, onOffer, row.bagOverflowPct ?? 0);
    if (ok) sent++;
  }

  if (sent === 0) {
    // Todos los drivers del batch tenían pending offer (advisory lock los saltó)
    log(`order=${orderId}`, 'batch completo en pending — pending_driver');
    await markPendingDriver(orderId);
  }

  return sent;
}
