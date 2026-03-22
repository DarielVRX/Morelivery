// frontend/src/App.jsx
import { lazy, Suspense } from 'react';
import { Link, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';
import {Layout, IconSun, IconMoon} from './components/Layout';
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
const ADMIN_APP = { key:'admin', label:'Administrador', home:'/admin', description:'' };
const APPS = [
  { key:'customer',   label:'Cliente',   description:'Pide donde quieras',  home:'/customer'   },
  { key:'restaurant', label:'Tienda',    description:'Gestiona tu negocio', home:'/restaurant' },
  { key:'driver',     label:'Conductor', description:'Reparte y gana',      home:'/driver'     },
];

function findApp(key) {
  return APPS.find(a => a.key === key) ?? (key === 'admin' ? ADMIN_APP : null);
}

// ─── Iconos por rol (Lucide, trazo fino) ──────────────────────────────────────
export function IconCustomer() {
  return (
    <svg width="80" height="80" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
    </svg>
  );
}
export function IconRestaurant() {
  return (
    <svg width="80" height="80" viewBox="0 0 52 52" fill="#a85c5c">
    <path d="M43.1,29.5c-0.1,0-0.2,0-0.2,0c-1.6-0.2-2.9-0.6-4.1-1.5c-0.1-0.1-0.1-0.1-0.2-0.1c-0.6-0.5-1.1-0.2-1.4-0.1l-0.1,0.1c-1.5,1.1-3.2,1.7-5.2,1.7c-2.1,0-3.8-0.6-5.4-1.8c-0.6-0.4-1,0-1,0c-1.6,1.3-3.4,1.9-5.5,1.9c-2,0-3.8-0.6-5.3-1.8c-0.1-0.1-0.2-0.1-0.2-0.2c-0.5-0.4-1,0-1,0c-1.5,1.2-3.2,1.8-5.1,1.9c0,0-0.6,0-0.6,0.7v12c0,1,0,2.1,0,2.9c0,0.3,0.2,1,1.1,1.2h18.5c1-0.2,1.1-0.9,1.1-1.2c0-0.8,0-1.8,0-2.9c0-2.6,0-5.1,0-7.7c0.1-0.3,0.2-0.6,1-0.6c2.8,0,5.6,0,8.4,0c0.2,0,0.3,0,0.5,0c0.3,0.1,0.6,0.3,0.6,1c0,2.5,0,4.9,0,7.3c0,1,0,1.9,0,2.7c0,1.1,0.8,1.3,1,1.3h2.8c0.2,0,1-0.2,1-1.3c0-0.8,0-1.7,0-2.7V30.6C43.9,29.8,43.5,29.6,43.1,29.5z M23.2,41c0,0.1,0,0.2,0,0.3c0,0.4-0.2,1-1.2,1c-2.7,0-5.4,0-8.1,0c-0.9,0-1.1-0.4-1.2-0.8c0-0.1,0-0.2,0-0.4c0-1.8,0-3.8,0-5.7c0-1.4,0.8-1.5,1.1-1.5c2.8,0,5.7,0,8.5,0c0.3,0,1,0.2,1,1.3C23.2,37.2,23.2,39.1,23.2,41z"/>
    <path d="M42.3,25.5c2.2,0.6,4.1,0.2,5.7-1.4c1-1,1.7-2.2,1.9-3.5c0-0.1,0-0.2,0-0.2c-0.2-0.5-0.4-1-0.6-1.4c-2.4-4.3-4.7-8.6-7-12.9c-0.3-0.6-1-0.6-1.2-0.6H10.6c0,0-0.9,0-1.2,0.6c-2.4,4.3-4.7,8.7-7,12.9C2.2,19.4,2,20,2,20.6c0,0.1,0,0.1,0,0.2c0.2,1.4,0.8,2.6,1.8,3.5c1.8,1.6,3.8,2,6.2,1.2c1.3-0.5,2.2-1.3,3-2.5c0.1-0.1,0.2-0.2,0.3-0.3c0.5-0.3,1.1-0.2,1.5,0.3c0.4,0.6,0.9,1.2,1.5,1.6c1.7,1.3,3.6,1.5,5.6,0.9c1.3-0.4,2.3-1.3,3-2.5c0.4-0.6,1.4-0.7,1.8,0c0.2,0.2,0.3,0.5,0.5,0.7c1,1.2,2.3,1.9,3.8,2.1c1.4,0.2,2.8-0.2,4.1-1c0.7-0.5,1.3-1.1,1.7-1.8c0.5-0.6,1.4-0.6,1.8,0c0.8,1.3,1.8,2.1,3.3,2.5L42.3,25.5z"/>
    </svg>
  );
}
export function IconDriver() {
  return (
    <svg width="80" height="80" viewBox="0 0 512 512" fill="#a85c5c">
    <path d="M159.511 154.957a5.086 5.086 0 0 1-5.085-5.085v-25.431a5.086 5.086 0 0 1 10.17 0v25.431a5.085 5.085 0 0 1-5.085 5.085z"/>
    <path d="M186.11 330.251c-5.619 0-10.171-4.555-10.171-10.171c0-48.411-39.387-87.798-87.801-87.798c-19.468 0-37.903 6.236-53.312 18.037c-4.458 3.418-10.847 2.569-14.261-1.893c-3.415-4.461-2.569-10.847 1.893-14.261c18.99-14.539 41.703-22.224 65.681-22.224c59.632 0 108.143 48.511 108.143 108.139c-.001 5.616-4.553 10.171-10.172 10.171z"/>
    <circle cx="88.937" cy="318.993" r="34.332"/>
    <path d="M88.939 406.73c-48.379 0-87.742-39.359-87.742-87.739s39.363-87.739 87.742-87.739s87.739 39.359 87.739 87.739s-39.36 87.739-87.739 87.739zm0-160.217c-39.966 0-72.482 32.516-72.482 72.479c0 39.969 32.516 72.486 72.482 72.486s72.479-32.516 72.479-72.486c0-39.963-32.513-72.479-72.479-72.479z"/>
    <path d="M399.692 406.73c-48.379 0-87.739-39.359-87.739-87.739s39.359-87.739 87.739-87.739s87.732 39.359 87.732 87.739s-39.353 87.739-87.732 87.739zm0-160.217c-39.969 0-72.486 32.516-72.486 72.479c0 39.969 32.516 72.486 72.486 72.486c39.962 0 72.479-32.516 72.479-72.486c0-39.963-32.517-72.479-72.479-72.479z"/>
    <path d="M399.692 211.941c-55.63 0-101.565 42.285-107.361 96.402h-57.214c-4.943 0-8.621-1.581-11.235-4.825c-2.475-3.078-3.896-7.599-3.896-12.403c0-5.928 2.52-14.74 9.46-14.74c5.883 0 10.649-4.767 10.649-10.649s-4.766-10.649-10.649-10.649c-17.537 0-30.759 15.492-30.759 36.038c0 9.72 3.057 18.872 8.607 25.763c6.628 8.23 16.511 12.764 27.823 12.764h63.765a10.166 10.166 0 0 0 5.996 0h62.172c4.482 13.747 17.397 23.684 32.64 23.684c18.961 0 34.332-15.371 34.332-34.332s-15.371-34.332-34.332-34.332c-15.242 0-28.157 9.936-32.64 23.682h-54.234c5.684-42.871 42.476-76.06 86.875-76.06c48.324 0 87.642 39.314 87.642 87.638c0 5.616 4.555 10.171 10.171 10.171s10.171-4.555 10.171-10.171c0-59.543-48.442-107.981-107.983-107.981z"/>
    <path d="M316.064 221.974l-.545-.031l-10.992-.623c4.496-5.515 7.296-12.479 7.544-20.126c.603-18.603-13.989-34.173-32.592-34.776l-.441-.014l-87.841-2.847a42.657 42.657 0 0 0-1.86-.012c-13.655.264-25.386 8.1-31.265 19.425l10.796-25.288c2.205-5.165-.194-11.142-5.363-13.35c-5.162-2.187-11.138.194-13.35 5.363l-.399.935a22.83 22.83 0 0 0 1.277-7.538c0-12.641-10.247-22.888-22.888-22.888v45.777c8.908 0 16.622-5.093 20.404-12.522l-37.531 87.91c-2.205 5.165.194 11.141 5.363 13.35a10.174 10.174 0 0 0 13.35-5.363l26.235-61.452a35.919 35.919 0 0 0-1.913 12.315c.384 19.87 16.803 35.668 36.673 35.284l.471-.009l64.45-1.244a25.357 25.357 0 0 0-2.537 11.969c.475 14.058 12.256 25.07 26.314 24.595l.582-.02l35.514-1.199c12.152-.449 22.292-10.089 22.994-22.474c.744-13.143-9.307-24.402-22.45-25.147z"/>
    </svg>
  );
}

const ROLE_ICONS = {
  customer:   <IconCustomer />,
  restaurant: <IconRestaurant />,
  driver:     <IconDriver />,
};
// ─── Logo bicolor — fuente única de verdad ────────────────────────────────────
function BrandName({ size = '2rem' }) {
  return (
    <span style={{ fontSize: size, fontWeight: 900, letterSpacing: '-0.02em' }}>
      <span style={{ color: '#e3aaaa' }}>More</span>
      <span style={{ color: 'var(--text-primary)' }}>livery</span>
    </span>
  );
}

// ─── Iconos utilitarios ───────────────────────────────────────────────────────
function IconSun()  { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" style={{display:'block'}}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>; }
function IconMoon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" style={{display:'block'}}><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>; }

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
            cursor: 'pointer', color: 'var(--text-secondary)',
            flexShrink: 0,
          }}
        >
          {isDark ? <IconSun /> : <IconMoon />}
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
              <div style={{ marginTop: '1.5rem' }}>{ROLE_ICONS[app.key]}</div>
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
            cursor: 'pointer', color: 'var(--text-secondary)',
            flexShrink: 0,
          }}
        >
          {isDark ? <IconSun /> : <IconMoon />}
        </button>
      </header>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem 1.25rem' }}>
        <div style={{ width: '100%', maxWidth: '420px' }}>
          <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
            <div style={{ marginBottom: '0.5rem' }}>{ROLE_ICONS[appKey] ?? '🔐'}</div>
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
