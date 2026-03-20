// frontend/src/App.jsx
import { lazy, Suspense } from 'react';
import { Link, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';
import Layout from './components/Layout';
import SplitLayout from './components/SplitLayout';
import AuthPage from './pages/AuthPage';
import CustomerOrders   from './pages/Customer/Orders';
import DriverOrders     from './pages/Driver/Orders';
import RestaurantOrders from './pages/Restaurant/Orders';

// ─── Lazy pages ───────────────────────────────────────────────────────────────
const CustomerHome      = lazy(() => import('./pages/Customer/Home'));
const CustomerPayments  = lazy(() => import('./pages/Customer/Payments'));
const RestaurantPage    = lazy(() => import('./pages/Customer/RestaurantPage'));
const RestaurantMenu     = lazy(() => import('./pages/Restaurant/Menu'));
const RestaurantSchedule = lazy(() => import('./pages/Restaurant/Schedule'));
const DriverHome     = lazy(() => import('./pages/Driver/Home'));
const DriverEarnings = lazy(() => import('./pages/Driver/Earnings'));
const AdminDashboard = lazy(() => import('./pages/Admin/Dashboard'));
const ProfilePage    = lazy(() => import('./pages/Profile'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));

const Spinner = () => (
  <div style={{ padding:'2rem', textAlign:'center', color:'var(--gray-400)' }}>Cargando…</div>
);

// ─── Config de apps ───────────────────────────────────────────────────────────
const ADMIN_APP = { key:'admin', label:'Administrador', home:'/admin', icon:null, description:'' };
const APPS = [
  { key:'customer',   label:'Cliente',   description:'Pide donde quieras',  icon:'🛍️', home:'/customer'   },
  { key:'restaurant', label:'Tienda',    description:'Gestiona tu negocio', icon:'🏪', home:'/restaurant' },
  { key:'driver',     label:'Conductor', description:'Reparte y gana',      icon:'🛵', home:'/driver'     },
];

function findApp(key) {
  return APPS.find(a => a.key === key) ?? (key === 'admin' ? ADMIN_APP : null);
}

// ─── Logo bicolor — fuente única de verdad ────────────────────────────────────
function BrandName({ size = '2rem' }) {
  return (
    <span style={{ fontSize: size, fontWeight: 900, letterSpacing: '-0.02em' }}>
      <span style={{ color: '#e3aaaa' }}>More</span>
      <span style={{ color: 'var(--text-primary)' }}>livery</span>
    </span>
  );
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
  const { isDark, toggle } = useTheme();

  if (auth.user) {
    const app = findApp(auth.user.role);
    return <Navigate to={app?.home || '/'} replace />;
  }

  return (
    <div style={{
      minHeight: '100dvh', background: 'var(--bg-card)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '2rem 1.25rem',
      position: 'relative',
    }}>
      <div style={{ position: 'absolute', top: '1rem', right: '1.25rem' }}>
        <button
          onClick={toggle}
          title={isDark ? 'Modo claro' : 'Modo oscuro'}
          style={{
            background: 'none', border: '1px solid var(--border)',
            borderRadius: 8, width: 34, height: 34,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', fontSize: '1rem', color: 'var(--text-secondary)',
            flexShrink: 0,
          }}
        >
          {isDark ? '☀️' : '🌙'}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', marginBottom: '2.5rem' }}>
        <img src="/logo.svg" alt="Morelivery" style={{ width: 60, height: 60 }} />
        <h1 style={{ margin: 0 }}>
          <BrandName size="2rem" />
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', margin: 0 }}>
          ¿Cómo quieres acceder?
        </p>
      </div>

      <div style={{
        display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: '0.75rem',
        width: '100%', maxWidth: '680px', justifyContent: 'center',
      }}>
        {APPS.map(app => (
          <Link key={app.key} to={`/${app.key}/login`} style={{ textDecoration: 'none', flex: '1 1 200px', maxWidth: '200px' }}>
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between',
              gap: '0.5rem',
              padding: '1.25rem 1rem 1rem',
              background: '#e0cccc',
              border: '1.5px solid var(--border)',
              borderRadius: 8,
              aspectRatio: '1 / 1',
              cursor: 'pointer',
              transition: 'transform 0.15s, box-shadow 0.15s',
              width: '100%',
              boxSizing: 'border-box',
            }} className="landing-btn">
              <span style={{ fontSize: '5rem', lineHeight: 1, marginTop: '2rem' }}>{app.icon}</span>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontWeight: 700, fontSize: '1rem', color: '#1a1a1a' }}>{app.label}</div>
                <div style={{ fontSize: '0.9rem', color: '#555' }}>{app.description}</div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <style>{`
        .landing-btn:hover { transform:translateY(-2px); box-shadow:0 4px 16px rgba(227,170,170,0.35); }
      `}</style>
    </div>
  );
}

