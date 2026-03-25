// frontend/src/features/admin/dashboard/tabs/UsersTab.jsx
import { useState } from 'react';
import { fmtDate, Th, Td, Badge } from '../shared';

export default function UsersTab({ users, onToggleUser, onAdminCreate, actionLoading }) {
  const [newUser, setNewUser] = useState({ username: '', password: '', displayName: '' });

  const handleCreate = () => {
    if (!newUser.username || !newUser.password) return;
    onAdminCreate(newUser);
    setNewUser({ username: '', password: '', displayName: '' });
  };

  return (
    <div>
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '1rem', marginBottom: '1.25rem', background: 'var(--bg-raised)' }}>
    <div style={{ fontWeight: 700, marginBottom: '0.75rem', fontSize: '0.875rem' }}>Crear cuenta admin</div>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '0.5rem', alignItems: 'end' }}>
    <label style={{ fontSize: '0.8rem' }}>
    Usuario
    <input type="text" value={newUser.username} onChange={e => setNewUser(p => ({ ...p, username: e.target.value }))}
    style={{ display: 'block', width: '100%', marginTop: 2, padding: '0.4rem 0.6rem', border: '1px solid var(--border)', borderRadius: 6, fontSize: '0.85rem' }} />
    </label>
    <label style={{ fontSize: '0.8rem' }}>
    Nombre
    <input type="text" value={newUser.displayName} onChange={e => setNewUser(p => ({ ...p, displayName: e.target.value }))}
    style={{ display: 'block', width: '100%', marginTop: 2, padding: '0.4rem 0.6rem', border: '1px solid var(--border)', borderRadius: 6, fontSize: '0.85rem' }} />
    </label>
    <label style={{ fontSize: '0.8rem' }}>
    Contraseña
    <input type="password" value={newUser.password} onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))}
    style={{ display: 'block', width: '100%', marginTop: 2, padding: '0.4rem 0.6rem', border: '1px solid var(--border)', borderRadius: 6, fontSize: '0.85rem' }} />
    </label>
    <button onClick={handleCreate} style={{ padding: '0.45rem 1rem', background: 'var(--brand)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem' }}>
    Crear
    </button>
    </div>
    </div>

    <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
    <thead>
    <tr><Th>Usuario</Th><Th>Nombre</Th><Th>Rol</Th><Th>Estado</Th><Th>Creado</Th><Th>Acción</Th></tr>
    </thead>
    <tbody>
    {users.map(u => (
      <tr key={u.id}>
      <Td><span style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{u.username}</span></Td>
      <Td>{u.full_name}</Td>
      <Td><Badge status={u.role} label={u.role} /></Td>
      <Td><Badge status={u.status === 'active' ? 'ready' : 'cancelled'} label={u.status} /></Td>
      <Td>{fmtDate(u.created_at)}</Td>
      <Td>
      <button
      disabled={actionLoading === u.id || u.role === 'admin'}
      onClick={() => onToggleUser(u)}
      style={{
        padding: '0.2rem 0.55rem',
        fontSize: '0.72rem',
        fontWeight: 700,
        borderRadius: 6,
        cursor: 'pointer',
        border: `1px solid ${u.status === 'active' ? 'var(--danger-border)' : 'var(--success-border)'}`,
                     background: u.status === 'active' ? 'var(--danger-bg)' : 'var(--success-bg)',
                     color: u.status === 'active' ? '#dc2626' : '#16a34a',
                     opacity: u.role === 'admin' ? 0.4 : 1,
      }}>
      {actionLoading === u.id ? '…' : u.status === 'active' ? 'Suspender' : 'Activar'}
      </button>
      </Td>
      </tr>
    ))}
    </tbody>
    </table>
    </div>
    </div>
  );
}
