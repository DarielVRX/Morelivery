// frontend/src/pages/AuthPage.jsx
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

// Etiqueta de campo obligatorio
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

// ── LoginView ─────────────────────────────────────────────────────────────────
function LoginView({ appKey, onGoRegister, onGoForgot }) {
  const { login }    = useAuth();
  const navigate     = useNavigate();
  const [loading,    setLoading]    = useState(false);
  const [msg,        setMsg]        = useState('');
  const [showResend, setShowResend] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [role,       setRole]       = useState(appKey || 'customer');
  const roleRef      = useRef(role);
  const googleBtnRef = useRef(null);
  const googleInit   = useRef(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const emailRef    = useRef(null);
  const passwordRef = useRef(null);

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
    } catch (e) { setMsg(e.message); }
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
    if (!GOOGLE_CLIENT_ID) return;
    if (googleInit.current) return;
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
    setLoading(true);
    try {
      const deviceFingerprint = await getFingerprint();
      const data = await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email, password, role: appKey || undefined, deviceFingerprint }) });
      if (appKey === 'admin' && data.user.role !== 'admin') { setMsg('Esta cuenta no es de administrador.'); return; }
      if (appKey && data.user.role !== appKey) {
        const labels = { customer: 'Cliente', restaurant: 'Tienda', driver: 'Conductor', admin: 'Administrador' };
        setMsg(`Esta cuenta es de tipo "${labels[data.user.role] || data.user.role}". Accede desde la sección correcta.`); return;
      }
      login({ token: data.token, user: data.user });
      navigate(`/${data.user.role}`);
    } catch (e) {
      setMsg(e.message);
      if (e.message?.includes('verificar tu correo')) setShowResend(true);
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
    } catch (e) { setMsg(e.message); }
    finally { setResendLoading(false); }
  }

  return (
    <>
      <div className="row">
        <label>Correo electrónico
          <input ref={emailRef} defaultValue="" type="email" placeholder="tu@correo.com" autoComplete="email"
            onKeyDown={e => e.key === 'Enter' && submitLogin()} />
        </label>
        <label>Contraseña
          <input ref={passwordRef} defaultValue="" type="password" placeholder="Tu contraseña" autoComplete="current-password"
            onKeyDown={e => e.key === 'Enter' && submitLogin()} />
        </label>
      </div>
      <div style={{ textAlign: 'right', marginTop: '-0.25rem', marginBottom: '0.75rem' }}>
        <button type="button" onClick={onGoForgot} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', fontSize: '0.8rem', padding: 0 }}>
          ¿Olvidaste tu contraseña?
        </button>
      </div>
      <div className="row">
        <button className="btn-primary" onClick={submitLogin} disabled={loading}>
          {loading ? 'Ingresando…' : 'Iniciar sesión'}
        </button>
        {GOOGLE_CLIENT_ID && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0.25rem 0' }}>
              <hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--border)' }} />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>o continúa con</span>
              <hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--border)' }} />
            </div>
            {!appKey && (
              <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'center', marginBottom: '0.4rem' }}>
                {[['customer','Cliente'],['restaurant','Tienda'],['driver','Conductor']].map(([val, label]) => (
                  <button key={val} type="button" onClick={() => setRole(val)}
                    style={{ padding: '0.2rem 0.65rem', fontSize: '0.75rem', cursor: 'pointer',
                      border: `1.5px solid ${role === val ? 'var(--brand)' : 'var(--border)'}`,
                      borderRadius: 6, background: role === val ? 'var(--brand-light)' : 'var(--bg-card)',
                      color: role === val ? 'var(--brand)' : 'var(--text-secondary)',
                      fontWeight: role === val ? 700 : 400, minHeight: 'unset' }}>
                    {label}
                  </button>
                ))}
              </div>
            )}
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
        <button type="button" onClick={onGoRegister}
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
      {msg && <p className="flash flash-error" style={{ marginTop: '0.75rem' }}>{msg}</p>}
    </>
  );
}

