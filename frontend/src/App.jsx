// frontend/src/App.jsx
import { lazy, Suspense } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import SplitLayout from './components/SplitLayout';

// Lazy loading — cada página se carga solo cuando se necesita
const AuthPage        = lazy(() => import('./pages/AuthPage'));
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

// ─── Guards ──────────────────────────────────────────────────────────────────
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

// ─── Rutas ───────────────────────────────────────────────────────────────────
function AppRoutes() {
  const { auth } = useAuth();
  const location  = useLocation();
  const isAuthPage = ['/login', '/register'].includes(location.pathname);

  // Auth pages — header mínimo sin username (evita re-renders al escribir)
  if (isAuthPage) {
    return (
      <>
        <header className="app-header">
          <div className="brand-block">
            <img className="brand-logo" src="/logo.svg" alt="Morelivery" />
            <div><h1>Morelivery</h1></div>
          </div>
        </header>
        <Suspense fallback={<Spinner />}>
          <Routes>
            <Route path="/login"    element={<AuthPage mode="login" />} />
            <Route path="/register" element={<AuthPage mode="register" />} />
          </Routes>
        </Suspense>
      </>
    );
  }

  return (
    <Layout>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/"        element={<Navigate to={auth.user ? `/${auth.user.role}` : '/login'} replace />} />
          <Route path="/login"   element={<AuthPage mode="login" />} />
          <Route path="/register" element={<AuthPage mode="register" />} />

          {/* Perfil */}
          <Route path="/profile" element={<ProtectedAny><ProfilePage /></ProtectedAny>} />

          {/* Tienda pública */}
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
