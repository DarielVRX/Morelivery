// frontend/src/App.jsx
import { lazy, memo, Suspense, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import SplitLayout from './components/SplitLayout';
import { apiFetch } from './api/client';

// ─── Lazy pages ───────────────────────────────────────────────────────────────
const CustomerHome     = lazy(() => import('./pages/Customer/Home'));
const CustomerOrders   = lazy(() => import('./pages/Customer/Orders'));
const CustomerPayments = lazy(() => import('./pages/Customer/Payments'));
const RestaurantPage   = lazy(() => import('./pages/Customer/RestaurantPage'));
const RestaurantMenu     = lazy(() => import('./pages/Restaurant/Menu'));
const RestaurantOrders   = lazy(() => import('./pages/Restaurant/Orders'));
const RestaurantSchedule = lazy(() => import('./pages/Restaurant/Schedule'));
const DriverHome     = lazy(() => import('./pages/Driver/Home'));
const DriverOrders   = lazy(() => import('./pages/Driver/Orders'));
const DriverEarnings = lazy(() => import('./pages/Driver/Earnings'));
const AdminDashboard = lazy(() => import('./pages/Admin/Dashboard'));
const ProfilePage    = lazy(() => import('./pages/Profile'));

const Spinner = () => (
  <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--gray-400)' }}>Cargando…</div>
);

// ─── Config de apps ───────────────────────────────────────────────────────────
const ADMIN_APP = { key: 'admin', label: 'Administrador', home: '/admin', icon: null, description: '' };
const APPS = [
  { key: 'customer',   label: 'Cliente',   description: 'Pide donde quieras',  icon: '🛍️', home: '/customer'   },
{ key: 'restaurant', label: 'Tienda',    description: 'Gestiona tu negocio', icon: '🏪', home: '/restaurant' },
{ key: 'driver',     label: 'Conductor', description: 'Reparte y gana',      icon: '🛵', home: '/driver'     },
];

function findApp(key) {
  return APPS.find(a => a.key === key) ?? (key === 'admin' ? ADMIN_APP : null);
}

// ─── Guards ───────────────────────────────────────────────────────────────────
function ProtectedRole({ role, children }) {
  const { auth } = useAuth();
  if (!auth.user) return <Navigate to="/" replace />;
  if (auth.user.role !== role) return <Navigate to={findApp(auth.user.role)?.home || '/'} replace />;
  return children;
}
function ProtectedAny({ children }) {
  const { auth } = useAuth();
  if (!auth.user) return <Navigate to="/" replace />;
  return children;
}

