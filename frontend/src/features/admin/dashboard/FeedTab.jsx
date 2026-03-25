// frontend/src/features/admin/dashboard/tabs/FeedTab.jsx

export default function FeedTab({ offers, logs, onClear }) {
  const all = [...offers.map(e => ({ ...e, _t: 'offer' })), ...logs.map(e => ({ ...e, _t: 'log' }))].sort((a, b) => b.ts - a.ts);

  return (
    <div>
    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
    <button onClick={onClear} style={{ padding: '0.3rem 0.65rem', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: '0.78rem', background: 'var(--bg-card)' }}>
    Limpiar feed
    </button>
    </div>
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', maxHeight: 500, overflowY: 'auto' }}>
    {all.map((e, i) => (
      <div key={i} style={{
        padding: '0.4rem 0.875rem',
        borderBottom: '1px solid var(--border-light)',
                        fontSize: '0.78rem',
                        background: e._t === 'offer' ? 'rgba(37,99,235,0.1)' : 'rgba(22,163,74,0.1)',
                        display: 'flex',
                        gap: '0.75rem'
      }}>
      <span style={{ color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>
      {new Date(e.ts).toLocaleTimeString('es-MX')}
      </span>
      <span style={{ color: e._t === 'offer' ? '#60a5fa' : '#4ade80', fontWeight: 700 }}>
      {e._t === 'offer' ? '📤 OFERTA' : '📦 PEDIDO'}
      </span>
      <span style={{ color: 'var(--text-primary)' }}>{e.orderId}</span>
      <span style={{ color: 'var(--text-secondary)' }}>{e.extra}</span>
      </div>
    ))}
    {all.length === 0 && (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>
      Esperando eventos SSE…
      </div>
    )}
    </div>
    </div>
  );
}
