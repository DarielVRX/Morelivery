import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';

export function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const isSseRequest = req.path === '/' && (req.baseUrl === '/api/events' || req.baseUrl === '/events');

  const token = header.startsWith('Bearer ')
    ? header.slice(7)
    : (isSseRequest ? (req.query.token || null) : null);

  if (!token) return next(new AppError(401, 'Missing token'));

  try {
    req.user = jwt.verify(token, env.jwtSecret);
    return next();
  } catch {
    return next(new AppError(401, 'Invalid token'));
  }
}

export function authorize(roles = []) {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new AppError(403, 'Forbidden'));
    }
    return next();
  };
}