// ─── Shared styles ────────────────────────────────────────────────────────────
const SHARED_STYLES = `
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@700;800&display=swap');

.ml-root {
  min-height: 100dvh;
  background-color: #0d0d0d;
  background-image:
  linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
  linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px);
  background-size: 40px 40px;
  font-family: 'DM Mono', monospace;
}

/* ── Landing ── */
.landing-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100dvh;
  padding: 2.5rem 1.5rem;
}

.landing-brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 3rem;
  text-align: center;
}

.landing-logo-ring {
  width: 60px;
  height: 60px;
  border: 2px solid #e8ff47;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 0.25rem;
}

.landing-title {
  font-family: 'Syne', sans-serif;
  font-size: clamp(2.2rem, 6vw, 3.5rem);
  font-weight: 800;
  color: #f0f0f0;
  letter-spacing: -0.04em;
  line-height: 1;
  margin: 0;
}

.landing-title span { color: #e8ff47; }

.landing-sub {
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #444;
  margin: 0;
}

/* App cards — horizontal on desktop, vertical on mobile */
.landing-apps {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  background: #1e1e1e;
  width: 100%;
  max-width: 680px;
  border: 1px solid #1e1e1e;
  position: relative;
}

/* corner accents */
.landing-apps::before,
.landing-apps::after {
  content: '';
  position: absolute;
  width: 14px;
  height: 14px;
  border-color: #e8ff47;
  border-style: solid;
  z-index: 1;
}
.landing-apps::before { top: -1px; left: -1px; border-width: 2px 0 0 2px; }
.landing-apps::after  { bottom: -1px; right: -1px; border-width: 0 2px 2px 0; }

@media (max-width: 560px) {
  .landing-apps {
    grid-template-columns: 1fr;
  }
}

.app-card {
  background: #111;
  padding: 1.75rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  text-decoration: none;
  position: relative;
  transition: background 0.15s;
  cursor: pointer;
}

.app-card:hover {
  background: #161616;
}

.app-card:hover .app-arrow {
  color: #e8ff47;
  transform: translateX(3px);
}

.app-card-icon {
  font-size: 1.6rem;
  line-height: 1;
  margin-bottom: 0.25rem;
}

.app-card-label {
  font-family: 'Syne', sans-serif;
  font-size: 1rem;
  font-weight: 700;
  color: #f0f0f0;
  letter-spacing: -0.01em;
}

.app-card-desc {
  font-size: 0.68rem;
  color: #444;
  letter-spacing: 0.04em;
}

.app-arrow {
  position: absolute;
  top: 1.5rem;
  right: 1.25rem;
  font-size: 1rem;
  color: #2a2a2a;
  transition: color 0.15s, transform 0.15s;
}

/* ── Auth screen ── */
.auth-screen {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
}

.auth-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.85rem 1.5rem;
  border-bottom: 1px solid #1a1a1a;
  background: #0d0d0d;
  position: sticky;
  top: 0;
  z-index: 10;
}

.auth-back {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: #e8ff47;
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  text-decoration: none;
  transition: opacity 0.15s;
}
.auth-back:hover { opacity: 0.7; }

.auth-wordmark {
  font-family: 'Syne', sans-serif;
  font-size: 0.9rem;
  font-weight: 700;
  color: #f0f0f0;
  letter-spacing: -0.01em;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.auth-center {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2.5rem 1.5rem;
}

.auth-panel {
  width: 100%;
  max-width: 860px;
  background: #111;
  border: 1px solid #2a2a2a;
  position: relative;
}

.auth-panel::before,
.auth-panel::after {
  content: '';
  position: absolute;
  width: 14px;
  height: 14px;
  border-color: #e8ff47;
  border-style: solid;
}
.auth-panel::before { top: -1px; left: -1px; border-width: 2px 0 0 2px; }
.auth-panel::after  { bottom: -1px; right: -1px; border-width: 0 2px 2px 0; }

.auth-panel-header {
  padding: 2rem 2rem 1.5rem;
  border-bottom: 1px solid #1a1a1a;
  display: flex;
  align-items: baseline;
  gap: 1.25rem;
}

.auth-panel-title {
  font-family: 'Syne', sans-serif;
  font-size: clamp(1.5rem, 3.5vw, 2.2rem);
  font-weight: 800;
  color: #f0f0f0;
  letter-spacing: -0.03em;
  line-height: 1;
  margin: 0;
}
.auth-panel-title span { color: #e8ff47; }

.auth-panel-tag {
  font-size: 0.62rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #444;
}

.auth-panel-body {
  padding: 2rem;
}

/* Horizontal desktop / vertical mobile layout */
.auth-panel-layout {
  display: grid;
  grid-template-columns: 1fr 200px;
  gap: 2rem;
  align-items: start;
}

@media (max-width: 600px) {
  .auth-panel-header { padding: 1.5rem 1.5rem 1.25rem; flex-direction: column; gap: 0.3rem; }
  .auth-panel-body   { padding: 1.5rem; }
  .auth-panel-layout {
    grid-template-columns: 1fr;
    gap: 1.25rem;
  }
  .auth-panel-actions {
    flex-direction: row !important;
    flex-wrap: wrap;
  }
  .auth-btn-primary, .auth-btn-link { flex: 1 1 140px; }
}

.auth-fields {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.fields-2col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.9rem;
}
@media (max-width: 420px) { .fields-2col { grid-template-columns: 1fr; } }

.auth-lbl {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.62rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #555;
}

.auth-inp, .auth-sel {
  background: #0d0d0d;
  border: 1px solid #2a2a2a;
  border-radius: 0;
  color: #f0f0f0;
  font-family: 'DM Mono', monospace;
  font-size: 0.85rem;
  padding: 0.6rem 0.8rem;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
  width: 100%;
  box-sizing: border-box;
  appearance: none;
}
.auth-inp:focus, .auth-sel:focus {
  border-color: #e8ff47;
  box-shadow: 0 0 0 1px #e8ff47;
}
.auth-inp::placeholder { color: #333; }
.auth-sel option { background: #111; }

/* Actions column */
.auth-panel-actions {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.auth-btn-primary {
  background: #e8ff47;
  color: #0d0d0d;
  border: none;
  border-radius: 0;
  font-family: 'Syne', sans-serif;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0.9rem 1rem;
  cursor: pointer;
  width: 100%;
  transition: background 0.15s, transform 0.1s;
}
.auth-btn-primary:hover:not(:disabled) {
  background: #f5ff8a;
  transform: translateY(-1px);
}
.auth-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

.auth-btn-link {
  background: transparent;
  color: #555;
  border: 1px solid #2a2a2a;
  border-radius: 0;
  font-family: 'DM Mono', monospace;
  font-size: 0.65rem;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  padding: 0.7rem 0.9rem;
  text-align: center;
  text-decoration: none;
  display: block;
  transition: border-color 0.15s, color 0.15s;
}
.auth-btn-link:hover { border-color: #555; color: #aaa; }

/* Warning banner */
.auth-warn {
  margin-bottom: 1rem;
  padding: 0.6rem 0.85rem;
  background: rgba(255, 193, 7, 0.07);
  border-left: 3px solid #ffc107;
  font-size: 0.72rem;
  color: #cca000;
  letter-spacing: 0.02em;
}

/* Flash */
.auth-flash {
  margin: 0 2rem 1.75rem;
  padding: 0.7rem 0.9rem;
  font-size: 0.72rem;
  letter-spacing: 0.04em;
  border-left: 3px solid;
}
.auth-flash-ok    { background: rgba(232,255,71,0.06); border-color: #e8ff47; color: #e8ff47; }
.auth-flash-error { background: rgba(255,80,80,0.06);  border-color: #ff5050; color: #ff5050; }

@media (max-width: 600px) {
  .auth-flash { margin: 0 1.5rem 1.5rem; }
}
`;

