// frontend/src/pages/AuthPage.jsx
//
// CAMBIOS:
//   - AuthPage es la entrada directa — sin splash
//   - Formulario asume 'customer' por default
//   - Dos links discretos en LoginView: "Soy repartidor" / "Tengo un negocio"
//     que llevan al registro con el rol preseleccionado (login Y registro)
//   - Errores de credenciales siempre genéricos — no revelan el rol
//   - RegisterView con progressive disclosure: paso 1 usuario, paso 2 contacto,
//     paso 3 contraseña/dirección

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../api/client';
import { validatePassword, PasswordStrength } from '../utils/passwordUtils.jsx';
import FingerprintJS from '@fingerprintjs/fingerprintjs';
import PullToRefresh from '../components/PullToRefresh';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildUsernameCandidate(alias = '', suffix = '') {
  const base = alias.toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9._-]/g, '').slice(0, 28) || 'user';
  return suffix ? `${base}${suffix}` : base;
}

async function makeUniqueUsername(alias) {
  const base = buildUsernameCandidate(alias);
  const candidates = [base, ...Array.from({ length: 4 }, () =>
    buildUsernameCandidate(alias, Math.floor(10 + Math.random() * 90).toString()))];
  for (const c of candidates) {
    try { await apiFetch(`/auth/check-username?username=${encodeURIComponent(c)}`); return c; }
    catch { /* tomado */ }
  }
  return buildUsernameCandidate(alias, Date.now().toString().slice(-4));
}

async function fetchColoniasByPostal(cp) {
  try {
    const r = await apiFetch(`/auth/postal/${cp}`);
    return { estado: r?.estado || '', ciudad: r?.ciudad || '', colonias: Array.isArray(r?.colonias) ? r.colonias : [] };
  } catch { return null; }
}

async function getFingerprint() {
  try { const fp = await FingerprintJS.load(); return (await fp.get()).visitorId; }
  catch { return undefined; }
}

function Req() {
  return <span style={{ color: 'var(--danger)', fontWeight: 400, fontSize: '0.75rem', marginLeft: 3 }}>*</span>;
}

// ── AddressBlock ──────────────────────────────────────────────────────────────
function AddressBlock({ postalCode, setPostalCode, estado, setEstado, ciudad, setCiudad,
  colonia, setColonia, coloniasList, calle, setCalle, numero, setNumero, cpLoading, cpError, required }) {
  const BUSY = { opacity: 0.7, pointerEvents: 'none' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
      <label>Código postal {required && <Req />}
        <div style={{ position: 'relative', ...(cpLoading ? BUSY : {}) }}>
          <input value={postalCode}
            onChange={e => setPostalCode(e.target.value.replace(/\D/g, '').slice(0, 5))}
            placeholder="Ej: 44100" maxLength={5} inputMode="numeric" />
          {cpLoading && <span style={{ position: 'absolute', right: '0.6rem', top: '50%', transform: 'translateY(-50%)', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Buscando…</span>}
        </div>
        {cpError && <span style={{ fontSize: '0.72rem', color: 'var(--error)', marginTop: '0.2rem', display: 'block' }}>{cpError}</span>}
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.55rem' }}>
        <label>Estado<input value={estado} onChange={e => setEstado(e.target.value)} placeholder="Michoacán" disabled={cpLoading} /></label>
        <label>Municipio / Ciudad<input value={ciudad} onChange={e => setCiudad(e.target.value)} placeholder="Morelia" disabled={cpLoading} /></label>
      </div>
      <label>Colonia
        {coloniasList.length > 0
          ? <select value={colonia} onChange={e => setColonia(e.target.value)} disabled={cpLoading}>
              <option value="">Seleccionar colonia…</option>
              {coloniasList.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          : <input value={colonia} onChange={e => setColonia(e.target.value)} placeholder="Ej: Col. Centro" disabled={cpLoading} />
        }
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.55rem', alignItems: 'end' }}>
        <label>Calle {required && <Req />}<input value={calle} onChange={e => setCalle(e.target.value)} placeholder="Ej: Av. Revolución" /></label>
        <label style={{ width: 90 }}>Número<input value={numero} onChange={e => setNumero(e.target.value)} placeholder="1234" /></label>
      </div>
    </div>
  );
}

// ── TwoFaView ─────────────────────────────────────────────────────────────────
function TwoFaView({ userId, onSuccess, onGoLogin }) {
  const [code,    setCode]    = useState('');
  const [loading, setLoading] = useState(false);
  const [msg,     setMsg]     = useState('');

  async function submitCode() {
    const trimmed = code.trim();
    if (trimmed.length !== 6) { setMsg('Ingresa el código de 6 dígitos'); return; }
    setLoading(true);
    try {
      const data = await apiFetch('/auth/verify-2fa', { method: 'POST', body: JSON.stringify({ userId, code: trimmed }) });
      onSuccess(data);
    } catch (e) { setMsg(e.message || 'Código incorrecto o expirado'); }
    finally { setLoading(false); }
  }

  return (
    <>
      <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
        Te enviamos un código de 6 dígitos a tu correo. Ingrésalo para continuar.
      </p>
      <div className="row">
        <label>Código de verificación
          <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g,'').slice(0,6))}
            inputMode="numeric" placeholder="000000" autoComplete="one-time-code"
            onKeyDown={e => e.key === 'Enter' && submitCode()} />
        </label>
      </div>
      <div className="row" style={{ marginTop: '0.75rem' }}>
        <button className="btn-primary" onClick={submitCode} disabled={loading}>
          {loading ? 'Verificando…' : 'Confirmar'}
        </button>
        <button type="button" onClick={onGoLogin}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', fontSize: '0.875rem', textAlign: 'center', padding: '0.25rem 0' }}>
          ← Volver
        </button>
      </div>
      {msg && <p className="flash flash-error" style={{ marginTop: '0.75rem' }}>{msg}</p>}
    </>
  );
}

