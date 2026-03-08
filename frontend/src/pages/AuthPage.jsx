// frontend/src/pages/AuthPage.jsx
// Inputs no controlados (useRef) para cero re-renders al tipear.
// Lee localStorage directamente para el redirect — sin consumir AuthContext
// en el ciclo de render, lo que elimina el jank causado por re-renders del árbol.
import { useCallback, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../api/client';

const STORAGE_KEY = 'morelivery_auth_v1';

function getStoredUser() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}').user || null; }
  catch { return null; }
}

export default function AuthPage({ mode = 'login' }) {
  // Redirect: leer localStorage directo, sin suscribirse al context
  const storedUser = getStoredUser();
  const navigate   = useNavigate();
  if (storedUser) { navigate(`/${storedUser.role}`, { replace: true }); return null; }

  return <AuthForm mode={mode} />;
}

// AuthForm es un componente separado que sí puede usar context y state
// sin arrastrar el redirect al ciclo de re-render.
function AuthForm({ mode }) {
  const { login } = useAuth();
  const navigate  = useNavigate();

  const usernameRef    = useRef(null);
  const passwordRef    = useRef(null);
  const displayNameRef = useRef(null);
  const addressRef     = useRef(null);

  const [role,    setRole]    = useState('customer');
  const [message, setMessage] = useState('');

  const isLogin = mode === 'login';

  const submit = useCallback(async () => {
    const username    = usernameRef.current?.value?.trim()    || '';
    const password    = passwordRef.current?.value            || '';
    const displayName = displayNameRef.current?.value?.trim() || '';
    const address     = addressRef.current?.value?.trim()     || '';

    try {
      if (!isLogin) {
        await apiFetch('/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            username, password, role,
            displayName: displayName || undefined,
            address: ['customer','restaurant'].includes(role) ? address : undefined,
          })
        });
        setMessage('Registro exitoso. Ya puedes iniciar sesión.');
        return;
      }
      const data = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      login({ token: data.token, user: data.user });
      navigate(`/${data.user.role}`);
    } catch (error) {
      setMessage(error.message);
    }
  }, [isLogin, role, login, navigate]);

  function handleKey(e) { if (e.key === 'Enter') submit(); }

  return (
    <section className="auth-card">
      <h2>{isLogin ? 'Iniciar sesión' : 'Crear cuenta'}</h2>
      <p>{isLogin ? 'Ingresa con tu usuario y contraseña.' : 'Completa los datos para registrarte.'}</p>

      <div className="row">
        <label>Usuario
          <input ref={usernameRef} defaultValue="" placeholder="Tu nombre de usuario"
            autoComplete="username" onKeyDown={handleKey} />
        </label>
        <label>Contraseña
          <input ref={passwordRef} defaultValue="" type="password" placeholder="Tu contraseña"
            autoComplete="current-password" onKeyDown={handleKey} />
        </label>
        {!isLogin && (
          <label>Tipo de cuenta
            <select value={role} onChange={e => setRole(e.target.value)}>
              <option value="customer">Cliente</option>
              <option value="restaurant">Tienda</option>
              <option value="driver">Conductor</option>
            </select>
          </label>
        )}
      </div>

      {!isLogin && role === 'restaurant' && (
        <div className="row">
          <label>Nombre de la tienda
            <input ref={displayNameRef} defaultValue="" placeholder="Ej: Tacos El Güero" onKeyDown={handleKey} />
          </label>
        </div>
      )}
      {!isLogin && ['customer','restaurant'].includes(role) && (
        <div className="row">
          <label>Dirección
            <input ref={addressRef} defaultValue="" placeholder="Ej: Av. Revolución 1234, Col. Centro" onKeyDown={handleKey} />
          </label>
        </div>
      )}

      <div className="row">
        <button className="btn-primary" onClick={submit}>
          {isLogin ? 'Iniciar sesión' : 'Registrarse'}
        </button>
        {isLogin
          ? <Link to="/register" style={{ fontSize:'0.875rem', textAlign:'center' }}>¿No tienes cuenta? Regístrate</Link>
          : <Link to="/login"    style={{ fontSize:'0.875rem', textAlign:'center' }}>¿Ya tienes cuenta? Inicia sesión</Link>
        }
      </div>

      {message && (
        <p className={`flash ${message.startsWith('Registro') ? 'flash-ok' : 'flash-error'}`}>
          {message}
        </p>
      )}
    </section>
  );
}
