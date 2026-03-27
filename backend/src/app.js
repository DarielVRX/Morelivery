  import express from 'express';

import { applyCoreMiddleware, registerHealthEndpoints } from './bootstrap/middleware.js';
import { registerApplicationRoutes } from './bootstrap/routes.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';
import pushRoutes from './modules/push/routes.js';

export function createApp() {
  const app = express();

  app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));

  applyCoreMiddleware(app);
  registerHealthEndpoints(app);
  registerApplicationRoutes(app);

  // Montar pushRoutes ANTES de los handlers de error/404
  app.use('/api/push', pushRoutes);

  // Estos van al final, después de todas las rutas
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
