import { useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import CustomerHome from './pages/Customer/Home';
import RestaurantDashboard from './pages/Restaurant/Dashboard';
import DriverDashboard from './pages/Driver/Dashboard';
import AdminDashboard from './pages/Admin/Dashboard';
import { apiFetch } from './api/client';

function ProtectedRole({ role, children }) {
  const { auth } = useAuth();
  if (!auth.user) return <Navigate to="/login" replace />;
  if (auth.user.role !== role) return <Navigate to={`/${auth.user.role}`} replace />;
  return children;
}

function AuthScreen({ mode = 'login' }) {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('customer');
  const [message, setMessage] = useState('');

  async function submit() {
    try {
      if (mode === 'register') {
        await apiFetch('/auth/register', { method: 'POST', body: JSON.stringify({ username, password, role }) });
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

  return (
    <section className="auth-card">
      <h2>{isLogin ? 'Inicio de sesión' : 'Crear cuenta de prueba'}</h2>
      <p>
        {isLogin
          ? 'Accede con tu username y contraseña para entrar a tu entorno de trabajo.'
          : 'Registro rápido de usuarios ficticios para pruebas por rol.'}
      </p>
      <div className="row">
        <input placeholder="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <input type="password" placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {!isLogin ? (
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="customer">customer</option>
            <option value="restaurant">restaurant</option>
            <option value="driver">driver</option>
            <option value="admin">admin</option>
          </select>
        ) : null}
      </div>
      <div className="row">
        <button onClick={submit}>{isLogin ? 'Entrar' : 'Registrar'}</button>
        {isLogin ? <Link className="login-link" to="/register">Ir a registro</Link> : <Link className="login-link" to="/login">Ir a login</Link>}
      </div>
      {message ? <p>{message}</p> : null}
    </section>
  );
}

function AppRoutes() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<AuthScreen mode="login" />} />
        <Route path="/register" element={<AuthScreen mode="register" />} />
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
