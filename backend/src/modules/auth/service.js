// backend/modules/auth/service.js
import bcrypt           from 'bcryptjs';
import jwt              from 'jsonwebtoken';
import { google }       from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { query }        from '../../config/db.js';
import { env }          from '../../config/env.js';
import { AppError }     from '../../utils/errors.js';
import { logEvent }     from '../../utils/logger.js';
import { randomUUID }   from 'crypto';

// ── Legado: mantener pseudoEmail para no romper usuarios existentes ───────────
function normalizeUsername(username) { return username.trim().toLowerCase(); }
function pseudoEmailFromUsername(username) { return `${normalizeUsername(username)}@local.test`; }

const PENDING_STATUSES = ['created','assigned','accepted','preparing','ready','on_the_way','pending_driver'];

export function cleanRestaurantName(name) {
  return name.trim().replace(/\s+(kitchen|restaurant)$/i, '');
}

// ── Google OAuth client (para verificar tokens de Google Login) ───────────────
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ── Gmail API (para envío de correos via HTTP — sin SMTP) ─────────────────────
const gmailAuth = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
);
gmailAuth.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });

async function sendGmail({ to, subject, html }) {
  const gmail = google.gmail({ version: 'v1', auth: gmailAuth });
  const message = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    html,
  ].join('\n');
  const encoded = Buffer.from(message).toString('base64url');
  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encoded },
  });
}

// ── Utilidad: resolver username único ────────────────────────────────────────
async function resolveUniqueUsername(candidate) {
  const base = candidate
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9._-]/g, '')
  .slice(0, 27) || 'user';

  const taken = await query('SELECT 1 FROM users WHERE email = $1', [pseudoEmailFromUsername(base)]);
  if (taken.rowCount === 0) return base;

  for (let i = 0; i < 20; i++) {
    const suffix = Math.random().toString(36).slice(2, 5);
    const candidate2 = `${base}${suffix}`;
    const r = await query('SELECT 1 FROM users WHERE email = $1', [pseudoEmailFromUsername(candidate2)]);
    if (r.rowCount === 0) return candidate2;
  }
  return `${base}${Date.now().toString(36).slice(-4)}`;
}

// ── REGISTER ─────────────────────────────────────────────────────────────────
export async function registerUser(payload) {
  const realEmail = payload.email.trim().toLowerCase();

  try {
    const existingReal = await query(
      'SELECT id FROM users WHERE real_email = $1 AND role = $2',
      [realEmail, payload.role]
    );
    if (existingReal.rowCount > 0) throw new AppError(409, 'Este correo ya está registrado para este tipo de cuenta');
  } catch (e) {
    if (e instanceof AppError) throw e;
    if (e?.code !== '42703') throw e;
  }

  const usernameCandidate = payload.username || payload.alias;
  const username    = await resolveUniqueUsername(usernameCandidate);
  const pseudoEmail = pseudoEmailFromUsername(username);

  const existingPseudo = await query('SELECT id FROM users WHERE email = $1', [pseudoEmail]);
  if (existingPseudo.rowCount > 0) throw new AppError(409, 'Nombre de usuario ya en uso');

  const passwordHash = await bcrypt.hash(payload.password, 12);

  const verifyToken   = jwt.sign({ email: realEmail, purpose: 'email-verify' }, env.jwtSecret, { expiresIn: '48h' });
  const verifyExpires = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  const addressFull = payload.address ||
  [payload.calle, payload.numero, payload.colonia, payload.ciudad, payload.estado, payload.postalCode]
  .filter(Boolean).join(', ') || null;
  const userAddress = ['customer','restaurant'].includes(payload.role) ? addressFull : null;

  let result;
  try {
    result = await query(
      `INSERT INTO users
      (full_name, alias, email, real_email, password_hash, role, status, address,
       postal_code, colonia, estado, ciudad,
       email_verified, email_verify_token, email_verify_expires)
      VALUES($1,$2,$3,$4,$5,$6,'active',$7,$8,$9,$10,$11, false,$12,$13)
      RETURNING id, full_name, alias, email, real_email, role, address`,
      [
        payload.fullName.trim(),
                         payload.alias.trim(),
                         pseudoEmail,
                         realEmail,
                         passwordHash,
                         payload.role,
                         userAddress,
                         payload.postalCode || null,
                         payload.colonia    || null,
                         payload.estado     || null,
                         payload.ciudad     || null,
                         verifyToken,
                         verifyExpires,
      ]
    );
  } catch (e) {
    if (e?.code === '42703') {
      result = await query(
        `INSERT INTO users(full_name, alias, email, password_hash, role, status, address)
        VALUES($1,$2,$3,$4,$5,'active',$6)
        RETURNING id, full_name, alias, email, role, address`,
        [payload.fullName.trim(), payload.alias.trim(), pseudoEmail, passwordHash, payload.role, userAddress]
      );
    } else throw e;
  }

  const user = result.rows[0];

  if (user.role === 'restaurant') {
    const restName = cleanRestaurantName(payload.displayName || payload.alias || payload.fullName);
    try {
      await query('INSERT INTO restaurants(owner_user_id, name, category) VALUES($1,$2,$3)',
                  [user.id, restName, 'General']);
    } catch (e) {
      if (e?.code !== '42703') throw e;
    }
  }

  if (user.role === 'driver') {
    await query(
      'INSERT INTO driver_profiles(user_id, vehicle_type, is_verified, is_available) VALUES($1,$2,true,true)',
                [user.id, 'bike']
    );
  }

  return { id: user.id, username, role: user.role };
}

