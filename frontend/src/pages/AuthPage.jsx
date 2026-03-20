// frontend/src/pages/AuthPage.jsx
// ─────────────────────────────────────────────────────────────────────────────
//  Cambios respecto a la versión anterior
//  • Login con correo electrónico (ya no username)
//  • Login con Google (Google Identity Services — gratuito)
//  • Registro: correo, nombre completo, alias, contraseña con validación
//    - username se genera automáticamente desde alias (sin consulta al usuario)
//    - dirección estructurada con autorrelleno de CP (igual que Profile)
//      → obligatoria solo para "restaurant"; opcional para customer/driver
//  • Flujo "Olvidé mi contraseña" (solicita reset por email)
//  • Dark mode persistido
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../api/client';

// ── Constante: Client ID de Google (configura en .env) ──────────────────────
// VITE_GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

// ── Utilidad: genera username desde alias ────────────────────────────────────
// Limpia el alias, lo pone en minúsculas sin espacios ni caracteres especiales.
// Si el alias ya tiene ≥3 chars de sufijo se omite la generación adicional;
// el backend decide si hay colisión y añade sufijo random — aquí solo enviamos
// el candidato base. Ver comentario en auth.routes.suggestions.js.
function buildUsernameCandidate(alias = '') {
  return alias
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')   // quitar tildes
  .replace(/[^a-z0-9._-]/g, '')      // solo chars válidos
  .slice(0, 30)
  || 'user';
}

// ── Validación de contraseña ─────────────────────────────────────────────────
function validatePassword(pwd) {
  if (pwd.length < 8)             return 'Mínimo 8 caracteres';
  if (!/[A-Z]/.test(pwd))         return 'Al menos una mayúscula';
  if (!/[0-9]/.test(pwd))         return 'Al menos un número';
  return null;
}

// ── Fetch colonias desde CP (idéntico al de Profile) ────────────────────────
async function fetchColoniasByPostal(cp) {
  try {
    // Sin token en registro — el endpoint debe ser público o aceptar anon
    const result = await apiFetch(`/auth/postal/${cp}`);
    return {
      estado:   result?.estado   || '',
      ciudad:   result?.ciudad   || '',
      colonias: Array.isArray(result?.colonias) ? result.colonias : [],
    };
  } catch {
    return null;
  }
}

// ── Componente raíz ──────────────────────────────────────────────────────────
export default function AuthPage({ mode = 'login', appKey = null }) {
  return <AuthForm mode={mode} appKey={appKey} />;
}

