import rateLimit from 'express-rate-limit';

export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false
});

export const apiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false
});

// SSE necesita límite generoso — es una conexión persistente que puede durar horas.
// Limita reconexiones abusivas (bot/spam) sin bloquear uso legítimo.
export const sseRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10, // máx 10 reconexiones por minuto por IP
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
});
