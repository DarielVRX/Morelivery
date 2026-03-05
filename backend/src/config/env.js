import dotenv from 'dotenv';

dotenv.config();

function parseAllowedOrigins() {
  const csv = process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:5173';
  return csv
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export const env = {
  port: Number(process.env.PORT || 4000),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/morelivery',
  allowedOrigins: parseAllowedOrigins(),
  redisUrl: process.env.REDIS_URL || ''
};
