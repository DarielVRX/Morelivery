import http from 'http';

import { createApp } from './app.js';
import { env } from './config/env.js';
import { offerCb } from './modules/events/offerCallback.js';
import { bootstrapEngineParams, createSchedulers, startSchedulers, stopSchedulers } from './bootstrap/schedulers.js';
import { seedDefaultParams } from './engine/params.js'; // ← agregar esta línea

const app = createApp();
const server = http.createServer(app);
const schedulers = createSchedulers(offerCb);

bootstrapEngineParams();
seedDefaultParams(); // ← agregar esta línea
startSchedulers(schedulers);

server.listen(env.port, () => {
  console.log(`API running on port ${env.port}`);
});

function shutdown() {
  stopSchedulers(schedulers);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
