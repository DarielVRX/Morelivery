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
  return (
    <p className={`flash ${isError ? 'flash-error' : 'flash-ok'}`} style={{ marginTop:'0.5rem' }}>
      {text}
    </p>
  );
}

export default function ProfilePage() {
  const { auth, patchUser, logout } = useAuth();
  const user = auth.user;

  // Datos personales
  const [displayName, setDisplayName] = useState(user?.display_name || user?.username || '');
  const [address, setAddress]         = useState(user?.address && user.address !== 'address-pending' ? user.address : '');
  const [profileMsg, setProfileMsg]   = useState('');
  const [profileErr, setProfileErr]   = useState(false);

  // Contraseña
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
      // Todos los roles pueden tener dirección
      if (address.trim()) body.address = address.trim();
      const data = await apiFetch('/auth/profile', { method:'PATCH', body: JSON.stringify(body) }, auth.token);
      patchUser({
        display_name: data.profile.displayName || displayName.trim(),
        address: data.profile.address ?? address.trim(),
      });
      setProfileMsg('Perfil actualizado'); setProfileErr(false);
    } catch (e) { setProfileMsg(e.message); setProfileErr(true); }
  }

  async function changePassword() {
    if (!newPassword) { setPwdMsg('Ingresa la nueva contraseña'); setPwdErr(true); return; }
    if (newPassword !== confirmPassword) { setPwdMsg('Las contraseñas no coinciden'); setPwdErr(true); return; }
    if (newPassword.length < 6) { setPwdMsg('Mínimo 6 caracteres'); setPwdErr(true); return; }
    try {
      await apiFetch('/auth/password', { method:'PATCH', body: JSON.stringify({ currentPassword, newPassword }) }, auth.token);
      setPwdMsg('Contraseña actualizada'); setPwdErr(false);
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    } catch (e) { setPwdMsg(e.message); setPwdErr(true); }
  }

  async function deleteAccount() {
    if (!window.confirm('¿Eliminar tu cuenta permanentemente? Esta acción no se puede deshacer.')) return;
    try {
      await apiFetch('/auth/delete-account', { method:'DELETE' }, auth.token);
      logout();
    } catch (e) { setDeleteMsg(e.message); setDeleteErr(true); }
  }

  return (
    <div>
      <h2 style={{ fontSize:'1.1rem', fontWeight:800, marginBottom:'1.25rem' }}>Mi perfil</h2>

      {/* Info de cuenta */}
      <div className="card" style={{ marginBottom:'0.75rem', display:'flex', gap:'0.75rem', alignItems:'center' }}>
        <div style={{ width:44, height:44, borderRadius:'50%', background:'var(--brand-light)', border:'2px solid var(--brand)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
          <span style={{ fontWeight:800, fontSize:'1.1rem', color:'var(--brand)' }}>
            {(displayName[0] || '?').toUpperCase()}
          </span>
        </div>
        <div>
          <div style={{ fontWeight:700 }}>{displayName}</div>
          <div style={{ fontSize:'0.8rem', color:'var(--gray-600)' }}>
            @{user?.username} · {ROLE_LABELS[user?.role] || user?.role}
          </div>
        </div>
      </div>

      {/* Datos personales */}
      <Collapsible title="Datos personales" defaultOpen>
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

      {/* Cambiar contraseña */}
      <Collapsible title="Cambiar contraseña">
        <div style={{ display:'flex', flexDirection:'column', gap:'0.55rem', marginBottom:'0.65rem' }}>
          <label>Contraseña actual<input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} /></label>
          <label>Nueva contraseña<input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} /></label>
          <label>Confirmar contraseña<input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} /></label>
        </div>
        <button className="btn-primary btn-sm" onClick={changePassword}>Cambiar contraseña</button>
        <Flash text={pwdMsg} isError={pwdErr} />
      </Collapsible>

      {/* Cerrar sesión */}
      <div className="card" style={{ marginBottom:'0.75rem' }}>
        <button className="btn-sm" onClick={logout}>Cerrar sesión</button>
      </div>

      {/* Eliminar cuenta */}
      <Collapsible title="Zona de peligro">
        <p style={{ fontSize:'0.85rem', color:'var(--gray-600)', marginBottom:'0.75rem' }}>
          Eliminar tu cuenta es permanente. No podrás recuperarla.
        </p>
        <button className="btn-danger btn-sm" onClick={deleteAccount}>Eliminar cuenta</button>
        <Flash text={deleteMsg} isError={deleteErr} />
      </Collapsible>
    </div>
  );
}

const ROLE_LABELS = { customer:'Cliente', restaurant:'Restaurante', driver:'Conductor', admin:'Administrador' };
