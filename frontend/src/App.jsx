// frontend/src/App.jsx
import { lazy, Suspense, memo } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import SplitLayout from './components/SplitLayout';

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

// ─── Guards ───────────────────────────────────────────────────────────────────
// ProtectedRole: solo bloquea acceso si no hay sesión.
// No redirige por rol — el usuario simplemente ve un 404 si va a la ruta equivocada.
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

// ─── Header mínimo para páginas de auth (estático, sin useAuth) ───────────────
const AuthHeader = memo(() => (
  <header className="app-header">
    <div className="brand-block">
      <img className="brand-logo" src="/logo.svg" alt="Morelivery" />
      <div><h1>Morelivery</h1></div>
    </div>
  </header>
));

// ─── Rutas de autenticación — árbol aislado sin useAuth ──────────────────────
// Al estar fuera de Layout (que consume useAuth), los re-renders de auth
// NO afectan a AuthPage ni a sus inputs.
function AuthRoutes() {
  return (
    <>
      <AuthHeader />
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/login"    element={<AuthPage mode="login" />} />
          <Route path="/register" element={<AuthPage mode="register" />} />
          <Route path="*"         element={<Navigate to="/login" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}

// ─── Rutas protegidas ─────────────────────────────────────────────────────────
function AppRoutes() {
  return (
    <Layout>
      <Suspense fallback={<Spinner />}>
        <Routes>
          {/* Inicio público */}
          <Route path="/"        element={<Navigate to="/login" replace />} />
          <Route path="/login"   element={<AuthPage mode="login" />} />
          <Route path="/register" element={<AuthPage mode="register" />} />

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
// Separamos auth routes de app routes ANTES de AuthProvider para que
// AuthPage no sea un descendiente de ningún componente que consuma auth context.
function RootRouter() {
  const location = useLocation();
  const isAuth   = ['/login', '/register'].includes(location.pathname);
  // Auth pages: árbol completamente aislado del Layout y del auth context consumer
  if (isAuth) return <AuthRoutes />;
  return <AppRoutes />;
}

export default function App() {
  return (
    <AuthProvider>
      <RootRouter />
    </AuthProvider>
  );
}
