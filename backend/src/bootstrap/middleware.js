import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import express from 'express';

import { env } from '../config/env.js';
import { checkDbConnection } from '../config/db.js';
import { apiRateLimit } from '../middlewares/rateLimit.js';

function corsOrigin(origin, callback) {
  if (!origin) return callback(null, true);
  if (env.allowedOrigins.length === 0 || env.allowedOrigins.includes('*')) return callback(null, true);
  if (env.allowedOrigins.includes(origin)) return callback(null, true);

  if (env.nodeEnv === 'production') {
    console.warn(`[cors] Origen bloqueado en producción: ${origin}`);
    return callback(new Error(`CORS: origen no permitido: ${origin}`), false);
  }

  console.warn(`[cors] Origen no en allowlist (dev — permitiendo): ${origin}`);
  return callback(null, true);
}

function createRateLimitSkipper() {
  return (req, res, next) => {
    if (req.path === '/api/events' || req.path === '/events') return next();
    return apiRateLimit(req, res, next);
  };
}

export function applyCoreMiddleware(app) {
  app.set('trust proxy', 1);
  app.use(cors({ origin: corsOrigin, credentials: true }));
  app.use(helmet());
  app.use(createRateLimitSkipper());
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
}

export function registerHealthEndpoints(app) {
  app.get('/', (_req, res) => res.json({ service: 'morelivery-api', status: 'online' }));
  app.get('/health', (_req, res) => res.json({ status: 'ok', env: env.nodeEnv }));
  app.get('/health/db', async (_req, res, next) => {
    try {
      const db = await checkDbConnection();
      return res.json({ status: 'ok', database: 'connected', now: db.now });
    } catch (error) {
      return next(error);
    }
  });
}
