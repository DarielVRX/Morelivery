// frontend/src/App.jsx
import { lazy, memo, Suspense, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import SplitLayout from './components/SplitLayout';
import { apiFetch } from './api/client';

// ─── Lazy pages ───────────────────────────────────────────────────────────────
const CustomerHome    = lazy(() => import('./pages/Customer/Home'));
const CustomerOrders  = lazy(() => import('./pages/Customer/Orders'));
const CustomerPayments = lazy(() => import('./pages/Customer/Payments'));
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
  if (auth.user) {
    const app = findApp(auth.user.role);
    return <Navigate to={app?.home || '/'} replace />;
  }

  return (
    <div style={{
      minHeight:'100dvh', background:'#fff',
      display:'flex', flexDirection:'column',
      alignItems:'center', justifyContent:'center',
      padding:'2rem 1.25rem',
    }}>
      {/* Marca */}
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'0.5rem', marginBottom:'2.5rem' }}>
        <img src="/logo.svg" alt="Morelivery" style={{ width:60, height:60 }} />
        <h1 style={{ fontSize:'2rem', fontWeight:900, color:'var(--gray-800)', margin:0, letterSpacing:'-0.02em' }}>
          Morelivery
        </h1>
        <p style={{ color:'var(--gray-600)', fontSize:'0.95rem', margin:0 }}>
          ¿Cómo quieres acceder?
        </p>
      </div>

      {/* Botones — columna, uno bajo el otro, no más de una pantalla */}
      <div style={{
        display:'flex', flexDirection:'column', gap:'0.75rem',
        width:'100%', maxWidth:'340px',
      }}>
        {APPS.map(app => (
          <Link key={app.key} to={`/${app.key}/login`} style={{ textDecoration:'none' }}>
            <div style={{
              display:'flex', alignItems:'center', gap:'1rem',
              padding:'0.875rem 1.25rem',
              background:'var(--brand-light)',
              border:'1.5px solid #e3aaaa',
              borderRadius:14,
              cursor:'pointer',
              transition:'transform 0.15s, box-shadow 0.15s',
            }} className="landing-btn">
              <span style={{ fontSize:'1.5rem', lineHeight:1 }}>{app.icon}</span>
              <div>
                <div style={{ fontWeight:700, fontSize:'0.95rem', color:'var(--gray-800)' }}>{app.label}</div>
                <div style={{ fontSize:'0.78rem', color:'var(--gray-600)' }}>{app.description}</div>
              </div>
              <span style={{ marginLeft:'auto', color:'#e3aaaa', fontSize:'1.1rem' }}>›</span>
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
// memo + refs para cero re-renders al tipear (elimina el lag en móvil)
const AuthScreen = memo(function AuthScreen({ mode = 'login' }) {
  const { appKey } = useParams();
  const app        = findApp(appKey);
  const { auth, login } = useAuth();
  const navigate   = useNavigate();

  // Inputs no controlados — refs para evitar re-renders
  const usernameRef    = useRef(null);
  const passwordRef    = useRef(null);
  const displayNameRef = useRef(null);
  const addressRef     = useRef(null);

  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const isLogin = mode === 'login';

  // Si ya está logueado con ESTE mismo rol, redirigir a su home
  if (auth.user && auth.user.role === appKey) {
    return <Navigate to={app?.home || `/${appKey}`} replace />;
  }
  // Si está logueado con OTRO rol, mostrar aviso (no redirigir — puede querer cambiar de cuenta)
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
            address: ['customer','restaurant'].includes(appKey) ? address : undefined,
          }),
        });
        setMessage('Registro exitoso. Ya puedes iniciar sesión.');
        return;
      }
      const data = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password, role: appKey }),
      });
      // Validación de rol: el backend solo devuelve el usuario si el rol coincide.
      // Por seguridad adicional, verificar en el frontend también.
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
    <div style={{ minHeight:'100dvh', background:'#fff', display:'flex', flexDirection:'column' }}>
      {/* Header con botón atrás */}
      <header style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'0.75rem 1.25rem', borderBottom:'1px solid var(--gray-200)',
        background:'#fff', position:'sticky', top:0, zIndex:10,
      }}>
        <Link to="/" style={{ display:'flex', alignItems:'center', gap:'0.3rem', color:'var(--brand)', fontSize:'0.875rem', fontWeight:600, textDecoration:'none' }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Inicio
        </Link>
        <div style={{ display:'flex', alignItems:'center', gap:'0.4rem', color:'var(--gray-800)' }}>
          <img src="/logo.svg" alt="" style={{ width:24, height:24 }} />
          <strong style={{ fontSize:'0.95rem' }}>Morelivery</strong>
        </div>
      </header>

      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding:'2rem 1.25rem' }}>
        <section className="auth-card" style={{ width:'100%', maxWidth:'400px' }}>
          <div style={{ textAlign:'center', marginBottom:'1rem' }}>
            <span style={{ fontSize:'2rem' }}>{app.icon || '🔐'}</span>
            <h2 style={{ margin:'0.25rem 0 0' }}>
              {isLogin ? `Entrar como ${app.label}` : `Crear cuenta ${app.label}`}
            </h2>
          </div>

          {/* Aviso si hay sesión activa de otro rol */}
          {wrongRole && (
            <div style={{ background:'#fff3cd', border:'1px solid #ffc107', borderRadius:8, padding:'0.6rem 0.875rem', marginBottom:'0.75rem', fontSize:'0.82rem', color:'#856404' }}>
              ⚠️ Ya tienes sesión como <strong>{findApp(auth.user.role)?.label}</strong>. Inicia sesión aquí para cambiar de cuenta.
            </div>
          )}

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
                <input ref={displayNameRef} defaultValue="" placeholder="Ej: Tacos El Güero" onKeyDown={handleKey} />
              </label>
            </div>
          )}
          {!isLogin && ['customer','restaurant'].includes(appKey) && (
            <div className="row">
              <label>Dirección
                <input ref={addressRef} defaultValue="" placeholder="Ej: Av. Revolución 1234, Col. Centro" onKeyDown={handleKey} />
              </label>
            </div>
          )}

          <div className="row">
            <button className="btn-primary" onClick={submit} disabled={loading}>
              {loading ? 'Cargando…' : (isLogin ? 'Iniciar sesión' : 'Registrarse')}
            </button>
            {isLogin
              ? <Link to={`/${appKey}/register`} style={{ fontSize:'0.875rem', textAlign:'center' }}>¿No tienes cuenta? Regístrate</Link>
              : <Link to={`/${appKey}/login`}    style={{ fontSize:'0.875rem', textAlign:'center' }}>¿Ya tienes cuenta? Inicia sesión</Link>
            }
          </div>

          {message && (
            <p className={`flash ${isOk ? 'flash-ok' : 'flash-error'}`}>{message}</p>
          )}
        </section>
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
          <Route path="/customer/pedidos" element={<Navigate to="/customer" replace />} />
          <Route path="/customer/pagos" element={<ProtectedRole role="customer"><CustomerPayments /></ProtectedRole>} />

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