// ── LoginView ─────────────────────────────────────────────────────────────────
function useCountdown(lockedUntil) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (!lockedUntil) { setSecs(0); return; }
    const calc = () => Math.max(0, Math.round((new Date(lockedUntil) - Date.now()) / 1000));
    setSecs(calc());
    const iv = setInterval(() => { const s = calc(); setSecs(s); if (s <= 0) clearInterval(iv); }, 1000);
    return () => clearInterval(iv);
  }, [lockedUntil]);
  return secs;
}

function fmtCountdown(secs) {
  if (secs <= 0) return '';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function LoginView({ appKey, onGoRegister, onGoForgot, initialRole = 'customer', onTwoFa }) {
  const { login }   = useAuth();
  const navigate    = useNavigate();
  const [loading,   setLoading]   = useState(false);
  const [msg,       setMsg]       = useState('');
  const [showResend, setShowResend] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [role,      setRole]      = useState(appKey || initialRole);
  const roleRef     = useRef(role);
  const googleBtnRef = useRef(null);
  const googleInit   = useRef(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const emailRef    = useRef(null);
  const passwordRef = useRef(null);

  // ── Estado de intentos / bloqueo ──────────────────────────────────────────
  const [attempts,     setAttempts]     = useState(0);
  const [lockedUntil,  setLockedUntil]  = useState(null);  // bloqueo temporal dispositivo
  const [accountLocked, setAccountLocked] = useState(false); // bloqueo permanente cuenta
  const [suggestReset, setSuggestReset] = useState(false);  // banner fallo >= 3
  const [suggest2Fa,   setSuggest2Fa]   = useState(false);  // sugerencia post fallo 10+
  const [showHelp,     setShowHelp]     = useState(false);  // panel ¿Problemas para iniciar sesión?
  const countdown = useCountdown(lockedUntil);
  const formBlocked = accountLocked || countdown > 0;

  useEffect(() => { roleRef.current = role; }, [role]);

  useEffect(() => {
    const h = (e) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);

  const handleGoogleResponse = useCallback(async (response) => {
    setLoading(true);
    try {
      const data = await apiFetch('/auth/google', { method: 'POST', body: JSON.stringify({ credential: response.credential, role: roleRef.current }) });
      login({ token: data.token, user: data.user });
      navigate(`/${data.user.role}`);
    } catch { setMsg('No se pudo iniciar sesión. Verifica tus datos e intenta de nuevo.'); }
    finally { setLoading(false); }
  }, [login, navigate]);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    if (!document.getElementById('google-gsi')) {
      const s = Object.assign(document.createElement('script'), { id: 'google-gsi', src: 'https://accounts.google.com/gsi/client', async: true });
      document.head.appendChild(s);
    }
  }, []);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || googleInit.current) return;
    const render = () => {
      if (!window.google || !googleBtnRef.current) return;
      googleInit.current = true;
      window.google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleGoogleResponse });
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const width  = Math.min(360, Math.max(200, (googleBtnRef.current.parentElement?.offsetWidth || 360) - 2));
      window.google.accounts.id.renderButton(googleBtnRef.current, { theme: isDark ? 'filled_black' : 'outline', size: 'large', width, text: 'continue_with', locale: 'es' });
    };
    if (window.google) { render(); return; }
    const iv = setInterval(() => { if (window.google) { clearInterval(iv); render(); } }, 200);
    return () => clearInterval(iv);
  }, [handleGoogleResponse]);

  async function submitLogin() {
    const email    = emailRef.current?.value?.trim() || '';
    const password = passwordRef.current?.value      || '';
    if (!email || !password) { setMsg('Ingresa tu correo y contraseña'); return; }
    if (formBlocked) return;
    setLoading(true);
    setMsg('');
    try {
      const deviceFingerprint = await getFingerprint();
      const data = await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email, password, role: appKey || undefined, deviceFingerprint }) });
      if (appKey && data.user.role !== appKey) {
        setMsg('Correo o contraseña incorrectos.');
        return;
      }
      // ── 2FA requerido ─────────────────────────────────────────────────────
      if (data.requiresTwoFa) {
        onTwoFa?.(data.userId);
        return;
      }
      login({ token: data.token, user: data.user });
      navigate(`/${data.user.role}`);
    } catch (e) {
      const extra = e.extra || {};

      // Bloqueo permanente de cuenta
      if (e.status === 403 && e.message?.includes('bloqueada')) {
        setAccountLocked(true);
        setMsg(e.message);
        return;
      }
      // Bloqueo temporal de dispositivo (423) o lockedUntil en respuesta
      if (e.status === 423 || extra.lockedUntil) {
        setLockedUntil(extra.lockedUntil || null);
        setAttempts(extra.attempts || attempts);
        setMsg('');
        return;
      }
      // Actualizar contador de intentos y banderas
      if (extra.attempts) {
        setAttempts(extra.attempts);
        setSuggestReset(extra.suggestReset || false);
        if (extra.attempts >= 10) setSuggest2Fa(true);
        if (extra.lockedUntil) { setLockedUntil(extra.lockedUntil); setMsg(''); return; }
      }
      if (e.message?.includes('verificar tu correo')) {
        setMsg('Verifica tu correo antes de ingresar.');
        setShowResend(true);
        return;
      }
      setMsg('Correo o contraseña incorrectos.');
    } finally { setLoading(false); }
  }

  async function submitResend() {
    const email = emailRef.current?.value?.trim() || '';
    if (!email) { setMsg('Ingresa tu correo para reenviar la verificación'); return; }
    setResendLoading(true);
    try {
      await apiFetch('/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email }) });
      setMsg('Correo de verificación reenviado. Revisa tu bandeja.');
      setShowResend(false);
    } catch { setMsg('No se pudo reenviar. Intenta más tarde.'); }
    finally { setResendLoading(false); }
  }

  return (
    <>
      {/* Banner: cuenta bloqueada */}
      {accountLocked && (
        <div style={{ background: 'var(--danger-bg, #fef2f2)', border: '1px solid var(--danger-border, #fca5a5)', borderRadius: 8, padding: '0.65rem 0.9rem', marginBottom: '0.75rem', fontSize: '0.82rem', color: 'var(--danger, #dc2626)' }}>
          🔒 Tu cuenta está bloqueada por actividad sospechosa. <strong>Revisa tu correo</strong> para recibir el enlace de desbloqueo.
        </div>
      )}

      {/* Banner: bloqueo temporal con countdown */}
      {!accountLocked && countdown > 0 && (
        <div style={{ background: 'var(--warn-bg)', border: '1px solid var(--warn-border)', borderRadius: 8, padding: '0.65rem 0.9rem', marginBottom: '0.75rem', fontSize: '0.82rem', color: 'var(--warn)' }}>
          ⏳ Demasiados intentos fallidos. Podrás intentarlo de nuevo en <strong>{fmtCountdown(countdown)}</strong>.
          <div style={{ fontSize: '0.78rem', marginTop: '0.25rem', opacity: 0.85 }}>
            Esto protege tu cuenta para evitar su suspensión.
          </div>
        </div>
      )}

      {/* Banner: sugerir recuperación por correo (fallo >= 3) */}
      {!accountLocked && countdown <= 0 && suggestReset && (
        <div style={{ background: 'var(--warn-bg)', border: '1px solid var(--warn-border)', borderRadius: 8, padding: '0.65rem 0.9rem', marginBottom: '0.75rem', fontSize: '0.82rem', color: 'var(--warn)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
          <span>¿Olvidaste tu contraseña? Te recomendamos recuperarla por correo.</span>
          <button type="button" onClick={onGoForgot}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', fontWeight: 700, fontSize: '0.82rem', whiteSpace: 'nowrap', padding: 0 }}>
            Recuperar →
          </button>
        </div>
      )}

      {/* Banner: sugerir activar 2FA (post fallo 10+) */}
      {suggest2Fa && !accountLocked && (
        <div style={{ background: 'var(--info-bg, #eff6ff)', border: '1px solid var(--info-border, #bfdbfe)', borderRadius: 8, padding: '0.65rem 0.9rem', marginBottom: '0.75rem', fontSize: '0.82rem', color: 'var(--info, #1d4ed8)' }}>
          🔐 Para mayor seguridad, considera activar la verificación en dos pasos desde tu perfil una vez que ingreses.
        </div>
      )}

      <div className="row">
        <label>Correo electrónico
          <input ref={emailRef} defaultValue="" type="email" placeholder="tu@correo.com" autoComplete="email"
            disabled={formBlocked}
            onKeyDown={e => e.key === 'Enter' && submitLogin()} />
        </label>
        <label>Contraseña
          <input ref={passwordRef} defaultValue="" type="password" placeholder="Tu contraseña" autoComplete="current-password"
            disabled={formBlocked}
            onKeyDown={e => e.key === 'Enter' && submitLogin()} />
        </label>
      </div>

      {/* Links discretos de rol — solo en la entrada principal (sin appKey) */}
      {!appKey && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '1.25rem', marginTop: '0.1rem' }}>
        <button type="button" onClick={() => navigate('/driver/login')}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: '0.75rem', padding: 0, textDecoration: 'underline', textUnderlineOffset: 2 }}>
        Soy repartidor
        </button>
        <button type="button" onClick={() => navigate('/restaurant/login')}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: '0.75rem', padding: 0, textDecoration: 'underline', textUnderlineOffset: 2 }}>
        Tengo un negocio
        </button>
        </div>
      )}

      <div style={{ textAlign: 'right', marginTop: '-0.25rem', marginBottom: '0.75rem' }}>
        <button type="button" onClick={onGoForgot}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', fontSize: '0.8rem', padding: 0 }}>
          ¿Olvidaste tu contraseña?
        </button>
      </div>

      <div className="row">
        <button className="btn-primary" onClick={submitLogin} disabled={loading || formBlocked}>
          {loading ? 'Ingresando…' : 'Iniciar sesión'}
        </button>

        {GOOGLE_CLIENT_ID && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0.25rem 0' }}>
              <hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--border)' }} />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>o continúa con</span>
              <hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--border)' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'center' }}><div ref={googleBtnRef} /></div>
          </>
        )}

        {installPrompt && (
          <button type="button" className="btn-sm"
            onClick={async () => { installPrompt.prompt(); await installPrompt.userChoice.catch(() => null); setInstallPrompt(null); }}
            style={{ marginTop: '0.4rem' }}>
            Instalar app
          </button>
        )}

        <button type="button" onClick={() => onGoRegister('customer')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', fontSize: '0.875rem', textAlign: 'center', padding: '0.25rem 0' }}>
          ¿No tienes cuenta? <strong>Regístrate</strong>
        </button>
      </div>

      {showResend && (
        <div style={{ marginTop: '0.5rem', padding: '0.65rem 0.9rem', background: 'var(--warn-bg)', border: '1px solid var(--warn-border)', borderRadius: 8, fontSize: '0.82rem', color: 'var(--warn)' }}>
          ¿No recibiste el correo de verificación?{' '}
          <button type="button" onClick={submitResend} disabled={resendLoading}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', fontWeight: 700, padding: 0, fontSize: '0.82rem' }}>
            {resendLoading ? 'Enviando…' : 'Reenviar'}
          </button>
        </div>
      )}

      {/* ¿Problemas para iniciar sesión? */}
      <div style={{ textAlign: 'center', marginTop: '0.75rem' }}>
        <button type="button" onClick={() => setShowHelp(v => !v)}
          style={{ background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-tertiary)', fontSize: '0.78rem', padding: 0,
            textDecoration: 'underline', textUnderlineOffset: 2 }}>
          ¿Problemas para iniciar sesión?
        </button>
      </div>

      {showHelp && (
        <div style={{ marginTop: '0.5rem', padding: '0.75rem 0.9rem',
          background: 'var(--bg-raised)', border: '1px solid var(--border)',
          borderRadius: 10, fontSize: '0.82rem', color: 'var(--text-secondary)',
          display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>

          {/* Rol incorrecto — solo mostrar si está en la entrada principal */}
          {!appKey && (
            <div>
              <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.2rem' }}>
                ¿Eres repartidor o tienes un negocio?
              </div>
              <div style={{ marginBottom: '0.35rem' }}>
                Esta pantalla es para clientes. Ingresa desde la sección que corresponde a tu cuenta:
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button type="button" onClick={() => navigate('/driver/login')}
                  style={{ background: 'none', border: '1px solid var(--border)',
                    borderRadius: 6, cursor: 'pointer', color: 'var(--primary)',
                    fontSize: '0.78rem', fontWeight: 700, padding: '0.25rem 0.65rem' }}>
                  Soy repartidor →
                </button>
                <button type="button" onClick={() => navigate('/restaurant/login')}
                  style={{ background: 'none', border: '1px solid var(--border)',
                    borderRadius: 6, cursor: 'pointer', color: 'var(--primary)',
                    fontSize: '0.78rem', fontWeight: 700, padding: '0.25rem 0.65rem' }}>
                  Tengo un negocio →
                </button>
              </div>
            </div>
          )}

          {/* Recuperar contraseña */}
          <div style={{ borderTop: !appKey ? '1px solid var(--border-light)' : 'none',
            paddingTop: !appKey ? '0.5rem' : 0 }}>
            <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.2rem' }}>
              ¿Olvidaste tu contraseña?
            </div>
            <ol style={{ margin: '0 0 0.35rem 1.1rem', padding: 0, lineHeight: 1.6 }}>
              <li>Presiona <strong>"¿Olvidaste tu contraseña?"</strong> arriba del botón de ingreso.</li>
              <li>Ingresa el correo con el que te registraste.</li>
              <li>Revisa tu bandeja de entrada y sigue el enlace que te enviamos.</li>
            </ol>
            <button type="button" onClick={() => { setShowHelp(false); onGoForgot(); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--primary)', fontWeight: 700, fontSize: '0.82rem', padding: 0 }}>
              Ir a recuperar contraseña →
            </button>
          </div>
        </div>
      )}

      {msg && <p className="flash flash-error" style={{ marginTop: '0.75rem' }}>{msg}</p>}
    </>
  );
}

// ── RegisterView con progressive disclosure ───────────────────────────────────
// Paso 1 — Identidad:  nombre, alias
// Paso 2 — Contacto:   correo, teléfono (customer), tipo de cuenta
// Paso 3 — Seguridad:  contraseña + dirección

function RegisterView({ appKey, onGoLogin, onSuccess, initialRole = 'customer' }) {
  const [step,    setStep]    = useState(1);
  const [loading, setLoading] = useState(false);
  const [msg,     setMsg]     = useState('');
  const [msgOk,   setMsgOk]   = useState(false);

  const [firstName,  setFirstName]  = useState('');
  const [lastName,   setLastName]   = useState('');
  const [alias,      setAlias]      = useState('');
  const [regEmail,   setRegEmail]   = useState('');
  const [regPwd,     setRegPwd]     = useState('');
  const [regPwdConf, setRegPwdConf] = useState('');
  const [phone,      setPhone]      = useState('');
  const [pwdError,   setPwdError]   = useState('');

  const validRoles = ['customer', 'restaurant', 'driver'];
  const [role, setRole] = useState(validRoles.includes(appKey) ? appKey : initialRole);

  const [emailStatus,  setEmailStatus]  = useState('');
  const emailTimer = useRef(null);

  const [postalCode,   setPostalCode]   = useState('');
  const [estado,       setEstado]       = useState('');
  const [ciudad,       setCiudad]       = useState('');
  const [colonia,      setColonia]      = useState('');
  const [coloniasList, setColoniasList] = useState([]);
  const [calle,        setCalle]        = useState('');
  const [numero,       setNumero]       = useState('');
  const [cpLoading,    setCpLoading]    = useState(false);
  const [cpError,      setCpError]      = useState('');
  const cpTimer = useRef(null);
  const lastCp  = useRef('');

  useEffect(() => { if (!regPwd) { setPwdError(''); return; } setPwdError(validatePassword(regPwd) || ''); }, [regPwd]);

  useEffect(() => {
    const email = regEmail.trim();
    if (!email || !/\S+@\S+\.\S+/.test(email)) { setEmailStatus(''); return; }
    setEmailStatus('checking');
    clearTimeout(emailTimer.current);
    emailTimer.current = setTimeout(async () => {
      try {
        await apiFetch(`/auth/check-email?email=${encodeURIComponent(email)}&role=${role}`);
        setEmailStatus('available');
      } catch (e) {
        setEmailStatus(e.message?.includes('409') || e.message?.includes('registrado') ? 'taken' : '');
      }
    }, 600);
  }, [regEmail, role]);

  useEffect(() => {
    const cp = postalCode.trim();
    if (cp.length !== 5 || !/^\d{5}$/.test(cp)) { setCpError(''); setColoniasList([]); return; }
    if (cp === lastCp.current) return;
    clearTimeout(cpTimer.current);
    cpTimer.current = setTimeout(async () => {
      setCpLoading(true); setCpError('');
      const res = await fetchColoniasByPostal(cp);
      setCpLoading(false); lastCp.current = cp;
      if (!res) { setCpError('CP no encontrado'); setColoniasList([]); }
      else { setEstado(res.estado); setCiudad(res.ciudad); setColoniasList(res.colonias); if (res.colonias.length) setColonia(res.colonias[0]); }
    }, 600);
  }, [postalCode]);

  function buildAddress() {
    return [[calle, numero].filter(Boolean).join(' '), colonia, ciudad, estado, postalCode].filter(Boolean).join(', ');
  }

  function validateStep1() {
    if (!firstName.trim()) { setMsg('Ingresa tu nombre'); return false; }
    if (!lastName.trim())  { setMsg('Ingresa tu apellido'); return false; }
    if (!alias.trim())     { setMsg('Ingresa un alias'); return false; }
    return true;
  }

  function validateStep2() {
    if (!regEmail.trim())                     { setMsg('Ingresa tu correo electrónico'); return false; }
    if (!/\S+@\S+\.\S+/.test(regEmail))       { setMsg('Correo inválido'); return false; }
    if (emailStatus === 'taken')               { setMsg('Este correo ya está registrado. ¿Ya tienes cuenta?'); return false; }
    if (role === 'customer' && !phone.trim()) { setMsg('El número de teléfono es obligatorio'); return false; }
    return true;
  }

  function validateStep3() {
    const pwdErr = validatePassword(regPwd);
    if (pwdErr)                { setMsg(pwdErr); return false; }
    if (regPwd !== regPwdConf) { setMsg('Las contraseñas no coinciden'); return false; }
    if (role === 'restaurant' && (!postalCode || !calle)) { setMsg('La dirección completa de tu tienda es requerida'); return false; }
    return true;
  }

  function nextStep() {
    setMsg('');
    if (step === 1 && !validateStep1()) return;
    if (step === 2 && !validateStep2()) return;
    setStep(s => s + 1);
  }

  async function submitRegister() {
    setMsg('');
    if (!validateStep3()) return;
    const fullName    = `${firstName.trim()} ${lastName.trim()}`;
    const username    = await makeUniqueUsername(alias);
    const addressFull = ['customer', 'restaurant'].includes(role) && (postalCode || calle) ? buildAddress() : undefined;
    const deviceFingerprint = await getFingerprint();
    setLoading(true);
    try {
      await apiFetch('/auth/register', { method: 'POST', body: JSON.stringify({
        email: regEmail.trim(), password: regPwd,
        fullName, alias: alias.trim(), username, role,
        phone: phone.trim() || undefined, address: addressFull,
        postalCode: postalCode || undefined, estado: estado || undefined,
        ciudad: ciudad || undefined, colonia: colonia || undefined,
        calle: calle || undefined, numero: numero || undefined,
        displayName: role === 'restaurant' ? (alias.trim() || undefined) : undefined,
        deviceFingerprint,
      })});
      setMsg('¡Registro exitoso! Revisa tu correo para verificar tu cuenta.'); setMsgOk(true);
      onSuccess?.();
    } catch (e) { setMsg(e.message); setMsgOk(false); }
    finally { setLoading(false); }
  }

  const stepLabels = ['Identidad', 'Contacto', 'Seguridad'];

  return (
    <>
      {/* Indicador de pasos */}
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem', alignItems: 'center' }}>
        {[1,2,3].map(n => (
          <div key={n} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flex: n < 3 ? 1 : 'none' }}>
            <div style={{
              width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
              background: n <= step ? 'var(--brand)' : 'var(--border)',
              color: n <= step ? '#fff' : 'var(--text-tertiary)',
              fontSize: '0.7rem', fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {n < step ? '✓' : n}
            </div>
            <span style={{ fontSize: '0.72rem', color: n === step ? 'var(--text-primary)' : 'var(--text-tertiary)', fontWeight: n === step ? 600 : 400 }}>
              {stepLabels[n-1]}
            </span>
            {n < 3 && <div style={{ flex: 1, height: 1, background: n < step ? 'var(--brand)' : 'var(--border)' }} />}
          </div>
        ))}
      </div>

      {/* Paso 1 — Identidad */}
      {step === 1 && (
        <div className="row">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
            <label>Nombre <Req /><input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Juan" autoComplete="given-name" /></label>
            <label>Apellido <Req /><input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="García" autoComplete="family-name" /></label>
          </div>
          <label>Alias / Apodo <Req />
            <input value={alias} onChange={e => setAlias(e.target.value)} placeholder="Ej: JuanG" autoComplete="nickname" />
            <span style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', marginTop: '0.2rem', display: 'block' }}>Así te verán los demás.</span>
          </label>
        </div>
      )}

      {/* Paso 2 — Contacto */}
      {step === 2 && (
        <div className="row">
          <label>Correo electrónico <Req />
            <div style={{ position: 'relative' }}>
              <input value={regEmail} onChange={e => setRegEmail(e.target.value)} type="email" placeholder="tu@correo.com" autoComplete="email"
                style={{ paddingRight: '2rem' }} />
              {emailStatus === 'checking'  && <span style={{ position: 'absolute', right: '0.6rem', top: '50%', transform: 'translateY(-50%)', fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>…</span>}
              {emailStatus === 'available' && <span style={{ position: 'absolute', right: '0.6rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--success)' }}>✓</span>}
              {emailStatus === 'taken'     && <span style={{ position: 'absolute', right: '0.6rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--danger)' }}>✗</span>}
            </div>
            {emailStatus === 'taken' && (
              <span style={{ fontSize: '0.72rem', color: 'var(--danger)', marginTop: '0.2rem', display: 'block' }}>
                Este correo ya tiene una cuenta.{' '}
                <button type="button" onClick={onGoLogin} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--brand)', padding: 0, fontSize: '0.72rem', fontWeight: 700 }}>Inicia sesión</button>
              </span>
            )}
          </label>

          {role === 'customer' && (
            <label>Teléfono <Req />
              <input value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g,'').slice(0,15))} type="tel" placeholder="Ej: 4431234567" autoComplete="tel" inputMode="numeric" />
            </label>
          )}

          {!appKey && (
            <label>Tipo de cuenta <Req />
              <select value={role} onChange={e => setRole(e.target.value)}>
                <option value="customer">Cliente</option>
                <option value="restaurant">Tengo un negocio</option>
                <option value="driver">Soy repartidor</option>
              </select>
            </label>
          )}
        </div>
      )}

      {/* Paso 3 — Seguridad */}
      {step === 3 && (
        <>
          <div className="row">
            <label>Contraseña <Req />
              <input value={regPwd} onChange={e => setRegPwd(e.target.value)} type="password" placeholder="Mínimo 8 caracteres" autoComplete="new-password" />
              {pwdError && <span style={{ fontSize: '0.73rem', color: 'var(--error)', marginTop: '0.2rem', display: 'block' }}>{pwdError}</span>}
            </label>
            <label>Confirmar contraseña <Req />
              <input value={regPwdConf} onChange={e => setRegPwdConf(e.target.value)} type="password" placeholder="Repite la contraseña" autoComplete="new-password" />
            </label>
            {regPwd.length > 0 && <PasswordStrength pwd={regPwd} />}
          </div>
          <div style={{ marginTop: '0.75rem' }}>
            <p style={{ fontWeight: 700, fontSize: '0.82rem', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>
              {role === 'restaurant' ? <>Dirección de la tienda <Req /></> : 'Dirección (puedes agregarla después)'}
            </p>
            <AddressBlock postalCode={postalCode} setPostalCode={setPostalCode}
              estado={estado} setEstado={setEstado} ciudad={ciudad} setCiudad={setCiudad}
              colonia={colonia} setColonia={setColonia} coloniasList={coloniasList}
              calle={calle} setCalle={setCalle} numero={numero} setNumero={setNumero}
              cpLoading={cpLoading} cpError={cpError} required={role === 'restaurant'} />
          </div>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: '0.5rem' }}>
            Los campos con <span style={{ color: 'var(--danger)' }}>*</span> son obligatorios.
          </p>
        </>
      )}

      {msg && <p className={`flash ${msgOk ? 'flash-ok' : 'flash-error'}`} style={{ marginTop: '0.75rem' }}>{msg}</p>}

      <div className="row" style={{ marginTop: '0.75rem' }}>
        {step < 3
          ? <button className="btn-primary" onClick={nextStep}
              disabled={step === 2 && (emailStatus === 'taken' || emailStatus === 'checking')}>
              Continuar →
            </button>
          : <button className="btn-primary" onClick={submitRegister} disabled={loading}>
              {loading ? 'Registrando…' : 'Crear cuenta'}
            </button>
        }
        {step > 1 && (
          <button type="button" onClick={() => { setMsg(''); setStep(s => s - 1); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', fontSize: '0.875rem', textAlign: 'center', padding: '0.25rem 0' }}>
            ← Atrás
          </button>
        )}
        <button type="button" onClick={onGoLogin}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', fontSize: '0.875rem', textAlign: 'center', padding: '0.25rem 0' }}>
          ¿Ya tienes cuenta? <strong>Inicia sesión</strong>
        </button>
      </div>
    </>
  );
}

// ── ForgotView ────────────────────────────────────────────────────────────────
function ForgotView({ onGoLogin }) {
  const [email,   setEmail]   = useState('');
  const [loading, setLoading] = useState(false);
  const [msg,     setMsg]     = useState('');
  const [msgOk,   setMsgOk]   = useState(false);

  async function submitForgot() {
    if (!/\S+@\S+\.\S+/.test(email)) { setMsg('Ingresa un correo válido'); return; }
    setLoading(true);
    try {
      await apiFetch('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email: email.trim() }) });
      setMsg('Si el correo está registrado recibirás un enlace para restablecer tu contraseña.'); setMsgOk(true);
    } catch { setMsg('No se pudo enviar. Intenta más tarde.'); setMsgOk(false); }
    finally { setLoading(false); }
  }

  return (
    <>
      <div className="row">
        <label>Correo electrónico de tu cuenta
          <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="tu@correo.com"
            autoComplete="email" onKeyDown={e => e.key === 'Enter' && submitForgot()} />
        </label>
      </div>
      <div className="row" style={{ marginTop: '0.5rem' }}>
        <button className="btn-primary" onClick={submitForgot} disabled={loading}>
          {loading ? 'Enviando…' : 'Enviar enlace de recuperación'}
        </button>
        <button type="button" onClick={onGoLogin}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', fontSize: '0.875rem', textAlign: 'center', padding: '0.25rem 0' }}>
          ← Volver
        </button>
      </div>
      {msg && <p className={`flash ${msgOk ? 'flash-ok' : 'flash-error'}`} style={{ marginTop: '0.75rem' }}>{msg}</p>}
    </>
  );
}

// ── AuthPage ──────────────────────────────────────────────────────────────────
export default function AuthPage({ mode = 'login', appKey = null }) {
  const [searchParams]  = useSearchParams();
  const [view, setView] = useState(mode);
  const [verifiedBanner, setVerifiedBanner] = useState(searchParams.get('verified') === '1');
  const [unlockedBanner, setUnlockedBanner] = useState(searchParams.get('unlocked') === '1');
  const [showVerifyHint, setShowVerifyHint] = useState(false);
  const [twoFaUserId,   setTwoFaUserId]    = useState(null);

  const { login }   = useAuth();
  const navigate    = useNavigate();

  const [sharedRole, setSharedRole] = useState('customer');

  function goTo(v, role = null) {
    if (role) setSharedRole(role);
    setView(v);
  }

  function handleTwoFaSuccess(data) {
    login({ token: data.token, user: data.user });
    navigate(`/${data.user.role}`);
  }

  const TITLES = { login: 'Iniciar sesión', register: 'Crear cuenta', forgot: 'Recuperar contraseña', twofa: 'Verificación en dos pasos' };
  const SUBS   = {
    login:    'Ingresa con tu correo y contraseña.',
    register: 'Completa los datos para registrarte.',
    forgot:   'Te enviaremos un enlace para restablecer tu contraseña.',
    twofa:    'Ingresa el código que enviamos a tu correo.',
  };

  return (
    <section className="auth-card">
      <div style={{ marginBottom: '0.25rem' }}><h2 style={{ margin: 0 }}>{TITLES[view] || TITLES.login}</h2></div>
      <p style={{ marginBottom: '1rem', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>{SUBS[view] || SUBS.login}</p>

      {verifiedBanner && (
        <div style={{ background: 'var(--success-bg)', border: '1px solid var(--success-border)', borderRadius: 8, padding: '0.65rem 0.9rem', marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--success)' }}>✅ Correo verificado. Ya puedes iniciar sesión.</span>
          <button onClick={() => setVerifiedBanner(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--success)', fontSize: '1rem', lineHeight: 1 }}>✕</button>
        </div>
      )}
      {unlockedBanner && (
        <div style={{ background: 'var(--success-bg)', border: '1px solid var(--success-border)', borderRadius: 8, padding: '0.65rem 0.9rem', marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--success)' }}>✅ Cuenta desbloqueada. Ya puedes iniciar sesión.</span>
          <button onClick={() => setUnlockedBanner(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--success)', fontSize: '1rem', lineHeight: 1 }}>✕</button>
        </div>
      )}
      {showVerifyHint && view === 'login' && (
        <div style={{ background: 'var(--warn-bg)', border: '1px solid var(--warn-border)', borderRadius: 8, padding: '0.65rem 0.9rem', marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--warn)' }}>📬 Revisa tu correo para verificar tu cuenta antes de ingresar.</span>
          <button onClick={() => setShowVerifyHint(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--warn)', fontSize: '1rem', lineHeight: 1 }}>✕</button>
        </div>
      )}

      {view === 'login' && (
        <LoginView
          appKey={appKey}
          initialRole={sharedRole}
          onGoRegister={(role) => goTo('register', role || 'customer')}
          onGoForgot={() => goTo('forgot')}
          onTwoFa={(userId) => { setTwoFaUserId(userId); setView('twofa'); }}
        />
      )}
      {view === 'twofa' && (
        <TwoFaView
          userId={twoFaUserId}
          onSuccess={handleTwoFaSuccess}
          onGoLogin={() => goTo('login')}
        />
      )}
      {view === 'register' && (
        <RegisterView
          appKey={appKey}
          initialRole={sharedRole}
          onGoLogin={() => goTo('login')}
          onSuccess={() => { setShowVerifyHint(true); setView('login'); }}
        />
      )}
      {view === 'forgot' && <ForgotView onGoLogin={() => goTo('login')} />}
    </section>
  );
}