// ── LOGIN ─────────────────────────────────────────────────────────────────────
export async function loginUser(payload) {
  let result;

  if (payload.email) {
    const rawEmail = payload.email.trim().toLowerCase();
    const isLegacy = rawEmail.endsWith('@local.test');

    if (isLegacy) {
      result = await query(
        'SELECT id, full_name, alias, email, password_hash, role, status, address FROM users WHERE email = $1',
        [rawEmail]
      );
    } else {
      try {
        result = await query(
          'SELECT id, full_name, alias, email, real_email, password_hash, role, status, address FROM users WHERE real_email = $1',
          [rawEmail]
        );
      } catch (e) {
        if (e?.code === '42703') {
          result = await query(
            'SELECT id, full_name, alias, email, password_hash, role, status, address FROM users WHERE email = $1',
            [pseudoEmailFromUsername(rawEmail.split('@')[0])]
          );
        } else throw e;
      }
    }

    if (result.rowCount === 0) {
      logEvent('auth.login_error', { email: rawEmail, reason: 'user_not_found' });
      throw new AppError(401, 'Credenciales inválidas');
    }
  }

  const user = result.rows[0];
  if (user.status !== 'active') {
    logEvent('auth.login_error', { userId: user.id, reason: 'suspended' });
    throw new AppError(403, 'Cuenta suspendida');
  }

  const matches = await bcrypt.compare(payload.password, user.password_hash);
  if (!matches) {
    logEvent('auth.login_error', { userId: user.id, reason: 'bad_password' });
    throw new AppError(401, 'Credenciales inválidas');
  }

  const username = user.email.replace(/@local\.test$/, '');
  const token = jwt.sign({ userId: user.id, role: user.role, username }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });

  let profile = {
    address: user.address || null,
    alias: user.alias || user.full_name || username,
    needsAddress: false,
    lat: null, lng: null, home_lat: null, home_lng: null,
    postal_code: null, colonia: null, estado: null, ciudad: null,
  };

  try {
    const r = await query(
      'SELECT address, lat, lng, home_lat, home_lng, postal_code, colonia, estado, ciudad FROM users WHERE id = $1',
      [user.id]
    );
    Object.assign(profile, {
      address:     r.rows[0]?.address     ?? profile.address,
      lat:         r.rows[0]?.lat         ?? null,
      lng:         r.rows[0]?.lng         ?? null,
      home_lat:    r.rows[0]?.home_lat    ?? null,
      home_lng:    r.rows[0]?.home_lng    ?? null,
      postal_code: r.rows[0]?.postal_code ?? null,
      colonia:     r.rows[0]?.colonia     ?? null,
      estado:      r.rows[0]?.estado      ?? null,
      ciudad:      r.rows[0]?.ciudad      ?? null,
    });
  } catch (_) {}

  if (user.role === 'restaurant') {
    try {
      const r = await query(
        'SELECT id, name, category, is_open, profile_photo FROM restaurants WHERE owner_user_id = $1 LIMIT 1',
        [user.id]
      );
      profile.restaurant = r.rows[0] || null;
    } catch (e) {
      if (e?.code === '42703') {
        const r = await query('SELECT id, name, is_open FROM restaurants WHERE owner_user_id = $1 LIMIT 1', [user.id]);
        profile.restaurant = r.rows[0] || null;
      } else throw e;
    }
  }

  if (user.role === 'driver') {
    try {
      const r = await query('SELECT driver_number, is_available FROM driver_profiles WHERE user_id = $1', [user.id]);
      profile.driver = r.rows[0] || { driver_number: null, is_available: true };
    } catch (e) {
      if (e?.code === '42703') {
        const r = await query('SELECT is_available FROM driver_profiles WHERE user_id = $1', [user.id]);
        profile.driver = { driver_number: null, is_available: r.rows[0]?.is_available ?? true };
      } else throw e;
    }
  }

  if (['customer','restaurant'].includes(user.role) && !profile.address) profile.needsAddress = true;

  return { token, user: { id: user.id, username, role: user.role, ...profile } };
}

