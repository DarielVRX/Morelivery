// components/FeeBreakdown.jsx
import { fmt } from '../utils/format';

export default function FeeBreakdown({ order }) {
  const sub    = order.total_cents        || 0;
  const svc    = order.service_fee_cents  || 0;
  const delFee = order.delivery_fee_cents || 0;
  const tip    = order.tip_cents          || 0;
  const isCash = (order.payment_method || 'cash') === 'cash';
  const earn   = delFee + Math.round(svc * 0.5) + tip;
  const total  = sub + svc + delFee + tip;

  if (!svc && !delFee) return null;

  return (
    <div style={{ fontSize:'0.78rem', color:'var(--gray-500)',
      borderTop:'1px solid var(--gray-100)', paddingTop:'0.35rem', marginTop:'0.35rem' }}>
      {isCash && (
        <>
          <div style={{ display:'flex', justifyContent:'space-between', color:'var(--gray-700)' }}>
            <span>A pagar a tienda</span><span>{fmt(sub)}</span>
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', fontWeight:700,
            color:'var(--brand)', marginBottom:'0.15rem' }}>
            <span>Cobrar a cliente</span><span>{fmt(total)}</span>
          </div>
        </>
      )}
      <div style={{ display:'flex', justifyContent:'space-between', fontWeight:700,
        color:'var(--success)', marginTop:'0.1rem' }}>
        <span>Tu ganancia</span><span>{fmt(earn)}</span>
      </div>
      {tip > 0 && (
        <div style={{ fontSize:'0.72rem', color:'var(--success)', textAlign:'right' }}>
          incl. agradecimiento {fmt(tip)}
        </div>
      )}
    </div>
  );
}
