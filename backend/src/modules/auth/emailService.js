// backend/src/modules/auth/emailService.js
import { google }   from 'googleapis';
import { logEvent } from '../../utils/logger.js';
import { BACKEND_BASE_URL, UI_BRAND } from '../../config/brand.js';

const gmailAuth = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
);
gmailAuth.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });

async function sendGmail({ to, subject, html }) {
  const gmail = google.gmail({ version: 'v1', auth: gmailAuth });

  // Subject encoded as UTF-8 base64 per RFC 2047 — fixes ñ, ó, á, etc.
  const subjectEncoded = `=?UTF-8?B?${Buffer.from(subject, 'utf-8').toString('base64')}?=`;

  // Body encoded as base64 — required when Content-Transfer-Encoding: base64
  const htmlBase64 = Buffer.from(html, 'utf-8').toString('base64');

  // MIME separators must be \r\n per RFC 2822
  const message = [
    `To: ${to}`,
    `Subject: ${subjectEncoded}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    htmlBase64,
  ].join('\r\n');

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: Buffer.from(message, 'utf-8').toString('base64url') },
  });
}

export async function sendGmailSafe(opts) {
  try {
    await sendGmail(opts);
  } catch (err) {
    logEvent('auth.email_send_error', { to: opts.to, error: err.message });
    console.warn('[auth] Gmail send failed (non-blocking):', err.message);
  }
}

const FRONT = () => process.env.FRONTEND_URL || 'http://localhost:5173';

export function verificationEmail(name, verifyToken) {
  const url = `${BACKEND_BASE_URL}/api/auth/verify-email?token=${verifyToken}`;
  return {
    subject: `Confirma tu correo en ${UI_BRAND}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#1a202c;margin-bottom:8px">Hola, ${name} 👋</h2>
        <p style="color:#4a5568">Gracias por registrarte. Confirma tu correo para empezar a hacer pedidos.</p>
        <p style="margin:24px 0">
          <a href="${url}" style="background:#2563eb;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">
            Verificar correo
          </a>
        </p>
        <p style="color:#718096;font-size:13px">
          Este enlace expira en <strong>48 horas</strong>.<br>
          Si no creaste esta cuenta, ignora este correo.
        </p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
        <p style="color:#a0aec0;font-size:12px">${UI_BRAND}</p>
      </div>`,
  };
}

export function resendVerificationEmail(name, verifyToken) {
  const url = `${BACKEND_BASE_URL}/api/auth/verify-email?token=${verifyToken}`;
  return {
    subject: `Tu enlace de verificacion - ${UI_BRAND}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#1a202c">Verificacion de correo</h2>
        <p style="color:#4a5568">Hola ${name}, aqui tienes tu nuevo enlace:</p>
        <p style="margin:24px 0">
          <a href="${url}" style="background:#2563eb;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700">
            Verificar correo
          </a>
        </p>
        <p style="color:#718096;font-size:13px">Expira en 48 horas.</p>
      </div>`,
  };
}

export function accountLockedEmail(name, unlockToken) {
  const url = `${FRONT()}/unlock-account?token=${unlockToken}`;
  return {
    subject: `Actividad sospechosa detectada en tu cuenta - ${UI_BRAND}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#1a202c;margin-bottom:8px">Hola, ${name} 👋</h2>
        <p style="color:#4a5568">
          Detectamos múltiples intentos de acceso fallidos en tu cuenta desde un dispositivo desconocido.
          Por seguridad, hemos <strong>bloqueado el acceso</strong> para evitar la suspensión de tu cuenta.
        </p>
        <p style="color:#4a5568">
          Si eres tú, usa el botón de abajo para desbloquearla. Si no reconoces esta actividad,
          te recomendamos desbloquear tu cuenta y revisar que nadie más tenga acceso a tu correo.
        </p>
        <p style="margin:24px 0">
          <a href="${url}" style="background:#2563eb;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">
            Desbloquear mi cuenta
          </a>
        </p>
        <p style="color:#718096;font-size:13px">
          Este enlace expira en <strong>1 hora</strong>.<br>
          Si no intentaste ingresar, ignora este correo — tu cuenta permanecerá bloqueada.
        </p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
        <p style="color:#a0aec0;font-size:12px">${UI_BRAND}</p>
      </div>`,
  };
}

export function twoFaCodeEmail(name, code) {
  return {
    subject: `Tu código de verificación - ${UI_BRAND}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#1a202c;margin-bottom:8px">Hola, ${name} 👋</h2>
        <p style="color:#4a5568">Tu código de verificación de dos pasos es:</p>
        <div style="margin:24px 0;text-align:center">
          <span style="font-size:2.5rem;font-weight:800;letter-spacing:0.35em;color:#1a202c;font-family:monospace">
            ${code}
          </span>
        </div>
        <p style="color:#718096;font-size:13px">
          Este código expira en <strong>10 minutos</strong>.<br>
          Si no intentaste ingresar, alguien puede tener tu contraseña — considera cambiarla.
        </p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
        <p style="color:#a0aec0;font-size:12px">${UI_BRAND}</p>
      </div>`,
  };
}

export function resetPasswordEmail(name, resetToken) {
  const url = `${FRONT()}/reset-password?token=${resetToken}`;
  return {
    subject: `Recupera tu contrasena en ${UI_BRAND}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#1a202c;margin-bottom:8px">Hola, ${name} 👋</h2>
        <p style="color:#4a5568">Recibimos una solicitud para restablecer tu contrasena.</p>
        <p style="margin:24px 0">
          <a href="${url}" style="background:#2563eb;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">
            Restablecer contrasena
          </a>
        </p>
        <p style="color:#718096;font-size:13px">
          Este enlace expira en <strong>15 minutos</strong>.<br>
          Si no solicitaste esto, ignora este correo.
        </p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
        <p style="color:#a0aec0;font-size:12px">${UI_BRAND}</p>
      </div>`,
  };
}
