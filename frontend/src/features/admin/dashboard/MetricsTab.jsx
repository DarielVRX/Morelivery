// frontend/src/features/admin/dashboard/tabs/MetricsTab.jsx
import { fmt } from '../shared';

export default function MetricsTab({ metrics, metricDays, onMetricDaysChange }) {
  if (!metrics) return <div>No hay datos</div>;

  return (
    <div>
    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
    {[7, 14, 30, 90].map(d => (
      <button key={d} onClick={() => onMetricDaysChange(d)}
      style={{
        padding: '0.3rem 0.65rem',
        border: `1px solid ${metricDays === d ? 'var(--brand)' : '#e5e7eb'}`,
                               borderRadius: 8,
                               cursor: 'pointer',
                               fontSize: '0.78rem',
                               fontWeight: metricDays === d ? 700 : 400,
                               background: metricDays === d ? 'var(--brand-light)' : '#fff',
                               color: metricDays === d ? 'var(--brand)' : 'var(--gray-600)'
      }}>
      {d}d
      </button>
    ))}
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.6rem', marginBottom: '1.25rem' }}>
    {[
      { label: 'Pedidos', value: metrics.summary?.total_orders, color: '#60a5fa' },
      { label: 'Entregados', value: metrics.summary?.delivered, color: '#16a34a' },
      { label: 'Cancelados', value: metrics.summary?.cancelled, color: '#dc2626' },
      { label: 'Activos', value: metrics.summary?.active, color: '#f59e0b' },
      { label: 'Ticket prom.', value: fmt(metrics.summary?.avg_ticket_cents), color: '#8b5cf6' },
          { label: 'Ingresos', value: fmt(metrics.summary?.revenue_cents), color: '#0d9488' },
    ].map(({ label, value, color }) => (
      <div key={label} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '0.6rem 1rem' }}>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{label}</div>
      <div style={{ fontSize: '1.3rem', fontWeight: 800, color }}>{value ?? '—'}</div>
      </div>
    ))}
    </div>

    {metrics.timings && (
      <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1rem' }}>
      <div style={{ fontWeight: 700, fontSize: '0.875rem', marginBottom: '0.5rem' }}>⏱ Tiempos promedio</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.5rem', fontSize: '0.8rem' }}>
      {[
        ['Asignación', metrics.timings.avg_min_to_accept],
        ['Preparación', metrics.timings.avg_min_to_prepare],
        ['Listo para retiro', metrics.timings.avg_min_to_ready],
        ['Retiro', metrics.timings.avg_min_to_pickup],
        ['Entrega', metrics.timings.avg_min_to_deliver],
        ['Total', metrics.timings.avg_total_min],
      ].map(([k, v]) => (
        <div key={k}><span style={{ color: 'var(--text-secondary)' }}>{k}:</span> <strong>{v != null ? `${v}m` : '—'}</strong></div>
      ))}
      </div>
      </div>
    )}
    </div>
  );
}