// ── GOOGLE LOGIN / REGISTRO ───────────────────────────────────────────────────
export async function googleLogin(credential, role = 'customer') {
  if (!process.env.GOOGLE_CLIENT_ID) throw new AppError(501, 'Google login no configurado');

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken:  credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    throw new AppError(401, 'Token de Google inválido');
  }

  const { email, name, given_name, sub: googleId } = payload;
  const realEmail = email.toLowerCase();

  let user;
  try {
    const r = await query(
      'SELECT * FROM users WHERE (real_email = $1 OR google_id = $2) AND role = $3 LIMIT 1',
                          [realEmail, googleId, role]
    );
    user = r.rows[0];
  } catch (e) {
    if (e?.code === '42703') {
      const r = await query(
        'SELECT * FROM users WHERE email = $1 AND role = $2 LIMIT 1',
        [realEmail, role]
      );
      user = r.rows[0];
    } else throw e;
  }

  if (!user) {
    const alias       = given_name || name?.split(' ')[0] || 'user';
    const fullName    = name || realEmail.split('@')[0];
    const username    = await resolveUniqueUsername(alias);
    const pseudoEmail = pseudoEmailFromUsername(username);
    const placeholderHash = await bcrypt.hash(randomUUID(), 12);

    try {
      const r = await query(
        `INSERT INTO users(full_name, alias, email, real_email, google_id, role, status, password_hash)
        VALUES($1,$2,$3,$4,$5,$6,'active',$7) RETURNING *`,
                            [fullName, alias, pseudoEmail, realEmail, googleId, role, placeholderHash]
      );
      user = r.rows[0];
    } catch (e) {
      if (e?.code === '42703') {
        const r = await query(
          `INSERT INTO users(full_name, alias, email, role, status, password_hash)
          VALUES($1,$2,$3,$4,'active',$5) RETURNING *`,
                              [fullName, alias, pseudoEmail, role, placeholderHash]
        );
        user = r.rows[0];
      } else throw e;
    }

    // Crear perfil de rol igual que registerUser
    if (role === 'restaurant') {
      const restName = cleanRestaurantName(alias);
      try {
        await query('INSERT INTO restaurants(owner_user_id, name, category) VALUES($1,$2,$3)',
                    [user.id, restName, 'General']);
      } catch (e) {
        if (e?.code !== '42703' && e?.code !== '23505') throw e;
      }
    } else if (role === 'driver') {
      try {
        await query(
          'INSERT INTO driver_profiles(user_id, vehicle_type, is_verified, is_available) VALUES($1,$2,true,true)',
          [user.id, 'bike']
        );
      } catch (e) {
        if (e?.code !== '23505') throw e;
      }
    }
  } else {
    try {
      if (!user.google_id) {
        await query('UPDATE users SET google_id=$1 WHERE id=$2 AND role=$3', [googleId, user.id, role]);
      }
    } catch (_) {}
  }

  const username = user.email.replace(/@local\.test$/, '');
  const token = jwt.sign({ userId: user.id, role: user.role, username }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });

  // Cargar datos de rol para la respuesta (igual que loginUser)
  let profile = {
    alias:        user.alias || user.full_name || username,
    address:      user.address || null,
    needsAddress: ['customer','restaurant'].includes(role) && !user.address,
  };

  if (role === 'restaurant') {
    try {
      const r = await query(
        'SELECT id, name, category, is_open, profile_photo FROM restaurants WHERE owner_user_id=$1 LIMIT 1',
        [user.id]
      );
      profile.restaurant = r.rows[0] || null;
    } catch (e) {
      if (e?.code === '42703') {
        const r = await query('SELECT id, name FROM restaurants WHERE owner_user_id=$1 LIMIT 1', [user.id]);
        profile.restaurant = r.rows[0] || null;
      } else throw e;
    }
  }

  if (role === 'driver') {
    try {
      const r = await query('SELECT driver_number, is_available FROM driver_profiles WHERE user_id=$1', [user.id]);
      profile.driver = r.rows[0] || { driver_number: null, is_available: true };
    } catch (_) {
      profile.driver = { driver_number: null, is_available: true };
    }
  }

  return { token, user: { id: user.id, username, role: user.role, ...profile } };
}

