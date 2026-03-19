// frontend/src/pages/AuthPage.jsx
// Inputs no controlados (useRef) para cero re-renders al tipear.
// Lee localStorage directamente para el redirect — sin consumir AuthContext
// en el ciclo de render, lo que elimina el jank causado por re-renders del árbol.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../api/client';

const styles = `
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@700;800&display=swap');

.auth-root {
  min-height: 100vh;
  background-color: #0d0d0d;
  background-image:
  linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
  linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px);
  background-size: 40px 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  font-family: 'DM Mono', monospace;
}

.auth-card {
  background: #111;
  border: 1px solid #2a2a2a;
  width: 100%;
  max-width: 960px;
  position: relative;
  overflow: hidden;
}

/* Corner accents */
.auth-card::before,
.auth-card::after {
  content: '';
  position: absolute;
  width: 18px;
  height: 18px;
  border-color: #e8ff47;
  border-style: solid;
}
.auth-card::before {
  top: -1px; left: -1px;
  border-width: 2px 0 0 2px;
}
.auth-card::after {
  bottom: -1px; right: -1px;
  border-width: 0 2px 2px 0;
}

/* ── HEADER ── */
.auth-header {
  padding: 2.5rem 2.5rem 2rem;
  border-bottom: 1px solid #1e1e1e;
  display: flex;
  align-items: baseline;
  gap: 1.5rem;
}

.auth-title {
  font-family: 'Syne', sans-serif;
  font-size: clamp(1.8rem, 4vw, 2.8rem);
  font-weight: 800;
  color: #f0f0f0;
  letter-spacing: -0.03em;
  line-height: 1;
  margin: 0;
}

.auth-title span {
  color: #e8ff47;
}

.auth-subtitle {
  font-size: 0.7rem;
  color: #444;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  margin: 0;
}

/* ── BODY ── */
.auth-body {
  padding: 2.5rem;
}

/* Desktop: horizontal grid — fields on left, actions on right */
.auth-layout {
  display: grid;
  grid-template-columns: 1fr 220px;
  gap: 2rem;
  align-items: start;
}

/* Mobile: stack vertically */
@media (max-width: 640px) {
  .auth-header {
    padding: 1.75rem 1.5rem 1.25rem;
    flex-direction: column;
    gap: 0.4rem;
  }
  .auth-body {
    padding: 1.5rem;
  }
  .auth-layout {
    grid-template-columns: 1fr;
    gap: 1.5rem;
  }
  .auth-actions {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 0.75rem;
  }
  .btn-primary, .btn-secondary, .btn-pwa {
    flex: 1 1 140px;
  }
}

/* ── FIELDS ── */
.auth-fields {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

/* Two-column row for username + password on desktop */
.fields-row-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

@media (max-width: 480px) {
  .fields-row-2 {
    grid-template-columns: 1fr;
  }
}

.auth-label {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.65rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #555;
}

.auth-input,
.auth-select {
  background: #0d0d0d;
  border: 1px solid #2a2a2a;
  border-radius: 0;
  color: #f0f0f0;
  font-family: 'DM Mono', monospace;
  font-size: 0.875rem;
  padding: 0.65rem 0.85rem;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
  width: 100%;
  box-sizing: border-box;
  appearance: none;
}

.auth-input:focus,
.auth-select:focus {
  border-color: #e8ff47;
  box-shadow: 0 0 0 1px #e8ff47;
}

.auth-input::placeholder {
  color: #333;
}

.auth-select option {
  background: #111;
}

/* ── ACTIONS COLUMN ── */
.auth-actions {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding-top: 0.1rem;
}

.btn-primary {
  background: #e8ff47;
  color: #0d0d0d;
  border: none;
  border-radius: 0;
  font-family: 'Syne', sans-serif;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0.9rem 1.25rem;
  cursor: pointer;
  transition: background 0.15s, transform 0.1s;
  width: 100%;
}

.btn-primary:hover {
  background: #f5ff8a;
  transform: translateY(-1px);
}

.btn-primary:active {
  transform: translateY(0);
}

.btn-secondary {
  background: transparent;
  color: #555;
  border: 1px solid #2a2a2a;
  border-radius: 0;
  font-family: 'DM Mono', monospace;
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0.75rem 1rem;
  cursor: pointer;
  text-align: center;
  text-decoration: none;
  display: block;
  transition: border-color 0.15s, color 0.15s;
}

.btn-secondary:hover {
  border-color: #555;
  color: #aaa;
}

.btn-pwa {
  background: transparent;
  color: #444;
  border: 1px dashed #2a2a2a;
  border-radius: 0;
  font-family: 'DM Mono', monospace;
  font-size: 0.65rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 0.65rem 1rem;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
  width: 100%;
}

.btn-pwa:hover {
  border-color: #e8ff47;
  color: #e8ff47;
}

/* ── FLASH ── */
.flash {
  margin: 0 2.5rem 2rem;
  padding: 0.75rem 1rem;
  font-size: 0.75rem;
  letter-spacing: 0.05em;
  border-left: 3px solid;
}

.flash-ok {
  background: rgba(232, 255, 71, 0.06);
  border-color: #e8ff47;
  color: #e8ff47;
}

.flash-error {
  background: rgba(255, 80, 80, 0.06);
  border-color: #ff5050;
  color: #ff5050;
}

@media (max-width: 640px) {
  .flash {
    margin: 0 1.5rem 1.5rem;
  }
}
`;