// ── AuthForm ─────────────────────────────────────────────────────────────────
function AuthForm({ mode, appKey }) {
  const { login } = useAuth();
  const navigate  = useNavigate();
  const [searchParams] = useSearchParams();

  const [view, setView] = useState(mode);

  // Banner "correo verificado" si viene ?verified=1 desde el enlace del email
  const [verifiedBanner, setVerifiedBanner] = useState(searchParams.get('verified') === '1');

  // Banner post-registro — muestra aviso sin bloquear
  const [showVerifyHint, setShowVerifyHint] = useState(false);

  // ── Campos comunes
  const emailRef    = useRef(null);
  const passwordRef = useRef(null);

  // ── Campos registro — role preseleccionado desde appKey si viene de /:appKey/register
  const [fullName,    setFullName]    = useState('');

  const [alias,       setAlias]       = useState('');
  const [regEmail,    setRegEmail]    = useState('');
  const [regPwd,      setRegPwd]      = useState('');
  const [regPwdConf,  setRegPwdConf]  = useState('');
  // Si viene de /:appKey/register, preseleccionar el rol correspondiente
  const validRoles = ['customer', 'restaurant', 'driver'];
  const [role, setRole] = useState(
    validRoles.includes(appKey) ? appKey : 'customer'
  );
  const [pwdError,    setPwdError]    = useState('');

  // ── Dirección estructurada (registro)
  const [postalCode,   setPostalCode]   = useState('');
  const [estado,       setEstado]       = useState('');
  const [ciudad,       setCiudad]       = useState('');
  const [colonia,      setColonia]      = useState('');
  const [coloniasList, setColoniasList] = useState([]);
  const [calle,        setCalle]        = useState('');
  const [numero,       setNumero]       = useState('');
  const [cpLoading,    setCpLoading]    = useState(false);
  const [cpError,      setCpError]      = useState('');
  const cpTimerRef     = useRef(null);
  const lastCp         = useRef('');

  // ── Forgot password
  const [forgotEmail,  setForgotEmail]  = useState('');

  // ── PWA install prompt
  const [installPrompt, setInstallPrompt] = useState(null);

  // ── Mensajes globales
  const [message, setMessage] = useState({ text: '', ok: false });
  const [loading, setLoading] = useState(false);

  // ── Inyectar Google GSI script ──────────────────────────────────────────
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    if (document.getElementById('google-gsi')) return;
    const s = document.createElement('script');
    s.id  = 'google-gsi';
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    document.head.appendChild(s);
  }, []);

  // ── PWA install prompt ──────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // ── Autorrelleno CP ─────────────────────────────────────────────────────
  useEffect(() => {
    const cp = postalCode.trim();
    if (cp.length !== 5 || !/^\d{5}$/.test(cp)) {
      setCpError(''); setColoniasList([]); return;
    }
    if (cp === lastCp.current) return;
    clearTimeout(cpTimerRef.current);
    cpTimerRef.current = setTimeout(async () => {
      setCpLoading(true); setCpError('');
      const res = await fetchColoniasByPostal(cp);
      setCpLoading(false);
      lastCp.current = cp;
      if (!res) {
        setCpError('CP no encontrado — llena estado, ciudad y colonia manualmente');
        setColoniasList([]);
      } else {
        setEstado(res.estado);
        setCiudad(res.ciudad);
        setColoniasList(res.colonias);
        if (res.colonias.length > 0) setColonia(res.colonias[0]);
      }
    }, 600);
  }, [postalCode]);

  // ── Validar contraseña en tiempo real ───────────────────────────────────
  useEffect(() => {
    if (!regPwd) { setPwdError(''); return; }
    setPwdError(validatePassword(regPwd) || '');
  }, [regPwd]);

  const msg = (text, ok = false) => setMessage({ text, ok });

  // ── Construir dirección completa ────────────────────────────────────────
  function buildAddress() {
    const parts = [calle, numero].filter(Boolean).join(' ');
    return [parts, colonia, ciudad, estado, postalCode].filter(Boolean).join(', ');
  }

  // ── SUBMIT LOGIN ────────────────────────────────────────────────────────
  const submitLogin = useCallback(async () => {
    const email    = emailRef.current?.value?.trim()    || '';
    const password = passwordRef.current?.value         || '';
  if (!email || !password) { msg('Ingresa tu correo y contraseña'); return; }
  setLoading(true);
  try {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    // Si venimos de /:appKey/login, validar que el rol coincida
    if (appKey && data.user.role !== appKey) {
      const labels = { customer:'Cliente', restaurant:'Tienda', driver:'Conductor', admin:'Administrador' };
      msg(`Esta cuenta es de tipo "${labels[data.user.role] || data.user.role}". Accede desde la sección correcta.`);
      return;
    }
    login({ token: data.token, user: data.user });
    navigate(`/${data.user.role}`);
  } catch (e) {
    msg(e.message);
  } finally {
    setLoading(false);
  }
  }, [appKey, login, navigate]);

  // ── SUBMIT GOOGLE LOGIN ─────────────────────────────────────────────────
  const handleGoogleResponse = useCallback(async (response) => {
    setLoading(true);
    try {
      const data = await apiFetch('/auth/google', {
        method: 'POST',
        body: JSON.stringify({ credential: response.credential }),
      });
      login({ token: data.token, user: data.user });
      navigate(`/${data.user.role}`);
    } catch (e) {
      msg(e.message);
    } finally {
      setLoading(false);
    }
  }, [login, navigate]);

  // Renderizar botón Google cuando el script cargue
  const googleBtnRef      = useRef(null);
  const googleInitialized = useRef(false);
  useEffect(() => {
    if (view !== 'login' || !GOOGLE_CLIENT_ID) return;
    if (googleInitialized.current) return;
    const render = () => {
      if (!window.google || !googleBtnRef.current) return;
      googleInitialized.current = true;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback:  handleGoogleResponse,
      });
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      window.google.accounts.id.renderButton(googleBtnRef.current, {
        theme:  isDark ? 'filled_black' : 'outline',
        size:   'large',
        width:  360,
        text:   'continue_with',
        locale: 'es',
      });
    };
    if (window.google) { render(); return; }
    const interval = setInterval(() => { if (window.google) { clearInterval(interval); render(); } }, 200);
    return () => clearInterval(interval);
  }, [view, handleGoogleResponse]);

  // ── SUBMIT REGISTER ─────────────────────────────────────────────────────
  const submitRegister = useCallback(async () => {
    if (!fullName.trim())      { msg('Ingresa tu nombre completo'); return; }
    if (!alias.trim())         { msg('Ingresa un alias/apodo'); return; }
    if (!regEmail.trim())      { msg('Ingresa tu correo electrónico'); return; }
    if (!/\S+@\S+\.\S+/.test(regEmail)) { msg('Correo inválido'); return; }
    const pwdErr = validatePassword(regPwd);
    if (pwdErr)                { msg(pwdErr); return; }
    if (regPwd !== regPwdConf) { msg('Las contraseñas no coinciden'); return; }
    // Dirección obligatoria solo para restaurant
    if (role === 'restaurant' && (!postalCode || !calle)) {
      msg('Ingresa la dirección completa de tu tienda'); return;
    }

    const usernameCandidate = buildUsernameCandidate(alias);
    const addressFull = (['customer','restaurant'].includes(role) && (postalCode || calle))
    ? buildAddress()
    : undefined;

    setLoading(true);
    try {
      await apiFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email:    regEmail.trim(),
                             password: regPwd,
                             fullName: fullName.trim(),
                             alias:    alias.trim(),
                             username: usernameCandidate,   // backend valida unicidad y ajusta
                             role,
                             address:     addressFull,
                             postalCode:  postalCode  || undefined,
                             estado:      estado      || undefined,
                             ciudad:      ciudad      || undefined,
                             colonia:     colonia     || undefined,
                             calle:       calle       || undefined,
                             numero:      numero      || undefined,
                             // displayName para restaurant
                             displayName: role === 'restaurant' ? (alias.trim() || undefined) : undefined,
        }),
      });
      msg('¡Registro exitoso! Ya puedes iniciar sesión.', true);
      setShowVerifyHint(true);
      setView('login');
    } catch (e) {
      msg(e.message);
    } finally {
      setLoading(false);
    }
  }, [fullName, alias, regEmail, regPwd, regPwdConf, role, postalCode, estado, ciudad, colonia, calle, numero]);

  // ── SUBMIT FORGOT PASSWORD ──────────────────────────────────────────────
  const submitForgot = useCallback(async () => {
    if (!/\S+@\S+\.\S+/.test(forgotEmail)) { msg('Ingresa un correo válido'); return; }
    setLoading(true);
    try {
      await apiFetch('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: forgotEmail.trim() }),
      });
      msg('Si el correo está registrado recibirás un enlace para restablecer tu contraseña.', true);
    } catch (e) {
      msg(e.message);
    } finally {
      setLoading(false);
    }
  }, [forgotEmail]);

  function handleKey(e, fn) { if (e.key === 'Enter') fn(); }

  // ── Cambiar de vista (limpia mensajes) ──────────────────────────────────
  function goTo(v) { setMessage({ text: '', ok: false }); setView(v); }

  // ── RENDER ──────────────────────────────────────────────────────────────
  return (
    <section className="auth-card">

    {/* Header */}
    {/* Header */}
    <div style={{ marginBottom:'0.25rem' }}>
    <h2 style={{ margin:0 }}>
    {view === 'login'    && 'Iniciar sesión'}
    {view === 'register' && 'Crear cuenta'}
    {view === 'forgot'   && 'Recuperar contraseña'}
    </h2>
    </div>

    <p style={{ marginBottom:'1rem', color:'var(--text-secondary)', fontSize:'0.875rem' }}>
    {view === 'login'    && 'Ingresa con tu correo y contraseña.'}
    {view === 'register' && 'Completa los datos para registrarte.'}
    {view === 'forgot'   && 'Te enviaremos un enlace para restablecer tu contraseña.'}
    </p>

    {/* Banner: correo verificado exitosamente */}
    {verifiedBanner && (
      <div style={{ background:'#f0fff4', border:'1px solid #9ae6b4', borderRadius:8, padding:'0.65rem 0.9rem', marginBottom:'0.75rem', display:'flex', justifyContent:'space-between', alignItems:'center', gap:'0.5rem' }}>
      <span style={{ fontSize:'0.85rem', color:'#276749' }}>✅ Correo verificado. Ya puedes iniciar sesión.</span>
      <button onClick={() => setVerifiedBanner(false)} style={{ background:'none', border:'none', cursor:'pointer', color:'#276749', fontSize:'1rem', lineHeight:1 }}>✕</button>
      </div>
    )}

    {/* Banner: post-registro — avisa sin bloquear (envío de correo desactivado por ahora) */}
    {showVerifyHint && view === 'login' && (
      <div style={{ background:'#fffbeb', border:'1px solid #f6e05e', borderRadius:8, padding:'0.65rem 0.9rem', marginBottom:'0.75rem', display:'flex', justifyContent:'space-between', alignItems:'center', gap:'0.5rem' }}>
      <span style={{ fontSize:'0.82rem', color:'#744210' }}>📬 Próximamente recibirás un correo para verificar tu cuenta.</span>
      <button onClick={() => setShowVerifyHint(false)} style={{ background:'none', border:'none', cursor:'pointer', color:'#744210', fontSize:'1rem', lineHeight:1 }}>✕</button>
      </div>
    )}

    {/* ── VISTA: LOGIN ────────────────────────────────────────────────── */}
    {view === 'login' && (
      <>
      <div className="row">
      <label>Correo electrónico
      <input
      ref={emailRef}
      defaultValue=""
      type="email"
      placeholder="tu@correo.com"
      autoComplete="email"
      onKeyDown={e => handleKey(e, submitLogin)}
      />
      </label>
      <label>Contraseña
      <input
      ref={passwordRef}
      defaultValue=""
      type="password"
      placeholder="Tu contraseña"
      autoComplete="current-password"
      onKeyDown={e => handleKey(e, submitLogin)}
      />
      </label>
      </div>

      {/* Olvidé mi contraseña */}
      <div style={{ textAlign:'right', marginTop:'-0.25rem', marginBottom:'0.75rem' }}>
      <button
      type="button"
      onClick={() => goTo('forgot')}
      style={{ background:'none', border:'none', cursor:'pointer', color:'var(--primary)', fontSize:'0.8rem', padding:0 }}
      >
      ¿Olvidaste tu contraseña?
      </button>
      </div>

      <div className="row">
      <button className="btn-primary" onClick={submitLogin} disabled={loading}>
      {loading ? 'Ingresando…' : 'Iniciar sesión'}
      </button>

      {/* Separador */}
      {GOOGLE_CLIENT_ID && (
        <>
        <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', margin:'0.25rem 0' }}>
        <hr style={{ flex:1, border:'none', borderTop:'1px solid var(--border)' }} />
        <span style={{ fontSize:'0.75rem', color:'var(--text-secondary)', whiteSpace:'nowrap' }}>o continúa con</span>
        <hr style={{ flex:1, border:'none', borderTop:'1px solid var(--border)' }} />
        </div>
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          minHeight: 44,
        }}>
        <div ref={googleBtnRef} />
        </div>
        </>
      )}

      {installPrompt && (
        <button
        type="button"
        className="btn-sm"
        onClick={async () => {
          installPrompt.prompt();
          await installPrompt.userChoice.catch(() => null);
          setInstallPrompt(null);
        }}
        style={{ marginTop:'0.4rem' }}
        >
        Instalar app (PWA)
        </button>
      )}

      <button
      type="button"
      onClick={() => goTo('register')}
      style={{ background:'none', border:'none', cursor:'pointer', color:'var(--primary)', fontSize:'0.875rem', textAlign:'center', padding:'0.25rem 0' }}
      >
      ¿No tienes cuenta? <strong>Regístrate</strong>
      </button>
      </div>
      </>
    )}

    {/* ── VISTA: REGISTER ─────────────────────────────────────────────── */}
    {view === 'register' && (
      <>
      {/* Datos personales */}
      <div className="row">
      <label>Nombre completo
      <input
      value={fullName}
      onChange={e => setFullName(e.target.value)}
      placeholder="Ej: Juan García López"
      autoComplete="name"
      />
      </label>

      <label>
      Alias / Apodo
      <input
      value={alias}
      onChange={e => setAlias(e.target.value)}
      placeholder="Ej: JuanG"
      autoComplete="nickname"
      />
      <span style={{ fontSize:'0.73rem', color:'var(--text-secondary)', marginTop:'0.2rem', display:'block' }}>
      Así te verán los demás. Tu nombre de usuario se genera automáticamente.
      </span>
      </label>

      <label>Correo electrónico
      <input
      value={regEmail}
      onChange={e => setRegEmail(e.target.value)}
      type="email"
      placeholder="tu@correo.com"
      autoComplete="email"
      />
      </label>

      {!appKey && (
        <label>Tipo de cuenta
        <select value={role} onChange={e => setRole(e.target.value)}>
        <option value="customer">Cliente</option>
        <option value="restaurant">Tienda</option>
        <option value="driver">Conductor</option>
        </select>
        </label>
      )}
      </div>

      {/* Contraseña */}
      <div className="row" style={{ marginTop:'0.5rem' }}>
      <label>
      Contraseña
      <input
      value={regPwd}
      onChange={e => setRegPwd(e.target.value)}
      type="password"
      placeholder="Mínimo 8 caracteres"
      autoComplete="new-password"
      />
      {pwdError && (
        <span style={{ fontSize:'0.73rem', color:'var(--error)', marginTop:'0.2rem', display:'block' }}>
        {pwdError}
        </span>
      )}
      </label>
      <label>Confirmar contraseña
      <input
      value={regPwdConf}
      onChange={e => setRegPwdConf(e.target.value)}
      type="password"
      placeholder="Repite la contraseña"
      autoComplete="new-password"
      />
      </label>

      {/* Indicador visual fuerza contraseña */}
      {regPwd.length > 0 && (
        <PasswordStrength pwd={regPwd} />
      )}
      </div>

      {/* Dirección — obligatoria solo para restaurant, opcional para los demás */}
      <div style={{ marginTop:'0.75rem' }}>
      <p style={{ fontWeight:700, fontSize:'0.82rem', marginBottom:'0.5rem', color:'var(--text-secondary)' }}>
      {role === 'restaurant'
        ? 'Dirección de la tienda (requerida)'
    : 'Dirección (opcional — puedes configurarla después)'}
    </p>
    <AddressBlock
    postalCode={postalCode} setPostalCode={setPostalCode}
    estado={estado}         setEstado={setEstado}
    ciudad={ciudad}         setCiudad={setCiudad}
    colonia={colonia}       setColonia={setColonia}
    coloniasList={coloniasList}
    calle={calle}           setCalle={setCalle}
    numero={numero}         setNumero={setNumero}
    cpLoading={cpLoading}   cpError={cpError}
    />
    </div>

    <div className="row" style={{ marginTop:'0.75rem' }}>
    <button className="btn-primary" onClick={submitRegister} disabled={loading}>
    {loading ? 'Registrando…' : 'Crear cuenta'}
    </button>
    <button
    type="button"
    onClick={() => goTo('login')}
    style={{ background:'none', border:'none', cursor:'pointer', color:'var(--primary)', fontSize:'0.875rem', textAlign:'center', padding:'0.25rem 0' }}
    >
    ¿Ya tienes cuenta? <strong>Inicia sesión</strong>
    </button>
    </div>
    </>
    )}

    {/* ── VISTA: FORGOT PASSWORD ──────────────────────────────────────── */}
    {view === 'forgot' && (
      <>
      <div className="row">
      <label>Correo electrónico de tu cuenta
      <input
      value={forgotEmail}
      onChange={e => setForgotEmail(e.target.value)}
      type="email"
      placeholder="tu@correo.com"
      autoComplete="email"
      onKeyDown={e => handleKey(e, submitForgot)}
      />
      </label>
      </div>
      <div className="row" style={{ marginTop:'0.5rem' }}>
      <button className="btn-primary" onClick={submitForgot} disabled={loading}>
      {loading ? 'Enviando…' : 'Enviar enlace de recuperación'}
      </button>
      <button
      type="button"
      onClick={() => goTo('login')}
      style={{ background:'none', border:'none', cursor:'pointer', color:'var(--primary)', fontSize:'0.875rem', textAlign:'center', padding:'0.25rem 0' }}
      >
      ← Volver al inicio de sesión
      </button>
      </div>
      </>
    )}

    {/* ── Mensaje flash ───────────────────────────────────────────────── */}
    {message.text && (
      <p className={`flash ${message.ok ? 'flash-ok' : 'flash-error'}`} style={{ marginTop:'0.75rem' }}>
      {message.text}
      </p>
    )}
    </section>
  );
}

