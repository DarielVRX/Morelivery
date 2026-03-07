// backend/modules/auth/service.js
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../../config/db.js';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';
import { logEvent } from '../../utils/logger.js';

function normalizeUsername(username) { return username.trim().toLowerCase(); }
function pseudoEmailFromUsername(username) { return `${normalizeUsername(username)}@local.test`; }
function firstNameFromUsername(username) { return username.split(/[_\-.\s]/)[0] || username; }

const PENDING_STATUSES = ['created','assigned','accepted','preparing','ready','on_the_way','pending_driver'];

export async function registerUser(payload) {
  const username = normalizeUsername(payload.username);
  const pseudoEmail = pseudoEmailFromUsername(username);

  const existing = await query('SELECT id FROM users WHERE email = $1', [pseudoEmail]);
  if (existing.rowCount > 0) throw new AppError(409, 'Ese nombre de usuario ya está registrado');

  const passwordHash = await bcrypt.hash(payload.password, 12);
  const userAddress = payload.role === 'customer' ? payload.address || null : null;

  let result;
  try {
    result = await query(
      'INSERT INTO users(full_name, email, password_hash, role, address) VALUES($1,$2,$3,$4,$5) RETURNING id, full_name, email, role, address',
      [username, pseudoEmail, passwordHash, payload.role, userAddress]
    );
  } catch (error) {
    if (error?.code === '42703') {
      result = await query(
        'INSERT INTO users(full_name, email, password_hash, role) VALUES($1,$2,$3,$4) RETURNING id, full_name, email, role',
        [username, pseudoEmail, passwordHash, payload.role]
      );
    } else throw error;
  }

  const user = result.rows[0];

  if (user.role === 'restaurant') {
    const restName = cleanRestaurantName(payload.displayName || username);
    try {
      await query('INSERT INTO restaurants(owner_user_id, name, category, address) VALUES($1,$2,$3,$4)',
        [user.id, restName, 'General', payload.address || null]);
    } catch (error) {
      if (error?.code === '42703') await query('INSERT INTO restaurants(owner_user_id, name, category) VALUES($1,$2,$3)', [user.id, restName, 'General']);
      else throw error;
    }
  }

  if (user.role === 'driver') {
    await query('INSERT INTO driver_profiles(user_id, vehicle_type, is_verified, is_available) VALUES($1,$2,true,true)', [user.id, 'bike']);
  }

  return { id: user.id, username, role: user.role };
}

export async function loginUser(payload) {
  const username = normalizeUsername(payload.username);
  const pseudoEmail = pseudoEmailFromUsername(username);

  let result;
  try {
    result = await query('SELECT id, full_name, email, password_hash, role, status, address FROM users WHERE email = $1', [pseudoEmail]);
  } catch (error) {
    if (error?.code === '42703') result = await query('SELECT id, full_name, email, password_hash, role, status FROM users WHERE email = $1', [pseudoEmail]);
    else throw error;
  }

  if (result.rowCount === 0) { logEvent('auth.login_error', { username, reason: 'user_not_found' }); throw new AppError(401, 'Credenciales inválidas'); }

  const user = result.rows[0];
  if (user.status !== 'active') { logEvent('auth.login_error', { username, reason: 'suspended' }); throw new AppError(403, 'Cuenta suspendida'); }

  const matches = await bcrypt.compare(payload.password, user.password_hash);
  if (!matches) { logEvent('auth.login_error', { username, reason: 'bad_password' }); throw new AppError(401, 'Credenciales inválidas'); }

  const token = jwt.sign({ userId: user.id, role: user.role, username }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });

  let profile = { address: user.address || null, firstName: firstNameFromUsername(username), displayName: user.full_name || username, needsAddress: false };

  if (user.role === 'restaurant') {
    try {
      const r = await query('SELECT id, name, address, is_open FROM restaurants WHERE owner_user_id = $1 LIMIT 1', [user.id]);
      profile.restaurant = r.rows[0] || null;
      profile.address = r.rows[0]?.address || null;
    } catch (error) {
      if (error?.code === '42703') {
        const r = await query('SELECT id, name FROM restaurants WHERE owner_user_id = $1 LIMIT 1', [user.id]);
        profile.restaurant = r.rows[0] || null;
      } else throw error;
    }
  }

  if (user.role === 'driver') {
    try {
      const r = await query('SELECT driver_number, is_available FROM driver_profiles WHERE user_id = $1', [user.id]);
      profile.driver = r.rows[0] || { driver_number: null, is_available: true };
    } catch (error) {
      if (error?.code === '42703') {
        const r = await query('SELECT is_available FROM driver_profiles WHERE user_id = $1', [user.id]);
        profile.driver = { driver_number: null, is_available: r.rows[0]?.is_available ?? true };
      } else throw error;
    }
  }

  if (['customer', 'restaurant'].includes(user.role) && !profile.address) profile.needsAddress = true;

  return { token, user: { id: user.id, username, role: user.role, ...profile } };
}

