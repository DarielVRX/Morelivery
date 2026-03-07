import { memo, useCallback, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useLocation, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';

import CustomerHome    from './pages/Customer/Home';
import CustomerOrders  from './pages/Customer/Orders';
import RestaurantPage  from './pages/Customer/RestaurantPage';

import RestaurantMenu     from './pages/Restaurant/Menu';
import RestaurantOrders   from './pages/Restaurant/Orders';
import RestaurantSchedule from './pages/Restaurant/Schedule';

import DriverHome     from './pages/Driver/Home';
import DriverOrders   from './pages/Driver/Orders';
import DriverEarnings from './pages/Driver/Earnings';

import AdminDashboard from './pages/Admin/Dashboard';
import ProfilePage    from './pages/Profile';
import { apiFetch }   from './api/client';

// ─── Guards ───────────────────────────────────────────────────────────────────
function ProtectedRole({ role, children }) {
  const { auth } = useAuth();
  if (!auth.user) return <Navigate to="/" replace />;
  if (auth.user.role !== role) return <Navigate to={`/${auth.user.role}`} replace />;
  return children;
}

function ProtectedAny({ children }) {
  const { auth } = useAuth();
  if (!auth.user) return <Navigate to="/" replace />;
  return children;
}

// ─── Configuración de las 3 apps ─────────────────────────────────────────────
// Admin separado — nunca aparece en APPS públicos ni en la landing
const ADMIN_APP = { key: 'admin', label: 'Admin', description: '', home: '/admin', icon: null };

const APPS = [
  {
    key: 'customer',
    label: 'Cliente',
    description: 'Pide tu comida favorita',
    home: '/customer',
    icon: (
      <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="24" cy="16" r="7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
        <path d="M8 40c0-8.837 7.163-16 16-16s16 7.163 16 16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    key: 'driver',
    label: 'Conductor',
    description: 'Reparte y genera ingresos',
    home: '/driver',
    icon: (
      <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M6 30l4-12h20l6 8h4a2 2 0 0 1 2 2v4H6v-2z" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round"/>
        <circle cx="14" cy="36" r="4" stroke="currentColor" strokeWidth="2.5"/>
        <circle cx="34" cy="36" r="4" stroke="currentColor" strokeWidth="2.5"/>
        <path d="M10 18h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    key: 'restaurant',
    label: 'Tienda',
    description: 'Gestiona tu tienda',
    home: '/restaurant/pedidos',
    icon: (
      <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10 18h28l-3 18H13L10 18z" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round"/>
        <path d="M18 18c0-3.314 2.686-6 6-6s6 2.686 6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
      </svg>
    ),
  },
];

// ─── Pantalla principal: selector de app ──────────────────────────────────────
function LandingScreen() {
  const { auth } = useAuth();

  // Si ya está logueado, redirigir a su app
  if (auth.user) {
    const app = APPS.find(a => a.key === auth.user.role) ?? (auth.user.role === 'admin' ? ADMIN_APP : null);
    return <Navigate to={app?.home || `/${auth.user.role}`} replace />;
  }

  return (
    <div style={styles.landing}>
      <div style={styles.landingInner}>
        <div style={styles.brandBlock}>
          <img src="/logo.svg" alt="Morelivery" style={styles.brandLogo} />
          <h1 style={styles.brandName}>Morelivery</h1>
          <p style={styles.brandSub}>¿Cómo quieres acceder?</p>
        </div>

        <div style={styles.appGrid}>
          {APPS.filter(app => app.icon !== null).map(app => (
            <Link key={app.key} to={`/${app.key}/login`} style={{ textDecoration: 'none' }}>
              <div style={styles.appCard} className="app-card">
                <div style={styles.appIcon}>{app.icon}</div>
                <span style={styles.appLabel}>{app.label}</span>
                <span style={styles.appDesc}>{app.description}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <style>{`
        .app-card {
          transition: transform 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
        }
        .app-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 12px 32px rgba(0,0,0,0.13);
          background: #fff !important;
        }
        @media (max-width: 640px) {
          .app-grid-inner { flex-direction: column !important; align-items: center !important; }
          .app-card-wrap  { width: 100% !important; max-width: 320px !important; }
        }
      `}</style>
    </div>
  );
}

// ─── Pantalla de login/registro por app ──────────────────────────────────────
const AuthScreen = memo(function AuthScreen({ mode = 'login' }) {
  const { appKey } = useParams();  // 'customer' | 'driver' | 'restaurant'
  const app = APPS.find(a => a.key === appKey) ?? (appKey === 'admin' ? ADMIN_APP : null);
  const { auth, login } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername]       = useState('');
  const [password, setPassword]       = useState('');
  const [address, setAddress]         = useState('');
  const [displayName, setDisplayName] = useState('');
  const [message, setMessage]         = useState('');

  const isLogin = mode === 'login';

  // Todos los hooks PRIMERO — sin returns condicionales antes de hooks
  const submit = useCallback(async () => {
    setMessage('');
    try {
      if (!isLogin) {
        await apiFetch('/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            username,
            password,
            role: appKey,
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

      login({ token: data.token, user: data.user });
      navigate(app.home);
    } catch (error) {
      setMessage(error.message);
    }
  }, [username, password, address, displayName, appKey, isLogin, login, navigate, app]);

  const isOk = message.startsWith('Registro exitoso');

  // Guards de redirección — DESPUÉS de todos los hooks
  if (!app) return <Navigate to="/" replace />;
  if (auth.user?.role === appKey) return <Navigate to={app.home} replace />;

  return (
    <div style={styles.authWrap}>
      {/* Header minimal */}
      <header style={styles.authHeader}>
        <Link to="/" style={styles.backLink}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Inicio
        </Link>
        <div style={styles.authBrand}>
          <img src="/logo.svg" alt="" style={{ width: 24, height: 24 }} />
          <span style={{ fontWeight: 700, fontSize: '1rem' }}>Morelivery</span>
        </div>
        <div style={{ width: 70 }} />
      </header>

      <section className="auth-card">
        {/* Ícono y título de la app */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1.25rem' }}>
          <div style={{ ...styles.appIcon, width: 36, height: 36, fontSize: '1rem', color: 'var(--brand)', background: 'var(--brand-light, #eff6ff)', borderRadius: 8, flexShrink: 0 }}>
            {app.icon}
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>
              {isLogin ? 'Iniciar sesión' : 'Crear cuenta'} — {app.label}
            </h2>
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--gray-600)' }}>{app.description}</p>
          </div>
        </div>

        <div className="row">
          <label>
            Usuario
            <input
              placeholder="Tu nombre de usuario"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoComplete="username"
              onKeyDown={e => e.key === 'Enter' && submit()}
            />
          </label>
          <label>
            Contraseña
            <input
              type="password"
              placeholder="Tu contraseña"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete={isLogin ? 'current-password' : 'new-password'}
              onKeyDown={e => e.key === 'Enter' && submit()}
            />
          </label>
        </div>

        {/* Campos extra en registro */}
        {!isLogin && appKey === 'restaurant' && (
          <div className="row">
            <label>
              Nombre de la tienda
              <input placeholder="Ej: Tacos El Güero, Farmacia Cruz" value={displayName} onChange={e => setDisplayName(e.target.value)} />
            </label>
          </div>
        )}
        {!isLogin && ['customer', 'restaurant'].includes(appKey) && (
          <div className="row">
            <label>
              Dirección
              <input placeholder="Ej: Av. Revolución 1234, Col. Centro" value={address} onChange={e => setAddress(e.target.value)} />
            </label>
          </div>
        )}

        <div className="row">
          <button className="btn-primary" onClick={submit}>
            {isLogin ? 'Iniciar sesión' : 'Registrarse'}
          </button>
          {isLogin
            ? <Link to={`/${appKey}/register`} style={{ fontSize: '0.875rem', textAlign: 'center' }}>¿No tienes cuenta? Regístrate</Link>
            : <Link to={`/${appKey}/login`}    style={{ fontSize: '0.875rem', textAlign: 'center' }}>¿Ya tienes cuenta? Inicia sesión</Link>
          }
        </div>

        {message && (
          <p className={`flash ${isOk ? 'flash-ok' : 'flash-error'}`}>{message}</p>
        )}
      </section>
    </div>
  );
}); // fin AuthScreen memo

// ─── Estilos de landing ───────────────────────────────────────────────────────
const styles = {
  landing: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2rem 1rem',
    background: 'var(--gray-50, #f9fafb)',
  },
  landingInner: {
    width: '100%',
    maxWidth: 860,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '2.5rem',
  },
  brandBlock: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.4rem',
  },
  brandLogo: {
    width: 56,
    height: 56,
    marginBottom: '0.25rem',
  },
  brandName: {
    margin: 0,
    fontSize: '1.75rem',
    fontWeight: 800,
    letterSpacing: '-0.02em',
  },
  brandSub: {
    margin: 0,
    fontSize: '0.95rem',
    color: 'var(--gray-500, #6b7280)',
  },
  appGrid: {
    display: 'flex',
    flexDirection: 'row',
    gap: '1.25rem',
    width: '100%',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  appCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '2rem 1.5rem',
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 16,
    cursor: 'pointer',
    width: 200,
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
    textAlign: 'center',
  },
  appIcon: {
    width: 52,
    height: 52,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--brand, #2563eb)',
  },
  appLabel: {
    fontSize: '1rem',
    fontWeight: 700,
    color: 'var(--gray-900, #111)',
  },
  appDesc: {
    fontSize: '0.8rem',
    color: 'var(--gray-500, #6b7280)',
    lineHeight: 1.4,
  },
  authWrap: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--gray-50, #f9fafb)',
  },
  authHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '1rem 1.5rem',
    background: '#fff',
    borderBottom: '1px solid #e5e7eb',
  },
  authBrand: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  backLink: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.3rem',
    fontSize: '0.875rem',
    color: 'var(--gray-600, #6b7280)',
    textDecoration: 'none',
    fontWeight: 500,
  },
};

// ─── Rutas ────────────────────────────────────────────────────────────────────
function AppRoutes() {
  const { auth } = useAuth();

  return (
    <Routes>
      {/* Landing — selector de app */}
      <Route path="/" element={<LandingScreen />} />

      {/* Login/registro por app */}
      <Route path="/:appKey/login"    element={<AuthScreen mode="login" />} />
      <Route path="/:appKey/register" element={<AuthScreen mode="register" />} />


      {/* Rutas protegidas dentro del Layout */}
      <Route path="/*" element={
        <Layout>
          <Routes>
            {/* Perfil */}
            <Route path="/profile" element={<ProtectedAny><ProfilePage /></ProtectedAny>} />

            {/* Restaurante público */}
            <Route path="/restaurant/:id" element={<RestaurantPage />} />

            {/* Cliente */}
            <Route path="/customer"         element={<ProtectedRole role="customer"><CustomerHome /></ProtectedRole>} />
            <Route path="/customer/pedidos" element={<ProtectedRole role="customer"><CustomerOrders /></ProtectedRole>} />

            {/* Restaurante */}
            <Route path="/restaurant"         element={<ProtectedRole role="restaurant"><RestaurantMenu /></ProtectedRole>} />
            <Route path="/restaurant/pedidos" element={<ProtectedRole role="restaurant"><RestaurantOrders /></ProtectedRole>} />
            <Route path="/restaurant/horario" element={<ProtectedRole role="restaurant"><RestaurantSchedule /></ProtectedRole>} />

            {/* Conductor */}
            <Route path="/driver"           element={<ProtectedRole role="driver"><DriverHome /></ProtectedRole>} />
            <Route path="/driver/pedidos"   element={<ProtectedRole role="driver"><DriverOrders /></ProtectedRole>} />
            <Route path="/driver/ganancias" element={<ProtectedRole role="driver"><DriverEarnings /></ProtectedRole>} />

            {/* Admin */}
            <Route path="/admin" element={<ProtectedRole role="admin"><AdminDashboard /></ProtectedRole>} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      } />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