// ── Sub-componente: bloque de dirección ──────────────────────────────────────
function AddressBlock({
  postalCode, setPostalCode,
  estado, setEstado,
  ciudad, setCiudad,
  colonia, setColonia,
  coloniasList,
  calle, setCalle,
  numero, setNumero,
  cpLoading, cpError,
}) {
  const BUSY = { opacity:0.7, pointerEvents:'none' };
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'0.55rem' }}>
    {/* CP */}
    <label>
    Código postal
    <div style={{ position:'relative', ...(cpLoading ? BUSY : {}) }}>
    <input
    value={postalCode}
    onChange={e => setPostalCode(e.target.value.replace(/\D/g,'').slice(0,5))}
    placeholder="Ej: 44100"
    maxLength={5}
    inputMode="numeric"
    />
    {cpLoading && (
      <span style={{ position:'absolute', right:'0.6rem', top:'50%', transform:'translateY(-50%)', fontSize:'0.75rem', color:'var(--text-secondary)' }}>
      Buscando…
      </span>
    )}
    </div>
    {cpError && <span style={{ fontSize:'0.72rem', color:'var(--error)', marginTop:'0.2rem', display:'block' }}>{cpError}</span>}
    </label>

    {/* Estado / Ciudad */}
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.55rem' }}>
    <label>Estado
    <input value={estado} onChange={e => setEstado(e.target.value)} placeholder="Jalisco" disabled={cpLoading} />
    </label>
    <label>Municipio / Ciudad
    <input value={ciudad} onChange={e => setCiudad(e.target.value)} placeholder="Guadalajara" disabled={cpLoading} />
    </label>
    </div>

    {/* Colonia */}
    <label>
    Colonia
    {coloniasList.length > 0 ? (
      <select value={colonia} onChange={e => setColonia(e.target.value)} disabled={cpLoading}>
      <option value="">Seleccionar colonia…</option>
      {coloniasList.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
    ) : (
      <input value={colonia} onChange={e => setColonia(e.target.value)} placeholder="Ej: Col. Centro" disabled={cpLoading} />
    )}
    </label>

    {/* Calle + Número */}
    <div style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:'0.55rem', alignItems:'end' }}>
    <label>Calle
    <input value={calle} onChange={e => setCalle(e.target.value)} placeholder="Ej: Av. Revolución" />
    </label>
    <label style={{ width:90 }}>Número
    <input value={numero} onChange={e => setNumero(e.target.value)} placeholder="1234" />
    </label>
    </div>
    </div>
  );
}

// ── Sub-componente: indicador de fuerza de contraseña ────────────────────────
function PasswordStrength({ pwd }) {
  let score = 0;
  if (pwd.length >= 8)         score++;
  if (/[A-Z]/.test(pwd))       score++;
  if (/[0-9]/.test(pwd))       score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;

  const labels = ['Muy débil', 'Débil', 'Regular', 'Fuerte', 'Muy fuerte'];
  const colors = ['#e53e3e', '#dd6b20', '#d69e2e', '#38a169', '#2b6cb0'];

  return (
    <div style={{ marginTop:'0.3rem' }}>
    <div style={{ display:'flex', gap:3 }}>
    {[0,1,2,3].map(i => (
      <div key={i} style={{
        flex:1, height:4, borderRadius:2,
        background: i < score ? colors[score] : 'var(--border)',
                         transition:'background 0.3s',
      }} />
    ))}
    </div>
    <span style={{ fontSize:'0.72rem', color: colors[score] || 'var(--text-secondary)', marginTop:'0.2rem', display:'block' }}>
    {labels[score] || ''}
    </span>
    </div>
  );
}
