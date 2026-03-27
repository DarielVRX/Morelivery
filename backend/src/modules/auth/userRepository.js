// backend/src/modules/auth/userRepository.js
import { query }    from '../../config/db.js';
import { AppError } from '../../utils/errors.js';

export function normalizeUsername(u)       { return u.trim().toLowerCase(); }
export function pseudoEmailFromUsername(u) { return `${normalizeUsername(u)}@local.test`; }

export const PENDING_STATUSES = ['created','assigned','accepted','preparing','ready','on_the_way','pending_driver'];

// ── Username único ────────────────────────────────────────────────────────────
export async function resolveUniqueUsername(candidate) {
  const base = candidate
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 27) || 'user';

  const taken = await query('SELECT 1 FROM users WHERE email = $1', [pseudoEmailFromUsername(base)]);
  if (taken.rowCount === 0) return base;

  for (let i = 0; i < 20; i++) {
    const suffix = Math.random().toString(36).slice(2, 5);
    const c2     = `${base}${suffix}`;
    const r      = await query('SELECT 1 FROM users WHERE email = $1', [pseudoEmailFromUsername(c2)]);
    if (r.rowCount === 0) return c2;
  }
  return `${base}${Date.now().toString(36).slice(-4)}`;
}

// ── Fingerprint ───────────────────────────────────────────────────────────────
export async function checkAndSaveFingerprint(fingerprint, userId, role) {
  if (!fingerprint) return;
  try {
    const blocked = await query('SELECT 1 FROM blocked_fingerprints WHERE fingerprint = $1', [fingerprint]);
    if (blocked.rowCount > 0) throw new AppError(403, 'No es posible crear una cuenta desde este dispositivo.');
  } catch (e) {
    if (e instanceof AppError) throw e;
    if (e?.code !== '42P01') throw e;
  }
  try {
    const existing = await query(
      'SELECT id FROM users WHERE device_fp = $1 AND id <> $2 AND role = $3 LIMIT 1',
      [fingerprint, userId, role],
    );
    if (existing.rowCount > 0) {
      await query('UPDATE users SET status = $1 WHERE id = $2', ['suspended', userId]);
      throw new AppError(403, 'Detectamos una cuenta relacionada con este dispositivo. Contacta a soporte si crees que esto es un error.');
    }
  } catch (e) {
    if (e instanceof AppError) throw e;
    if (e?.code !== '42703') throw e;
  }
  try { await query('UPDATE users SET device_fp = $1 WHERE id = $2', [fingerprint, userId]); } catch (_) {}
}

// ── Insertar usuario ──────────────────────────────────────────────────────────
export async function insertUser({ fullName, alias, pseudoEmail, realEmail, passwordHash, role, address, postalCode, colonia, estado, ciudad, phone, verifyToken, verifyExpires }) {
  try {
    const r = await query(
      `INSERT INTO users
       (full_name, alias, email, real_email, password_hash, role, status, address,
        postal_code, colonia, estado, ciudad, phone,
        email_verified, email_verify_token, email_verify_expires)
       VALUES($1,$2,$3,$4,$5,$6,'active',$7,$8,$9,$10,$11,$12,false,$13,$14)
       RETURNING id, full_name, alias, email, real_email, role, address`,
      [fullName, alias, pseudoEmail, realEmail, passwordHash, role, address,
       postalCode || null, colonia || null, estado || null, ciudad || null,
       phone || null, verifyToken, verifyExpires],
    );
    return r.rows[0];
  } catch (e) {
    if (e?.code !== '42703') throw e;
    // Fallback: columnas nuevas aún no migradas
    const r = await query(
      `INSERT INTO users(full_name, alias, email, real_email, password_hash, role, status, address,
        email_verified, email_verify_token, email_verify_expires)
       VALUES($1,$2,$3,$4,$5,$6,'active',$7,false,$8,$9)
       RETURNING id, full_name, alias, email, real_email, role, address`,
      [fullName, alias, pseudoEmail, realEmail, passwordHash, role, address, verifyToken, verifyExpires],
    );
    return r.rows[0];
  }
}

// ── Buscar usuario para login ─────────────────────────────────────────────────
export async function findUserForLogin(email, role) {
  const rawEmail = email.trim().toLowerCase();
  const isLegacy = rawEmail.endsWith('@local.test');
  if (isLegacy) {
    const r = await query(
      'SELECT id, full_name, alias, email, password_hash, role, status, address, email_verified FROM users WHERE email = $1',
      [rawEmail],
    );
    return r.rows[0] || null;
  }
  try {
    const roleFilter = role ? 'AND role = $2' : '';
    const params     = role ? [rawEmail, role] : [rawEmail];
    const r = await query(
      `SELECT id, full_name, alias, email, real_email, password_hash, role, status, address, email_verified
       FROM users WHERE real_email = $1 ${roleFilter}`,
      params,
    );
    return r.rows[0] || null;
  } catch (e) {
    if (e?.code !== '42703') throw e;
    const r = await query(
      'SELECT id, full_name, alias, email, password_hash, role, status, address FROM users WHERE email = $1',
      [pseudoEmailFromUsername(rawEmail.split('@')[0])],
    );
    return r.rows[0] || null;
  }
}

