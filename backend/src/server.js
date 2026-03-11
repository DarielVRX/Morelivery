import http from 'http';
import { Server } from 'socket.io';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { orderEvents } from './events/orderEvents.js';
import { expireTimedOutOffers } from './modules/orders/assignment/index.js';
import { offerCb } from './modules/events/offerCallback.js';

const app = createApp();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: env.allowedOrigins
  }
});

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);
});

orderEvents.setSocket(io);

// Scheduler resiliente sin solapamientos:
// - ejecuta expiración + barrido huérfano en secuencia
// - en error aplica backoff para evitar ruido constante
let assignmentDelayMs = 2_000;
let assignmentTimer = null;

async function runAssignmentLoop() {
  try {
    await expireTimedOutOffers(offerCb);
    assignmentDelayMs = 2_000;
  } catch (e) {
    assignmentDelayMs = Math.min(assignmentDelayMs * 2, 15_000);
    console.error('[assign.scheduler] error:', e.message);
  } finally {
    assignmentTimer = setTimeout(runAssignmentLoop, assignmentDelayMs);
  }
}

assignmentTimer = setTimeout(runAssignmentLoop, assignmentDelayMs);

server.listen(env.port, () => {
  console.log(`API running on port ${env.port}`);
});

function shutdown() {
  if (assignmentTimer) clearTimeout(assignmentTimer);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
