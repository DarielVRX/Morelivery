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
      'INSERT INTO users(full_name, alias, email, password_hash, role, address) VALUES($1,$2,$3,$4,$5,$6) RETURNING id, full_name, alias, email, role, address',
                         [username, payload.displayName?.trim() || username, pseudoEmail, passwordHash, payload.role, userAddress]
    );
  } catch (error) {
    if (error?.code === '42703') {
      result = await query(
        'INSERT INTO users(full_name, alias, email, password_hash, role) VALUES($1,$2,$3,$4,$5) RETURNING id, full_name, alias, email, role',
                           [username, payload.displayName?.trim() || username, pseudoEmail, passwordHash, payload.role]
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
    result = await query('SELECT id, full_name, alias, email, password_hash, role, status, address FROM users WHERE email = $1', [pseudoEmail]);
  } catch (error) {
    if (error?.code === '42703') result = await query('SELECT id, full_name, alias, email, password_hash, role, status FROM users WHERE email = $1', [pseudoEmail]);
    else throw error;
  }

  if (result.rowCount === 0) { logEvent('auth.login_error', { username, reason: 'user_not_found' }); throw new AppError(401, 'Credenciales inválidas'); }

  const user = result.rows[0];
  if (user.status !== 'active') { logEvent('auth.login_error', { username, reason: 'suspended' }); throw new AppError(403, 'Cuenta suspendida'); }

  const matches = await bcrypt.compare(payload.password, user.password_hash);
  if (!matches) { logEvent('auth.login_error', { username, reason: 'bad_password' }); throw new AppError(401, 'Credenciales inválidas'); }

  const token = jwt.sign({ userId: user.id, role: user.role, username }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });

  let profile = { address: user.address || null, alias: user.alias || user.full_name || username, needsAddress: false };

  if (user.role === 'restaurant') {
    try {
      const r = await query('SELECT id, name, address, is_open, lat, lng FROM restaurants WHERE owner_user_id = $1 LIMIT 1', [user.id]);
      profile.restaurant = r.rows[0] || null;
      profile.address = r.rows[0]?.address || null;
      profile.lat     = r.rows[0]?.lat     ?? null;
      profile.lng     = r.rows[0]?.lng     ?? null;
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

export async function updateProfileAddress(userId, role, address, displayName, lat, lng) {
  if (role === 'restaurant') {
    const restUpdates = [];
    const restVals    = [];
    let ri = 1;
    if (address !== undefined && address !== null) { restUpdates.push(`address=$${ri++}`); restVals.push(address); }
    if (lat     !== undefined && lat     !== null) { restUpdates.push(`lat=$${ri++}`);     restVals.push(lat); }
    if (lng     !== undefined && lng     !== null) { restUpdates.push(`lng=$${ri++}`);     restVals.push(lng); }

    if (restUpdates.length > 0) {
      restVals.push(userId);
      try { await query(`UPDATE restaurants SET ${restUpdates.join(',')} WHERE owner_user_id=$${ri}`, restVals); }
      catch (e) { if (e?.code !== '42703') throw e; }
    }

    if (displayName !== undefined && displayName !== null) {
      const cleanName = cleanRestaurantName(displayName);
      try { await query('UPDATE restaurants SET name=$1 WHERE owner_user_id=$2', [cleanName, userId]); }
      catch (e) { if (e?.code !== '42703') throw e; }
      try {
        await query('UPDATE users SET full_name=$1, alias=$1 WHERE id=$2', [displayName.trim(), userId]);
      } catch (e) {
        if (e?.code === '42703') {
          try { await query('UPDATE users SET full_name=$1 WHERE id=$2', [displayName.trim(), userId]); } catch (_) {}
        } else throw e;
      }
    }

    let rRow = {};
    try {
      const rc = await query('SELECT name, address, lat, lng FROM restaurants WHERE owner_user_id=$1', [userId]);
      rRow = rc.rows[0] || {};
    } catch (_) {}
    const uRow = (await query('SELECT full_name, alias FROM users WHERE id=$1', [userId])).rows[0] || {};
    return {
      address:     rRow.address     ?? address     ?? null,
      displayName: uRow.alias       ?? uRow.full_name ?? displayName ?? null,
      alias:       uRow.alias       ?? uRow.full_name ?? displayName ?? null,
      lat:         rRow.lat         ?? null,
      lng:         rRow.lng         ?? null,
    };
  } else {
    // FIX: Se agregaron lat y lng a la consulta principal para clientes/drivers
    const updates = [];
    const vals = [];
    let i = 1;
    if (displayName !== undefined && displayName !== null) {
      updates.push(`full_name=$${i++}`); vals.push(displayName.trim());
      updates.push(`alias=$${i++}`);     vals.push(displayName.trim());
    }
    if (address !== undefined && address !== null) { updates.push(`address=$${i++}`); vals.push(address); }
    if (lat     !== undefined && lat     !== null) { updates.push(`lat=$${i++}`);     vals.push(lat); }
    if (lng     !== undefined && lng     !== null) { updates.push(`lng=$${i++}`);     vals.push(lng); }

    if (updates.length > 0) {
      vals.push(userId);
      try {
        await query(`UPDATE users SET ${updates.join(',')} WHERE id=$${i}`, vals);
      } catch (e) {
        if (e?.code === '42703') {
          const safeUpdates = [];
          const safeVals    = [];
          let j = 1;
          if (address     !== undefined && address     !== null) { safeUpdates.push(`address=$${j++}`);   safeVals.push(address); }
          if (displayName !== undefined && displayName !== null) { safeUpdates.push(`full_name=$${j++}`); safeVals.push(displayName.trim()); }
          // Bloque de compatibilidad mantiene el guardado si las columnas existen
          if (lat         !== undefined && lat         !== null) { safeUpdates.push(`lat=$${j++}`);       safeVals.push(lat); }
          if (lng         !== undefined && lng         !== null) { safeUpdates.push(`lng=$${j++}`);       safeVals.push(lng); }
          if (safeUpdates.length > 0) {
            safeVals.push(userId);
            try { await query(`UPDATE users SET ${safeUpdates.join(',')} WHERE id=$${j}`, safeVals); } catch (_) {}
          }
        } else throw e;
      }
    }
    let row = {};
    try {
      const confirmed = await query('SELECT full_name, alias, address, lat, lng FROM users WHERE id=$1', [userId]);
      row = confirmed.rows[0] || {};
    } catch (_) {
      try {
        const confirmed = await query('SELECT full_name, alias, address FROM users WHERE id=$1', [userId]);
        row = confirmed.rows[0] || {};
      } catch (_2) {}
    }
    return {
      address:     row.address ?? address ?? null,
      displayName: row.alias   ?? row.full_name ?? displayName ?? null,
      alias:       row.alias   ?? row.full_name ?? displayName ?? null,
      lat:         row.lat  ?? null,
      lng:         row.lng  ?? null,
    };
  }
}

export async function changePassword(userId, currentPassword, newPassword) {
  const r = await query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  if (r.rowCount === 0) throw new App
