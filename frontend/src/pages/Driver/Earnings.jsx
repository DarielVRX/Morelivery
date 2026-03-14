import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import PullToRefresh    from '../../components/PullToRefresh';

function fmt(cents) { return `$${((cents ?? 0) / 100).toFixed(2)}`; }
function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('es-MX', { day:'2-digit', month:'short', year:'numeric' });
}

const PERIODS = [
  { label: '7 días',  days: 7 },
  { label: '30 días', days: 30 },
  { label: '90 días', days: 90 },
];

export default function DriverEarnings() {
  const { auth } = useAuth();
  const [orders,   setOrders]   = useState([]);
  const [summary,  setSummary]  = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [days,     setDays]     = useState(30);
  const [offset,   setOffset]   = useState(0);
  const [hasMore,  setHasMore]  = useState(false);
  const LIMIT = 50;

  const load = useCallback(async (d, off, append = false) => {
    setLoading(true);
    try {
      const data = await apiFetch(
        `/drivers/earnings?days=${d}&limit=${LIMIT + 1}&offset=${off}`,
        {}, auth.token
      );
      const rows = data.orders || [];
      const more = rows.length > LIMIT;
      setHasMore(more);
      const page = more ? rows.slice(0, LIMIT) : rows;
      setOrders(prev => append ? [...prev, ...page] : page);
      if (!append) setSummary(data.summary || null);
    } catch (_) {}
    finally { setLoading(false); }
  }, [auth.token]);

  useEffect(() => { setOffset(0); load(days, 0, false); }, [days, load]);

  function loadMore() {
    const next = offset + LIMIT;
    setOffset(next);
    load(days, next, true);
  }

  return (
    <PullToRefresh onRefresh={order.loadData}>
    <div style={{ backgroundColor:'#f0fdf4', minHeight:'100vh', padding:'1rem' }}>
      <div style={{ margin:'-1rem -1rem 1.25rem', padding:'0.75rem 1rem 0.65rem',
        background:'linear-gradient(135deg,var(--brand) 0%,#c0546a 100%)', color:'#fff' }}>
        <div style={{ fontWeight:800, fontSize:'1.05rem', letterSpacing:'-0.01em' }}>💰 Ganancias</div>
        <div style={{ fontSize:'0.75rem', opacity:0.85, marginTop:'0.1rem' }}>Historial de entregas y comisiones</div>
      </div>

      <div style={{ display:'flex', gap:'0.5rem', marginBottom:'1rem' }}>
        {PERIODS.map(p => (
          <button key={p.days} onClick={() => setDays(p.days)}
            style={{
              padding:'0.3rem 0.7rem', borderRadius:20, fontSize:'0.8rem', fontWeight:600,
              border:`1.5px solid ${days===p.days ? '#16a34a' : '#e5e7eb'}`,
              background: days===p.days ? '#dcfce7' : '#fff',
              color: days===p.days ? '#15803d' : 'var(--gray-600)',
              cursor:'pointer',
            }}>
            {p.label}
          </button>
        ))}
      </div>

      {summary && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'0.5rem', marginBottom:'1.25rem' }}>
          {[
            { label:'Entregas', value: summary.deliveries, color:'var(--brand)' },
            { label:'Total ganado', value: fmt(summary.total_earnings), color:'var(--success)' },
            { label:'Propinas', value: fmt(summary.total_tips), color:'#f59e0b' },
          ].map(({ label, value, color }) => (
            <div key={label} className="card" style={{ textAlign:'center', padding:'0.75rem 0.5rem' }}>
              <div style={{ fontSize:'0.68rem', color:'var(--gray-500)', marginBottom:'0.2rem', fontWeight:600, textTransform:'uppercase' }}>{label}</div>
              <div style={{ fontSize:'1.1rem', fontWeight:800, color }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {loading && orders.length === 0 ? (
        <div style={{ padding:'2rem', textAlign:'center', color:'var(--gray-400)' }}>Cargando…</div>
      ) : orders.length === 0 ? (
        <p style={{ color:'var(--gray-600)', fontSize:'0.9rem' }}>Sin entregas en este período.</p>
      ) : (
        <div>
          <h3 style={{ fontSize:'0.8rem', fontWeight:700, color:'var(--gray-500)', marginBottom:'0.6rem', textTransform:'uppercase', letterSpacing:'0.4px' }}>
            Por entrega
          </h3>
          <ul style={{ listStyle:'none', padding:0 }}>
            {orders.map(o => {
              const del_fee = o.delivery_fee_cents || 0;
              const svc     = o.service_fee_cents  || 0;
              const tip     = (o.tip_cents || 0) + (o.delivered_tip_cents || 0);
              const earning = del_fee + Math.round(svc * 0.5) + tip;
              const isCash  = (o.payment_method || 'cash') === 'cash';
              const grandTotal = (o.total_cents || 0) + svc + del_fee + tip;
              return (
                <li key={o.id} className="card" style={{ marginBottom:'0.5rem', padding:'0.7rem 0.875rem' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'0.2rem' }}>
                    <span style={{ fontWeight:700, fontSize:'0.875rem' }}>{o.restaurant_name}</span>
                    <span style={{ fontWeight:800, color:'var(--success)' }}>{fmt(earning)}</span>
                  </div>
                  <div style={{ fontSize:'0.77rem', color:'var(--gray-500)' }}>
                    {fmtDate(o.delivered_at || o.created_at)}
                    {' · '}{{ cash:'Efectivo', card:'Tarjeta', spei:'SPEI' }[o.payment_method] || 'Efectivo'}
                    {tip > 0 && <span style={{ color:'#f59e0b' }}> · Propina +{fmt(tip)}</span>}
                  </div>
                  {isCash && (
                    <div style={{ fontSize:'0.77rem', color:'var(--gray-500)', marginTop:'0.15rem' }}>
                      Cobrar: <strong style={{ color:'var(--brand)' }}>{fmt(grandTotal)}</strong>
                      <span style={{ marginLeft:'0.5rem' }}>· Pagar tienda: <strong>{fmt(o.total_cents || 0)}</strong></span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {hasMore && (
            <button onClick={loadMore} disabled={loading}
              style={{ width:'100%', padding:'0.6rem', background:'#fff', border:'1px solid #e5e7eb',
                borderRadius:10, cursor:'pointer', fontSize:'0.85rem', color:'var(--gray-600)', marginTop:'0.25rem' }}>
              {loading ? 'Cargando…' : 'Cargar más'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
