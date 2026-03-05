import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function Layout({ children }) {
  const { auth, logout } = useAuth();

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
      <main>{children}</main>
    </div>
  );
}
