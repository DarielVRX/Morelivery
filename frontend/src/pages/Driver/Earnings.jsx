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

  // Calcular totales
  const totalDeliveryFee = orders.reduce((s, o) => s + (o.delivery_fee_cents || 0), 0);
  const totalTips        = orders.reduce((s, o) => s + (o.tip_cents          || 0), 0);
  const totalEarnings    = totalDeliveryFee + totalTips;

  if (loading) return <div style={{ padding:'2rem', textAlign:'center', color:'var(--gray-400)' }}>Cargando…</div>;

  return (
    <div>
      <h2 style={{ fontSize:'1.1rem', fontWeight:800, marginBottom:'1rem' }}>Ganancias</h2>

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
        <div className="card" style={{ textAlign:'center', padding:'0.75rem' }}>
          <div style={{ fontSize:'0.72rem', color:'var(--gray-500)', marginBottom:'0.2rem', fontWeight:600 }}>Tarifas de envío</div>
          <div style={{ fontWeight:700 }}>{fmt(totalDeliveryFee)}</div>
        </div>
        <div className="card" style={{ textAlign:'center', padding:'0.75rem' }}>
          <div style={{ fontSize:'0.72rem', color:'var(--gray-500)', marginBottom:'0.2rem', fontWeight:600 }}>Agradecimientos</div>
          <div style={{ fontWeight:700, color:'var(--success)' }}>{fmt(totalTips)}</div>
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
              const envio = o.delivery_fee_cents || 0;
              const tip   = o.tip_cents          || 0;
              const total = envio + tip;
              return (
                <li key={o.id} className="card" style={{ marginBottom:'0.5rem', padding:'0.7rem 0.875rem' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'0.2rem' }}>
                    <span style={{ fontWeight:700, fontSize:'0.9rem' }}>{o.restaurant_name}</span>
                    <span style={{ fontWeight:800, color:'var(--success)' }}>{fmt(total)}</span>
                  </div>
                  <div style={{ fontSize:'0.78rem', color:'var(--gray-500)' }}>
                    {fmtDate(o.created_at)}
                    {envio > 0 && <span> · Envío: {fmt(envio)}</span>}
                    {tip   > 0 && <span style={{ color:'var(--success)' }}> · Agradecimiento: +{fmt(tip)}</span>}
                  </div>
                  {/* Subtotal a pagar a la tienda */}
                  <div style={{ fontSize:'0.78rem', color:'var(--gray-400)', marginTop:'0.15rem' }}>
                    Cobrar a tienda: {fmt(o.total_cents || 0)}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
