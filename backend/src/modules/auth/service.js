import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../../config/db.js';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';

function normalizeUsername(username) {
  return username.trim().toLowerCase();
}

function pseudoEmailFromUsername(username) {
  return `${normalizeUsername(username)}@local.test`;
}

export async function registerUser(payload) {
  const username = normalizeUsername(payload.username);
  const pseudoEmail = pseudoEmailFromUsername(username);

  const existing = await query('SELECT id FROM users WHERE email = $1', [pseudoEmail]);
  if (existing.rowCount > 0) throw new AppError(409, 'Username already registered');

  const passwordHash = await bcrypt.hash(payload.password, 12);

  const result = await query(
    'INSERT INTO users(full_name, email, password_hash, role) VALUES($1, $2, $3, $4) RETURNING id, full_name, email, role',
    [username, pseudoEmail, passwordHash, payload.role]
  );

  const user = result.rows[0];

  if (user.role === 'restaurant') {
    await query('INSERT INTO restaurants(owner_user_id, name, category) VALUES($1, $2, $3)', [
      user.id,
      `${username} kitchen`,
      'General'
    ]);
  }

  if (user.role === 'driver') {
    await query('INSERT INTO driver_profiles(user_id, vehicle_type, is_verified, is_available) VALUES($1, $2, true, true)', [
      user.id,
      'bike'
    ]);
  }

  return { id: user.id, username, role: user.role };
}

export async function loginUser(payload) {
  const username = normalizeUsername(payload.username);
  const pseudoEmail = pseudoEmailFromUsername(username);

  const result = await query('SELECT id, full_name, email, password_hash, role, status FROM users WHERE email = $1', [pseudoEmail]);
  if (result.rowCount === 0) throw new AppError(401, 'Invalid credentials');

  const user = result.rows[0];
  if (user.status !== 'active') throw new AppError(403, 'Account suspended');

  const matches = await bcrypt.compare(payload.password, user.password_hash);
  if (!matches) throw new AppError(401, 'Invalid credentials');

  const token = jwt.sign({ userId: user.id, role: user.role, username }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn
  });

  let profile = {};
  if (user.role === 'restaurant') {
    const restaurantResult = await query('SELECT id, name FROM restaurants WHERE owner_user_id = $1 LIMIT 1', [user.id]);
    profile.restaurant = restaurantResult.rows[0] || null;
  }
  if (user.role === 'driver') {
    const driverResult = await query('SELECT driver_number, is_available FROM driver_profiles WHERE user_id = $1', [user.id]);
    profile.driver = driverResult.rows[0] || null;
  }

  return {
    token,
    user: { id: user.id, username, role: user.role, ...profile }
  };
}
