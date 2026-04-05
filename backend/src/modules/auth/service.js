// backend/src/modules/auth/service.js
import bcrypt        from 'bcryptjs';
import jwt           from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { env }       from '../../config/env.js';
import { AppError }  from '../../utils/errors.js';
import { logEvent }  from '../../utils/logger.js';
import { randomUUID } from 'crypto';
import { checkName } from '../../utils/nameFilter.js';
import { sendGmailSafe, verificationEmail, resendVerificationEmail as resendVerificationEmailTemplate, resetPasswordEmail, accountLockedEmail, twoFaCodeEmail } from './emailService.js';
import {
  normalizeUsername, pseudoEmailFromUsername, resolveUniqueUsername,
  checkAndSaveFingerprint, insertUser, findUserForLogin,
  fetchUserProfile, fetchRestaurantProfile, fetchDriverProfile,
  createRestaurantProfile, createDriverProfile,
  findUserByGoogle, insertGoogleUser, linkGoogleId,
  markEmailVerified, updateVerifyToken, findUnverifiedCustomer,
  updatePasswordHash, findUserById,
  updateUserProfile, fetchFullUserProfile,
  hasPendingOrders, deleteUserData, updateLoginEmail,
} from './userRepository.js';

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export function cleanRestaurantName(name) {
  return name.trim().replace(/\s+(kitchen|restaurant)$/i, '');
}

