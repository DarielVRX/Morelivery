import { useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import CustomerHome from './pages/Customer/Home';
import RestaurantDashboard from './pages/Restaurant/Dashboard';
import DriverDashboard from './pages/Driver/Dashboard';
import AdminDashboard from './pages/Admin/Dashboard';
import ProfilePage from './pages/Profile';
import { apiFetch } from './api/client';

function ProtectedRole({ role, children }) {
  const { auth } = useAuth();
  if (!auth.user) return <Navigate to="/login" replace />;
  if (auth.user.role !== role) return <Navigate to={`/${auth.user.role}`} replace />;
  return children;
}

function ProtectedAuth({ children }) {
  const { auth } = useAuth();
  if (!auth.user) return <Navigate to="/login" replace />;
  return children;
}

function AuthScreen({ mode = 'login' }) {
  const { auth, login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('customer');
  const [address, setAddress] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [message, setMessage] = useState('');

  async function submit() {
    try {
      if (mode === 'register') {
        await apiFetch('/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            username,
            password,
            role,
            displayName: displayName.trim() || username,
            address: ['customer', 'restaurant'].includes(role) ? address : undefined
          })
        });
        setMessage('Registro exitoso. Ya puedes iniciar sesión.');
        return;
      }
      const data = await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      login({ token: data.token, user: data.user });
      navigate(`/${data.user.role}`);
    } catch (error) {
      setMessage(error.message);
    }
  }

  const isLogin = mode === 'login';
  if (auth.user) return <Navigate to={`/${auth.user.role}`} replace />;

  return (
    <section className="auth-card">
      <h2>{isLogin ? 'Inicio de sesión' : 'Registro de usuario'}</h2>
      <div className="row">
        <input placeholder="Usuario (para login)" value={username} onChange={e => setUsername(e.target.value)} />
        <input type="password" placeholder="Contraseña" value={password} onChange={e => setPassword(e.target.value)} />
        {!isLogin && (
          <select value={role} onChange={e => setRole(e.target.value)}>
            <option value="customer">Cliente</option>
            <option value="restaurant">Restaurante</option>
            <option value="driver">Repartidor</option>
            <option value="admin">Admin</option>
          </select>
        )}
      </div>
      {!isLogin && (
        <div className="row">
          <input
            placeholder="Nombre para mostrar (Ej: Juan García)"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
          />
        </div>
      )}
      {!isLogin && ['customer', 'restaurant'].includes(role) && (
        <div className="row">
          <input placeholder="Dirección" value={address} onChange={e => setAddress(e.target.value)} />
        </div>
      )}
      <div className="row">
        <button onClick={submit}>{isLogin ? 'Iniciar sesión' : 'Registrarse'}</button>
        {isLogin
          ? <Link className="login-link" to="/register">Ir a registro</Link>
          : <Link className="login-link" to="/login">Ir a inicio de sesión</Link>}
      </div>
      {message ? <p>{message}</p> : null}
    </section>
  );
}

function AppRoutes() {
  const { auth } = useAuth();
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to={auth.user ? `/${auth.user.role}` : '/login'} replace />} />
        <Route path="/login" element={<AuthScreen mode="login" />} />
        <Route path="/register" element={<AuthScreen mode="register" />} />
        <Route path="/profile" element={<ProtectedAuth><ProfilePage /></ProtectedAuth>} />
        <Route path="/customer" element={<ProtectedRole role="customer"><CustomerHome /></ProtectedRole>} />
        <Route path="/restaurant" element={<ProtectedRole role="restaurant"><RestaurantDashboard /></ProtectedRole>} />
        <Route path="/driver" element={<ProtectedRole role="driver"><DriverDashboard /></ProtectedRole>} />
        <Route path="/admin" element={<ProtectedRole role="admin"><AdminDashboard /></ProtectedRole>} />
      </Routes>
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
