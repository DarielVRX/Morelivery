import http from 'http';
import { Server } from 'socket.io';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { orderEvents } from './events/orderEvents.js';
import { expireTimedOutOffers } from './modules/orders/assignment/index.js';
import { sseHub } from './modules/events/hub.js';

const app = createApp();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: env.allowedOrigins }
});

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);
});

orderEvents.setSocket(io);

// Callback SSE con acceso al hub — mismo que usa drivers/routes.js
function offerCb(driverId, orderId, data) {
  try { sseHub.notifyNewOffer(driverId, orderId, data); } catch (_) {}
}

// Ticker global cada 10s: expira ofertas vencidas y re-encola con SSE real
setInterval(async () => {
  try {
    await expireTimedOutOffers(offerCb);
  } catch (e) {
    console.error('[ticker] expireTimedOutOffers error:', e.message);
  }
}, 10_000);

server.listen(env.port, () => {
  console.log(`API running on port ${env.port}`);
});