// ─── AuthScreen ───────────────────────────────────────────────────────────────
function AuthScreen({ mode = 'login' }) {
  const { appKey } = useParams();
  const { auth }   = useAuth();
  const { isDark, toggle } = useTheme();
  const app        = findApp(appKey);

  if (auth.user && auth.user.role === appKey)
    return <Navigate to={app?.home || `/${appKey}`} replace />;

  if (!app) return <Navigate to="/" replace />;

  const wrongRole = auth.user && auth.user.role !== appKey;

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg-card)', display: 'flex', flexDirection: 'column' }}>
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0.75rem 1.25rem', borderBottom: '1px solid var(--gray-200)',
        background: 'var(--bg-card)', position: 'sticky', top: 0, zIndex: 10,
      }}>
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--brand)', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none' }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Inicio
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <img src="/logo.svg" alt="" style={{ width: 24, height: 24 }} />
          <BrandName size="0.95rem" />
        </div>
        <button
          onClick={toggle}
          title={isDark ? 'Modo claro' : 'Modo oscuro'}
          style={{
            background: 'none', border: '1px solid var(--border)',
            borderRadius: 8, width: 34, height: 34,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', fontSize: '1rem', color: 'var(--text-secondary)',
            flexShrink: 0,
          }}
        >
          {isDark ? '☀️' : '🌙'}
        </button>
      </header>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem 1.25rem' }}>
        <div style={{ width: '100%', maxWidth: '420px' }}>
          <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
            <span style={{ fontSize: '5rem' }}>{app.icon || '🔐'}</span>
            <p style={{ margin: '0.3rem 0 0', fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              {app.label}
            </p>
          </div>
          {wrongRole && (
            <div style={{ background: '#fff3cd', border: '1px solid #ffc107', borderRadius: 8, padding: '0.6rem 0.875rem', marginBottom: '0.75rem', fontSize: '0.82rem', color: '#856404' }}>
              ⚠️ Ya tienes sesión como <strong>{findApp(auth.user.role)?.label}</strong>. Inicia sesión aquí para cambiar de cuenta.
            </div>
          )}
          <AuthPage mode={mode} appKey={appKey} />
        </div>
      </div>
    </div>
  );
}

// ─── Layout wrappers por rol ──────────────────────────────────────────────────
function CustomerLayout() {
  return (
    <ProtectedRole role="customer">
      <SplitLayout
        ordersContent={<CustomerOrders />}
        homeContent={
          <Suspense fallback={<Spinner />}>
            <Routes>
              <Route path="pagos" element={<CustomerPayments />} />
              <Route path="r/:id" element={<RestaurantPage />} />
              <Route index        element={<CustomerHome />} />
            </Routes>
          </Suspense>
        }
      />
    </ProtectedRole>
  );
}

function RestaurantLayout() {
  return (
    <ProtectedRole role="restaurant">
      <SplitLayout
        ordersContent={<RestaurantOrders />}
        homeContent={
          <Suspense fallback={<Spinner />}>
            <Routes>
              <Route path="horario" element={<RestaurantSchedule />} />
              <Route index          element={<RestaurantMenu />} />
            </Routes>
          </Suspense>
        }
      />
    </ProtectedRole>
  );
}

function DriverLayout() {
  return (
    <ProtectedRole role="driver">
      <SplitLayout
        ordersContent={<DriverOrders />}
        homeContent={
          <Suspense fallback={<Spinner />}>
            <Routes>
              <Route path="ganancias" element={<DriverEarnings />} />
              <Route index            element={<DriverHome />} />
            </Routes>
          </Suspense>
        }
      />
    </ProtectedRole>
  );
}

// ─── Rutas protegidas ─────────────────────────────────────────────────────────
function AppRoutes() {
  return (
    <Layout>
      <Routes>
        <Route path="/profile" element={
          <Suspense fallback={<Spinner />}>
            <ProtectedAny><ProfilePage /></ProtectedAny>
          </Suspense>
        } />
        <Route path="/customer/*"   element={<CustomerLayout />} />
        <Route path="/restaurant/*" element={<RestaurantLayout />} />
        <Route path="/driver/*"     element={<DriverLayout />} />
        <Route path="/admin" element={
          <Suspense fallback={<Spinner />}>
            <ProtectedRole role="admin"><AdminDashboard /></ProtectedRole>
          </Suspense>
        } />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
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
      <Route path="/reset-password"   element={
        <Suspense fallback={<Spinner />}>
          <ResetPasswordPage />
        </Suspense>
      } />
      <Route path="/*" element={<AppRoutes />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <RootRouter />
      </ThemeProvider>
    </AuthProvider>
  );
}
