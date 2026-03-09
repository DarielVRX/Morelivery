// frontend/src/App.jsx
import { lazy, memo, Suspense, useCallback, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import SplitLayout from './components/SplitLayout';
import { apiFetch } from './api/client';

// ─── Lazy pages ───────────────────────────────────────────────────────────────
const CustomerHome    = lazy(() => import('./pages/Customer/Home'));
const CustomerOrders  = lazy(() => import('./pages/Customer/Orders'));
const RestaurantPage  = lazy(() => import('./pages/Customer/RestaurantPage'));
const RestaurantMenu     = lazy(() => import('./pages/Restaurant/Menu'));
const RestaurantOrders   = lazy(() => import('./pages/Restaurant/Orders'));
const RestaurantSchedule = lazy(() => import('./pages/Restaurant/Schedule'));
const DriverHome     = lazy(() => import('./pages/Driver/Home'));
const DriverOrders   = lazy(() => import('./pages/Driver/Orders'));
const DriverEarnings = lazy(() => import('./pages/Driver/Earnings'));
const AdminDashboard = lazy(() => import('./pages/Admin/Dashboard'));
const ProfilePage    = lazy(() => import('./pages/Profile'));

const Spinner = () => (
  <div style={{ padding:'2rem', textAlign:'center', color:'var(--gray-400)' }}>Cargando…</div>
);

const ADMIN_APP = { key:'admin', label:'Administrador', home:'/admin', icon:null, description:'' };

const APPS = [
  { key: 'customer',   label: 'Cliente',    description: 'Pide donde quieras',    icon: '🛍️', home: '/customer'   },
  { key: 'restaurant', label: 'Tienda',     description: 'Gestiona tu negocio',   icon: '🏪', home: '/restaurant' },
  { key: 'driver',     label: 'Conductor',  description: 'Reparte y gana',        icon: '🛵', home: '/driver'     },
];

function findApp(roleOrKey) {
  return APPS.find(a => a.key === roleOrKey) ?? (roleOrKey === 'admin' ? ADMIN_APP : null);
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

// ─── Landing ──────────────────────────────────────────────────────────────────
function LandingScreen() {
  const { auth } = useAuth();
  if (auth.user) {
    const app = findApp(auth.user.role);
    return <Navigate to={app?.home || '/'} replace />;
  }

  return (
    <div style={{
      minHeight: '100dvh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#fff',
      padding: '1.5rem 1rem',
    }}>
      <div style={{
        width: '100%',
        maxWidth: '400px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0.5rem',
      }}>
        {/* Brand */}
        <img src="/logo.svg" alt="Morelivery" style={{ width: 56, height: 56, marginBottom: '0.25rem' }} />
        <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: '#1a1a1a', margin: 0 }}>Morelivery</h1>
        <p style={{ fontSize: '0.9rem', color: '#6b7280', margin: '0 0 1.25rem' }}>¿Cómo quieres acceder?</p>

        {/* Vertical stacked buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', width: '100%' }}>
          {APPS.map(app => (
            <Link key={app.key} to={`/${app.key}/login`} style={{ textDecoration: 'none' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '1rem',
                background: 'var(--brand, #e03a6e)',
                color: '#fff',
                borderRadius: '12px',
                padding: '0.875rem 1.25rem',
                cursor: 'pointer',
                transition: 'transform 0.15s, box-shadow 0.15s',
                boxShadow: '0 2px 8px rgba(224,58,110,0.25)',
              }} className="landing-btn">
                <span style={{ fontSize: '1.6rem', lineHeight: 1 }}>{app.icon}</span>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 700, fontSize: '1rem' }}>{app.label}</span>
                  <span style={{ fontSize: '0.78rem', opacity: 0.85 }}>{app.description}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <style>{`
        .landing-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(224,58,110,0.35) !important;
        }
        .landing-btn:active { transform: translateY(0); }
      `}</style>
    </div>
  );
}

// ─── Auth Screen ──────────────────────────────────────────────────────────────
// Inputs are uncontrolled (useRef) — zero re-renders while typing
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
  const [submitting, setSubmitting] = useState(false);

  const isLogin = mode === 'login';

  // If already logged in with the SAME role → redirect to home
  if (auth.user && auth.user.role === appKey) {
    return <Navigate to={app?.home || `/${appKey}`} replace />;
  }
  // If logged in with a DIFFERENT role → redirect to their own home (role mismatch guard)
  if (auth.user && auth.user.role !== appKey) {
    return <Navigate to={findApp(auth.user.role)?.home || '/'} replace />;
  }
  // Unknown app key
  if (!app) return <Navigate to="/" replace />;

  const submit = async () => {
    if (submitting) return;
    const username    = usernameRef.current?.value?.trim() || '';
    const password    = passwordRef.current?.value         || '';
    const displayName = displayNameRef.current?.value?.trim() || '';
    const address     = addressRef.current?.value?.trim()  || '';
    setMessage('');
    setSubmitting(true);
    try {
      if (!isLogin) {
        await apiFetch('/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            username, password,
            role: appKey,
            displayName: displayName || undefined,
            address: ['customer','restaurant'].includes(appKey) ? address : undefined,
          }),
        });
        setMessage('Registro exitoso. Ya puedes iniciar sesión.');
        return;
      }
      // Login — backend validates role; we also validate client-side
      const data = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password, role: appKey }),
      });
      // Extra safety: if server returns a different role, block it
      if (data.user?.role && data.user.role !== appKey) {
        setMessage(`Esta cuenta es de tipo "${data.user.role}". Usa el acceso correcto.`);
        return;
      }
      login({ token: data.token, user: data.user });
      navigate(app.home);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  function handleKey(e) { if (e.key === 'Enter') submit(); }

  const isOk = message.startsWith('Registro exitoso');

  return (
    <div style={authStyles.wrap}>
      <header style={authStyles.header}>
        <Link to="/" style={authStyles.back}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Inicio
        </Link>
        <div style={authStyles.headerBrand}>
          <img src="/logo.svg" alt="" style={{ width:28, height:28 }} />
          <strong style={{ fontSize:'1rem' }}>Morelivery</strong>
        </div>
      </header>

      <section className="auth-card">
        <div style={{ textAlign:'center', marginBottom:'0.5rem' }}>
          <span style={{ fontSize:'1.75rem' }}>{app.icon || '🔐'}</span>
          <h2 style={{ margin:'0.25rem 0 0' }}>
            {isLogin ? `Entrar como ${app.label}` : `Crear cuenta ${app.label}`}
          </h2>
        </div>

        <div className="row">
          <label>Usuario
            <input ref={usernameRef} defaultValue="" placeholder="Tu nombre de usuario"
              autoComplete="username" onKeyDown={handleKey} />
          </label>
          <label>Contraseña
            <input ref={passwordRef} defaultValue="" type="password" placeholder="Tu contraseña"
              autoComplete="current-password" onKeyDown={handleKey} />
          </label>
        </div>

        {!isLogin && appKey === 'restaurant' && (
          <div className="row">
            <label>Nombre de la tienda
              <input ref={displayNameRef} defaultValue=""
                placeholder="Ej: Tacos El Güero" onKeyDown={handleKey} />
            </label>
          </div>
        )}
        {!isLogin && ['customer','restaurant'].includes(appKey) && (
          <div className="row">
            <label>Dirección
              <input ref={addressRef} defaultValue=""
                placeholder="Ej: Av. Revolución 1234, Col. Centro" onKeyDown={handleKey} />
            </label>
          </div>
        )}

        <div className="row">
          <button className="btn-primary" onClick={submit} disabled={submitting}>
            {submitting ? 'Procesando…' : (isLogin ? 'Iniciar sesión' : 'Registrarse')}
          </button>
          {isLogin
            ? <Link to={`/${appKey}/register`} style={{ fontSize:'0.875rem', textAlign:'center' }}>
                ¿No tienes cuenta? Regístrate
              </Link>
            : <Link to={`/${appKey}/login`} style={{ fontSize:'0.875rem', textAlign:'center' }}>
                ¿Ya tienes cuenta? Inicia sesión
              </Link>
          }
        </div>

        {message && (
          <p className={`flash ${isOk ? 'flash-ok' : 'flash-error'}`}>{message}</p>
        )}
      </section>
    </div>
  );
});

const authStyles = {
  wrap: {
    minHeight: '100dvh',
    background: '#fff',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0.75rem 1.25rem',
    borderBottom: '1px solid var(--gray-200)',
    background: '#fff',
  },
  back: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.3rem',
    color: 'var(--brand)',
    fontSize: '0.875rem',
    fontWeight: 600,
    textDecoration: 'none',
  },
  headerBrand: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    color: 'var(--gray-800)',
  },
};

// ─── Protected routes (inside Layout) ────────────────────────────────────────
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
          <Route path="/customer/pedidos" element={<Navigate to="/customer" replace />} />

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
          <Route path="/driver/pedidos"   element={<Navigate to="/driver" replace />} />
          <Route path="/driver/ganancias" element={
            <ProtectedRole role="driver">
              <SplitLayout homeContent={<DriverEarnings />} ordersContent={<DriverOrders />} />
            </ProtectedRole>
          } />

          <Route path="/admin" element={<ProtectedRole role="admin"><AdminDashboard /></ProtectedRole>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}

function RootRouter() {
  return (
    <Routes>
      <Route path="/"                    element={<LandingScreen />} />
      <Route path="/:appKey/login"       element={<AuthScreen mode="login" />} />
      <Route path="/:appKey/register"    element={<AuthScreen mode="register" />} />
      <Route path="/*"                   element={<AppRoutes />} />
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