function signToken(userId, role, username) {
  return jwt.sign({ userId, role, username }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
}

// ── REGISTER ──────────────────────────────────────────────────────────────────
export async function registerUser(payload) {
  const realEmail = payload.email.trim().toLowerCase();

  if (payload.role === 'customer' && !payload.phone?.trim()) {
    throw new AppError(400, 'El número de teléfono es obligatorio para registrarse como cliente.');
  }

  const nameCheckFull  = checkName(payload.fullName);
  const nameCheckAlias = checkName(payload.alias);
  if (!nameCheckFull.ok)  throw new AppError(400, nameCheckFull.reason);
  if (!nameCheckAlias.ok) throw new AppError(400, nameCheckAlias.reason);

  try {
    const existing = await import('../../config/db.js').then(({ query }) =>
      query('SELECT id FROM users WHERE real_email=$1 AND role=$2', [realEmail, payload.role]),
    );
    if (existing.rowCount > 0) throw new AppError(409, 'Este correo ya está registrado para este tipo de cuenta');
  } catch (e) {
    if (e instanceof AppError) throw e;
    if (e?.code !== '42703') throw e;
  }

  const username    = await resolveUniqueUsername(payload.username || payload.alias);
  const pseudoEmail = pseudoEmailFromUsername(username);
  const { query }   = await import('../../config/db.js');

  const existingPseudo = await query('SELECT id FROM users WHERE email=$1', [pseudoEmail]);
  if (existingPseudo.rowCount > 0) throw new AppError(409, 'Nombre de usuario ya en uso');

  const passwordHash  = await bcrypt.hash(payload.password, 12);
  const verifyToken   = jwt.sign({ email: realEmail, purpose: 'email-verify' }, env.jwtSecret, { expiresIn: '48h' });
  const verifyExpires = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  const addressFull = payload.address ||
    [payload.calle, payload.numero, payload.colonia, payload.ciudad, payload.estado, payload.postalCode]
    .filter(Boolean).join(', ') || null;

  const user = await insertUser({
    fullName: payload.fullName.trim(), alias: payload.alias.trim(),
    pseudoEmail, realEmail, passwordHash, role: payload.role,
    address: ['customer','restaurant'].includes(payload.role) ? addressFull : null,
    postalCode: payload.postalCode, colonia: payload.colonia,
    estado: payload.estado, ciudad: payload.ciudad,
    phone: payload.phone?.trim(),
    verifyToken, verifyExpires,
  });

  if (payload.deviceFingerprint) {
    await checkAndSaveFingerprint(payload.deviceFingerprint, user.id, user.role);
  }

  if (user.role === 'restaurant') {
    const restName = cleanRestaurantName(payload.displayName || payload.alias || payload.fullName);
    await createRestaurantProfile(user.id, restName);
  }
  if (user.role === 'driver') {
    await createDriverProfile(user.id, payload.vehicleType);
  }

  const skipEmail = ['driver','admin'].includes(payload.role) && payload._adminRegister;
  if (!skipEmail) {
    const name = payload.alias || payload.fullName;
    const { subject, html } = verificationEmail(name, verifyToken);
    sendGmailSafe({ to: realEmail, subject, html });
  }

  return { id: user.id, username, role: user.role };
}

// ── LOGIN ─────────────────────────────────────────────────────────────────────
// Umbrales de bloqueo escalonado (intentos acumulativos)
const LOCK_THRESHOLDS = [
  { at: 5,  minutes: 15 },
  { at: 8,  minutes: 60 },
  { at: 10, minutes: 24 * 60 }, // tras este nivel → bloqueo permanente de cuenta
];

function getLockDuration(attempts) {
  // De mayor a menor para encontrar el umbral alcanzado
  for (let i = LOCK_THRESHOLDS.length - 1; i >= 0; i--) {
    if (attempts >= LOCK_THRESHOLDS[i].at) return LOCK_THRESHOLDS[i].minutes;
  }
  return 0;
}

async function getLoginAttempts(query, email, fingerprint) {
  const fp = fingerprint || null;
  const r  = await query(
    'SELECT * FROM login_attempts WHERE email=$1 AND (fingerprint=$2 OR (fingerprint IS NULL AND $2::text IS NULL)) LIMIT 1',
    [email, fp],
  );
  return r.rows[0] || null;
}

async function recordLoginFailure(query, email, fingerprint, userName) {
  const fp  = fingerprint || null;
  const row = await getLoginAttempts(query, email, fp);

  let newAttempts;
  let lockedUntil = null;

  if (row) {
    newAttempts = row.attempts + 1;
  } else {
    newAttempts = 1;
  }

  const lockMinutes = getLockDuration(newAttempts);
  if (lockMinutes > 0) {
    lockedUntil = new Date(Date.now() + lockMinutes * 60 * 1000);
  }

  if (row) {
    await query(
      'UPDATE login_attempts SET attempts=$1, locked_until=$2, last_attempt=NOW() WHERE id=$3',
      [newAttempts, lockedUntil, row.id],
    );
  } else {
    await query(
      'INSERT INTO login_attempts (email, fingerprint, attempts, locked_until) VALUES ($1,$2,$3,$4)',
      [email, fp, newAttempts, lockedUntil],
    );
  }

  // Fallo 10+: bloquear cuenta y enviar correo de aviso
  if (newAttempts >= 10 && userName) {
    const unlockToken   = jwt.sign({ email, purpose: 'account-unlock' }, process.env.RESET_TOKEN_SECRET || env.jwtSecret, { expiresIn: '1h' });
    const unlockExpires = new Date(Date.now() + 60 * 60 * 1000);
    await query(
      'UPDATE users SET account_locked=TRUE, account_unlock_token=$1, account_unlock_expires=$2 WHERE real_email=$3 OR email=$4',
      [unlockToken, unlockExpires, email, email],
    );
    const { subject, html } = accountLockedEmail(userName, unlockToken);
    sendGmailSafe({ to: email, subject, html });
  }

  return { attempts: newAttempts, lockedUntil };
}

async function clearLoginAttempts(query, email, fingerprint) {
  const fp = fingerprint || null;
  await query(
    'DELETE FROM login_attempts WHERE email=$1 AND (fingerprint=$2 OR (fingerprint IS NULL AND $2::text IS NULL))',
    [email, fp],
  );
}

export async function loginUser(payload) {
  if (!payload.email) throw new AppError(400, 'Correo requerido');

  const { query } = await import('../../config/db.js');
  const fp        = payload.deviceFingerprint || null;

  // ── 1. Verificar bloqueo de dispositivo (login_attempts) ─────────────────
  const attemptRow = await getLoginAttempts(query, payload.email, fp);
  if (attemptRow?.locked_until && new Date(attemptRow.locked_until) > new Date()) {
    throw new AppError(423, 'Dispositivo bloqueado temporalmente para evitar la suspensión de tu cuenta.', {
      lockedUntil: attemptRow.locked_until,
      attempts:    attemptRow.attempts,
    });
  }

  const user = await findUserForLogin(payload.email, payload.role);
  if (!user) {
    logEvent('auth.login_error', { email: payload.email, reason: 'user_not_found' });
    await recordLoginFailure(query, payload.email, fp, null);
    const row = await getLoginAttempts(query, payload.email, fp);
    throw new AppError(401, 'Credenciales inválidas', {
      attempts:     row?.attempts || 1,
      suggestReset: (row?.attempts || 1) >= 3,
      lockedUntil:  row?.locked_until || null,
    });
  }

  if (user.status === 'suspended') throw new AppError(403, 'Cuenta suspendida. Contacta a soporte.');

  // ── 2. Verificar bloqueo permanente de cuenta ─────────────────────────────
  if (user.account_locked) {
    throw new AppError(403, 'Tu cuenta está bloqueada por actividad sospechosa. Revisa tu correo para desbloquearla.');
  }

  if (user.role === 'customer' && user.email_verified === false) {
    throw new AppError(403, 'Debes verificar tu correo electrónico antes de ingresar. Revisa tu bandeja de entrada.');
  }

  // ── 3. Verificar bloqueo de fingerprint permanente ────────────────────────
  if (fp && user.role === 'customer') {
    try {
      const blocked = await query('SELECT 1 FROM blocked_fingerprints WHERE fingerprint=$1', [fp]);
      if (blocked.rowCount > 0) throw new AppError(403, 'Acceso bloqueado desde este dispositivo.');
    } catch (e) { if (e instanceof AppError) throw e; }
  }

  // ── 4. Validar contraseña ─────────────────────────────────────────────────
  const passwordMatch = await bcrypt.compare(payload.password, user.password_hash);
  if (!passwordMatch) {
    logEvent('auth.login_error', { userId: user.id, reason: 'wrong_password' });
    const userName = user.alias || user.full_name || null;
    const { attempts, lockedUntil } = await recordLoginFailure(query, payload.email, fp, userName);
    throw new AppError(401, 'Credenciales inválidas', {
      attempts,
      suggestReset: attempts >= 3,
      lockedUntil:  lockedUntil || null,
    });
  }

  // ── 5. Login correcto: limpiar intentos ───────────────────────────────────
  await clearLoginAttempts(query, payload.email, fp);

  // ── 6. 2FA: si está habilitado, emitir código y detener flujo ─────────────
  if (user.two_fa_enabled) {
    const code        = String(Math.floor(100000 + Math.random() * 900000));
    const codeExpires = new Date(Date.now() + 10 * 60 * 1000);
    await query(
      'UPDATE users SET two_fa_code=$1, two_fa_expires=$2 WHERE id=$3',
      [code, codeExpires, user.id],
    );
    const name = user.alias || user.full_name || 'usuario';
    const realEmail = user.real_email || payload.email;
    const { subject, html } = twoFaCodeEmail(name, code);
    sendGmailSafe({ to: realEmail, subject, html });
    throw new AppError(202, 'Código de verificación enviado a tu correo.', {
      requiresTwoFa: true,
      userId:        user.id,
    });
  }

  const username = user.email.replace(/@local\.test$/, '');
  const token    = signToken(user.id, user.role, username);
  const refresh  = jwt.sign(
    { userId: user.id, purpose: 'refresh' },
    process.env.REFRESH_TOKEN_SECRET || env.jwtSecret,
    { expiresIn: '30d' }
  );

  const profile  = await fetchUserProfile(user.id);
  const extended = {
    alias:       user.alias || user.full_name || username,
    address:     profile.address ?? user.address ?? null,
    lat:         profile.lat         ?? null,
    lng:         profile.lng         ?? null,
    home_lat:    profile.home_lat    ?? null,
    home_lng:    profile.home_lng    ?? null,
    postal_code: profile.postal_code ?? null,
    colonia:     profile.colonia     ?? null,
    estado:      profile.estado      ?? null,
    ciudad:      profile.ciudad      ?? null,
    needsAddress: false,
    two_fa_enabled: user.two_fa_enabled ?? false,
  };

  if (user.role === 'restaurant') extended.restaurant = await fetchRestaurantProfile(user.id);
  if (user.role === 'driver')     extended.driver     = await fetchDriverProfile(user.id);
  if (['customer','restaurant'].includes(user.role) && !extended.address) extended.needsAddress = true;

  return { token, refreshToken: refresh, user: { id: user.id, username, role: user.role, ...extended } };
}


// ── GOOGLE ────────────────────────────────────────────────────────────────────
export async function googleLogin(credential, role = 'customer', confirmRegister = false) {
  if (!process.env.GOOGLE_CLIENT_ID) throw new AppError(501, 'Google login no configurado');

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch { throw new AppError(401, 'Token de Google inválido'); }

  const { email, name, given_name, sub: googleId } = payload;
  const realEmail = email.toLowerCase();

  let user = await findUserByGoogle(realEmail, googleId, role);

  if (!user) {
    // No existe cuenta con este rol — pedir confirmación antes de registrar
    if (!confirmRegister) {
      throw new AppError(404, 'No tienes cuenta en esta sección.', {
        requiresConfirmation: true,
        email: realEmail,
        role,
      });
    }

    // Usuario confirmó registro — crear cuenta
    const alias       = given_name || name?.split(' ')[0] || 'user';
    const username    = await resolveUniqueUsername(alias);
    const pseudoEmail = pseudoEmailFromUsername(username);
    const hash        = await bcrypt.hash(randomUUID(), 12);

    user = await insertGoogleUser({ fullName: name || realEmail.split('@')[0], alias, pseudoEmail, realEmail, googleId, role, passwordHash: hash });

    if (role === 'restaurant') await createRestaurantProfile(user.id, cleanRestaurantName(alias));
    if (role === 'driver')     await createDriverProfile(user.id);
  } else {
    if (!user.google_id) await linkGoogleId(user.id, googleId, role);
  }

  const username = user.email.replace(/@local\.test$/, '');
  const token    = signToken(user.id, user.role, username);

  const extended = {
    alias:        user.alias || user.full_name || username,
    address:      user.address || null,
    needsAddress: ['customer','restaurant'].includes(role) && !user.address,
  };

  if (role === 'restaurant') extended.restaurant = await fetchRestaurantProfile(user.id);
  if (role === 'driver')     extended.driver     = await fetchDriverProfile(user.id);

  return { token, user: { id: user.id, username, role: user.role, ...extended } };
}

// ── EMAIL VERIFICATION ────────────────────────────────────────────────────────
export async function verifyEmail(token) {
  let payload;
  try { payload = jwt.verify(token, env.jwtSecret); }
  catch { throw new AppError(401, 'Enlace inválido o expirado'); }
  if (payload.purpose !== 'email-verify') throw new AppError(401, 'Token inválido');
  const updated = await markEmailVerified(payload.email);
  return updated ? { ok: true } : { alreadyVerified: true };
}

export async function resendVerificationEmail(email) {
  const realEmail = email.trim().toLowerCase();
  const user      = await findUnverifiedCustomer(realEmail);
  if (!user || user.email_verified) return;

  const verifyToken   = jwt.sign({ email: realEmail, purpose: 'email-verify' }, env.jwtSecret, { expiresIn: '48h' });
  const verifyExpires = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  await updateVerifyToken(user.id, verifyToken, verifyExpires);

  const name          = user.alias || user.full_name || 'usuario';
  const { subject, html } = resendVerificationEmailTemplate(name, verifyToken);
  sendGmailSafe({ to: realEmail, subject, html });
}

// ── PASSWORD RESET ────────────────────────────────────────────────────────────
export async function forgotPassword(email) {
  const realEmail = email.trim().toLowerCase();
  const { query } = await import('../../config/db.js');

  let user;
  try {
    const r = await query('SELECT id, alias, full_name FROM users WHERE real_email=$1', [realEmail]);
    user = r.rows[0];
    if (!user) {
      const r2 = await query('SELECT id, alias, full_name FROM users WHERE email=$1',
        [pseudoEmailFromUsername(realEmail.split('@')[0])]);
      user = r2.rows[0];
    }
  } catch (e) {
    if (e?.code !== '42703') return;
    const r = await query('SELECT id, alias, full_name FROM users WHERE email=$1',
      [pseudoEmailFromUsername(realEmail.split('@')[0])]).catch(() => ({ rows: [] }));
    user = r.rows[0];
  }
  if (!user) return;

  const resetToken = jwt.sign(
    { userId: user.id, purpose: 'password-reset' },
    process.env.RESET_TOKEN_SECRET || env.jwtSecret,
    { expiresIn: '15m' },
  );

  const name = user.alias || user.full_name || 'usuario';
  const { subject, html } = resetPasswordEmail(name, resetToken);
  sendGmailSafe({ to: realEmail, subject, html });
}

export async function resetPassword(token, newPassword) {
  let payload;
  try { payload = jwt.verify(token, process.env.RESET_TOKEN_SECRET || env.jwtSecret); }
  catch { throw new AppError(401, 'Enlace inválido o expirado'); }
  if (payload.purpose !== 'password-reset') throw new AppError(401, 'Token inválido');
  const hash = await bcrypt.hash(newPassword, 12);
  await updatePasswordHash(payload.userId, hash);
}

// ── PROFILE UPDATE ────────────────────────────────────────────────────────────
export async function updateProfileAddress(userId, role, address, displayName, lat, lng, homeLat, homeLng, postalCode, colonia, estado, ciudad) {
  const fields = {};
  if (displayName != null) { fields.full_name = displayName.trim(); fields.alias = displayName.trim(); }
  if (address    !== undefined) fields.address     = address;
  if (lat        !== undefined) fields.lat         = lat;
  if (lng        !== undefined) fields.lng         = lng;
  if (homeLat    !== undefined) fields.home_lat    = homeLat;
  if (homeLng    !== undefined) fields.home_lng    = homeLng;
  if (postalCode !== undefined) fields.postal_code = postalCode;
  if (colonia    !== undefined) fields.colonia     = colonia;
  if (estado     !== undefined) fields.estado      = estado;
  if (ciudad     !== undefined) fields.ciudad      = ciudad;

  await updateUserProfile(userId, fields);

  if (role === 'restaurant' && displayName != null) {
    const { query } = await import('../../config/db.js');
    await query('UPDATE restaurants SET name=$1 WHERE owner_user_id=$2', [cleanRestaurantName(displayName), userId]).catch(() => {});
  }

  const row = await fetchFullUserProfile(userId);
  return {
    address:     row.address     ?? address     ?? null,
    displayName: row.alias       ?? row.full_name ?? displayName ?? null,
    alias:       row.alias       ?? row.full_name ?? displayName ?? null,
    lat:         row.lat         ?? null, lng:         row.lng         ?? null,
    home_lat:    row.home_lat    ?? null, home_lng:    row.home_lng    ?? null,
    postal_code: row.postal_code ?? null, colonia:     row.colonia     ?? null,
    estado:      row.estado      ?? null, ciudad:      row.ciudad      ?? null,
  };
}

export async function changePassword(userId, currentPassword, newPassword) {
  const user = await findUserById(userId);
  if (!user) throw new AppError(404, 'Usuario no encontrado');
  if (!currentPassword) throw new AppError(400, 'La contraseña actual es requerida');
  const matches = await bcrypt.compare(currentPassword, user.password_hash);
  if (!matches) throw new AppError(401, 'Contraseña actual incorrecta');
  await updatePasswordHash(userId, await bcrypt.hash(newPassword, 12));
}

export async function deleteAccount(userId, role, currentPassword) {
  const user = await findUserById(userId);
  if (!user) throw new AppError(404, 'Usuario no encontrado');
  if (currentPassword) {
    if (!user.password_hash) throw new AppError(400, 'Esta cuenta usa Google — no tiene contraseña');
    const matches = await bcrypt.compare(currentPassword, user.password_hash);
    if (!matches) throw new AppError(401, 'Contraseña incorrecta');
  } else if (!user.google_id) {
    throw new AppError(400, 'Ingresa tu contraseña para confirmar');
  }
  if (await hasPendingOrders(userId, role)) {
    throw new AppError(409, 'No puedes eliminar tu cuenta mientras tengas pedidos activos.');
  }
  await deleteUserData(userId, role);
  return { ok: true };
}

// ── REFRESH TOKEN ─────────────────────────────────────────────────────────────
export async function refreshToken(refreshTokenStr) {
  let payload;
  try {
    payload = jwt.verify(refreshTokenStr, process.env.REFRESH_TOKEN_SECRET || env.jwtSecret);
  } catch {
    throw new AppError(401, 'Refresh token inválido o expirado');
  }
  if (payload.purpose !== 'refresh') throw new AppError(401, 'Token inválido');

  const { query } = await import('../../config/db.js');
  const r = await query(
    'SELECT id, email, role, status, account_locked FROM users WHERE id=$1',
    [payload.userId]
  );
  if (r.rowCount === 0) throw new AppError(401, 'Usuario no encontrado');

  const user = r.rows[0];
  if (user.status === 'suspended') throw new AppError(403, 'Cuenta suspendida');
  if (user.account_locked) throw new AppError(403, 'Cuenta bloqueada');

  const username   = user.email.replace(/@local\.test$/, '');
  const accessToken  = signToken(user.id, user.role, username);
  const newRefresh = jwt.sign(
    { userId: user.id, purpose: 'refresh' },
    process.env.REFRESH_TOKEN_SECRET || env.jwtSecret,
    { expiresIn: '30d' }
  );

  return { token: accessToken, refreshToken: newRefresh };
}

// ── UNLOCK ACCOUNT ────────────────────────────────────────────────────────────
export async function unlockAccount(token) {
  let payload;
  try { payload = jwt.verify(token, process.env.RESET_TOKEN_SECRET || env.jwtSecret); }
  catch { throw new AppError(401, 'Enlace inválido o expirado'); }
  if (payload.purpose !== 'account-unlock') throw new AppError(401, 'Token inválido');

  const { query } = await import('../../config/db.js');
  const r = await query(
    `UPDATE users
     SET account_locked=FALSE, account_unlock_token=NULL, account_unlock_expires=NULL
     WHERE real_email=$1 AND account_unlock_token=$2 AND account_unlock_expires > NOW()
     RETURNING id`,
    [payload.email, token],
  );
  if (r.rowCount === 0) throw new AppError(401, 'Enlace inválido, ya usado o expirado');

  // Limpiar intentos asociados a este correo
  await query('DELETE FROM login_attempts WHERE email=$1', [payload.email]);
  return { ok: true };
}

// ── VERIFY 2FA CODE ───────────────────────────────────────────────────────────
export async function verifyTwoFaCode(userId, code) {
  const { query } = await import('../../config/db.js');
  const r = await query(
    `SELECT * FROM users WHERE id=$1 AND two_fa_code=$2 AND two_fa_expires > NOW()`,
    [userId, code],
  );
  if (r.rowCount === 0) throw new AppError(401, 'Código incorrecto o expirado');

  const user = r.rows[0];
  // Limpiar código usado
  await query('UPDATE users SET two_fa_code=NULL, two_fa_expires=NULL WHERE id=$1', [userId]);

  const username = user.email.replace(/@local\.test$/, '');
  const token    = signToken(user.id, user.role, username);
  const refresh  = jwt.sign(
    { userId: user.id, purpose: 'refresh' },
    process.env.REFRESH_TOKEN_SECRET || env.jwtSecret,
    { expiresIn: '30d' }
  );

  const profile  = await fetchUserProfile(user.id);
  const extended = {
    alias:          user.alias || user.full_name || username,
    address:        profile.address ?? user.address ?? null,
    lat:            profile.lat      ?? null,
    lng:            profile.lng      ?? null,
    home_lat:       profile.home_lat ?? null,
    home_lng:       profile.home_lng ?? null,
    postal_code:    profile.postal_code ?? null,
    colonia:        profile.colonia  ?? null,
    estado:         profile.estado   ?? null,
    ciudad:         profile.ciudad   ?? null,
    needsAddress:   false,
    two_fa_enabled: user.two_fa_enabled ?? true,
  };

  if (user.role === 'restaurant') extended.restaurant = await fetchRestaurantProfile(user.id);
  if (user.role === 'driver')     extended.driver     = await fetchDriverProfile(user.id);
  if (['customer','restaurant'].includes(user.role) && !extended.address) extended.needsAddress = true;

  return { token, refreshToken: refresh, user: { id: user.id, username, role: user.role, ...extended } };
}

// ── TOGGLE 2FA ────────────────────────────────────────────────────────────────
export async function toggleTwoFa(userId, enable) {
  const { query } = await import('../../config/db.js');
  await query('UPDATE users SET two_fa_enabled=$1 WHERE id=$2', [enable, userId]);
  return { two_fa_enabled: enable };
}

export async function updateLoginUsername(userId, role, currentPassword, newUsername) {
  const user = await findUserById(userId);
  if (!user) throw new AppError(404, 'Usuario no encontrado');
  const matches = await bcrypt.compare(currentPassword, user.password_hash);
  if (!matches) throw new AppError(401, 'Contraseña actual incorrecta');
  const normalized = normalizeUsername(newUsername);
  const newEmail   = pseudoEmailFromUsername(normalized);
  const ok = await updateLoginEmail(userId, role, newEmail);
  if (!ok) throw new AppError(409, 'Ese usuario de acceso ya está en uso');
  return { username: normalized };
}
