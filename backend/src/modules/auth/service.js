import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../../config/db.js';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';
import { logEvent } from '../../utils/logger.js';

function normalizeUsername(username) {
  return username.trim().toLowerCase();
}

function pseudoEmailFromUsername(username) {
  return `${normalizeUsername(username)}@local.test`;
}

function firstNameFromUsername(username) {
  return username.split(/[_\-.\s]/)[0] || username;
}

export async function registerUser(payload) {
  const username = normalizeUsername(payload.username);
  const pseudoEmail = pseudoEmailFromUsername(username);

  const existing = await query('SELECT id FROM users WHERE email = $1', [pseudoEmail]);
  if (existing.rowCount > 0) throw new AppError(409, 'Username already registered');

  const passwordHash = await bcrypt.hash(payload.password, 12);
  const userAddress = payload.role === 'customer' ? payload.address || null : null;

  const result = await query(
    'INSERT INTO users(full_name, email, password_hash, role, address) VALUES($1, $2, $3, $4, $5) RETURNING id, full_name, email, role, address',
    [username, pseudoEmail, passwordHash, payload.role, userAddress]
  );

  const user = result.rows[0];

  if (user.role === 'restaurant') {
    await query('INSERT INTO restaurants(owner_user_id, name, category, address) VALUES($1, $2, $3, $4)', [
      user.id,
      `${username} kitchen`,
      'General',
      payload.address || null
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

  const result = await query('SELECT id, full_name, email, password_hash, role, status, address FROM users WHERE email = $1', [pseudoEmail]);
  if (result.rowCount === 0) {
    logEvent('auth.login_error', { username, reason: 'user_not_found' });
    throw new AppError(401, 'Invalid credentials');
  }

  const user = result.rows[0];
  if (user.status !== 'active') {
    logEvent('auth.login_error', { username, reason: 'suspended' });
    throw new AppError(403, 'Account suspended');
  }

  const matches = await bcrypt.compare(payload.password, user.password_hash);
  if (!matches) {
    logEvent('auth.login_error', { username, reason: 'bad_password' });
    throw new AppError(401, 'Invalid credentials');
  }

  const token = jwt.sign({ userId: user.id, role: user.role, username }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn
  });

  let profile = { address: user.address || null, firstName: firstNameFromUsername(username), needsAddress: false };
  if (user.role === 'restaurant') {
    const restaurantResult = await query('SELECT id, name, address FROM restaurants WHERE owner_user_id = $1 LIMIT 1', [user.id]);
    profile.restaurant = restaurantResult.rows[0] || null;
    profile.address = restaurantResult.rows[0]?.address || null;
  }
  if (user.role === 'driver') {
    try {
      const driverResult = await query('SELECT driver_number, is_available FROM driver_profiles WHERE user_id = $1', [user.id]);
      profile.driver = driverResult.rows[0] || { driver_number: null, is_available: true };
    } catch (error) {
      if (error?.code === '42703') {
        const fallback = await query('SELECT is_available FROM driver_profiles WHERE user_id = $1', [user.id]);
        profile.driver = { driver_number: null, is_available: fallback.rows[0]?.is_available ?? true };
      } else {
        throw error;
      }
    }
  }

  if (['customer', 'restaurant'].includes(user.role) && !profile.address) {
    profile.needsAddress = true;
  }

  return {
    token,
    user: { id: user.id, username, role: user.role, ...profile }
  };
}

export async function updateProfileAddress(userId, role, address) {
  if (role === 'restaurant') {
    await query('UPDATE restaurants SET address = $1 WHERE owner_user_id = $2', [address, userId]);
    return { address };
  }
  await query('UPDATE users SET address = $1 WHERE id = $2', [address, userId]);
  return { address };
}

export async function deleteAccount(userId) {
  await query('DELETE FROM users WHERE id = $1', [userId]);
  return { ok: true };
}
