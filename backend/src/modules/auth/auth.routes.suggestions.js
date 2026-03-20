// ─────────────────────────────────────────────────────────────────────────────
//  auth.routes.suggestions.js
//  Endpoints nuevos / modificados que necesita el nuevo AuthPage.jsx
//  ⚠️  Este archivo es DOCUMENTACIÓN / GUÍA — no es código de producción listo.
//      Adáptalo a tu estructura de rutas Express existente.
// ─────────────────────────────────────────────────────────────────────────────
//
//  Dependencias nuevas a instalar:
//    npm install nodemailer google-auth-library jsonwebtoken
//
//  Variables de entorno a agregar al .env:
//    GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
//    RESET_TOKEN_SECRET=otro_secreto_largo_aqui         # distinto al JWT_SECRET
//    RESET_TOKEN_EXPIRES=15m
//    SMTP_HOST=smtp.gmail.com
//    SMTP_PORT=587
//    SMTP_USER=encorto.vo@gmail.com      # tu gmail
//    SMTP_PASS=xxxx xxxx xxxx xxxx       # App Password de Google (16 chars)
//    FRONTEND_URL=https://lmorelivery.vercel.app
//
//  Variable frontend a agregar al .env de Vite:
//    VITE_GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
//
// ─────────────────────────────────────────────────────────────────────────────

import express      from 'express';
import bcrypt       from 'bcrypt';
import jwt          from 'jsonwebtoken';
import nodemailer   from 'nodemailer';
import { OAuth2Client } from 'google-auth-library';
import pool         from '../db.js';           // tu pool de postgres

const router = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ── Mailer (Nodemailer + Gmail App Password) ─────────────────────────────────
const mailer = nodemailer.createTransport({
  host:   process.env.SMTP_HOST || 'smtp.gmail.com',
  port:   Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// ── Utilidad: generar username único ─────────────────────────────────────────
// El frontend envía `username` como candidato (alias limpio).
// Este helper verifica colisiones y añade sufijo si es necesario.
async function resolveUniqueUsername(candidate, client) {
  // Intento 1: el candidato limpio
  let username = candidate.toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 30) || 'user';
  const { rows } = await client.query('SELECT 1 FROM users WHERE username = $1', [username]);
  if (rows.length === 0) return username;

  // Genera sufijo de 3 chars alfanuméricos hasta encontrar uno libre
  for (let i = 0; i < 20; i++) {
    const suffix = Math.random().toString(36).slice(2, 5);
    const candidate2 = `${username.slice(0, 27)}${suffix}`;
    const { rows: r } = await client.query('SELECT 1 FROM users WHERE username = $1', [candidate2]);
    if (r.length === 0) return candidate2;
  }
  // Fallback extremo: timestamp
  return `${username.slice(0, 24)}${Date.now().toString(36).slice(-4)}`;
}

// ── POST /auth/register ───────────────────────────────────────────────────────
// Campos nuevos: email, fullName, alias, username (candidato), postalCode,
//                estado, ciudad, colonia, calle, numero
router.post('/register', async (req, res) => {
  const {
    email, password, fullName, alias, username: candidateUsername,
    role = 'customer',
    displayName,
    address, postalCode, estado, ciudad, colonia, calle, numero,
  } = req.body;

  if (!email || !password || !fullName || !alias) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }

  const client = await pool.connect();
  try {
    // Verificar email único
    const { rows: existing } = await client.query('SELECT 1 FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.length > 0) return res.status(409).json({ error: 'Este correo ya está registrado' });

    const uniqueUsername = await resolveUniqueUsername(candidateUsername || alias, client);
    const hashedPwd = await bcrypt.hash(password, 12);

    // Construir address completo si no viene ya armado
    const fullAddress = address || [calle, numero, colonia, ciudad, estado, postalCode]
      .filter(Boolean).join(', ') || null;

    const { rows } = await client.query(
      `INSERT INTO users
         (email, username, alias, full_name, display_name, password_hash, role,
          address, postal_code, estado, ciudad, colonia, calle, numero)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id, email, username, alias, full_name, display_name, role`,
      [
        email.toLowerCase(), uniqueUsername, alias, fullName,
        displayName || alias,
        hashedPwd, role,
        fullAddress, postalCode||null, estado||null, ciudad||null,
        colonia||null, calle||null, numero||null,
      ]
    );

    res.status(201).json({ user: rows[0] });
  } finally {
    client.release();
  }
});

// ── POST /auth/login ──────────────────────────────────────────────────────────
// Ahora recibe `email` en lugar de `username`
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Faltan campos' });

  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  if (rows.length === 0) return res.status(401).json({ error: 'Credenciales incorrectas' });

  const user = rows[0];
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return res.status(401).json({ error: 'Credenciales incorrectas' });

  const token = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  });

  res.json({
    token,
    user: {
      id: user.id, email: user.email, username: user.username,
      alias: user.alias, full_name: user.full_name,
      display_name: user.display_name, role: user.role,
    },
  });
});

