import dotenv from 'dotenv';
import { DEFAULT_DATABASE_NAME, DEFAULT_VAPID_EMAIL } from './brand.js';
dotenv.config();

/**
 * Construye allowedOrigins combinando:
 * - ALLOWED_ORIGINS explícito
 * - FRONTEND_URL
 * - localhost para desarrollo
 */
function parseAllowedOrigins() {
  const origins = [];

  // 1. Lista explícita de ALLOWED_ORIGINS (coma-separada)
  if (process.env.ALLOWED_ORIGINS) {
    origins.push(...process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean));
  }

  // 2. FRONTEND_URL (producción)
  if (process.env.FRONTEND_URL) {
    origins.push(process.env.FRONTEND_URL.trim());
  }

  // 3. Siempre incluir localhost para desarrollo
  if ((process.env.NODE_ENV || 'development') === 'development') {
    origins.push('http://localhost:5173', 'http://localhost:3000');
  }

  // Eliminar duplicados
  return Array.from(new Set(origins));
}

export const env = {
  port: Number(process.env.PORT || 4000),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || (() => { throw new Error('JWT_SECRET no configurado'); })(),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
  databaseUrl: process.env.DATABASE_URL || (() => { throw new Error('DATABASE_URL no configurado'); })(),
  allowedOrigins: parseAllowedOrigins(),
  redisUrl: process.env.REDIS_URL || '',
  // OSRM propio en Railway — fallback al servidor público si no está configurado
  osrmUrl: process.env.OSRM_URL || 'https://router.project-osrm.org',

  // ✅ AGREGAR ESTAS VARIABLES PARA WEB PUSH
  vapidEmail: process.env.VAPID_EMAIL || DEFAULT_VAPID_EMAIL,
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY,

  // Stripe (tarjeta)
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
};
