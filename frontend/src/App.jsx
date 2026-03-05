import { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import CustomerHome from './pages/Customer/Home';
import RestaurantDashboard from './pages/Restaurant/Dashboard';
import DriverDashboard from './pages/Driver/Dashboard';
import { apiFetch } from './api/client';

function AuthPanel() {
  const { auth, login, logout } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('customer');
  const [message, setMessage] = useState('');

  async function registerUser() {
    try {
      await apiFetch('/auth/register', { method: 'POST', body: JSON.stringify({ username, password, role }) });
      setMessage('Registro exitoso');
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function loginUser() {
    try {
      const data = await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      login({ token: data.token, user: data.user });
      setMessage(`Login OK: ${data.user.role}`);
    } catch (error) {
      setMessage(error.message);
    }
  }

  return (
    <section className="card">
      <h3>Pruebas: Registro / Login</h3>
      <div className="row">
        <input placeholder="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <input placeholder="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="customer">customer</option>
          <option value="restaurant">restaurant</option>
          <option value="driver">driver</option>
        </select>
      </div>
      <div className="row">
        <button onClick={registerUser}>Registrar</button>
        <button onClick={loginUser}>Login</button>
        <button onClick={logout}>Logout</button>
      </div>
      <p>{auth.user ? `Sesión: ${auth.user.username} (${auth.user.role})` : 'Sin sesión'}</p>
      {message ? <p>{message}</p> : null}
    </section>
  );
}

function AppRoutes() {
  return (
    <Layout>
      <AuthPanel />
      <Routes>
        <Route path="/" element={<CustomerHome />} />
        <Route path="/restaurant" element={<RestaurantDashboard />} />
        <Route path="/driver" element={<DriverDashboard />} />
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
