import { useEffect, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';

function fmt(cents) { return `$${((cents ?? 0) / 100).toFixed(2)}`; }
function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('es-MX', { day:'2-digit', month:'short' });
}

export default function DriverEarnings() {
  const { auth } = useAuth();
  const [orders, setOrders]   = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const d = await apiFetch('/orders/my', {}, auth.token);
        const delivered = (d.orders || []).filter(o => o.status === 'delivered');
        setOrders(delivered);
      } catch (_) {}
      finally { setLoading(false); }
    }
    load();
  }, [auth.token]);

  const totalEarnings = orders.reduce((s, o) => {
    const del = o.delivery_fee_cents || 0;
    const svc = o.service_fee_cents  || 0;
    const tip = o.tip_cents          || 0;
    return s + del + Math.round(svc * 0.5) + tip;
  }, 0);

  if (loading) return <div style={{ padding:'2rem', textAlign:'center', color:'var(--gray-400)' }}>Cargando…</div>;

  return (
    <div>
      {/* ── Encabezado ─────────────────────────────────────────────────── */}
      <div style={{
        margin: '0 -1rem 1rem',
        padding: '0.75rem 1rem 0.65rem',
        background: 'linear-gradient(135deg,#16a34a 0%,#14532d 100%)',
        color: '#fff',
      }}>
        <div style={{ fontWeight: 800, fontSize: '1.05rem', letterSpacing: '-0.01em' }}>💰 Ganancias</div>
        <div style={{ fontSize: '0.75rem', opacity: 0.85, marginTop: '0.1rem' }}>Historial de entregas y comisiones</div>
      </div>

      {/* Resumen */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.6rem', marginBottom:'1.25rem' }}>
        <div className="card" style={{ textAlign:'center', padding:'0.875rem' }}>
          <div style={{ fontSize:'0.72rem', color:'var(--gray-500)', marginBottom:'0.25rem', fontWeight:600, textTransform:'uppercase' }}>
            Entregas
          </div>
          <div style={{ fontSize:'1.5rem', fontWeight:800, color:'var(--brand)' }}>{orders.length}</div>
        </div>
        <div className="card" style={{ textAlign:'center', padding:'0.875rem' }}>
          <div style={{ fontSize:'0.72rem', color:'var(--gray-500)', marginBottom:'0.25rem', fontWeight:600, textTransform:'uppercase' }}>
            Total ganado
          </div>
          <div style={{ fontSize:'1.25rem', fontWeight:800, color:'var(--success)' }}>{fmt(totalEarnings)}</div>
        </div>
      </div>

      {/* Historial por pedido */}
      {orders.length === 0 ? (
        <p style={{ color:'var(--gray-600)', fontSize:'0.9rem' }}>Sin entregas completadas aún.</p>
      ) : (
        <div>
          <h3 style={{ fontSize:'0.875rem', fontWeight:700, color:'var(--gray-600)', marginBottom:'0.6rem' }}>
            Por entrega
          </h3>
          <ul style={{ listStyle:'none', padding:0 }}>
            {orders.map(o => {
              const del_fee  = o.delivery_fee_cents || 0;
              const svc      = o.service_fee_cents  || 0;
              const tip      = o.tip_cents           || 0;
              const earning  = del_fee + Math.round(svc * 0.5) + tip;
              const isCash   = (o.payment_method || 'cash') === 'cash';
              const grandTotal = (o.total_cents||0) + svc + del_fee + tip;
              return (
                <li key={o.id} className="card" style={{ marginBottom:'0.5rem', padding:'0.7rem 0.875rem' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'0.2rem' }}>
                    <span style={{ fontWeight:700, fontSize:'0.9rem' }}>{o.restaurant_name}</span>
                    <span style={{ fontWeight:800, color:'var(--success)' }}>{fmt(earning)}</span>
                  </div>
                  <div style={{ fontSize:'0.78rem', color:'var(--gray-500)' }}>
                    {fmtDate(o.created_at)}
                    {' · '}{{cash:'Efectivo',card:'Tarjeta',spei:'SPEI'}[o.payment_method]||'Efectivo'}
                    {tip > 0 && <span style={{ color:'var(--success)' }}> · Agradecimiento: +{fmt(tip)}</span>}
                  </div>
                  {isCash && (
                    <div style={{ fontSize:'0.78rem', color:'var(--gray-500)', marginTop:'0.15rem' }}>
                      <span>Cobrar: <strong style={{ color:'var(--brand)' }}>{fmt(grandTotal)}</strong></span>
                      <span style={{ marginLeft:'0.5rem' }}>· Pagar tienda: <strong>{fmt(o.total_cents||0)}</strong></span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
