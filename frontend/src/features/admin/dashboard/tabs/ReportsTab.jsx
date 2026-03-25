// frontend/src/features/admin/dashboard/tabs/ReportsTab.jsx
import { useState } from 'react';

export default function ReportsTab({ reports, reportsDone, onReview, loadingId }) {
  const [reviewLoading, setReviewLoading] = useState('');

  const handleReview = async (id) => {
    setReviewLoading(id);
    await onReview(id);
    setReviewLoading('');
  };

  return (
    <div>
    <div style={{ marginBottom: '1rem' }}>
    <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.5rem' }}>
    Pendientes de revisión ({reports.length})
    </div>
    {reports.length === 0
      ? <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>Sin reportes pendientes 🎉</p>
      : reports.map(r => (
        <div key={r.id} className="card" style={{ marginBottom: '0.5rem', borderLeft: '3px solid var(--danger)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.4rem' }}>
        <div>
        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--danger)', background: 'var(--danger-bg)', border: '1px solid var(--danger-border)', borderRadius: 6, padding: '1px 6px', marginRight: '0.5rem' }}>
        {r.reporter_role}
        </span>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
        {r.reporter_name} · {r.restaurant_name}
        </span>
        </div>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', flexShrink: 0 }}>
        {new Date(r.created_at).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}
        </span>
        </div>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', marginBottom: '0.5rem', lineHeight: 1.5 }}>
        {r.text}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
        Pedido: <code style={{ fontSize: '0.72rem' }}>{r.order_id?.slice(0,8)}</code> · Estado: {r.order_status}
        </span>
        <button className="btn-sm btn-primary"
        style={{ marginLeft: 'auto', fontSize: '0.75rem' }}
        disabled={reviewLoading === r.id}
        onClick={() => handleReview(r.id)}>
        {reviewLoading === r.id ? '…' : '✓ Revisado'}
        </button>
        </div>
        </div>
      ))
    }
    </div>

    {reportsDone.length > 0 && (
      <details>
      <summary style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)', cursor: 'pointer', marginBottom: '0.5rem' }}>
      Revisados ({reportsDone.length})
      </summary>
      {reportsDone.map(r => (
        <div key={r.id} className="card" style={{ marginBottom: '0.4rem', opacity: 0.6, borderLeft: '3px solid var(--success)' }}>
        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
        <span style={{ fontWeight: 700 }}>{r.reporter_role}</span> · {r.reporter_name} · {r.restaurant_name}
        </div>
        <div style={{ fontSize: '0.82rem', color: 'var(--text-primary)' }}>{r.text}</div>
        </div>
      ))}
      </details>
    )}
    </div>
  );
}