// ── VERIFY EMAIL ──────────────────────────────────────────────────────────────
export async function verifyEmail(token) {
  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch {
    throw new AppError(401, 'Enlace inválido o expirado');
  }

  if (payload.purpose !== 'email-verify') throw new AppError(401, 'Token inválido');

  try {
    await query(
      `UPDATE users
      SET email_verified = true, email_verify_token = NULL, email_verify_expires = NULL
      WHERE real_email = $1 AND email_verified = false
      RETURNING id`,
      [payload.email]
    );
  } catch (e) {
    if (e?.code === '42703') return;
    throw e;
  }
}

// ── FORGOT PASSWORD ───────────────────────────────────────────────────────────
export async function forgotPassword(email) {
  const realEmail = email.trim().toLowerCase();

  let user;
  try {
    const r = await query('SELECT id, alias, full_name FROM users WHERE real_email = $1', [realEmail]);
    user = r.rows[0];
    if (!user) {
      const r2 = await query(
        'SELECT id, alias, full_name FROM users WHERE email = $1',
        [pseudoEmailFromUsername(realEmail.split('@')[0])]
      );
      user = r2.rows[0];
    }
  } catch (e) {
    if (e?.code === '42703') {
      try {
        const r = await query(
          'SELECT id, alias, full_name FROM users WHERE email = $1',
          [pseudoEmailFromUsername(realEmail.split('@')[0])]
        );
        user = r.rows[0];
      } catch (_) { return; }
    } else {
      return;
    }
  }

  if (!user) return;

  const resetToken = jwt.sign(
    { userId: user.id, purpose: 'password-reset' },
    process.env.RESET_TOKEN_SECRET || env.jwtSecret,
    { expiresIn: '15m' }
  );

  const name     = user.alias || user.full_name || 'usuario';
  const frontUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const resetUrl = `${frontUrl}/reset-password?token=${resetToken}`;

  try {
    await sendGmail({
      to:      realEmail,
      subject: 'Recupera tu contrase\u00F1a en Morelivery',
      html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="color:#1a202c;margin-bottom:8px">Hola, ${name} 👋</h2>
      <p style="color:#4a5568">Recibimos una solicitud para restablecer la contraseña de tu cuenta.</p>
      <p style="margin:24px 0">
      <a href="${resetUrl}"
      style="background:#2563eb;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">
      Restablecer contraseña
      </a>
      </p>
      <p style="color:#718096;font-size:13px">
      Este enlace expira en <strong>15 minutos</strong>.<br>
      Si no solicitaste esto, ignora este correo — tu contraseña no cambiará.
      </p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
      <p style="color:#a0aec0;font-size:12px">Morelivery · No responder este correo</p>
      </div>
      `,
    });
  } catch (err) {
    logEvent('auth.forgot_password_email_error', { userId: user.id, error: err.message });
  }
}

// ── RESET PASSWORD ────────────────────────────────────────────────────────────
export async function resetPassword(token, newPassword) {
  let payload;
  try {
    payload = jwt.verify(token, process.env.RESET_TOKEN_SECRET || env.jwtSecret);
  } catch {
    throw new AppError(401, 'Enlace inválido o expirado');
  }

  if (payload.purpose !== 'password-reset') throw new AppError(401, 'Token inválido');

  const newHash = await bcrypt.hash(newPassword, 12);
  const r = await query(
    'UPDATE users SET password_hash=$1, google_id=NULL WHERE id=$2 RETURNING id',
    [newHash, payload.userId]
  );
  if (r.rowCount === 0) throw new AppError(404, 'Usuario no encontrado');
}

// ── UPDATE PROFILE ADDRESS ────────────────────────────────────────────────────
export async function updateProfileAddress(userId, role, address, displayName, lat, lng, homeLat, homeLng, postalCode, colonia, estado, ciudad) {
  const updates = [];
  const vals = [];
  let i = 1;

  const pushUpdate = (column, value) => {
    if (value === undefined) return;
    updates.push(`${column}=$${i++}`);
    vals.push(value);
  };

  if (displayName !== undefined && displayName !== null) {
    pushUpdate('full_name', displayName.trim());
    pushUpdate('alias', displayName.trim());
  }

  pushUpdate('address', address);
  pushUpdate('lat', lat);
  pushUpdate('lng', lng);
  pushUpdate('home_lat', homeLat);
  pushUpdate('home_lng', homeLng);
  pushUpdate('postal_code', postalCode);
  pushUpdate('colonia', colonia);
  pushUpdate('estado', estado);
  pushUpdate('ciudad', ciudad);

  if (updates.length > 0) {
    vals.push(userId);
    try {
      await query(`UPDATE users SET ${updates.join(',')} WHERE id=$${i}`, vals);
    } catch (e) {
      if (e?.code === '42703') {
        const safe = [];
        const safeVals = [];
        let j = 1;
        const candidates = [
          ['full_name', displayName !== undefined && displayName !== null ? displayName.trim() : undefined],
          ['alias', displayName !== undefined && displayName !== null ? displayName.trim() : undefined],
          ['address', address],
          ['lat', lat],
          ['lng', lng],
          ['home_lat', homeLat],
          ['home_lng', homeLng],
          ['postal_code', postalCode],
          ['colonia', colonia],
          ['estado', estado],
          ['ciudad', ciudad],
        ];
        for (const [col, val] of candidates) {
          if (val === undefined) continue;
          safe.push(`${col}=$${j++}`);
          safeVals.push(val);
        }
        if (safe.length > 0) {
          safeVals.push(userId);
          try { await query(`UPDATE users SET ${safe.join(',')} WHERE id=$${j}`, safeVals); } catch (_) {}
        }
      } else throw e;
    }
  }

  if (role === 'restaurant' && displayName !== undefined && displayName !== null) {
    const cleanName = cleanRestaurantName(displayName);
    try { await query('UPDATE restaurants SET name=$1 WHERE owner_user_id=$2', [cleanName, userId]); }
    catch (e) { if (e?.code !== '42703') throw e; }
  }

  let row = {};
  try {
    const confirmed = await query('SELECT full_name, alias, address, lat, lng, home_lat, home_lng, postal_code, colonia, estado, ciudad FROM users WHERE id=$1', [userId]);
    row = confirmed.rows[0] || {};
  } catch (_) {
    try {
      const confirmed = await query('SELECT full_name, alias, address FROM users WHERE id=$1', [userId]);
      row = confirmed.rows[0] || {};
    } catch (_2) {}
  }

  return {
    address:     row.address     ?? address     ?? null,
    displayName: row.alias       ?? row.full_name ?? displayName ?? null,
    alias:       row.alias       ?? row.full_name ?? displayName ?? null,
    lat:         row.lat         ?? null,
    lng:         row.lng         ?? null,
    home_lat:    row.home_lat    ?? null,
    home_lng:    row.home_lng    ?? null,
    postal_code: row.postal_code ?? null,
    colonia:     row.colonia     ?? null,
    estado:      row.estado      ?? null,
    ciudad:      row.ciudad      ?? null,
  };
}

// ── VERIFICACIÓN DE EMAIL — descomenta cuando estés listo ────────────────
// Paso 1: Agrega EMAIL_VERIFICATION_ENABLED=true en Render
// Paso 2: Descomenta el bloque de abajo
//
// if (process.env.EMAIL_VERIFICATION_ENABLED === 'true') {
//   const frontUrl  = process.env.FRONTEND_URL || 'http://localhost:5173';
//   const verifyUrl = `${frontUrl}/verify-email?token=${verifyToken}`;
//   try {
//     await mailer.sendMail({
//       from:    `"Morelivery" <${process.env.SMTP_USER}>`,
//       to:      realEmail,
//       subject: 'Confirma tu correo en Morelivery',
//       html: `
//         <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
//           <h2 style="color:#1a202c">Confirma tu correo 📬</h2>
//           <p>Hola ${payload.alias}, haz clic para verificar tu cuenta:</p>
//           <p style="margin:24px 0">
//             <a href="${verifyUrl}"
//                style="background:#2563eb;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700">
//               Verificar correo
//             </a>
//           </p>
//           <p style="color:#718096;font-size:13px">El enlace expira en 48 horas.</p>
//         </div>
//       `,
//     });
//   } catch (err) {
//     logEvent('auth.verify_email_send_error', { userId: result.rows[0]?.id, error: err.message });
//   }
// }

// ── BLOQUEAR LOGIN SIN VERIFICAR — descomenta en loginUser cuando actives lo de arriba ──
// Busca la función loginUser y agrega esto justo después del check de user.status:
//
// if (user.email_verified === false) {
//   throw new AppError(403, 'Verifica tu correo antes de ingresar');
// }

export async function changePassword(userId, currentPassword, newPassword) {
  const r = await query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  if (r.rowCount === 0) throw new AppError(404, 'Usuario no encontrado');
  if (!currentPassword) throw new AppError(400, 'La contraseña actual es requerida');
  const matches = await bcrypt.compare(currentPassword, r.rows[0].password_hash);
  if (!matches) throw new AppError(401, 'Contraseña actual incorrecta');
  const newHash = await bcrypt.hash(newPassword, 12);
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, userId]);
}

export async function deleteAccount(userId, role, currentPassword) {
  // Verificar contraseña
  const pwdRow = await query('SELECT password_hash, google_id FROM users WHERE id=$1', [userId]).catch(() => ({ rows: [], rowCount: 0 }));
  if (pwdRow.rowCount === 0) throw new AppError(404, 'Usuario no encontrado');
  const { password_hash: hash, google_id: googleId } = pwdRow.rows[0];

  if (currentPassword) {
    if (!hash) throw new AppError(400, 'Esta cuenta usa Google — no tiene contraseña');
    const matches = await bcrypt.compare(currentPassword, hash);
    if (!matches) throw new AppError(401, 'Contraseña incorrecta');
  } else if (!googleId) {
    throw new AppError(400, 'Ingresa tu contraseña para confirmar');
  }

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
  if (hasPending) throw new AppError(409, 'No puedes eliminar tu cuenta mientras tengas pedidos activos. Completa o cancela tus pedidos primero.');

  // Limpiar FKs antes de borrar user
  try {
    if (role === 'driver') {
      await query('DELETE FROM driver_profiles WHERE user_id=$1', [userId]);
    }
    if (role === 'restaurant') {
      const rest = await query('SELECT id FROM restaurants WHERE owner_user_id=$1', [userId]);
      if (rest.rows[0]) {
        await query('UPDATE orders SET restaurant_id=NULL WHERE restaurant_id=$1', [rest.rows[0].id]).catch(() => {});
        await query('DELETE FROM restaurants WHERE id=$1', [rest.rows[0].id]);
      }
    }
  } catch (_) {}

  await query('DELETE FROM users WHERE id=$1', [userId]);
  return { ok: true };
}

export async function updateLoginUsername(userId, role, currentPassword, newUsername) {
  const normalized = normalizeUsername(newUsername);
  const newEmail   = pseudoEmailFromUsername(normalized);
  const r = await query('SELECT password_hash FROM users WHERE id=$1', [userId]);
  if (r.rowCount === 0) throw new AppError(404, 'Usuario no encontrado');
  const matches = await bcrypt.compare(currentPassword, r.rows[0].password_hash);
  if (!matches) throw new AppError(401, 'Contraseña actual incorrecta');
  const taken = await query('SELECT id FROM users WHERE email=$1 AND role=$2 AND id<>$3', [newEmail, role, userId]);
  if (taken.rowCount > 0) throw new AppError(409, 'Ese usuario de acceso ya está en uso');
  await query('UPDATE users SET email=$1 WHERE id=$2', [newEmail, userId]);
  return { username: normalized };
}