export async function updateProfileAddress(userId, role, address, displayName) {
  if (role === 'restaurant') {
    if (address !== undefined && address !== null) {
      try { await query('UPDATE restaurants SET address=$1 WHERE owner_user_id=$2', [address, userId]); }
      catch (e) { if (e?.code !== '42703') throw e; }
    }
    if (displayName !== undefined && displayName !== null) {
      const cleanName = cleanRestaurantName(displayName);
      try {
        await query('UPDATE restaurants SET name=$1 WHERE owner_user_id=$2', [cleanName, userId]);
        await query('UPDATE users SET full_name=$1 WHERE id=$2', [displayName.trim(), userId]);
      } catch (e) { if (e?.code !== '42703') throw e; }
    }
  } else {
    // customer / driver / admin
    const updates = [];
    const vals = [];
    let i = 1;
    if (displayName !== undefined && displayName !== null) { updates.push(`full_name=$${i++}`); vals.push(displayName.trim()); }
    if (address !== undefined && address !== null)         { updates.push(`address=$${i++}`);    vals.push(address); }
    if (updates.length > 0) {
      vals.push(userId);
      try { await query(`UPDATE users SET ${updates.join(',')} WHERE id=$${i}`, vals); }
      catch (e) { if (e?.code !== '42703') throw e; }
    }
  }

  // Leer valores confirmados desde la DB para devolver al cliente
  const confirmed = await query(
    'SELECT full_name, address FROM users WHERE id=$1', [userId]
  );
  const row = confirmed.rows[0] || {};
  return {
    address:     row.address    ?? address ?? null,
    displayName: row.full_name  ?? displayName ?? null,
  };
}

export async function changePassword(userId, currentPassword, newPassword) {
  const r = await query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  if (r.rowCount === 0) throw new AppError(404, 'Usuario no encontrado');
  if (currentPassword) {
    const matches = await bcrypt.compare(currentPassword, r.rows[0].password_hash);
    if (!matches) throw new AppError(401, 'Contraseña actual incorrecta');
  }
  const newHash = await bcrypt.hash(newPassword, 12);
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, userId]);
}

export async function deleteAccount(userId, role) {
  // Bloquear si tiene pedidos activos
  let hasPending = false;

  if (role === 'customer') {
    const r = await query(`SELECT 1 FROM orders WHERE customer_id=$1 AND status=ANY($2::text[]) LIMIT 1`, [userId, PENDING_STATUSES]);
    hasPending = r.rowCount > 0;
  } else if (role === 'driver') {
    const r = await query(`SELECT 1 FROM orders WHERE driver_id=$1 AND status=ANY($2::text[]) LIMIT 1`, [userId, PENDING_STATUSES]);
    hasPending = r.rowCount > 0;
  } else if (role === 'restaurant') {
    const r = await query(
      `SELECT 1 FROM orders o JOIN restaurants rest ON rest.id=o.restaurant_id
       WHERE rest.owner_user_id=$1 AND o.status=ANY($2::text[]) LIMIT 1`,
      [userId, PENDING_STATUSES]
    );
    hasPending = r.rowCount > 0;
  }

  if (hasPending) {
    throw new AppError(409, 'No puedes eliminar tu cuenta mientras tengas pedidos activos. Completa o cancela tus pedidos primero.');
  }

  await query('DELETE FROM users WHERE id = $1', [userId]);
  return { ok: true };
}

export async function updateLoginUsername(userId, role, currentPassword, newUsername) {
  const normalized = normalizeUsername(newUsername);
  const newEmail   = pseudoEmailFromUsername(normalized);

  // Verificar contraseña actual
  const r = await query('SELECT password_hash FROM users WHERE id=$1', [userId]);
  if (r.rowCount === 0) throw new AppError(404, 'Usuario no encontrado');
  const matches = await bcrypt.compare(currentPassword, r.rows[0].password_hash);
  if (!matches) throw new AppError(401, 'Contraseña actual incorrecta');

  // Verificar disponibilidad del nuevo username en el mismo rol
  const taken = await query(
    'SELECT id FROM users WHERE email=$1 AND role=$2 AND id<>$3',
    [newEmail, role, userId]
  );
  if (taken.rowCount > 0) throw new AppError(409, 'Ese usuario de acceso ya está en uso');

  await query('UPDATE users SET email=$1 WHERE id=$2', [newEmail, userId]);
  return { username: normalized };
}

export function cleanRestaurantName(name) {
  return name.trim().replace(/\s+(kitchen|restaurant)$/i, '');
}
