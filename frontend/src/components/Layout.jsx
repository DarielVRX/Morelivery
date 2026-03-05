import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../api/client';

export default function Layout({ children }) {
  const { auth, logout, patchUser } = useAuth();
  const navigate = useNavigate();
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const shouldAskAddress = Boolean(
    auth.user &&
    ['customer', 'restaurant'].includes(auth.user.role) &&
    (!auth.user.address || auth.user.address === 'address-pending')
  );

  async function saveAddress() {
    if (!auth.token || !address.trim()) return;
    setError(''); setSaving(true);
    try {
      const data = await apiFetch('/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({ address: address.trim() })
      }, auth.token);
      patchUser({ address: data.profile.address });
      setAddress('');
    } catch (err) {
      setError(err.message || 'Error al guardar dirección');
    } finally { setSaving(false); }
  }

  async function deleteAccount() {
    if (!auth.token) return;
    if (!window.confirm('¿Seguro que deseas eliminar tu cuenta?')) return;
    await apiFetch('/auth/account', { method: 'DELETE' }, auth.token);
    logout();
  }

  const displayName = auth.user?.display_name || auth.user?.username || '';
  const homeRoute = auth.user ? `/${auth.user.role}` : '/';

  return (
    <div className="container">
      <header className="app-header">
        <div className="brand-block">
          {/* Logo y título son el botón de home */}
          <Link to={homeRoute} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none', color: 'inherit' }}>
            <img className="brand-logo" src="/logo.svg" alt="Morelivery logo" />
            <div>
              <h1 style={{ margin: 0 }}>Morelivery</h1>
              {auth.user ? <p className="subtitle role-pill" style={{ margin: 0 }}>{auth.user.role}</p> : null}
            </div>
          </Link>
        </div>
        <div className="session-box">
          {auth.user ? (
            <>
              <span>{displayName}</span>
              <Link className="login-link" to="/profile" style={{ marginLeft: '0.5rem' }}>Perfil</Link>
              <button onClick={logout} style={{ marginLeft: '0.5rem' }}>Cerrar sesión</button>
            </>
          ) : (
            <Link className="login-link" to="/login">Iniciar sesión</Link>
          )}
        </div>
      </header>

      {shouldAskAddress ? (
        <section className="auth-card">
          <h3>Ingresa tu dirección para continuar</h3>
          <p>Solo se pedirá una vez. Podrás modificarla desde tu perfil.</p>
          <div className="row">
            <input
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="Ej: Av. Siempre Viva 742, Springfield"
              onKeyDown={e => e.key === 'Enter' && saveAddress()}
            />
            <button onClick={saveAddress} disabled={saving || !address.trim()}>
              {saving ? 'Guardando…' : 'Guardar dirección'}
            </button>
          </div>
          {error ? <p style={{ color: 'red' }}>{error}</p> : null}
        </section>
      ) : (
        <>
          {auth.user ? (
            <section className="auth-card compact">
              <button onClick={deleteAccount}>Eliminar cuenta</button>
            </section>
          ) : null}
          <main>{children}</main>
        </>
      )}
    </div>
  );
}