export default function AuthPage({ mode = 'login' }) {
  return <AuthForm mode={mode} />;
}

function AuthForm({ mode }) {
  const { login } = useAuth();
  const navigate  = useNavigate();

  const usernameRef    = useRef(null);
  const passwordRef    = useRef(null);
  const displayNameRef = useRef(null);
  const addressRef     = useRef(null);

  const [role,    setRole]    = useState('customer');
  const [message, setMessage] = useState('');
  const isLogin = mode === 'login';

  const [installPromptEvent, setInstallPromptEvent] = useState(null);

  useEffect(() => {
    const onBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setInstallPromptEvent(e);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  }, []);

  const installPwa = useCallback(async () => {
    if (!installPromptEvent) return;
    installPromptEvent.prompt();
    await installPromptEvent.userChoice.catch(() => null);
    setInstallPromptEvent(null);
  }, [installPromptEvent]);

  const submit = useCallback(async () => {
    const username    = usernameRef.current?.value?.trim()    || '';
    const password    = passwordRef.current?.value            || '';
    const displayName = displayNameRef.current?.value?.trim() || '';
    const address     = addressRef.current?.value?.trim()     || '';

  try {
    if (!isLogin) {
      await apiFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          username, password, role,
          displayName: displayName || undefined,
          address: ['customer','restaurant'].includes(role) ? address : undefined,
        })
      });
      setMessage('Registro exitoso. Ya puedes iniciar sesión.');
      return;
    }
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    login({ token: data.token, user: data.user });
    navigate(`/${data.user.role}`);
  } catch (error) {
    setMessage(error.message);
  }
  }, [isLogin, role, login, navigate]);

  function handleKey(e) { if (e.key === 'Enter') submit(); }

  return (
    <>
    <style>{styles}</style>
    <div className="auth-root">
    <div className="auth-card">

    {/* ── HEADER ── */}
    <div className="auth-header">
    <h1 className="auth-title">
    {isLogin ? <>Iniciar<span>_</span>sesión</> : <>Crear<span>_</span>cuenta</>}
    </h1>
    <p className="auth-subtitle">
    {isLogin ? 'Accede a tu panel' : 'Completa los datos'}
    </p>
    </div>

    {/* ── BODY ── */}
    <div className="auth-body">
    <div className="auth-layout">

    {/* LEFT — Fields */}
    <div className="auth-fields">
    <div className="fields-row-2">
    <label className="auth-label">
    Usuario
    <input
    ref={usernameRef}
    className="auth-input"
    defaultValue=""
    placeholder="nombre_usuario"
    autoComplete="username"
    onKeyDown={handleKey}
    />
    </label>
    <label className="auth-label">
    Contraseña
    <input
    ref={passwordRef}
    className="auth-input"
    defaultValue=""
    type="password"
    placeholder="••••••••"
    autoComplete="current-password"
    onKeyDown={handleKey}
    />
    </label>
    </div>

    {!isLogin && (
      <label className="auth-label">
      Tipo de cuenta
      <select
      className="auth-select"
      value={role}
      onChange={e => setRole(e.target.value)}
      >
      <option value="customer">Cliente</option>
      <option value="restaurant">Tienda</option>
      <option value="driver">Conductor</option>
      </select>
      </label>
    )}

    {!isLogin && role === 'restaurant' && (
      <label className="auth-label">
      Nombre de la tienda
      <input
      ref={displayNameRef}
      className="auth-input"
      defaultValue=""
      placeholder="Ej: Tacos El Güero"
      onKeyDown={handleKey}
      />
      </label>
    )}

    {!isLogin && ['customer','restaurant'].includes(role) && (
      <label className="auth-label">
      Dirección
      <input
      ref={addressRef}
      className="auth-input"
      defaultValue=""
      placeholder="Ej: Av. Revolución 1234, Col. Centro"
      onKeyDown={handleKey}
      />
      </label>
    )}
    </div>

    {/* RIGHT — Actions */}
    <div className="auth-actions">
    <button className="btn-primary" onClick={submit}>
    {isLogin ? 'Entrar →' : 'Registrarse →'}
    </button>

    {isLogin
      ? <Link to="/register" className="btn-secondary">¿Sin cuenta? Regístrate</Link>
      : <Link to="/login"    className="btn-secondary">¿Ya tienes cuenta?</Link>
    }

    {installPromptEvent && (
      <button className="btn-pwa" onClick={installPwa}>
      ↓ Instalar PWA
      </button>
    )}
    </div>

    </div>
    </div>

    {/* ── FLASH ── */}
    {message && (
      <p className={`flash ${message.startsWith('Registro') ? 'flash-ok' : 'flash-error'}`}>
      {message}
      </p>
    )}

    </div>
    </div>
    </>
  );
}
