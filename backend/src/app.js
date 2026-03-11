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
import routeModelRoutes from './modules/routes/routes.js';
import paymentsRoutes from './modules/payments/routes.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';
import { checkDbConnection } from './config/db.js';

function corsOrigin(origin, callback) {
  if (!origin) return callback(null, true);
  if (env.allowedOrigins.length === 0 || env.allowedOrigins.includes('*')) return callback(null, true);
  if (env.allowedOrigins.includes(origin)) return callback(null, true);
  console.warn(`[cors] Origin not in allowlist, allowing for beta: ${origin}`);
  return callback(null, true);
}

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);

  app.use(cors({ origin: corsOrigin, credentials: true }));
  app.use(helmet());
  // SSE no debe ser afectado por rate limit \u2014 excluir la ruta antes de aplicarlo
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
  app.use('/api/routes', routeModelRoutes);
  app.use('/api/payments', paymentsRoutes);

  // Aliases sin /api/ para compatibilidad con c\u00f3digo existente
  app.use('/auth', authRoutes);
  app.use('/restaurants', restaurantRoutes);
  app.use('/orders', orderRoutes);
  app.use('/drivers', driverRoutes);
  app.use('/admin', adminRoutes);
  app.use('/events', eventRoutes);
  app.use('/routes', routeModelRoutes);
  app.use('/payments', paymentsRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
