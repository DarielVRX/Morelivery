import express from 'express';

import { applyCoreMiddleware, registerHealthEndpoints } from './bootstrap/middleware.js';
import { registerApplicationRoutes } from './bootstrap/routes.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';

export function createApp() {
  const app = express();

  applyCoreMiddleware(app);
  registerHealthEndpoints(app);
  registerApplicationRoutes(app);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