// ── Perfil extendido post-login ───────────────────────────────────────────────
export async function fetchUserProfile(userId) {
  try {
    const r = await query(
      'SELECT address, lat, lng, home_lat, home_lng, postal_code, colonia, estado, ciudad FROM users WHERE id = $1',
      [userId],
    );
    return r.rows[0] || {};
  } catch (_) { return {}; }
}

export async function fetchRestaurantProfile(userId) {
  try {
    const r = await query(
      'SELECT id, name, category, is_open, profile_photo FROM restaurants WHERE owner_user_id = $1 LIMIT 1',
      [userId],
    );
    return r.rows[0] || null;
  } catch (e) {
    if (e?.code !== '42703') throw e;
    const r = await query('SELECT id, name, is_open FROM restaurants WHERE owner_user_id = $1 LIMIT 1', [userId]);
    return r.rows[0] || null;
  }
}

export async function fetchDriverProfile(userId) {
  try {
    const r = await query('SELECT driver_number, is_available FROM driver_profiles WHERE user_id = $1', [userId]);
    return r.rows[0] || { driver_number: null, is_available: true };
  } catch (e) {
    if (e?.code !== '42703') throw e;
    const r = await query('SELECT is_available FROM driver_profiles WHERE user_id = $1', [userId]);
    return { driver_number: null, is_available: r.rows[0]?.is_available ?? true };
  }
}

// ── Crear perfiles de rol ─────────────────────────────────────────────────────
export async function createRestaurantProfile(userId, name) {
  try {
    await query(
      `INSERT INTO restaurants(owner_user_id, name, category, is_open, is_verified) VALUES($1,$2,'General',false,false)`,
      [userId, name],
    );
  } catch (e) {
    if (e?.code === '42703') {
      await query('INSERT INTO restaurants(owner_user_id, name, category) VALUES($1,$2,$3)', [userId, name, 'General']).catch(() => {});
    } else if (e?.code !== '23505') throw e;
  }
}

export async function createDriverProfile(userId, vehicleType = 'bike') {
  try {
    await query(
      'INSERT INTO driver_profiles(user_id, vehicle_type, is_verified, is_available) VALUES($1,$2,true,false)',
      [userId, vehicleType],
    );
  } catch (e) {
    if (e?.code !== '23505') throw e;
  }
}

// ── Google ────────────────────────────────────────────────────────────────────
export async function findUserByGoogle(realEmail, googleId, role) {
  try {
    const r = await query(
      'SELECT * FROM users WHERE (real_email = $1 OR google_id = $2) AND role = $3 LIMIT 1',
      [realEmail, googleId, role],
    );
    return r.rows[0] || null;
  } catch (e) {
    if (e?.code !== '42703') throw e;
    const r = await query('SELECT * FROM users WHERE email = $1 AND role = $2 LIMIT 1', [realEmail, role]);
    return r.rows[0] || null;
  }
}

export async function insertGoogleUser({ fullName, alias, pseudoEmail, realEmail, googleId, role, passwordHash }) {
  try {
    const r = await query(
      `INSERT INTO users(full_name, alias, email, real_email, google_id, role, status, password_hash, email_verified)
       VALUES($1,$2,$3,$4,$5,$6,'active',$7,true) RETURNING *`,
      [fullName, alias, pseudoEmail, realEmail, googleId, role, passwordHash],
    );
    return r.rows[0];
  } catch (e) {
    if (e?.code !== '42703') throw e;
    const r = await query(
      `INSERT INTO users(full_name, alias, email, role, status, password_hash) VALUES($1,$2,$3,$4,'active',$5) RETURNING *`,
      [fullName, alias, pseudoEmail, role, passwordHash],
    );
    return r.rows[0];
  }
}

export async function linkGoogleId(userId, googleId, role) {
  try {
    await query('UPDATE users SET google_id=$1, email_verified=true WHERE id=$2 AND role=$3', [googleId, userId, role]);
  } catch (_) {}
}

// ── Verificación email ────────────────────────────────────────────────────────
export async function markEmailVerified(realEmail) {
  try {
    const r = await query(
      `UPDATE users SET email_verified=true, email_verify_token=NULL, email_verify_expires=NULL
       WHERE real_email=$1 AND email_verified=false RETURNING id`,
      [realEmail],
    );
    return r.rowCount > 0;
  } catch (e) {
    if (e?.code === '42703') return true;
    throw e;
  }
}

