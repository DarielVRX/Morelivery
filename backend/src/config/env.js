import dotenv from 'dotenv';
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
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/morelivery',
  allowedOrigins: parseAllowedOrigins(),
  redisUrl: process.env.REDIS_URL || ''
};
