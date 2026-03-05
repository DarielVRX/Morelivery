import http from 'http';
import { Server } from 'socket.io';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { orderEvents } from './events/orderEvents.js';

const app = createApp();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: env.frontendUrl
  }
});

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);
});

orderEvents.setSocket(io);

server.listen(env.port, () => {
  console.log(`API running on port ${env.port}`);
});
