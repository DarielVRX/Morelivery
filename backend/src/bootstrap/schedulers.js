import { expireTimedOutOffers, expireDisputedOrders } from '../modules/orders/assignment/index.js';
import { ensureParamsLoaded, seedDefaultParams, getParam } from '../engine/params.js';
import { tickKitchen } from '../engine/kitchen.js';
import { cleanStaleEntities } from '../engine/stale.js';
import { runRebalancer } from '../engine/rebalancer.js';

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
    start() {
      timer = setTimeout(run, initialDelayMs);
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
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
      onSuccess: () => {
        assignmentDelayMs = 2_000;
      },
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
      onError: (error) => {
        console.error('[kitchen.scheduler] error:', error.message);
      },
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
      onError: (error) => {
        console.error('[stale.scheduler] error:', error.message);
      },
    }),
    createLoop({
      label: 'rebalancer',
      initialDelayMs: 15_000,
      intervalMs: () => getParam('rebalancer_interval_s', 300) * 1000,
      task: () => runRebalancer(offerCb),
      onError: (error) => {
        console.error('[rebalancer.scheduler] error:', error.message);
      },
    }),
  ];
}

export function startSchedulers(schedulers) {
  schedulers.forEach((scheduler) => scheduler.start());
}

export function stopSchedulers(schedulers) {
  schedulers.forEach((scheduler) => scheduler.stop());
}
