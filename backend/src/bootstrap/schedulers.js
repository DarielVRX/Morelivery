// backend/src/bootstrap/schedulers.js
// Cambio paso 8: el horario automático ya NO abre restaurantes.
// El schedule pasa a ser solo recordatorios push con botones Abrir/Ignorar.
// La apertura es 100% manual — el propietario debe tocar "Abrir" explícitamente.

import { expireTimedOutOffers, expireDisputedOrders } from '../modules/orders/assignment/index.js';
import { ensureParamsLoaded, seedDefaultParams, getParam } from '../engine/params.js';
import { tickKitchen } from '../engine/kitchen.js';
import { cleanStaleEntities } from '../engine/stale.js';
import { runRebalancer } from '../engine/rebalancer.js';
import { query } from '../config/db.js';
import { sendPushToUser } from '../modules/notifications/pushSubscription.js';

function createLoop({ label, initialDelayMs, intervalMs, task, onSuccess, onError }) {
  let timer = null;
  let currentDelayMs = initialDelayMs;

  async function run() {
    try {
      const result = await task();
      if (onSuccess) onSuccess(result);
      currentDelayMs = typeof intervalMs === 'function' ? intervalMs() : intervalMs;
    } catch (error) {
      if (onError) onError(error, currentDelayMs);
      currentDelayMs = typeof intervalMs === 'function' ? intervalMs() : currentDelayMs;
    } finally {
      timer = setTimeout(run, currentDelayMs);
    }
  }

  return {
    label,
    start() { timer = setTimeout(run, initialDelayMs); },
    stop()  { if (timer) clearTimeout(timer); timer = null; },
  };
}

export function bootstrapEngineParams() {
  ensureParamsLoaded().catch((error) => {
    console.warn('[server] pre-carga de engine_params falló (usando defaults):', error.message);
  });
  seedDefaultParams().catch((error) => {
    console.warn('[server] seedDefaultParams falló (no crítico):', error.message);
  });
}

// ── Recordatorio push de apertura ──────────────────────────────────────────────
// Envía push a propietarios de restaurantes que tienen horario programado para
// el momento actual pero NO han abierto manualmente aún.
// El push tiene botones "Abrir" e "Ignorar" — la apertura real solo ocurre
// cuando el propietario toca el botón desde la app.
async function sendScheduleReminders() {
  try {
    const tz    = 'America/Mexico_City';
    const nowMx = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
    const dow   = nowMx.getDay();
    const hh    = String(nowMx.getHours()).padStart(2, '0');
    const mm    = String(nowMx.getMinutes()).padStart(2, '0');
    const hhmm  = `${hh}:${mm}`;

    // Restaurantes con horario para hoy que deberían estar abiertos pero están cerrados
    // y cuyo horario empieza en los últimos 5 minutos (ventana de recordatorio)
    const fiveMinAgo = `${String(nowMx.getHours()).padStart(2,'0')}:${String(Math.max(0, nowMx.getMinutes()-5)).padStart(2,'0')}`;

    let candidates = [];
    try {
      const r = await query(
        `SELECT rs.restaurant_id, r.name, r.owner_user_id, rs.opens_at
         FROM restaurant_schedules rs
         JOIN restaurants r ON r.id = rs.restaurant_id
         WHERE rs.day_of_week = $1
           AND rs.is_closed = false
           AND rs.opens_at IS NOT NULL
           AND rs.opens_at::time >= $2::time
           AND rs.opens_at::time <= $3::time
           AND r.is_open = false
           AND (r.manual_open_override IS NULL OR r.manual_open_override = false)`,
        [dow, fiveMinAgo, hhmm]
      );
      candidates = r.rows;
    } catch (e) {
      if (e?.code !== '42P01') throw e; // ignorar si tabla no existe
    }

    for (const rest of candidates) {
      try {
        await sendPushToUser(rest.owner_user_id, {
          title:  `⏰ Es hora de abrir — ${rest.name}`,
          body:   `Tu horario programado indica apertura ahora. ¿Abres hoy?`,
          tag:    `open_reminder_${rest.restaurant_id}`,
          group:  'kitchen',
          url:    '/restaurant/horario',
          priority: 'high',
          type:   'open_reminder',
          restaurantId: rest.restaurant_id,
          // El SW mostrará botones Abrir / Ignorar
          actions: [
            { action: 'open_restaurant',  title: '✓ Abrir' },
            { action: 'ignore_reminder',  title: 'Ignorar' },
          ],
          vibrate: [300, 100, 300],
        });
        console.log(`[schedule.reminder] enviado a ${rest.owner_user_id.slice(0,8)} — ${rest.name}`);
      } catch (e) {
        console.warn(`[schedule.reminder] error para ${rest.name}:`, e.message);
      }
    }

    return candidates.length;
  } catch (e) {
    console.error('[schedule.reminder] error general:', e.message);
    return 0;
  }
}

export function createSchedulers(offerCb) {
  let assignmentDelayMs = 2_000;

  return [
    createLoop({
      label: 'assignment',
      initialDelayMs: 2_000,
      intervalMs: () => assignmentDelayMs,
      task: async () => {
        await expireTimedOutOffers(offerCb);
        await expireDisputedOrders();
      },
      onSuccess: () => { assignmentDelayMs = 2_000; },
      onError: (error) => {
        assignmentDelayMs = Math.min(assignmentDelayMs * 2, 15_000);
        console.error('[assign.scheduler] error:', error.message);
      },
    }),
    createLoop({
      label: 'kitchen',
      initialDelayMs: 5_000,
      intervalMs: 30_000,
      task: tickKitchen,
      onError: (error) => { console.error('[kitchen.scheduler] error:', error.message); },
    }),
    createLoop({
      label: 'stale',
      initialDelayMs: 10_000,
      intervalMs: 60_000,
      task: () => cleanStaleEntities(offerCb),
      onSuccess: (result) => {
        if (result.cancelled > 0 || result.reassigned > 0) {
          console.log(`[stale.scheduler] cancelled=${result.cancelled} reassigned=${result.reassigned} requeued=${result.requeued}`);
        }
      },
      onError: (error) => { console.error('[stale.scheduler] error:', error.message); },
    }),
    createLoop({
      label: 'rebalancer',
      initialDelayMs: 15_000,
      intervalMs: () => getParam('rebalancer_interval_s', 300) * 1000,
      task: () => runRebalancer(offerCb),
      onError: (error) => { console.error('[rebalancer.scheduler] error:', error.message); },
    }),
    // ── Recordatorios de apertura — cada 5 min, solo avisa, NO abre ──────────
    createLoop({
      label: 'schedule_reminders',
      initialDelayMs: 60_000,  // primer check al minuto de arrancar
      intervalMs: 5 * 60_000,  // cada 5 minutos
      task: sendScheduleReminders,
      onSuccess: (count) => {
        if (count > 0) console.log(`[schedule.reminder] ${count} recordatorio(s) enviados`);
      },
      onError: (error) => { console.error('[schedule.reminder] error:', error.message); },
    }),
  ];
}

export function startSchedulers(schedulers) {
  schedulers.forEach((s) => s.start());
}

export function stopSchedulers(schedulers) {
  schedulers.forEach((s) => s.stop());
}
