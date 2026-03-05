import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../api/client';

export default function Layout({ children }) {
  const { auth, logout, login } = useAuth();
  const [address, setAddress] = useState('');

  async function saveAddress() {
    if (!auth.token || !address.trim()) return;
    const data = await apiFetch('/auth/profile', { method: 'PATCH', body: JSON.stringify({ address }) }, auth.token);
    login({ token: auth.token, user: { ...auth.user, address: data.profile.address, needsAddress: false } });
  }

  async function deleteAccount() {
    if (!auth.token) return;
    if (!window.confirm('¿Seguro que deseas eliminar tu cuenta?')) return;
    await apiFetch('/auth/account', { method: 'DELETE' }, auth.token);
    logout();
  }

  return (
    <div className="container">
      <header className="app-header">
        <div className="brand-block">
          <img className="brand-logo" src="/logo.svg" alt="Morelivery logo" />
          <div>
            <h1>Morelivery</h1>
            {auth.user ? <p className="subtitle role-pill">{auth.user.role}</p> : null}
          </div>
        </div>
        <div className="session-box">
          <span>{auth.user ? auth.user.username : 'Sin sesión'}</span>
          {auth.user ? <button onClick={logout}>Logout</button> : <Link className="login-link" to="/login">Login</Link>}
        </div>
      </header>

      {auth.user?.needsAddress ? (
        <section className="auth-card">
          <h3>Completa dirección para continuar (pruebas)</h3>
          <div className="row">
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Dirección" />
            <button onClick={saveAddress}>Guardar dirección</button>
          </div>
        </section>
      ) : null}

      {auth.user ? (
        <section className="auth-card compact">
          <button onClick={deleteAccount}>Eliminar cuenta</button>
        </section>
      ) : null}

      <main>{children}</main>
    </div>
  );
}
