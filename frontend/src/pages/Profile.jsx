import { useState } from 'react';
import { apiFetch } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

function Collapsible({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card" style={{ marginBottom:'0.75rem', padding:0, overflow:'hidden' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width:'100%', display:'flex', justifyContent:'space-between', alignItems:'center',
          padding:'0.85rem 1rem', background:'none', border:'none', cursor:'pointer',
          fontWeight:700, fontSize:'0.9rem', color:'var(--gray-800)',
          borderBottom: open ? '1px solid var(--gray-200)' : 'none',
        }}
      >
        <span>{title}</span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition:'transform 0.2s' }}>
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>
      {open && <div style={{ padding:'1rem' }}>{children}</div>}
    </div>
  );
}

function Flash({ text, isError }) {
  if (!text) return null;
  return <p className={`flash ${isError ? 'flash-error' : 'flash-ok'}`} style={{ marginTop:'0.5rem' }}>{text}</p>;
}

const ROLE_LABELS = { customer:'Cliente', restaurant:'Tienda', driver:'Conductor', admin:'Administrador' };

export default function ProfilePage() {
  const { auth, patchUser, logout } = useAuth();
  const user = auth.user;

  // Datos personales (nombre para mostrar a terceros + dirección)
  const [displayName, setDisplayName] = useState(user?.display_name || user?.full_name || user?.username || '');
  const [address, setAddress]         = useState(user?.address && user.address !== 'address-pending' ? user.address : '');
  const [profileMsg, setProfileMsg]   = useState('');
  const [profileErr, setProfileErr]   = useState(false);

  // Cambiar contraseña + usuario de login (ambos en la misma sección)
  const [loginUsername, setLoginUsername]   = useState(user?.username || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword]         = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdMsg, setPwdMsg]   = useState('');
  const [pwdErr, setPwdErr]   = useState(false);

  // Eliminar cuenta
  const [deleteMsg, setDeleteMsg] = useState('');
  const [deleteErr, setDeleteErr] = useState(false);

  async function saveProfile() {
    if (!displayName.trim()) { setProfileMsg('El nombre no puede estar vacío'); setProfileErr(true); return; }
    try {
      const body = { displayName: displayName.trim() };
      if (address.trim()) body.address = address.trim();
      const data = await apiFetch('/auth/profile', { method:'PATCH', body: JSON.stringify(body) }, auth.token);
      patchUser({
        display_name: data.profile.displayName,
        full_name:    data.profile.displayName,
        address:      data.profile.address,
      });
      if (data.profile.displayName) setDisplayName(data.profile.displayName);
      if (data.profile.address)     setAddress(data.profile.address);
      setProfileMsg('Perfil actualizado'); setProfileErr(false);
    } catch (e) { setProfileMsg(e.message); setProfileErr(true); }
  }

  async function changePasswordAndLogin() {
    // Requiere contraseña actual siempre
    if (!currentPassword) { setPwdMsg('Ingresa tu contraseña actual'); setPwdErr(true); return; }

    const changingPwd  = !!newPassword;
    const changingUser = loginUsername.trim() && loginUsername.trim() !== user?.username;

    if (!changingPwd && !changingUser) {
      setPwdMsg('No hay cambios que guardar'); setPwdErr(false); return;
    }
    if (changingPwd) {
      if (newPassword !== confirmPassword) { setPwdMsg('Las contraseñas no coinciden'); setPwdErr(true); return; }
      if (newPassword.length < 6) { setPwdMsg('Mínimo 6 caracteres'); setPwdErr(true); return; }
    }

    try {
      // Cambiar contraseña
      if (changingPwd) {
        await apiFetch('/auth/password', {
          method:'PATCH', body: JSON.stringify({ currentPassword, newPassword })
        }, auth.token);
      }
      // Cambiar usuario de login (email interno)
      if (changingUser) {
        await apiFetch('/auth/login-username', {
          method:'PATCH', body: JSON.stringify({ currentPassword, newUsername: loginUsername.trim() })
        }, auth.token);
        patchUser({ username: loginUsername.trim() });
      }
      setPwdMsg(changingPwd && changingUser ? 'Contraseña y usuario actualizados'
        : changingPwd ? 'Contraseña actualizada'
        : 'Usuario de acceso actualizado');
      setPwdErr(false);
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    } catch (e) { setPwdMsg(e.message); setPwdErr(true); }
  }

  async function deleteAccount() {
    if (!window.confirm('¿Eliminar tu cuenta permanentemente? Esta acción no se puede deshacer.')) return;
    try {
      // Ruta correcta: DELETE /auth/account (no /auth/delete-account)
      await apiFetch('/auth/account', { method:'DELETE' }, auth.token);
      logout();
    } catch (e) { setDeleteMsg(e.message); setDeleteErr(true); }
  }

  const avatarLetter = (displayName[0] || '?').toUpperCase();

  return (
    <div>
      <h2 style={{ fontSize:'1.1rem', fontWeight:800, marginBottom:'1.25rem' }}>Mi perfil</h2>

      {/* Tarjeta de cuenta */}
      <div className="card" style={{ marginBottom:'0.75rem', display:'flex', gap:'0.75rem', alignItems:'center' }}>
        <div style={{ width:44, height:44, borderRadius:'50%', background:'var(--brand-light)', border:'2px solid var(--brand)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
          <span style={{ fontWeight:800, fontSize:'1.1rem', color:'var(--brand)' }}>{avatarLetter}</span>
        </div>
        <div>
          <div style={{ fontWeight:700 }}>{displayName}</div>
          <div style={{ fontSize:'0.8rem', color:'var(--gray-600)' }}>
            @{user?.username} · {ROLE_LABELS[user?.role] || user?.role}
          </div>
        </div>
      </div>

      {/* Datos personales — cerrado por defecto */}
      <Collapsible title="Datos personales" defaultOpen={false}>
        <p style={{ fontSize:'0.8rem', color:'var(--gray-500)', marginBottom:'0.65rem' }}>
          Este nombre se muestra a otros usuarios en la plataforma.
        </p>
        <div style={{ display:'flex', flexDirection:'column', gap:'0.55rem', marginBottom:'0.65rem' }}>
          <label>
            Nombre para mostrar
            <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Ej: Juan García" />
          </label>
          <label>
            Dirección
            <input value={address} onChange={e => setAddress(e.target.value)}
              placeholder="Ej: Av. Revolución 1234, Col. Centro" />
          </label>
        </div>
        <button className="btn-primary btn-sm" onClick={saveProfile}>Guardar cambios</button>
        <Flash text={profileMsg} isError={profileErr} />
      </Collapsible>

      {/* Seguridad — contraseña y usuario de acceso */}
      <Collapsible title="Seguridad">
        <p style={{ fontSize:'0.8rem', color:'var(--gray-500)', marginBottom:'0.65rem' }}>
          El usuario de acceso es el que usas para iniciar sesión. Es distinto al nombre que ven otros usuarios.
        </p>
        <div style={{ display:'flex', flexDirection:'column', gap:'0.55rem', marginBottom:'0.65rem' }}>
          <label>
            Usuario de acceso
            <input value={loginUsername} onChange={e => setLoginUsername(e.target.value)}
              placeholder="Ej: juangarcia91" autoComplete="username" />
          </label>
          <label>Contraseña actual (requerida)
            <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)}
              autoComplete="current-password" />
          </label>
          <label>Nueva contraseña (opcional)
            <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
              autoComplete="new-password" placeholder="Dejar vacío para no cambiar" />
          </label>
          {newPassword && (
            <label>Confirmar nueva contraseña
              <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                autoComplete="new-password" />
            </label>
          )}
        </div>
        <button className="btn-primary btn-sm" onClick={changePasswordAndLogin}>Guardar cambios</button>
        <Flash text={pwdMsg} isError={pwdErr} />
      </Collapsible>

      {/* Cerrar sesión */}
      <button
        onClick={logout}
        style={{
          width:'100%', padding:'0.7rem', background:'var(--gray-100)',
          border:'1px solid var(--gray-200)', borderRadius:'var(--radius)',
          fontWeight:700, fontSize:'0.9rem', cursor:'pointer', marginBottom:'0.75rem',
          color:'var(--gray-800)', transition:'background 0.15s',
        }}
        onMouseEnter={e => e.currentTarget.style.background='var(--gray-200)'}
        onMouseLeave={e => e.currentTarget.style.background='var(--gray-100)'}
      >
        Cerrar sesión
      </button>

      {/* Administración */}
      <Collapsible title="Administración de cuenta">
        <p style={{ fontSize:'0.85rem', color:'var(--gray-600)', marginBottom:'0.75rem' }}>
          Eliminar tu cuenta es permanente. No podrás recuperarla ni tienes pedidos activos pendientes.
        </p>
        <button className="btn-danger btn-sm" onClick={deleteAccount}>Eliminar cuenta</button>
        <Flash text={deleteMsg} isError={deleteErr} />
      </Collapsible>
    </div>
  );
}
