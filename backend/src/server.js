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

// Ticker global: expira ofertas sin respuesta cada 1s y re-encola con SSE real.
// La query UPDATE solo toca filas con status='pending' vencidas — costo mínimo
// cuando no hay nada que expirar (el caso normal).
setInterval(async () => {
  try {
    await expireTimedOutOffers(offerCb);
  } catch (e) {
    console.error('[ticker] expireTimedOutOffers error:', e.message);
  }
}, 1_000);

server.listen(env.port, () => {
  console.log(`API running on port ${env.port}`);
});