// ─── LandingScreen ────────────────────────────────────────────────────────────
function LandingScreen() {
  const { auth } = useAuth();
  if (auth.user) {
    const app = findApp(auth.user.role);
    return <Navigate to={app?.home || '/'} replace />;
  }

  return (
    <div className="ml-root">
    <style>{SHARED_STYLES}</style>
    <div className="landing-wrap">
    <div className="landing-brand">
    <div className="landing-logo-ring">
    <img src="/logo.svg" alt="Morelivery" style={{ width: 32, height: 32 }} />
    </div>
    <h1 className="landing-title">More<span>livery</span></h1>
    <p className="landing-sub">¿Cómo quieres acceder?</p>
    </div>

    <div className="landing-apps">
    {APPS.map(app => (
      <Link key={app.key} to={`/${app.key}/login`} className="app-card">
      <span className="app-arrow">›</span>
      <div className="app-card-icon">{app.icon}</div>
      <div className="app-card-label">{app.label}</div>
      <div className="app-card-desc">{app.description}</div>
      </Link>
    ))}
    </div>
    </div>
    </div>
  );
}

// ─── AuthScreen ───────────────────────────────────────────────────────────────
const AuthScreen = memo(function AuthScreen({ mode = 'login' }) {
  const { appKey } = useParams();
  const app        = findApp(appKey);
  const { auth, login } = useAuth();
  const navigate   = useNavigate();

  const usernameRef    = useRef(null);
  const passwordRef    = useRef(null);
  const displayNameRef = useRef(null);
  const addressRef     = useRef(null);

  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const isLogin = mode === 'login';

if (auth.user && auth.user.role === appKey) {
  return <Navigate to={app?.home || `/${appKey}`} replace />;
}
const wrongRole = auth.user && auth.user.role !== appKey;
if (!app) return <Navigate to="/" replace />;

const submit = async () => {
  const username    = usernameRef.current?.value?.trim() || '';
  const password    = passwordRef.current?.value         || '';
  const displayName = displayNameRef.current?.value?.trim() || '';
  const address     = addressRef.current?.value?.trim()  || '';

if (!username || !password) { setMessage('Completa usuario y contraseña.'); return; }
setMessage(''); setLoading(true);
try {
  if (!isLogin) {
    await apiFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username, password, role: appKey,
        displayName: displayName || undefined,
        address: ['customer', 'restaurant'].includes(appKey) ? address : undefined,
      }),
    });
    setMessage('Registro exitoso. Ya puedes iniciar sesión.');
    return;
  }
  const data = await apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password, role: appKey }),
  });
  if (data.user.role !== appKey) {
    setMessage(`Esta cuenta es de tipo "${findApp(data.user.role)?.label || data.user.role}". Accede desde la sección correcta.`);
    return;
  }
  login({ token: data.token, user: data.user });
  navigate(app.home);
} catch (error) {
  setMessage(error.message);
} finally {
  setLoading(false);
}
};

function handleKey(e) { if (e.key === 'Enter') submit(); }
const isOk = message.startsWith('Registro exitoso');

