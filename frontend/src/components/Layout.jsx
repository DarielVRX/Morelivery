import { useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../api/client';

const ROLE_LABELS = { customer:'Cliente', restaurant:'Tienda', driver:'Conductor', admin:'Administrador' };

function IconHome()     { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H5a1 1 0 01-1-1V9.5z"/><path d="M9 21V12h6v9"/></svg>; }
function IconOrders()   { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M7 9h10M7 13h8M7 17h5"/></svg>; }
function IconSchedule() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>; }
function IconClock()    { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>; }
function IconProfile()  { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>; }
function IconMenuTab()  { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M9 7h6M9 11h6M9 15h4"/><path d="M15 2v4H9V2"/></svg>; }

function getNavItems(role) {
  if (role === 'customer')   return [
    { to:'/customer', label:'Inicio', Icon:IconHome },
  ];
  if (role === 'restaurant') return [
    { to:'/restaurant',         label:'Inicio',  Icon:IconHome     },
    { to:'/restaurant/horario', label:'Horario', Icon:IconSchedule },
  ];
  if (role === 'driver')     return [
    { to:'/driver',           label:'Inicio',    Icon:IconHome  },
    { to:'/driver/ganancias', label:'Ganancias', Icon:IconClock },
  ];
  return [];
}

function isActive(to, pathname) {
  if (to === '/restaurant') return pathname === '/restaurant';
  if (['/customer','/driver'].includes(to)) return pathname === to;
  return pathname.startsWith(to);
}

export default function Layout({ children }) {
  const { auth, logout, patchUser } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [address, setAddress] = useState('');

  const role  = auth.user?.role;
  const items = getNavItems(role);
  const displayName = auth.user?.alias || auth.user?.full_name || auth.user?.username || '';

  const shouldAskAddress = Boolean(
    auth.user &&
    ['customer','restaurant'].includes(role) &&
    (!auth.user.address || auth.user.address === 'address-pending')
  );

  async function saveAddress() {
    if (!auth.token || !address.trim()) return;
    try {
      const data = await apiFetch('/auth/profile', {
        method:'PATCH', body: JSON.stringify({ address: address.trim() })
      }, auth.token);
      patchUser({ address: data.profile.address });
      setAddress('');
    } catch (e) { console.error(e); }
  }

  return (
    <div className="app-shell">
      <header className="app-header">

        {/* Logo — textDecoration none para quitar subrayado */}
        <Link to={auth.user ? `/${role}` : '/'} className="brand-block" style={{ textDecoration:'none' }}>
          <img className="brand-logo" src="/logo.svg" alt="Morelivery" />
          <div>
            <h1>Morelivery</h1>
            {role && <span className="role-pill">{ROLE_LABELS[role] || role}</span>}
          </div>
        </Link>

        {/* Nav desktop — alineado a la derecha */}
        {auth.user && items.length > 0 && (
          <nav className="nav-desktop" aria-label="Navegación principal">
            {items.map(({ to, label }) => (
              <Link key={to} to={to} className={isActive(to, location.pathname) ? 'active' : ''}>
                {label}
              </Link>
            ))}
            <button onClick={logout}>Salir</button>
          </nav>
        )}

        {/* Username → Perfil */}
        {auth.user && (
          <button
            onClick={() => navigate('/profile')}
            className={`user-name-btn${location.pathname === '/profile' ? ' active' : ''}`}
            title="Mi perfil"
          >
            {displayName}
          </button>
        )}
      </header>

      {/* Dirección pendiente */}
      {shouldAskAddress && (
        <div style={{ background:'#fffbeb', borderBottom:'1px solid #fde68a', padding:'0.75rem 1.25rem' }}>
          <p style={{ fontSize:'0.85rem', fontWeight:600, color:'#92400e', marginBottom:'0.5rem' }}>
            Agrega tu dirección para poder hacer pedidos
          </p>
          <div style={{ display:'flex', gap:'0.5rem', maxWidth:420 }}>
            <input value={address} onChange={e => setAddress(e.target.value)}
              placeholder="Tu dirección de entrega"
              onKeyDown={e => e.key === 'Enter' && saveAddress()} />
            <button className="btn-primary" onClick={saveAddress} style={{ whiteSpace:'nowrap' }}>Guardar</button>
          </div>
        </div>
      )}

      <main className="page-content">{children}</main>

      {/* Nav móvil — con Perfil al final */}
      {auth.user && items.length > 0 && (
        <nav className="nav-mobile" aria-label="Navegación">
          {items.map(({ to, label, Icon }) => (
            <button key={to}
              className={`nav-mobile-item${isActive(to, location.pathname) ? ' active' : ''}`}
              onClick={() => navigate(to)} aria-label={label}>
              <Icon /><span>{label}</span>
            </button>
          ))}
          <button
            className={`nav-mobile-item${location.pathname === '/profile' ? ' active' : ''}`}
            onClick={() => navigate('/profile')} aria-label="Perfil">
            <IconProfile /><span>Perfil</span>
          </button>
        </nav>
      )}
    </div>
  );
}
