// frontend/src/features/admin/dashboard/tabs/NotesTab.jsx
import { fmtDate, Th, Td, Badge } from '../shared';

export default function NotesTab({ notes }) {
  return (
    <div>
    <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '1rem' }}>
    Notas de cancelación y liberación ({notes.length})
    </div>
    {notes.length === 0
      ? <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>Sin notas registradas</p>
      : (
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
        <thead>
        <tr><Th>Pedido</Th><Th>Estado</Th><Th>Tienda</Th><Th>Driver</Th><Th>Nota driver</Th><Th>Nota tienda</Th><Th>Fecha</Th></tr>
        </thead>
        <tbody>
        {notes.map(n => (
          <tr key={n.id}>
          <Td><code style={{ fontSize: '0.72rem' }}>{n.id?.slice(0,8)}</code></Td>
          <Td><Badge status={n.status} /></Td>
          <Td>{n.restaurant_name}</Td>
          <Td>{n.driver_name || '—'}</Td>
          <Td style={{ maxWidth: 200 }}>
          {n.driver_note
            ? <span style={{ fontSize: '0.78rem', color: 'var(--text-primary)' }}>{n.driver_note}</span>
            : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
            </Td>
            <Td style={{ maxWidth: 200 }}>
            {n.restaurant_note
              ? <span style={{ fontSize: '0.78rem', color: 'var(--text-primary)' }}>{n.restaurant_note}</span>
              : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
              </Td>
              <Td>{new Date(n.updated_at).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}</Td>
              </tr>
        ))}
        </tbody>
        </table>
        </div>
      )
    }
    </div>
  );
}
