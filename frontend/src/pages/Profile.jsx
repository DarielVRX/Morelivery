import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

const ROLE_LABELS = {
  customer: 'Cliente', restaurant: 'Restaurante', driver: 'Conductor', admin: 'Administrador'
};

function useFlash(duration = 4000) {
  const [msgs, setMsgs]   = useState({});
  const timers = useRef({});
  const flash  = useCallback((text, isError = false, id = '__g__') => {
    setMsgs(p => ({ ...p, [id]: { text, isError } }));
    clearTimeout(timers.current[id]);
    timers.current[id] = setTimeout(() =>
      setMsgs(p => { const n = { ...p }; delete n[id]; return n; }), duration
    );
  }, [duration]);
  return [msgs, flash];
}

function Flash({ msg }) {
  if (!msg) return null;
  return <p className={`flash ${msg.isError ? 'flash-error' : 'flash-ok'}`}>{msg.text}</p>;
}

export default function ProfilePage() {
  const { auth, patchUser, logout } = useAuth();
  const navigate  = useNavigate();
  const user = auth.user;

  const [displayName, setDisplayName]       = useState(user?.display_name || user?.username || '');
  const [address, setAddress]               = useState(
    user?.address && user.address !== 'address-pending' ? user.address : ''
  );
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword]         = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [deleteMsg, setDeleteMsg]             = useState('');
  const [flash, flashMsg] = useFlash();

  async function saveProfile() {
    if (!displayName.trim()) return flashMsg('El nombre no puede estar vacío', true, 'name');
    try {
      // Enviamos siempre, aunque no cambie — el backend hace COLLATE case-sensitive
      const body = { displayName: displayName.trim() };
      if (['customer','restaurant'].includes(user.role)) {
        body.address = address.trim() || undefined;
      }
      const data = await apiFetch('/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify(body)
      }, auth.token);
      patchUser({
        display_name: data.profile.displayName ?? displayName.trim(),
        address:      data.profile.address     ?? address.trim(),
      });
      flashMsg('Perfil actualizado correctamente', false, 'name');
    } catch (e) { flashMsg(e.message, true, 'name'); }
  }

  async function changePassword() {
    if (!newPassword)                       return flashMsg('Ingresa la nueva contraseña', true, 'pwd');
    if (newPassword !== confirmPassword)    return flashMsg('Las contraseñas no coinciden', true, 'pwd');
    if (newPassword.length < 6)             return flashMsg('Mínimo 6 caracteres', true, 'pwd');
    try {
      await apiFetch('/auth/password', {
        method: 'PATCH',
        body: JSON.stringify({ currentPassword, newPassword })
      }, auth.token);
      flashMsg('Contraseña actualizada', false, 'pwd');
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    } catch (e) { flashMsg(e.message, true, 'pwd'); }
  }

  async function deleteAccount() {
    if (!window.confirm('¿Seguro que deseas eliminar tu cuenta? Esta acción no se puede deshacer.')) return;
    setDeleteMsg('');
    try {
      await apiFetch('/auth/account', { method: 'DELETE' }, auth.token);
      logout();
      navigate('/login');
    } catch (e) { setDeleteMsg(e.message); }
  }

  return (
    <div>
      <h2 style={{ fontSize:'1.15rem', fontWeight:800, marginBottom:'1.25rem' }}>Mi perfil</h2>

      {/* Info de cuenta */}
      <div className="card" style={{ marginBottom:'0.75rem' }}>
        <div style={{ display:'flex', gap:'1rem', flexWrap:'wrap' }}>
          <div>
            <div className="section-title">Usuario</div>
            <div style={{ fontWeight:600 }}>{user?.username}</div>
          </div>
          <div>
            <div className="section-title">Tipo de cuenta</div>
            <span className="role-pill">{ROLE_LABELS[user?.role] || user?.role}</span>
          </div>
        </div>
      </div>

      {/* Datos personales */}
      <div className="card">
        <h3 style={{ fontSize:'0.9rem', fontWeight:700, marginBottom:'0.75rem' }}>Datos personales</h3>

        <div style={{ display:'flex', flexDirection:'column', gap:'0.65rem', marginBottom:'0.75rem' }}>
          <label>
            Nombre para mostrar
            <input
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Ej: Juan García"
            />
          </label>

          {['customer','restaurant'].includes(user?.role) && (
            <label>
              Dirección
              <input
                value={address}
                onChange={e => setAddress(e.target.value)}
                placeholder="Ej: Av. Revolución 1234, Col. Centro"
              />
            </label>
          )}
        </div>

        <button className="btn-primary" onClick={saveProfile}>Guardar cambios</button>
        <Flash msg={flash['name']} />
      </div>

      {/* Cambiar contraseña */}
      <div className="card">
        <h3 style={{ fontSize:'0.9rem', fontWeight:700, marginBottom:'0.75rem' }}>Cambiar contraseña</h3>

        <div style={{ display:'flex', flexDirection:'column', gap:'0.65rem', marginBottom:'0.75rem' }}>
          <label>Contraseña actual
            <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} placeholder="Contraseña actual" />
          </label>
          <label>Nueva contraseña
            <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Mínimo 6 caracteres" />
          </label>
          <label>Confirmar contraseña
            <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Repite la nueva contraseña" />
          </label>
        </div>

        <button onClick={changePassword}>Cambiar contraseña</button>
        <Flash msg={flash['pwd']} />
      </div>

      {/* Sesión */}
      <div className="card">
        <h3 style={{ fontSize:'0.9rem', fontWeight:700, marginBottom:'0.75rem' }}>Sesión</h3>
        <button
          onClick={() => { logout(); navigate('/login'); }}
          style={{ marginBottom:'0.5rem' }}
        >
          Cerrar sesión
        </button>
      </div>

      {/* Eliminar cuenta */}
      <div className="card">
        <h3 style={{ fontSize:'0.9rem', fontWeight:700, marginBottom:'0.4rem', color:'var(--danger)' }}>
          Zona de peligro
        </h3>
        <p style={{ fontSize:'0.82rem', color:'var(--gray-600)', marginBottom:'0.65rem' }}>
          Al eliminar tu cuenta se borrarán todos tus datos. Esta acción no se puede deshacer.
        </p>
        {deleteMsg && <p className="flash flash-error">{deleteMsg}</p>}
        <button className="btn-danger" onClick={deleteAccount}>Eliminar cuenta</button>
      </div>
    </div>
  );
}
