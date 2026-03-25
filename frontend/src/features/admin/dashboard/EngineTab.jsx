// frontend/src/features/admin/dashboard/tabs/EngineTab.jsx
import { useState } from 'react';
import { Th, Td } from '../shared';

export default function EngineTab({ params, onSave, onReload, loading, msg, actionLoading }) {
  const [editing, setEditing] = useState({});
  const [savingKey, setSavingKey] = useState('');

  const handleSave = async (key, value) => {
    setSavingKey(key);
    await onSave(key, value);
    setSavingKey('');
    setEditing(prev => { const n = { ...prev }; delete n[key]; return n; });
  };

  if (!params.length) return <div style={{ padding: '2rem 0', color: 'var(--text-tertiary)' }}>Cargando parámetros…</div>;

  return (
    <div>
    <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
    <div>
    <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>⚙️ Parámetros del motor de asignación</div>
    <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '0.1rem' }}>
    Los cambios se aplican en el siguiente tick (~60s). Los valores por defecto están en gris.
    </div>
    </div>
    <button onClick={onReload} style={{ padding: '0.35rem 0.75rem', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: '0.78rem', background: 'var(--bg-card)' }}>
    ↻ Recargar
    </button>
    </div>

    {msg && (
      <div style={{
        padding: '0.45rem 0.75rem',
        borderRadius: 6,
        marginBottom: '0.75rem',
        fontSize: '0.82rem',
        background: msg.startsWith('✓') ? 'var(--success-bg)' : 'var(--danger-bg)',
             border: `1px solid ${msg.startsWith('✓') ? 'var(--success-border)' : 'var(--danger-border)'}`,
             color: msg.startsWith('✓') ? '#15803d' : '#dc2626',
      }}>{msg}</div>
    )}

    <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
    <thead>
    <tr><Th>Parámetro</Th><Th>Descripción</Th><Th>Valor actual</Th><Th>Default</Th><Th>Acción</Th></tr>
    </thead>
    <tbody>
    {params.map(p => {
      const isEditing = editing[p.key] !== undefined;
      const isModified = p.value !== p.default;
      return (
        <tr key={p.key} style={{ background: isModified ? 'rgba(217,119,6,0.1)' : undefined }}>
        <Td><code style={{ fontSize: '0.75rem', background: 'var(--bg-sunken)', padding: '0.1rem 0.35rem', borderRadius: 4 }}>{p.key}</code></Td>
        <Td style={{ maxWidth: 280, color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{p.description || '—'}</Td>
        <Td>
        {isEditing ? (
          <input
          type="number" step="any"
          value={editing[p.key]}
          onChange={e => setEditing(prev => ({ ...prev, [p.key]: e.target.value }))}
          style={{ width: 90, padding: '0.2rem 0.4rem', border: '1px solid #60a5fa', borderRadius: 4, fontSize: '0.82rem' }}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(p.key, editing[p.key]); if (e.key === 'Escape') setEditing(prev => { const n = { ...prev }; delete n[p.key]; return n; }); }}
          autoFocus
          />
        ) : (
          <span style={{ fontWeight: isModified ? 700 : 400, color: isModified ? 'var(--warn)' : 'var(--text-primary)', fontSize: '0.85rem' }}>{p.value}</span>
        )}
        </Td>
        <Td style={{ color: 'var(--text-tertiary)', fontSize: '0.82rem' }}>{p.default ?? '—'}</Td>
        <Td>
        {isEditing ? (
          <div style={{ display: 'flex', gap: '0.3rem' }}>
          <button disabled={savingKey === p.key} onClick={() => handleSave(p.key, editing[p.key])}
          style={{ padding: '0.2rem 0.55rem', background: 'var(--success)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.75rem', opacity: savingKey === p.key ? 0.6 : 1 }}>
          {savingKey === p.key ? '…' : 'Guardar'}
          </button>
          <button onClick={() => setEditing(prev => { const n = { ...prev }; delete n[p.key]; return n; })}
          style={{ padding: '0.2rem 0.55rem', background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', fontSize: '0.75rem' }}>
          Cancelar
          </button>
          </div>
        ) : (
          <button onClick={() => setEditing(prev => ({ ...prev, [p.key]: String(p.value) }))}
          style={{ padding: '0.2rem 0.55rem', background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', fontSize: '0.75rem' }}>
          Editar
          </button>
        )}
        </Td>
        </tr>
      );
    })}
    </tbody>
    </table>
    </div>

    {/* Panel de penalizaciones de drivers */}
    {/* Este panel puede venir de liveData, pero si no, se puede omitir o pasar como prop */}
    </div>
  );
}