// ── POST /auth/google ─────────────────────────────────────────────────────────
// Verifica el credential de Google GSI y hace login o registro automático.
router.post('/google', async (req, res) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: 'Token de Google requerido' });

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    return res.status(401).json({ error: 'Token de Google inválido' });
  }

  const { email, name, given_name, family_name, sub: googleId } = payload;

  const client = await pool.connect();
  try {
    // Buscar usuario existente por email
    let { rows } = await client.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    let user = rows[0];

    if (!user) {
      // Registro automático
      const alias    = given_name || name?.split(' ')[0] || 'user';
      const fullName = name || email.split('@')[0];
      const uniqueUsername = await resolveUniqueUsername(alias, client);
      const result = await client.query(
        `INSERT INTO users (email, username, alias, full_name, display_name, role, google_id)
         VALUES ($1,$2,$3,$4,$5,'customer',$6) RETURNING *`,
        [email.toLowerCase(), uniqueUsername, alias, fullName, alias, googleId]
      );
      user = result.rows[0];
    } else if (!user.google_id) {
      // Vincular cuenta existente con Google
      await client.query('UPDATE users SET google_id=$1 WHERE id=$2', [googleId, user.id]);
    }

    const token = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    });

    res.json({
      token,
      user: {
        id: user.id, email: user.email, username: user.username,
        alias: user.alias, full_name: user.full_name,
        display_name: user.display_name, role: user.role,
      },
    });
  } finally {
    client.release();
  }
});

// ── POST /auth/forgot-password ────────────────────────────────────────────────
// Genera token JWT de reset (15min) y envía email con enlace.
// Siempre responde 200 para no revelar si el email existe.
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  res.json({ ok: true }); // responder antes para evitar timing attacks

  if (!email) return;

  const { rows } = await pool.query('SELECT id, email, alias FROM users WHERE email = $1', [email.toLowerCase()]);
  if (rows.length === 0) return; // silencioso

  const user = rows[0];
  const resetToken = jwt.sign(
    { userId: user.id, purpose: 'password-reset' },
    process.env.RESET_TOKEN_SECRET || process.env.JWT_SECRET,
    { expiresIn: process.env.RESET_TOKEN_EXPIRES || '15m' }
  );

  const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

  try {
    await mailer.sendMail({
      from:    `"Morelivery" <${process.env.SMTP_USER}>`,
      to:      user.email,
      subject: 'Recupera tu contraseña en Morelivery',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
          <h2 style="color:#1a202c">Hola, ${user.alias || 'usuario'} 👋</h2>
          <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta.</p>
          <p>
            <a href="${resetUrl}"
               style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">
              Restablecer contraseña
            </a>
          </p>
          <p style="color:#718096;font-size:0.85em">
            Este enlace expira en 15 minutos. Si no solicitaste esto, ignora este correo.
          </p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
          <p style="color:#a0aec0;font-size:0.75em">Morelivery · No responder este correo</p>
        </div>
      `,
    });
  } catch (err) {
    console.error('[forgot-password] Error enviando email:', err.message);
  }
});

// ── POST /auth/reset-password ─────────────────────────────────────────────────
// Verifica el token de reset y actualiza la contraseña.
router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.status(400).json({ error: 'Datos incompletos' });

  let payload;
  try {
    payload = jwt.verify(token, process.env.RESET_TOKEN_SECRET || process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Enlace inválido o expirado' });
  }

  if (payload.purpose !== 'password-reset') {
    return res.status(401).json({ error: 'Token inválido' });
  }

  const hashedPwd = await bcrypt.hash(newPassword, 12);
  await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hashedPwd, payload.userId]);

  res.json({ ok: true });
});

export default router;

/*
 ─────────────────────────────────────────────────────────────────────────────
  CAMBIOS DE ESQUEMA SUGERIDOS (migraciones)
 ─────────────────────────────────────────────────────────────────────────────

  ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email        TEXT UNIQUE,
    ADD COLUMN IF NOT EXISTS full_name    TEXT,
    ADD COLUMN IF NOT EXISTS alias        TEXT,
    ADD COLUMN IF NOT EXISTS google_id    TEXT,
    ADD COLUMN IF NOT EXISTS postal_code  TEXT,
    ADD COLUMN IF NOT EXISTS estado       TEXT,
    ADD COLUMN IF NOT EXISTS ciudad       TEXT,
    ADD COLUMN IF NOT EXISTS colonia      TEXT,
    ADD COLUMN IF NOT EXISTS calle        TEXT,
    ADD COLUMN IF NOT EXISTS numero       TEXT;

  -- Si usabas username como login, es buena idea crear índice en email:
  CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users(email);

 ─────────────────────────────────────────────────────────────────────────────
  RUTAS A REGISTRAR EN app.js / server.js
 ─────────────────────────────────────────────────────────────────────────────

  import authRoutes from './routes/auth.routes.js';
  app.use('/auth', authRoutes);

 ─────────────────────────────────────────────────────────────────────────────
  RUTAS A AGREGAR EN el Router de React (frontend)
 ─────────────────────────────────────────────────────────────────────────────

  import ResetPasswordPage from './pages/ResetPasswordPage';

  <Route path="/reset-password" element={<ResetPasswordPage />} />

 ─────────────────────────────────────────────────────────────────────────────
  GOOGLE CLOUD CONSOLE (para activar Google Login gratis)
 ─────────────────────────────────────────────────────────────────────────────
  1. Ir a: https://console.cloud.google.com/apis/credentials
  2. Crear proyecto (o usar uno existente)
  3. Crear "ID de cliente de OAuth 2.0" → Tipo: Aplicación web
  4. Orígenes autorizados: https://lmorelivery.vercel.app, http://localhost:5173
  5. Copiar el "Client ID" y ponerlo en:
       Backend:  GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
       Frontend: VITE_GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com

 ─────────────────────────────────────────────────────────────────────────────
  GMAIL APP PASSWORD (para enviar correos sin OAuth en Nodemailer)
 ─────────────────────────────────────────────────────────────────────────────
  1. Ir a: https://myaccount.google.com/security
  2. Activar verificación en 2 pasos
  3. Buscar "Contraseñas de aplicaciones"
  4. Generar una para "Correo / Otro" → copiar las 16 letras
  5. Poner en: SMTP_PASS=xxxx xxxx xxxx xxxx
*/