export async function updateVerifyToken(userId, token, expires) {
  await query(
    'UPDATE users SET email_verify_token=$1, email_verify_expires=$2 WHERE id=$3',
    [token, expires, userId],
  ).catch(() => {});
}

export async function findUnverifiedCustomer(realEmail) {
  const r = await query(
    'SELECT id, alias, full_name, email_verified FROM users WHERE real_email=$1 AND role=$2',
    [realEmail, 'customer'],
  ).catch(() => ({ rows: [] }));
  return r.rows[0] || null;
}

// ── Password ──────────────────────────────────────────────────────────────────
export async function updatePasswordHash(userId, hash) {
  await query('UPDATE users SET password_hash=$1, google_id=NULL WHERE id=$2', [hash, userId]);
}

export async function findUserById(userId) {
  const r = await query('SELECT password_hash, google_id FROM users WHERE id=$1', [userId]);
  return r.rows[0] || null;
}

// ── Profile update ────────────────────────────────────────────────────────────
export async function updateUserProfile(userId, fields) {
  const updates = [], vals = [];
  let i = 1;
  for (const [col, val] of Object.entries(fields)) {
    if (val === undefined) continue;
    updates.push(`${col}=$${i++}`);
    vals.push(val);
  }
  if (!updates.length) return;
  vals.push(userId);
  try {
    await query(`UPDATE users SET ${updates.join(',')} WHERE id=$${i}`, vals);
  } catch (e) {
    if (e?.code !== '42703') throw e;
    // Reintento con solo columnas base
    const safe = [['full_name', fields.full_name], ['alias', fields.alias], ['address', fields.address],
                   ['lat', fields.lat], ['lng', fields.lng], ['home_lat', fields.home_lat], ['home_lng', fields.home_lng],
                   ['postal_code', fields.postal_code], ['colonia', fields.colonia], ['estado', fields.estado], ['ciudad', fields.ciudad]];
    const s = [], sv = []; let j = 1;
    for (const [col, val] of safe) {
      if (val === undefined) continue;
      s.push(`${col}=$${j++}`); sv.push(val);
    }
    if (s.length) { sv.push(userId); await query(`UPDATE users SET ${s.join(',')} WHERE id=$${j}`, sv).catch(() => {}); }
  }
}

export async function fetchFullUserProfile(userId) {
  try {
    const r = await query(
      'SELECT full_name, alias, address, lat, lng, home_lat, home_lng, postal_code, colonia, estado, ciudad FROM users WHERE id=$1',
      [userId],
    );
    return r.rows[0] || {};
  } catch (_) {
    const r = await query('SELECT full_name, alias, address FROM users WHERE id=$1', [userId]).catch(() => ({ rows: [] }));
    return r.rows[0] || {};
  }
}

// ── Delete account ────────────────────────────────────────────────────────────
export async function hasPendingOrders(userId, role) {
  if (role === 'customer') {
    const r = await query(`SELECT 1 FROM orders WHERE customer_id=$1 AND status=ANY($2::text[]) LIMIT 1`, [userId, PENDING_STATUSES]);
    return r.rowCount > 0;
  }
  if (role === 'driver') {
    const r = await query(`SELECT 1 FROM orders WHERE driver_id=$1 AND status=ANY($2::text[]) LIMIT 1`, [userId, PENDING_STATUSES]);
    return r.rowCount > 0;
  }
  if (role === 'restaurant') {
    const r = await query(
      `SELECT 1 FROM orders o JOIN restaurants rest ON rest.id=o.restaurant_id
       WHERE rest.owner_user_id=$1 AND o.status=ANY($2::text[]) LIMIT 1`,
      [userId, PENDING_STATUSES],
    );
    return r.rowCount > 0;
  }
  return false;
}

export async function deleteUserData(userId, role) {
  if (role === 'driver') {
    await query('DELETE FROM driver_profiles WHERE user_id=$1', [userId]).catch(() => {});
  }
  if (role === 'restaurant') {
    const rest = await query('SELECT id FROM restaurants WHERE owner_user_id=$1', [userId]).catch(() => ({ rows: [] }));
    if (rest.rows[0]) {
      await query('UPDATE orders SET restaurant_id=NULL WHERE restaurant_id=$1', [rest.rows[0].id]).catch(() => {});
      await query('DELETE FROM restaurants WHERE id=$1', [rest.rows[0].id]).catch(() => {});
    }
  }
  await query('DELETE FROM users WHERE id=$1', [userId]);
}

export async function updateLoginEmail(userId, role, newEmail) {
  const taken = await query('SELECT id FROM users WHERE email=$1 AND role=$2 AND id<>$3', [newEmail, role, userId]);
  if (taken.rowCount > 0) return false;
  await query('UPDATE users SET email=$1 WHERE id=$2', [newEmail, userId]);
  return true;
}
