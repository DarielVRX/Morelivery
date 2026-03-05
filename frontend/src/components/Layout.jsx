import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../api/client';

export default function Layout({ children }) {
  const { auth, logout, patchUser } = useAuth();
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Necesita dirección si: es customer o restaurant Y no tiene address guardada
  const shouldAskAddress = Boolean(
    auth.user &&
      ['customer', 'restaurant'].includes(auth.user.role) &&
      (!auth.user.address || auth.user.address === 'address-pending')
  );

  async function saveAddress() {
    if (!auth.token || !address.trim()) return;
    setError('');
    setSaving(true);
    try {
      const data = await apiFetch('/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({ address: address.trim() })
      }, auth.token);
      // patchUser actualiza auth en memoria Y en localStorage via AuthContext
      patchUser({ address: data.profile.address });
      setAddress('');
    } catch (err) {
      setError(err.message || 'Error al guardar dirección');
    } finally {
      setSaving(false);
    }
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
          {auth.user
            ? <button onClick={logout}>Cerrar sesión</button>
            : <Link className="login-link" to="/login">Iniciar sesión</Link>}
        </div>
      </header>

      {shouldAskAddress ? (
        <section className="auth-card">
          <h3>Ingresa tu dirección para continuar</h3>
          <p>Necesitamos tu dirección para procesar pedidos. Solo se pedirá una vez.</p>
          <div className="row">
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Ej: Av. Siempre Viva 742, Springfield"
              onKeyDown={(e) => e.key === 'Enter' && saveAddress()}
            />
            <button onClick={saveAddress} disabled={saving || !address.trim()}>
              {saving ? 'Guardando...' : 'Guardar dirección'}
            </button>
          </div>
          {error ? <p style={{ color: 'red' }}>{error}</p> : null}
          {/* Bloquea el contenido hasta tener dirección */}
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

      {/* Si no tiene dirección, no renderiza el contenido del rol */}
      {shouldAskAddress ? null : null}
    </div>
  );
}
