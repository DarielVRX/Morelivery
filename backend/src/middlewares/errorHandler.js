import { AppError } from '../utils/errors.js';
import { env } from '../config/env.js';

export function notFoundHandler(_req, res) {
  res.status(404).json({ error: 'Route not found' });
}

export function errorHandler(err, _req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message });
  }

  // PostgreSQL errors include SQLSTATE in err.code
  if (err?.code) {
    if (env.nodeEnv === 'production') {
      return res.status(500).json({ error: 'Database error' });
    }

    return res.status(500).json({
      error: 'Database error',
      code: err.code,
      message: err.message
    });
  }

  console.error(err);
  return res.status(500).json({ error: 'Internal server error' });
}
