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

// Limpia sufijos genéricos que se agregaban automáticamente
function cleanRestaurantName(name) {
  return name.replace(/\s+kitchen$/i, '').replace(/\s+restaurant$/i, '').trim();
}

export async function registerUser(payload) {
  const username = normalizeUsername(payload.username);
  const pseudoEmail = pseudoEmailFromUsername(username);
  // display_name respeta capitalización; si no se dio, usamos username
  const displayName = (payload.displayName || payload.username || username).trim();

  const existing = await query('SELECT id FROM users WHERE email = $1', [pseudoEmail]);
  if (existing.rowCount > 0) throw new AppError(409, 'Username already registered');

  const passwordHash = await bcrypt.hash(payload.password, 12);
  const userAddress = payload.role === 'customer' ? (payload.address || null) : null;

  let result;
  try {
    result = await query(
      'INSERT INTO users(full_name, email, password_hash, role, address) VALUES($1, $2, $3, $4, $5) RETURNING id, full_name, email, role, address',
      [displayName, pseudoEmail, passwordHash, payload.role, userAddress]
    );
  } catch (error) {
    if (error?.code === '42703') {
      result = await query(
        'INSERT INTO users(full_name, email, password_hash, role) VALUES($1, $2, $3, $4) RETURNING id, full_name, email, role',
        [displayName, pseudoEmail, passwordHash, payload.role]
      );
    } else throw error;
  }

  const user = result.rows[0];

  if (user.role === 'restaurant') {
    // Nombre del restaurante = displayName limpio, sin sufijos
    const restName = cleanRestaurantName(displayName);
    const restAddress = payload.address || null;
    try {
      await query(
        'INSERT INTO restaurants(owner_user_id, name, category, address) VALUES($1, $2, $3, $4)',
        [user.id, restName, 'General', restAddress]
      );
    } catch (error) {
      if (error?.code === '42703') {
        await query(
          'INSERT INTO restaurants(owner_user_id, name, category) VALUES($1, $2, $3)',
          [user.id, restName, 'General']
        );
      } else throw error;
    }
  }

  if (user.role === 'driver') {
    await query(
      'INSERT INTO driver_profiles(user_id, vehicle_type, is_verified, is_available) VALUES($1, $2, true, true)',
      [user.id, 'bike']
    );
  }

  return { id: user.id, username, role: user.role, display_name: displayName };
}

export async function loginUser(payload) {
  const username = normalizeUsername(payload.username);
  const pseudoEmail = pseudoEmailFromUsername(username);

  let result;
  try {
    result = await query(
      'SELECT id, full_name, email, password_hash, role, status, address FROM users WHERE email = $1',
      [pseudoEmail]
    );
  } catch (error) {
    if (error?.code === '42703') {
      result = await query(
        'SELECT id, full_name, email, password_hash, role, status FROM users WHERE email = $1',
        [pseudoEmail]
      );
    } else throw error;
  }

  if (result.rowCount === 0) {
    logEvent('auth.login_error', { username, reason: 'user_not_found' });
    throw new AppError(401, 'Credenciales inválidas');
  }

  const user = result.rows[0];
  if (user.status !== 'active') throw new AppError(403, 'Cuenta suspendida');

  const matches = await bcrypt.compare(payload.password, user.password_hash);
  if (!matches) {
    logEvent('auth.login_error', { username, reason: 'bad_password' });
    throw new AppError(401, 'Credenciales inválidas');
  }

  const token = jwt.sign({ userId: user.id, role: user.role, username }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn
  });

  const displayName = user.full_name && user.full_name !== username ? user.full_name : username;
  let profile = { address: user.address || null, display_name: displayName, username, needsAddress: false };

  if (user.role === 'restaurant') {
    try {
      const r = await query('SELECT id, name, address FROM restaurants WHERE owner_user_id = $1 LIMIT 1', [user.id]);
      profile.restaurant = r.rows[0] || null;
      profile.address = r.rows[0]?.address || null;
    } catch (error) {
      if (error?.code !== '42703') throw error;
    }
  }

  if (user.role === 'driver') {
    try {
      const d = await query('SELECT driver_number, is_available FROM driver_profiles WHERE user_id = $1', [user.id]);
      profile.driver = d.rows[0] || { driver_number: null, is_available: true };
    } catch (error) {
      if (error?.code === '42703') {
        const f = await query('SELECT is_available FROM driver_profiles WHERE user_id = $1', [user.id]);
        profile.driver = { driver_number: null, is_available: f.rows[0]?.is_available ?? true };
      } else throw error;
    }
  }

  if (['customer', 'restaurant'].includes(user.role) && !profile.address) {
    profile.needsAddress = true;
  }

  return { token, user: { id: user.id, username, role: user.role, ...profile } };
}

export async function updateProfileAddress(userId, role, address, displayName) {
  const result = {};

  if (displayName && displayName.trim()) {
    const cleanName = displayName.trim();
    try {
      await query('UPDATE users SET full_name = $1 WHERE id = $2', [cleanName, userId]);
      result.displayName = cleanName;
    } catch (_) {}

    // Si es restaurante, sincronizar el nombre del restaurante con el display_name
    if (role === 'restaurant') {
      try {
        const restName = cleanRestaurantName(cleanName);
        await query('UPDATE restaurants SET name = $1 WHERE owner_user_id = $2', [restName, userId]);
      } catch (_) {}
    }
  }

  if (address && address.trim()) {
    if (role === 'restaurant') {
      try {
        await query('UPDATE restaurants SET address = $1 WHERE owner_user_id = $2', [address.trim(), userId]);
      } catch (error) { if (error?.code !== '42703') throw error; }
    } else {
      try {
        await query('UPDATE users SET address = $1 WHERE id = $2', [address.trim(), userId]);
      } catch (error) { if (error?.code !== '42703') throw error; }
    }
    result.address = address.trim();
  }

  return result;
}

export async function changePassword(userId, currentPassword, newPassword) {
  const result = await query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  if (result.rowCount === 0) throw new AppError(404, 'Usuario no encontrado');

  if (currentPassword) {
    const matches = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!matches) throw new AppError(401, 'Contraseña actual incorrecta');
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, userId]);
}

export async function deleteAccount(userId) {
  await query('DELETE FROM users WHERE id = $1', [userId]);
  return { ok: true };
}