return (
  <div className="ml-root">
  <style>{SHARED_STYLES}</style>
  <div className="auth-screen">

  {/* ── Top bar ── */}
  <header className="auth-topbar">
  <Link to="/" className="auth-back">
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
  <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
  Inicio
  </Link>
  <div className="auth-wordmark">
  <img src="/logo.svg" alt="" style={{ width: 22, height: 22 }} />
  Morelivery
  </div>
  </header>

  {/* ── Panel ── */}
  <div className="auth-center">
  <div className="auth-panel">

  <div className="auth-panel-header">
  <h2 className="auth-panel-title">
  {app.icon && <span style={{ marginRight: '0.5rem' }}>{app.icon}</span>}
  {isLogin ? 'Iniciar' : 'Crear'}<span>_</span>{app.label}
  </h2>
  <span className="auth-panel-tag">
  {isLogin ? 'acceso' : 'registro'}
  </span>
  </div>

  <div className="auth-panel-body">
  {wrongRole && (
    <div className="auth-warn">
    ⚠ Ya tienes sesión como <strong>{findApp(auth.user.role)?.label}</strong>. Inicia sesión aquí para cambiar de cuenta.
    </div>
  )}

  <div className="auth-panel-layout">

  {/* Fields */}
  <div className="auth-fields">
  <div className="fields-2col">
  <label className="auth-lbl">
  Usuario
  <input ref={usernameRef} className="auth-inp" defaultValue=""
  placeholder="nombre_usuario" autoComplete="username" onKeyDown={handleKey} />
  </label>
  <label className="auth-lbl">
  Contraseña
  <input ref={passwordRef} className="auth-inp" defaultValue=""
  type="password" placeholder="••••••••" autoComplete="current-password" onKeyDown={handleKey} />
  </label>
  </div>

  {!isLogin && appKey === 'restaurant' && (
    <label className="auth-lbl">
    Nombre de la tienda
    <input ref={displayNameRef} className="auth-inp" defaultValue=""
    placeholder="Ej: Tacos El Güero" onKeyDown={handleKey} />
    </label>
  )}

  {!isLogin && ['customer', 'restaurant'].includes(appKey) && (
    <label className="auth-lbl">
    Dirección
    <input ref={addressRef} className="auth-inp" defaultValue=""
    placeholder="Ej: Av. Revolución 1234, Col. Centro" onKeyDown={handleKey} />
    </label>
  )}
  </div>

  {/* Actions */}
  <div className="auth-panel-actions">
  <button className="auth-btn-primary" onClick={submit} disabled={loading}>
  {loading ? 'Cargando…' : (isLogin ? 'Entrar →' : 'Registrarse →')}
  </button>
  {isLogin
    ? <Link to={`/${appKey}/register`} className="auth-btn-link">¿Sin cuenta? Regístrate</Link>
    : <Link to={`/${appKey}/login`}    className="auth-btn-link">¿Ya tienes cuenta?</Link>
  }
  </div>

  </div>
  </div>

  {message && (
    <p className={`auth-flash ${isOk ? 'auth-flash-ok' : 'auth-flash-error'}`}>
    {message}
    </p>
  )}
  </div>
  </div>
  </div>
  </div>
);
});

// ─── Rutas protegidas ─────────────────────────────────────────────────────────
function AppRoutes() {
  return (
    <Layout>
    <Suspense fallback={<Spinner />}>
    <Routes>
    <Route path="/profile" element={<ProtectedAny><ProfilePage /></ProtectedAny>} />

    <Route path="/restaurant/:id" element={
      <ProtectedAny>
      <SplitLayout homeContent={<RestaurantPage />} ordersContent={<CustomerOrders />} />
      </ProtectedAny>
    } />

    <Route path="/customer" element={
      <ProtectedRole role="customer">
      <SplitLayout homeContent={<CustomerHome />} ordersContent={<CustomerOrders />} />
      </ProtectedRole>
    } />
    <Route path="/customer/pedidos"  element={<Navigate to="/customer" replace />} />
    <Route path="/customer/pagos"    element={<ProtectedRole role="customer"><CustomerPayments /></ProtectedRole>} />

    <Route path="/restaurant" element={
      <ProtectedRole role="restaurant">
      <SplitLayout homeContent={<RestaurantMenu />} ordersContent={<RestaurantOrders />} />
      </ProtectedRole>
    } />
    <Route path="/restaurant/pedidos" element={<Navigate to="/restaurant" replace />} />
    <Route path="/restaurant/horario" element={
      <ProtectedRole role="restaurant">
      <SplitLayout homeContent={<RestaurantSchedule />} ordersContent={<RestaurantOrders />} />
      </ProtectedRole>
    } />

    <Route path="/driver" element={
      <ProtectedRole role="driver">
      <SplitLayout homeContent={<DriverHome />} ordersContent={<DriverOrders />} />
      </ProtectedRole>
    } />
    <Route path="/driver/pedidos"    element={<Navigate to="/driver" replace />} />
    <Route path="/driver/ganancias"  element={
      <ProtectedRole role="driver">
      <SplitLayout homeContent={<DriverEarnings />} ordersContent={<DriverOrders />} />
      </ProtectedRole>
    } />

    <Route path="/admin" element={<ProtectedRole role="admin"><AdminDashboard /></ProtectedRole>} />
    <Route path="*"      element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
    </Layout>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
function RootRouter() {
  return (
    <Routes>
    <Route path="/"                 element={<LandingScreen />} />
    <Route path="/:appKey/login"    element={<AuthScreen mode="login" />} />
    <Route path="/:appKey/register" element={<AuthScreen mode="register" />} />
    <Route path="/*"                element={<AppRoutes />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
    <RootRouter />
    </AuthProvider>
  );
}
