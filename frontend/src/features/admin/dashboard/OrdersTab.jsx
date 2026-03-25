// frontend/src/features/admin/dashboard/tabs/OrdersTab.jsx
import { fmt, fmtDate, Th, Td, Badge } from '../shared';

export default function OrdersTab({ orders, statusFilter, onStatusFilterChange, onForceStatus, actionLoading }) {
  const statuses = ['', 'created', 'pending_driver', 'assigned', 'accepted', 'preparing', 'ready', 'on_the_way', 'delivered', 'cancelled'];

  return (
    <div>
    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
    {statuses.map(s => (
      <button key={s} onClick={() => onStatusFilterChange(s)}
      style={{
        padding: '0.3rem 0.65rem',
        border: `1px solid ${statusFilter === s ? 'var(--brand)' : '#e5e7eb'}`,
                        borderRadius: 8,
                        cursor: 'pointer',
                        fontSize: '0.78rem',
                        background: statusFilter === s ? 'var(--brand-light)' : '#fff',
                        color: statusFilter === s ? 'var(--brand)' : 'var(--gray-600)',
                        fontWeight: statusFilter === s ? 700 : 400
      }}>
      {s || 'Todos'}
      </button>
    ))}
    </div>
    <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
    <thead>
    <tr>
    <Th>ID</Th><Th>Estado</Th><Th>Tienda</Th><Th>Cliente</Th>
    <Th>Driver</Th><Th>Total</Th><Th>Creado</Th>
    <Th>Pend.</Th><Th>Rech.</Th><Th>Exp.</Th><Th>Acción</Th>
    </tr>
    </thead>
    <tbody>
    {orders.map(o => (
      <tr key={o.id}>
      <Td><span style={{ fontFamily: 'monospace', fontSize: '0.72rem' }}>{o.id.slice(0,8)}</span></Td>
      <Td><Badge status={o.status} /></Td>
      <Td>{o.restaurant_name}</Td>
      <Td>{o.customer_name?.split('_')[0]}</Td>
      <Td>{o.driver_name?.split('_')[0] || '—'}</Td>
      <Td>{fmt(o.total_cents)}</Td>
      <Td>{fmtDate(o.created_at)}</Td>
      <Td>{o.pending_offers > 0 ? <span style={{ color: 'var(--warn)', fontWeight: 700 }}>⏳{o.pending_offers}</span> : 0}</Td>
      <Td>{o.rejected_offers > 0 ? <span style={{ color: 'var(--danger)' }}>{o.rejected_offers}</span> : 0}</Td>
      <Td>{o.expired_offers > 0 ? <span style={{ color: 'var(--text-tertiary)' }}>{o.expired_offers}</span> : 0}</Td>
      <Td>
      <button
      disabled={actionLoading === o.id || ['delivered', 'cancelled'].includes(o.status)}
      onClick={() => onForceStatus(o.id, o.status)}
      style={{
        padding: '0.2rem 0.5rem',
        fontSize: '0.72rem',
        fontWeight: 700,
        borderRadius: 6,
        cursor: 'pointer',
        border: '1px solid var(--warn-border)',
                      background: 'var(--warn-bg)',
                      color: 'var(--warn)',
                      opacity: ['delivered', 'cancelled'].includes(o.status) ? 0.35 : 1,
      }}>
      {actionLoading === o.id ? '…' : '✏️ Estado'}
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
