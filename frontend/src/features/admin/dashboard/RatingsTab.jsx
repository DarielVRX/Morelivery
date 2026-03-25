// frontend/src/features/admin/dashboard/tabs/RatingsTab.jsx
import { Th, Td } from '../shared';

export default function RatingsTab({ ratings }) {
  const star = (n) => n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '—';
  const starColor = (n) => !n ? 'var(--text-tertiary)' : n >= 4 ? 'var(--success)' : n >= 3 ? 'var(--warn)' : 'var(--danger)';

  return (
    <div>
    <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '1rem' }}>
    Calificaciones ({ratings.length})
    </div>
    {ratings.length === 0
      ? <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>Sin calificaciones aún</p>
      : (
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 780 }}>
        <thead>
        <tr>
        <Th>Pedido</Th><Th>Tienda</Th><Th>Cliente</Th><Th>Driver</Th>
        <Th>Cli→Tienda</Th><Th>Cli→Driver</Th>
        <Th>Tienda→Driver</Th><Th>Driver→Tienda</Th>
        <Th>Comentario</Th><Th>Fecha</Th>
        </tr>
        </thead>
        <tbody>
        {ratings.map(r => (
          <tr key={r.id}>
          <Td><code style={{ fontSize: '0.72rem' }}>{r.order_id?.slice(0,8)}</code></Td>
          <Td style={{ fontSize: '0.78rem' }}>{r.restaurant_name}</Td>
          <Td style={{ fontSize: '0.78rem' }}>{r.customer_name?.split('@')[0]}</Td>
          <Td style={{ fontSize: '0.78rem' }}>{r.driver_name?.split('@')[0] || '—'}</Td>
          <Td><span style={{ color: starColor(r.restaurant_stars), fontSize: '0.75rem', letterSpacing: -1 }}>{star(r.restaurant_stars > 0 ? r.restaurant_stars : null)}</span></Td>
          <Td><span style={{ color: starColor(r.driver_stars), fontSize: '0.75rem', letterSpacing: -1 }}>{star(r.driver_stars)}</span></Td>
          <Td><span style={{ color: starColor(r.restaurant_rates_driver), fontSize: '0.75rem', letterSpacing: -1 }}>{star(r.restaurant_rates_driver)}</span></Td>
          <Td><span style={{ color: starColor(r.driver_rates_restaurant), fontSize: '0.75rem', letterSpacing: -1 }}>{star(r.driver_rates_restaurant)}</span></Td>
          <Td style={{ maxWidth: 160, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          {r.comment || r.driver_comment || r.restaurant_comment || '—'}
          </Td>
          <Td>{new Date(r.created_at).toLocaleDateString('es-MX')}</Td>
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
