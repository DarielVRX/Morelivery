import { useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import SplitLayout from './components/SplitLayout';

import { lazy, Suspense } from 'react';

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
import { apiFetch }   from './api/client';

function ProtectedRole({ role, children }) {
  const { auth } = useAuth();
  if (!auth.user) return <Navigate to="/login" replace />;
  if (auth.user.role !== role) return <Navigate to={`/${auth.user.role}`} replace />;
  return children;
}

function ProtectedAny({ children }) {
  const { auth } = useAuth();
  if (!auth.user) return <Navigate to="/login" replace />;
  return children;
}

function AuthScreen({ mode = 'login' }) {
  const { auth, login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername]       = useState('');
  const [password, setPassword]       = useState('');
  const [role, setRole]               = useState('customer');
  const [address, setAddress]         = useState('');
  const [displayName, setDisplayName] = useState('');
  const [message, setMessage]         = useState('');

  const isLogin = mode === 'login';
  if (auth.user) return <Navigate to={`/${auth.user.role}`} replace />;

  async function submit() {
    try {
      if (!isLogin) {
        await apiFetch('/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            username, password, role,
            displayName: displayName || undefined,
            address: ['customer','restaurant'].includes(role) ? address : undefined
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
      const dest = `/${data.user.role}`;
      navigate(dest);
    } catch (error) {
      setMessage(error.message);
    }
  }

  return (
    <section className="auth-card">
      <h2>{isLogin ? 'Iniciar sesión' : 'Crear cuenta'}</h2>
      <p>{isLogin ? 'Ingresa con tu usuario y contraseña.' : 'Completa los datos para registrarte.'}</p>

      <div className="row">
        <label>Usuario<input placeholder="Tu nombre de usuario" value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" /></label>
        <label>Contraseña<input type="password" placeholder="Tu contraseña" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></label>
        {!isLogin && (
          <label>Tipo de cuenta
            <select value={role} onChange={e => setRole(e.target.value)}>
              <option value="customer">Cliente</option>
              <option value="restaurant">Tienda</option>
              <option value="driver">Conductor</option>
            </select>
          </label>
        )}
      </div>

      {!isLogin && role === 'restaurant' && (
        <div className="row">
          <label>Nombre de la tienda<input placeholder="Ej: Tacos El Güero" value={displayName} onChange={e => setDisplayName(e.target.value)} /></label>
        </div>
      )}
      {!isLogin && ['customer','restaurant'].includes(role) && (
        <div className="row">
          <label>Dirección<input placeholder="Ej: Av. Revolución 1234, Col. Centro" value={address} onChange={e => setAddress(e.target.value)} /></label>
        </div>
      )}

      <div className="row">
        <button className="btn-primary" onClick={submit}>
          {isLogin ? 'Iniciar sesión' : 'Registrarse'}
        </button>
        {isLogin
          ? <Link to="/register" style={{ fontSize:'0.875rem', textAlign:'center' }}>¿No tienes cuenta? Regístrate</Link>
          : <Link to="/login"    style={{ fontSize:'0.875rem', textAlign:'center' }}>¿Ya tienes cuenta? Inicia sesión</Link>
        }
      </div>

      {message && <p className={`flash ${message.startsWith('Registro') ? 'flash-ok' : 'flash-error'}`}>{message}</p>}
    </section>
  );
}

function AppRoutes() {
  const { auth } = useAuth();
  const location = useLocation();
  const isAuthPage = ['/login', '/register'].includes(location.pathname);

  // Auth pages NO usan el Layout (evita re-renders del header durante el typing)
  if (isAuthPage) {
    return (
      <>
        {/* Header minimal en login — sin nav, muestra "Morelivery" sin username */}
        <header className="app-header">
          <div className="brand-block" style={{ textDecoration:'none' }}>
            <img className="brand-logo" src="/logo.svg" alt="Morelivery" />
            <div><h1>Morelivery</h1></div>
          </div>
        </header>
        <Routes>
          <Route path="/login"    element={<AuthScreen mode="login" />} />
          <Route path="/register" element={<AuthScreen mode="register" />} />
        </Routes>
      </>
    );
  }

  return (
    <Layout>
      <Suspense fallback={<div style={{padding:'2rem',textAlign:'center',color:'var(--gray-400)'}}>Cargando…</div>}>
      <Routes>
        <Route path="/"        element={<Navigate to={auth.user ? `/${auth.user.role}` : '/login'} replace />} />
        <Route path="/login"   element={<AuthScreen mode="login" />} />
        <Route path="/register" element={<AuthScreen mode="register" />} />

        {/* Perfil — cualquier rol */}
        <Route path="/profile" element={<ProtectedAny><ProfilePage /></ProtectedAny>} />

        {/* Restaurante público */}
        <Route path="/restaurant/:id" element={<RestaurantPage />} />

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
        <Route path="/restaurant/horario" element={<ProtectedRole role="restaurant"><RestaurantSchedule /></ProtectedRole>} />

        {/* Conductor */}
        <Route path="/driver" element={
          <ProtectedRole role="driver">
            <SplitLayout homeContent={<DriverHome />} ordersContent={<DriverOrders />} />
          </ProtectedRole>
        } />
        <Route path="/driver/pedidos"   element={<Navigate to="/driver" replace />} />
        <Route path="/driver/ganancias" element={<ProtectedRole role="driver"><DriverEarnings /></ProtectedRole>} />

        {/* Admin */}
        <Route path="/admin" element={<ProtectedRole role="admin"><AdminDashboard /></ProtectedRole>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </Layout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
