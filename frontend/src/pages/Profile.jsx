import { useCallback, useRef, useState } from 'react';
import { apiFetch } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

function useFlash(duration=5000) {
  const [msgs, setMsgs] = useState({});
  const timers = useRef({});
  const flash = useCallback((text,isError=false,id='__g__')=>{
    setMsgs(p=>({...p,[id]:{text,isError}}));
    clearTimeout(timers.current[id]);
    timers.current[id]=setTimeout(()=>setMsgs(p=>{const n={...p};delete n[id];return n;}),duration);
  },[duration]);
  return [msgs,flash];
}
function FlashMsg({msg}) {
  if (!msg) return null;
  return <p style={{color:msg.isError?'#c00':'#080',margin:'0.25rem 0',fontSize:'0.875rem'}}>{msg.text}</p>;
}

export default function ProfilePage() {
  const { auth, patchUser } = useAuth();
  const user = auth.user;
  const [displayName, setDisplayName] = useState(user?.display_name || user?.username || '');
  const [address, setAddress] = useState(user?.address && user.address !== 'address-pending' ? user.address : '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [flash, flashMsg] = useFlash();

  async function saveProfile() {
    if (!displayName.trim()) return flashMsg('El nombre no puede estar vacío', true, 'name');
    try {
      const body = { displayName: displayName.trim() };
      if (['customer','restaurant'].includes(user.role) && address.trim()) {
        body.address = address.trim();
      }
      const data = await apiFetch('/auth/profile', { method: 'PATCH', body: JSON.stringify(body) }, auth.token);
      patchUser({
        display_name: data.profile.displayName || displayName.trim(),
        address: data.profile.address || address.trim()
      });
      flashMsg('✅ Perfil actualizado', false, 'name');
    } catch(e) { flashMsg(e.message, true, 'name'); }
  }

  async function changePassword() {
    if (!newPassword) return flashMsg('Ingresa la nueva contraseña', true, 'pwd');
    if (newPassword !== confirmPassword) return flashMsg('Las contraseñas no coinciden', true, 'pwd');
    if (newPassword.length < 6) return flashMsg('Mínimo 6 caracteres', true, 'pwd');
    try {
      await apiFetch('/auth/password', { method: 'PATCH', body: JSON.stringify({ currentPassword, newPassword }) }, auth.token);
      flashMsg('✅ Contraseña actualizada', false, 'pwd');
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    } catch(e) { flashMsg(e.message, true, 'pwd'); }
  }

  return (
    <section className="role-panel">
      <h2>Mi perfil</h2>

      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
        <p><strong>Usuario:</strong> {user?.username}</p>
        <p><strong>Rol:</strong> {user?.role}</p>
      </div>

      {/* Datos personales */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
        <h3 style={{ marginTop: 0 }}>Datos personales</h3>
        <label style={{ display: 'block', marginBottom: '0.4rem' }}>
          Nombre para mostrar
          <input
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder="Ej: Juan García"
            style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: '0.25rem' }}
          />
        </label>
        {['customer','restaurant'].includes(user?.role) && (
          <label style={{ display: 'block', marginBottom: '0.4rem' }}>
            Dirección
            <input
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="Ej: Av. Revolución 1234, Col. Centro"
              style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: '0.25rem' }}
            />
          </label>
        )}
        <button onClick={saveProfile}>Guardar cambios</button>
        <FlashMsg msg={flash['name']} />
      </div>

      {/* Cambiar contraseña */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '1rem' }}>
        <h3 style={{ marginTop: 0 }}>Cambiar contraseña</h3>
        <label style={{ display: 'block', marginBottom: '0.4rem' }}>
          Contraseña actual
          <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)}
            style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: '0.25rem' }} />
        </label>
        <label style={{ display: 'block', marginBottom: '0.4rem' }}>
          Nueva contraseña
          <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
            style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: '0.25rem' }} />
        </label>
        <label style={{ display: 'block', marginBottom: '0.4rem' }}>
          Confirmar contraseña
          <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
            style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: '0.25rem' }} />
        </label>
        <button onClick={changePassword}>Cambiar contraseña</button>
        <FlashMsg msg={flash['pwd']} />
      </div>
    </section>
  );
}
