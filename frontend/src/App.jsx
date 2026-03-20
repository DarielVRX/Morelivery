// frontend/src/App.jsx
import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import SplitLayout from './components/SplitLayout';
import AuthPage from './pages/AuthPage';

// ─── Dark mode hook ───────────────────────────────────────────────────────────
function useDarkMode() {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem('theme');
    if (saved) return saved === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);
  return [dark, setDark];
}

function ThemeToggle({ dark, setDark }) {
  return (
    <button
      onClick={() => setDark(d => !d)}
      title={dark ? 'Modo claro' : 'Modo oscuro'}
      style={{
        background: 'none', border: '1px solid var(--border)',
        borderRadius: 8, width: 34, height: 34,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', fontSize: '1rem', color: 'var(--text-secondary)',
        flexShrink: 0,
      }}
    >
      {dark ? '☀️' : '🌙'}
    </button>
  );
}

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
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));

const Spinner = () => (
  <div style={{ padding:'2rem', textAlign:'center', color:'var(--gray-400)' }}>Cargando…</div>
);

// ─── Config de apps ───────────────────────────────────────────────────────────
const ADMIN_APP = { key:'admin', label:'Administrador', home:'/admin', icon:null, description:'' };
const APPS = [
  { key:'customer',   label:'Cliente',   description:'Pide donde quieras',   icon:'🛍️', home:'/customer'   },
  { key:'restaurant', label:'Tienda',    description:'Gestiona tu negocio',  icon:'🏪', home:'/restaurant' },
  { key:'driver',     label:'Conductor', description:'Reparte y gana',       icon:'🛵', home:'/driver'     },
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

// ─── Pantalla de inicio ───────────────────────────────────────────────────────
function LandingScreen() {
  const { auth } = useAuth();
  const [dark, setDark] = useDarkMode();
  if (auth.user) {
    const app = findApp(auth.user.role);
    return <Navigate to={app?.home || '/'} replace />;
  }

  return (
    <div style={{
      minHeight:'100dvh', background:'var(--bg-card)',
      display:'flex', flexDirection:'column',
      alignItems:'center', justifyContent:'center',
      padding:'2rem 1.25rem',
      position:'relative',
    }}>
      <div style={{ position:'absolute', top:'1rem', right:'1.25rem' }}>
        <ThemeToggle dark={dark} setDark={setDark} />
      </div>
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'0.5rem', marginBottom:'2.5rem' }}>
        <img src="/logo.svg" alt="Morelivery" style={{ width:60, height:60 }} />
        <h1 style={{ fontSize:'2rem', fontWeight:900, margin:0, letterSpacing:'-0.02em' }}>
          <span style={{ color:'#e3aaaa' }}>More</span><span style={{ color:'var(--text-primary)' }}>livery</span>
        </h1>
        <p style={{ color:'var(--text-secondary)', fontSize:'0.95rem', margin:0 }}>
          ¿Cómo quieres acceder?
        </p>
      </div>

      <div style={{
        display:'flex', flexDirection:'row', flexWrap:'wrap', gap:'0.75rem',
        width:'100%', maxWidth:'680px', justifyContent:'center',
      }}>
        {APPS.map(app => (
          <Link key={app.key} to={`/${app.key}/login`} style={{ textDecoration:'none', flex:'1 1 200px', maxWidth:'200px' }}>
            <div style={{
              display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'space-between',
              gap:'0.5rem',
              padding:'1.25rem 1rem 1rem',
              background:'#e0cccc',
              border:'1.5px solid var(--border)',
              borderRadius:8,
              aspectRatio:'1 / 1',
              cursor:'pointer',
              transition:'transform 0.15s, box-shadow 0.15s',
              width:'100%',
              boxSizing:'border-box',
            }} className="landing-btn">
              <span style={{ fontSize:'3rem', lineHeight:1, marginTop:'2rem' }}>{app.icon}</span>
              <div style={{ textAlign:'center' }}>
                <div style={{ fontWeight:700, fontSize:'0.85rem', color:'#1a1a1a' }}>{app.label}</div>
                <div style={{ fontSize:'0.68rem', color:'#555' }}>{app.description}</div>
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

// ─── AuthScreen — wrapper que pasa appKey a AuthPage ─────────────────────────
function AuthScreen({ mode = 'login' }) {
  const { appKey } = useParams();
  const { auth }   = useAuth();
  const app        = findApp(appKey);
  const [dark, setDark] = useDarkMode();

  // Si ya está logueado con ESTE mismo rol, redirigir a su home
  if (auth.user && auth.user.role === appKey)
    return <Navigate to={app?.home || `/${appKey}`} replace />;

  if (!app) return <Navigate to="/" replace />;

  // Aviso sesión activa de otro rol
  const wrongRole = auth.user && auth.user.role !== appKey;

  return (
    <div style={{ minHeight:'100dvh', background:'var(--bg-card)', display:'flex', flexDirection:'column' }}>
      {/* Header con botón atrás */}
      <header style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'0.75rem 1.25rem', borderBottom:'1px solid var(--gray-200)',
        background:'var(--bg-card)', position:'sticky', top:0, zIndex:10,
      }}>
        <Link to="/" style={{ display:'flex', alignItems:'center', gap:'0.3rem', color:'var(--brand)', fontSize:'0.875rem', fontWeight:600, textDecoration:'none' }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Inicio
        </Link>
        <div style={{ display:'flex', alignItems:'center', gap:'0.4rem', color:'var(--text-primary)' }}>
          <img src="/logo.svg" alt="" style={{ width:24, height:24 }} />
          <strong style={{ fontSize:'0.95rem' }}>Morelivery</strong>
        </div>
        <ThemeToggle dark={dark} setDark={setDark} />
      </header>

      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding:'2rem 1.25rem' }}>
        <div style={{ width:'100%', maxWidth:'420px' }}>

          {/* Ícono y título del rol */}
          <div style={{ textAlign:'center', marginBottom:'1rem' }}>
            <span style={{ fontSize:'5rem' }}>{app.icon || '🔐'}</span>
            {mode === 'register' && (
              <p style={{ margin:'0.3rem 0 0', fontWeight:700, fontSize:'0.9rem', color:'var(--text-secondary)' }}>
              {app.label}
              </p>
            )}
          </div>

          {/* Aviso si hay sesión activa de otro rol */}
          {wrongRole && (
            <div style={{ background:'#fff3cd', border:'1px solid #ffc107', borderRadius:8, padding:'0.6rem 0.875rem', marginBottom:'0.75rem', fontSize:'0.82rem', color:'#856404' }}>
              ⚠️ Ya tienes sesión como <strong>{findApp(auth.user.role)?.label}</strong>. Inicia sesión aquí para cambiar de cuenta.
            </div>
          )}

          {/* AuthPage maneja todo el flujo: login / register / forgot */}
          <AuthPage mode={mode} appKey={appKey} />
        </div>
      </div>
    </div>
  );
}

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
      <Route path="/"                  element={<LandingScreen />} />
      <Route path="/:appKey/login"     element={<AuthScreen mode="login" />} />
      <Route path="/:appKey/register"  element={<AuthScreen mode="register" />} />

      {/* Ruta de reset de contraseña — viene del enlace del email */}
      <Route path="/reset-password" element={
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
      <RootRouter />
    </AuthProvider>
  );
}
