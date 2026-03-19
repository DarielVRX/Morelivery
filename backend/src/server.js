import http from 'http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { expireTimedOutOffers, expireDisputedOrders } from './modules/orders/assignment/index.js';
import { offerCb } from './modules/events/offerCallback.js';
import { ensureParamsLoaded, seedDefaultParams, getParam } from './engine/params.js';
import { tickKitchen } from './engine/kitchen.js';
import { cleanStaleEntities } from './engine/stale.js';
import { runRebalancer } from './engine/rebalancer.js';

const app    = createApp();
const server = http.createServer(app);

// ── Pre-cargar parámetros del motor antes del primer tick ────────────────────
ensureParamsLoaded().catch(e =>
  console.warn('[server] pre-carga de engine_params falló (usando defaults):', e.message)
);

// Sembrar params faltantes en DB (idempotente — ON CONFLICT DO NOTHING)
// Garantiza que el admin siempre ve todos los parámetros del catálogo
seedDefaultParams().catch(e =>
  console.warn('[server] seedDefaultParams falló (no crítico):', e.message)
);

// ── Scheduler de asignación (cada 2s, resiliente, sin solapamiento) ──────────
let assignmentDelayMs = 2_000;
let assignmentTimer   = null;

async function runAssignmentLoop() {
  try {
    await expireTimedOutOffers(offerCb);
    await expireDisputedOrders();
    assignmentDelayMs = 2_000;
  } catch (e) {
    assignmentDelayMs = Math.min(assignmentDelayMs * 2, 15_000);
    console.error('[assign.scheduler] error:', e.message);
  } finally {
    assignmentTimer = setTimeout(runAssignmentLoop, assignmentDelayMs);
  }
}

// ── Scheduler de cocina (cada 30s) ───────────────────────────────────────────
let kitchenTimer = null;

async function runKitchenLoop() {
  try {
    await tickKitchen();
  } catch (e) {
    console.error('[kitchen.scheduler] error:', e.message);
  } finally {
    kitchenTimer = setTimeout(runKitchenLoop, 30_000);
  }
}

// ── Scheduler de stale entities (cada 60s) ───────────────────────────────────
let staleTimer = null;

async function runStaleLoop() {
  try {
    const result = await cleanStaleEntities(offerCb);
    if (result.cancelled > 0 || result.reassigned > 0) {
      console.log(`[stale.scheduler] cancelled=${result.cancelled} reassigned=${result.reassigned} requeued=${result.requeued}`);
    }
  } catch (e) {
    console.error('[stale.scheduler] error:', e.message);
  } finally {
    staleTimer = setTimeout(runStaleLoop, 60_000);
  }
}

// ── Scheduler de rebalanceo (intervalo configurable, default 300s) ───────────
let rebalancerTimer = null;

async function runRebalancerLoop() {
  const intervalMs = getParam('rebalancer_interval_s', 300) * 1000;
  try {
    await runRebalancer(offerCb);
  } catch (e) {
    console.error('[rebalancer.scheduler] error:', e.message);
  } finally {
    rebalancerTimer = setTimeout(runRebalancerLoop, intervalMs);
  }
}

// Arrancar todos los schedulers con desfase para no saturar al inicio
assignmentTimer = setTimeout(runAssignmentLoop, 2_000);
kitchenTimer    = setTimeout(runKitchenLoop,    5_000);
staleTimer      = setTimeout(runStaleLoop,      10_000);
rebalancerTimer = setTimeout(runRebalancerLoop, 15_000);

server.listen(env.port, () => {
  console.log(`API running on port ${env.port}`);
});

function shutdown() {
  if (assignmentTimer)  clearTimeout(assignmentTimer);
  if (kitchenTimer)     clearTimeout(kitchenTimer);
  if (staleTimer)       clearTimeout(staleTimer);
  if (rebalancerTimer)  clearTimeout(rebalancerTimer);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);
