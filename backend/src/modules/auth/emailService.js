// backend/src/modules/auth/emailService.js
import { google }    from 'googleapis';
import { logEvent }  from '../../utils/logger.js';

const gmailAuth = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
);
gmailAuth.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });

async function sendGmail({ to, subject, html }) {
  const gmail   = google.gmail({ version: 'v1', auth: gmailAuth });
  const message = [`To: ${to}`, `Subject: ${subject}`, 'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8', '', html].join('\n');
  await gmail.users.messages.send({ userId: 'me', requestBody: { raw: Buffer.from(message).toString('base64url') } });
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
  const url = `${FRONT()}/verify-email?token=${verifyToken}`;
  return {
    subject: 'Confirma tu correo en Morelivery 📬',
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
        <p style="color:#a0aec0;font-size:12px">Morelivery · No responder este correo</p>
      </div>`,
  };
}

export function resendVerificationEmail(name, verifyToken) {
  const url = `${FRONT()}/verify-email?token=${verifyToken}`;
  return {
    subject: 'Tu enlace de verificación — Morelivery',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#1a202c">Verificación de correo 📬</h2>
        <p style="color:#4a5568">Hola ${name}, aquí tienes tu nuevo enlace de verificación:</p>
        <p style="margin:24px 0">
          <a href="${url}" style="background:#2563eb;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700">
            Verificar correo
          </a>
        </p>
        <p style="color:#718096;font-size:13px">Expira en 48 horas.</p>
      </div>`,
  };
}

export function resetPasswordEmail(name, resetToken) {
  const url = `${FRONT()}/reset-password?token=${resetToken}`;
  return {
    subject: 'Recupera tu contraseña en Morelivery',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#1a202c;margin-bottom:8px">Hola, ${name} 👋</h2>
        <p style="color:#4a5568">Recibimos una solicitud para restablecer tu contraseña.</p>
        <p style="margin:24px 0">
          <a href="${url}" style="background:#2563eb;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">
            Restablecer contraseña
          </a>
        </p>
        <p style="color:#718096;font-size:13px">
          Este enlace expira en <strong>15 minutos</strong>.<br>
          Si no solicitaste esto, ignora este correo.
        </p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
        <p style="color:#a0aec0;font-size:12px">Morelivery · No responder este correo</p>
      </div>`,
  };
}
