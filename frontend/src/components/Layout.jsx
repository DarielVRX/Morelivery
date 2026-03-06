import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../api/client';

export default function Layout({ children }) {
  const { auth, logout, patchUser } = useAuth();
  const [address, setAddress]     = useState('');
  const [deleteMsg, setDeleteMsg] = useState('');

  const shouldAskAddress = Boolean(
    auth.user &&
      ['customer', 'restaurant'].includes(auth.user.role) &&
      (!auth.user.address || auth.user.address === 'address-pending')
  );

  async function saveAddress() {
    if (!auth.token || !address.trim()) return;
    const data = await apiFetch('/auth/profile', { method: 'PATCH', body: JSON.stringify({ address }) }, auth.token);
    patchUser({ address: data.profile.address, needsAddress: false });
    setAddress('');
  }

  async function deleteAccount() {
    if (!auth.token) return;
    if (!window.confirm('¿Seguro que deseas eliminar tu cuenta? Esta acción no se puede deshacer.')) return;
    setDeleteMsg('');
    try {
      await apiFetch('/auth/account', { method: 'DELETE' }, auth.token);
      logout();
    } catch (e) {
      // Mostrar el error del backend de forma prominente (ej: pedidos activos)
      setDeleteMsg(e.message);
    }
  }

  return (
    <div className="container">
      <header className="app-header">
        <div className="brand-block">
          <Link to="/" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <img className="brand-logo" src="/logo.svg" alt="Morelivery logo" />
            <div>
              <h1>Morelivery</h1>
              {auth.user ? <p className="subtitle role-pill">{auth.user.role}</p> : null}
            </div>
          </Link>
        </div>
        <div className="session-box">
          {auth.user ? (
            <>
              <Link to="/profile" style={{ fontSize: '0.875rem', color: '#2563eb', fontWeight: 600 }}>
                {auth.user.display_name || auth.user.username}
              </Link>
              <button onClick={logout}>Cerrar sesión</button>
            </>
          ) : (
            <Link className="login-link" to="/login">Iniciar sesión</Link>
          )}
        </div>
      </header>

      {/* Banner de dirección pendiente */}
      {shouldAskAddress && (
        <section className="auth-card">
          <h3>Completa tu dirección para continuar</h3>
          <div className="row">
            <input value={address} onChange={e => setAddress(e.target.value)} placeholder="Dirección de entrega" />
            <button onClick={saveAddress}>Guardar dirección</button>
          </div>
        </section>
      )}

      {/* Error al eliminar cuenta (pedidos activos) */}
      {deleteMsg && (
        <div style={{
          background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8,
          padding: '0.75rem 1rem', margin: '0.5rem 0',
          color: '#991b1b', fontSize: '0.875rem', fontWeight: 600
        }}>
          ⚠️ {deleteMsg}
          <button onClick={() => setDeleteMsg('')} style={{ marginLeft: '1rem', background: 'none', border: 'none', cursor: 'pointer', color: '#991b1b', fontWeight: 700 }}>✕</button>
        </div>
      )}

      <main>{children}</main>

      {/* Eliminar cuenta al fondo, discreto */}
      {auth.user && (
        <footer style={{ textAlign: 'center', padding: '1.5rem 0 0.5rem', marginTop: '2rem', borderTop: '1px solid #f3f4f6' }}>
          <button
            onClick={deleteAccount}
            style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: '0.78rem', cursor: 'pointer', textDecoration: 'underline' }}
          >
            Eliminar cuenta
          </button>
        </footer>
      )}
    </div>
  );
}
