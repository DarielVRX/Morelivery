import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../../config/db.js';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';

export async function registerUser(payload) {
  const existing = await query('SELECT id FROM users WHERE email = $1', [payload.email]);
  if (existing.rowCount > 0) throw new AppError(409, 'Email already registered');

  const passwordHash = await bcrypt.hash(payload.password, 12);
  const result = await query(
    'INSERT INTO users(full_name, email, password_hash, role) VALUES($1, $2, $3, $4) RETURNING id, full_name, email, role',
    [payload.fullName, payload.email, passwordHash, payload.role]
  );

  return result.rows[0];
}

export async function loginUser(payload) {
  const result = await query('SELECT id, full_name, email, password_hash, role, status FROM users WHERE email = $1', [payload.email]);
  if (result.rowCount === 0) throw new AppError(401, 'Invalid credentials');

  const user = result.rows[0];
  if (user.status !== 'active') throw new AppError(403, 'Account suspended');

  const matches = await bcrypt.compare(payload.password, user.password_hash);
  if (!matches) throw new AppError(401, 'Invalid credentials');

  const token = jwt.sign({ userId: user.id, role: user.role, email: user.email }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn
  });

  return {
    token,
    user: { id: user.id, fullName: user.full_name, email: user.email, role: user.role }
  };
}
