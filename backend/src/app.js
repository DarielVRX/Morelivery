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
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';

function corsOrigin(origin, callback) {
  if (!origin) return callback(null, true);
  if (env.allowedOrigins.length === 0 || env.allowedOrigins.includes('*')) return callback(null, true);
  if (env.allowedOrigins.includes(origin)) return callback(null, true);
  console.warn(`[cors] Origin not in allowlist, allowing for beta: ${origin}`);
  return callback(null, true);
}

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: corsOrigin,
      credentials: true
    })
  );
  app.use(helmet());
  app.use(apiRateLimit);
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/', (_req, res) => {
    res.json({
      service: 'morelivery-api',
      status: 'online',
      docs: {
        health: '/health',
        auth: '/api/auth',
        restaurants: '/api/restaurants',
        orders: '/api/orders'
      }
    });
  });

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'morelivery-api',
      env: env.nodeEnv,
      allowedOrigins: env.allowedOrigins
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/restaurants', restaurantRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api/drivers', driverRoutes);
  app.use('/api/admin', adminRoutes);

  // Backward-compatible aliases in case frontend VITE_API_URL missed /api
  app.use('/auth', authRoutes);
  app.use('/restaurants', restaurantRoutes);
  app.use('/orders', orderRoutes);
  app.use('/drivers', driverRoutes);
  app.use('/admin', adminRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
