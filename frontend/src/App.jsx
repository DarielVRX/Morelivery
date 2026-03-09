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

// ─── Config de apps públicas ──────────────────────────────────────────────────
// Admin no aparece en la landing — acceso directo por URL /admin/login
const ADMIN_APP = { key:'admin', label:'Administrador', home:'/admin', icon:null, description:'' };

const APPS = [
  {
    key: 'customer',
    label: 'Cliente',
    description: 'Pide donde quieras',
    icon: '🛍️',
    home: '/customer',
  },
  {
    key: 'restaurant',
    label: 'Tienda',
    description: 'Gestiona tu negocio',
    icon: '🏪',
    home: '/restaurant',
  },
  {
    key: 'driver',
    label: 'Conductor',
    description: 'Reparte y gana',
    icon: '🛵',
    home: '/driver',
  },
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

// ─── Pantalla de inicio ───────────────────────────────────────────────────────
function LandingScreen() {
  const { auth } = useAuth();

  // Si ya está logueado, redirigir a su home
  if (auth.user) {
    const app = findApp(auth.user.role);
    return <Navigate to={app?.home || '/'} replace />;
  }

  return (
    <div style={landingStyles.wrap}>
      <div style={landingStyles.inner}>
        {/* Marca */}
        <div style={landingStyles.brand}>
          <img src="/logo.svg" alt="Morelivery" style={landingStyles.logo} />
          <h1 style={landingStyles.title}>Morelivery</h1>
          <p style={landingStyles.sub}>¿Cómo quieres acceder?</p>
        </div>

        {/* Tarjetas de acceso */}
        <div style={landingStyles.grid}>
          {APPS.map(app => (
            <Link key={app.key} to={`/${app.key}/login`} style={{ textDecoration:'none' }}>
              <div style={landingStyles.card} className="landing-card">
                <div style={landingStyles.cardIcon}>{app.icon}</div>
                <span style={landingStyles.cardLabel}>{app.label}</span>
                <span style={landingStyles.cardDesc}>{app.description}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <style>{`
        .landing-card {
          transition: transform 0.18s ease, box-shadow 0.18s ease;
        }
        .landing-card:hover {
          transform: translateY(-3px);
          box-shadow: 0 8px 24px rgba(0,0,0,0.12);
        }
      `}</style>
    </div>
  );
}

const landingStyles = {
  wrap: {
    minHeight: '100dvh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--brand-light)',
    padding: '2rem 1rem',
  },
  inner: {
    width: '100%',
    maxWidth: '520px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '2rem',
  },
  brand: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.35rem',
  },
  logo: { width: '64px', height: '64px' },
  title: { fontSize: '1.75rem', fontWeight: 800, color: 'var(--gray-800)', margin: 0 },
  sub: { fontSize: '1rem', color: 'var(--gray-600)', margin: 0 },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '1rem',
    width: '100%',
  },
  card: {
    background: '#fff',
    borderRadius: '14px',
    padding: '1.5rem 1rem',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.4rem',
    boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
    border: '1.5px solid var(--gray-200)',
    cursor: 'pointer',
  },
  cardIcon: { fontSize: '2rem', lineHeight: 1 },
  cardLabel: { fontWeight: 700, fontSize: '0.95rem', color: 'var(--gray-800)' },
  cardDesc: { fontSize: '0.78rem', color: 'var(--gray-600)', textAlign: 'center' },
};

// ─── Pantalla de login / registro ─────────────────────────────────────────────
// AuthScreen es memo puro — sus inputs son uncontrolled (refs) para cero re-renders.
const AuthScreen = memo(function AuthScreen({ mode = 'login' }) {
  const { appKey } = useParams();
  const app        = findApp(appKey);
  const { auth, login } = useAuth();
  const navigate   = useNavigate();

  const usernameRef    = useRef(null);
  const passwordRef    = useRef(null);
  const displayNameRef = useRef(null);
  const addressRef     = useRef(null);

  const [role,    setRole]    = useState(appKey || 'customer');
  const [message, setMessage] = useState('');

  const isLogin = mode === 'login';

  // Si ya está logueado con este mismo rol, redirigir
  if (auth.user && auth.user.role === appKey) {
    return <Navigate to={app?.home || `/${appKey}`} replace />;
  }
  // App no encontrada (URL inválida)
  if (!app) return <Navigate to="/" replace />;

  const submit = async () => {
    const username    = usernameRef.current?.value?.trim() || '';
    const password    = passwordRef.current?.value         || '';
    const displayName = displayNameRef.current?.value?.trim() || '';
    const address     = addressRef.current?.value?.trim()  || '';
    setMessage('');
    try {
      if (!isLogin) {
        await apiFetch('/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            username, password,
            role: role || appKey,
            displayName: displayName || undefined,
            address: ['customer','restaurant'].includes(role || appKey) ? address : undefined,
          }),
        });
        setMessage('Registro exitoso. Ya puedes iniciar sesión.');
        return;
      }
      const data = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password, role: appKey }),
      });
      login({ token: data.token, user: data.user });
      navigate(app.home);
    } catch (error) {
      setMessage(error.message);
    }
  };

  function handleKey(e) { if (e.key === 'Enter') submit(); }

  const isOk = message.startsWith('Registro exitoso');

  return (
    <div style={authStyles.wrap}>
      {/* Header mínimo con botón atrás */}
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
          <button className="btn-primary" onClick={submit}>
            {isLogin ? 'Iniciar sesión' : 'Registrarse'}
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
    background: 'var(--brand-light)',
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

// ─── Rutas protegidas (dentro de Layout) ──────────────────────────────────────
function AppRoutes() {
  return (
    <Layout>
      <Suspense fallback={<Spinner />}>
        <Routes>
          {/* Perfil */}
          <Route path="/profile" element={<ProtectedAny><ProfilePage /></ProtectedAny>} />

          {/* Tienda pública — con panel de pedidos del cliente */}
          <Route path="/restaurant/:id" element={
            <ProtectedAny>
              <SplitLayout homeContent={<RestaurantPage />} ordersContent={<CustomerOrders />} />
            </ProtectedAny>
          } />

          {/* Cliente */}
          <Route path="/customer" element={
            <ProtectedRole role="customer">
              <SplitLayout homeContent={<CustomerHome />} ordersContent={<CustomerOrders />} />
            </ProtectedRole>
          } />
          <Route path="/customer/pedidos" element={<Navigate to="/customer" replace />} />

          {/* Restaurante */}
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

          {/* Conductor */}
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

          {/* Admin */}
          <Route path="/admin" element={<ProtectedRole role="admin"><AdminDashboard /></ProtectedRole>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
function RootRouter() {
  return (
    <Routes>
      {/* Landing — pantalla de inicio pública */}
      <Route path="/"                    element={<LandingScreen />} />

      {/* Login / registro por rol */}
      <Route path="/:appKey/login"       element={<AuthScreen mode="login" />} />
      <Route path="/:appKey/register"    element={<AuthScreen mode="register" />} />

      {/* Rutas protegidas dentro de Layout */}
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