// ── RegisterView ──────────────────────────────────────────────────────────────
function RegisterView({ appKey, onGoLogin, onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [msg,     setMsg]     = useState('');
  const [msgOk,   setMsgOk]   = useState(false);

  // Nombre separado en nombre y apellido
  const [firstName, setFirstName] = useState('');
  const [lastName,  setLastName]  = useState('');
  const [alias,     setAlias]     = useState('');
  const [regEmail,  setRegEmail]  = useState('');
  const [regPwd,    setRegPwd]    = useState('');
  const [regPwdConf, setRegPwdConf] = useState('');
  const [phone,     setPhone]     = useState('');
  const [pwdError,  setPwdError]  = useState('');
  const validRoles = ['customer', 'restaurant', 'driver'];
  const [role, setRole] = useState(validRoles.includes(appKey) ? appKey : 'customer');

  // Validación en tiempo real de email
  const [emailStatus, setEmailStatus] = useState(''); // '' | 'checking' | 'available' | 'taken'
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

  // Validar email en tiempo real
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

  async function submitRegister() {
    if (!firstName.trim())     { setMsg('Ingresa tu nombre'); return; }
    if (!lastName.trim())      { setMsg('Ingresa tu apellido'); return; }
    if (!alias.trim())         { setMsg('Ingresa un alias'); return; }
    if (!regEmail.trim())      { setMsg('Ingresa tu correo electrónico'); return; }
    if (!/\S+@\S+\.\S+/.test(regEmail)) { setMsg('Correo inválido'); return; }
    if (emailStatus === 'taken') { setMsg('Este correo ya está registrado. ¿Ya tienes cuenta?'); return; }
    const pwdErr = validatePassword(regPwd);
    if (pwdErr)                { setMsg(pwdErr); return; }
    if (regPwd !== regPwdConf) { setMsg('Las contraseñas no coinciden'); return; }
    if (role === 'customer' && !phone.trim()) { setMsg('El número de teléfono es obligatorio'); return; }
    if (role === 'restaurant' && (!postalCode || !calle)) { setMsg('La dirección completa de tu tienda es requerida'); return; }

    const fullName    = `${firstName.trim()} ${lastName.trim()}`;
    const username    = await makeUniqueUsername(alias);
    const addressFull = ['customer','restaurant'].includes(role) && (postalCode || calle) ? buildAddress() : undefined;
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

  return (
    <>
      <div className="row">
        {/* Nombre y apellido separados */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
          <label>Nombre <Req /><input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Juan" autoComplete="given-name" /></label>
          <label>Apellido <Req /><input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="García" autoComplete="family-name" /></label>
        </div>
        <label>Alias / Apodo <Req />
          <input value={alias} onChange={e => setAlias(e.target.value)} placeholder="Ej: JuanG" autoComplete="nickname" />
          <span style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', marginTop: '0.2rem', display: 'block' }}>Así te verán los demás.</span>
        </label>
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
              Este correo ya tiene una cuenta. <button type="button" onClick={onGoLogin} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--brand)', padding: 0, fontSize: '0.72rem', fontWeight: 700 }}>Inicia sesión</button>
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
              <option value="restaurant">Tienda</option>
              <option value="driver">Conductor</option>
            </select>
          </label>
        )}
      </div>
      <div className="row" style={{ marginTop: '0.5rem' }}>
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
          cpLoading={cpLoading} cpError={cpError}
          required={role === 'restaurant'} />
      </div>
      <p style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: '0.5rem' }}>
        Los campos con <span style={{ color: 'var(--danger)' }}>*</span> son obligatorios.
      </p>
      <div className="row" style={{ marginTop: '0.75rem' }}>
        <button className="btn-primary" onClick={submitRegister}
          disabled={loading || emailStatus === 'taken' || emailStatus === 'checking'}>
          {loading ? 'Registrando…' : 'Crear cuenta'}
        </button>
        <button type="button" onClick={onGoLogin}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', fontSize: '0.875rem', textAlign: 'center', padding: '0.25rem 0' }}>
          ¿Ya tienes cuenta? <strong>Inicia sesión</strong>
        </button>
      </div>
      {msg && <p className={`flash ${msgOk ? 'flash-ok' : 'flash-error'}`} style={{ marginTop: '0.75rem' }}>{msg}</p>}
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
    } catch (e) { setMsg(e.message); setMsgOk(false); }
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
  const [showVerifyHint, setShowVerifyHint] = useState(false);

  function goTo(v) { setView(v); }

  const TITLES = { login: 'Iniciar sesión', register: 'Crear cuenta', forgot: 'Recuperar contraseña' };
  const SUBS   = {
    login:    'Ingresa con tu correo y contraseña.',
    register: 'Completa los datos para registrarte.',
    forgot:   'Te enviaremos un enlace para restablecer tu contraseña.',
  };

  return (
    <section className="auth-card">
      <div style={{ marginBottom: '0.25rem' }}><h2 style={{ margin: 0 }}>{TITLES[view]}</h2></div>
      <p style={{ marginBottom: '1rem', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>{SUBS[view]}</p>

      {verifiedBanner && (
        <div style={{ background: 'var(--success-bg)', border: '1px solid var(--success-border)', borderRadius: 8, padding: '0.65rem 0.9rem', marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--success)' }}>✅ Correo verificado. Ya puedes iniciar sesión.</span>
          <button onClick={() => setVerifiedBanner(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--success)', fontSize: '1rem', lineHeight: 1 }}>✕</button>
        </div>
      )}
      {showVerifyHint && view === 'login' && (
        <div style={{ background: 'var(--warn-bg)', border: '1px solid var(--warn-border)', borderRadius: 8, padding: '0.65rem 0.9rem', marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--warn)' }}>📬 Revisa tu correo para verificar tu cuenta antes de ingresar.</span>
          <button onClick={() => setShowVerifyHint(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--warn)', fontSize: '1rem', lineHeight: 1 }}>✕</button>
        </div>
      )}

      {view === 'login'    && <LoginView appKey={appKey} onGoRegister={() => goTo('register')} onGoForgot={() => goTo('forgot')} />}
      {view === 'register' && <RegisterView appKey={appKey} onGoLogin={() => goTo('login')} onSuccess={() => { setShowVerifyHint(true); setView('login'); }} />}
      {view === 'forgot'   && <ForgotView onGoLogin={() => goTo('login')} />}
    </section>
  );
}
