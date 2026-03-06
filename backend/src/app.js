import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

import { env } from './config/env.js';
import { apiRateLimit } from './middlewares/rateLimit.js';
import authRoutes from './modules/auth/routes.js';
import restaurantRoutes from './modules/restaurants/routes.js';
import orderRoutes from './modules/orders/routes.js';
import driverRoutes from './modules/drivers/routes.js';
import adminRoutes from './modules/admin/routes.js';
import eventRoutes from './modules/events/routes.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';
import { checkDbConnection } from './config/db.js';

function corsOrigin(origin, callback) {
  // Si no hay origen (como un test local) o es tu app de Vercel, permitir siempre
  callback(null, true); 
}

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);

  app.use(cors({ origin: corsOrigin, credentials: true }));
// Busca esta línea y cámbiala por esta configuración:
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false
}));
  app.use((req, res, next) => {
    if (req.path === '/api/events' || req.path === '/events') return next();
    return apiRateLimit(req, res, next);
  });
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/', (_req, res) => res.json({ service: 'morelivery-api', status: 'online' }));
  app.get('/health', (_req, res) => res.json({ status: 'ok', env: env.nodeEnv }));
  app.get('/health/db', async (_req, res, next) => {
    try {
      const db = await checkDbConnection();
      return res.json({ status: 'ok', database: 'connected', now: db.now });
    } catch (error) { return next(error); }
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/restaurants', restaurantRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api/drivers', driverRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/events', eventRoutes);   // \u2190 SSE

  // Aliases sin /api/ para compatibilidad con c\u00f3digo existente
  app.use('/auth', authRoutes);
  app.use('/restaurants', restaurantRoutes);
  app.use('/orders', orderRoutes);
  app.use('/drivers', driverRoutes);
  app.use('/admin', adminRoutes);
  app.use('/events', eventRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
