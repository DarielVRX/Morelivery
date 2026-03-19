// components/OfferPanel.jsx — panel de oferta entrante (minimizable)
import OfferCountdown from './OfferCountdown';
import { fmt } from '../utils/format';

export default function OfferPanel({
  offer,
  minimized,
  loading,
  consecutiveTimeouts,
  onAccept,
  onReject,
  onToggleMinimize,
  onExpired,
}) {
  if (!offer) return null;

  const earn = (offer.delivery_fee_cents || 0)
    + Math.round((offer.service_fee_cents || 0) * 0.5)
    + (offer.tip_cents || 0)
    || offer.driverEarning || 0;

  const bagOverflow = offer.bagOverflowPct ?? 0;
  const showBagWarning = bagOverflow > 100;

  return (
    <div style={{ position:'absolute', bottom:0, left:0, right:0, zIndex:30,
      pointerEvents: minimized ? 'none' : 'auto' }}>
      <div className="dh-offer-panel" style={{
        transform:  minimized ? 'translateY(100%)' : 'translateY(0)',
        transition: 'transform 0.22s ease',
      }}>
        <button onClick={onToggleMinimize}
          style={{ position:'absolute', top:-43, left:'50%', transform:'translateX(-50%)',
            width:74, height:15, background:'#f3e8ed', color:'var(--brand)',
            border:'1px solid #e8c8d4', borderRadius:'6px 6px 0 0',
            padding:0, cursor:'pointer', fontSize:'0.62rem', fontWeight:700,
            boxShadow:'0 -2px 6px rgba(0,0,0,0.06)', zIndex:31,
            whiteSpace:'nowrap', display:'flex', alignItems:'center',
            gap:3, justifyContent:'center', pointerEvents:'auto' }}
          aria-label={minimized ? 'Expandir oferta' : 'Minimizar oferta'}>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <polyline points={minimized ? '6 15 12 9 18 15' : '18 9 12 15 6 9'} />
          </svg>
          Oferta
        </button>

        <div style={{ background:'var(--bg-card)', borderTop:'1px solid var(--border)',
          boxShadow:'0 -4px 20px rgba(0,0,0,0.14)', overflow:'hidden', pointerEvents:'auto' }}>
          <div style={{ padding:'0.6rem 1rem 0.75rem', overflowY:'auto' }}>

            <div style={{ fontSize:'0.82rem', color:'var(--text-primary)', marginBottom:'0.3rem' }}>
              {(offer.restaurant_name || offer.restaurantAddress) && (
                <div style={{ marginBottom:'0.1rem' }}>
                  <span style={{ color:'var(--text-tertiary)', fontSize:'0.72rem' }}>Tienda: </span>
                  <strong>{offer.restaurant_name || offer.restaurantAddress}</strong>
                </div>
              )}
              {(offer.restaurant_address || offer.restaurantAddress) && (
                <div style={{ marginBottom:'0.1rem' }}>
                  <span style={{ color:'var(--text-tertiary)', fontSize:'0.72rem' }}>Dir. tienda: </span>
                  <strong>{offer.restaurant_address || offer.restaurantAddress}</strong>
                </div>
              )}
              {(offer.customer_address || offer.customerAddress || offer.delivery_address) && (
                <div style={{ marginBottom:'0.1rem' }}>
                  <span style={{ color:'var(--text-tertiary)', fontSize:'0.72rem' }}>Entrega: </span>
                  <strong>{offer.customer_address || offer.customerAddress || offer.delivery_address}</strong>
                </div>
              )}
            </div>

            {earn > 0 && (
              <div style={{ fontSize:'0.9rem', fontWeight:800, color:'var(--success)', marginBottom:'0.35rem' }}>
                Tu ganancia: {fmt(earn)}
              </div>
            )}

            {showBagWarning && (
              <div style={{
                background:'var(--warn-bg)', border:'1.5px solid var(--warn-border)',
                borderRadius:8, padding:'0.5rem 0.75rem',
                marginBottom:'0.4rem', display:'flex', alignItems:'flex-start', gap:'0.5rem',
              }}>
                <span style={{ fontSize:'1.2rem', lineHeight:1 }}>🎒</span>
                <div style={{ fontSize:'0.78rem', color:'var(--warn)', lineHeight:1.4 }}>
                  <strong>Mochila al {bagOverflow}%</strong> — con este pedido tu capacidad
                  se excede en algún punto de la ruta. Puedes aceptarlo igual.
                </div>
              </div>
            )}

            <OfferCountdown
              key={offer.id}
              secondsLeft={offer.seconds_left ?? offer.secondsLeft ?? 60}
              onExpired={onExpired}
            />

            <div style={{ display:'flex', gap:'0.5rem', marginTop:'0.5rem' }}>
              <button className="btn-primary"
                style={{ flex:1, padding:'0.65rem 0', fontSize:'0.95rem', fontWeight:700, borderRadius:10 }}
                disabled={loading} onClick={onAccept}>
                {loading ? 'Aceptando…' : '✓ Aceptar'}
              </button>
              <button
                style={{ flex:1, padding:'0.65rem 0', fontSize:'0.95rem', fontWeight:700, borderRadius:10,
                  background:'var(--bg-raised)', color:'var(--text-primary)',
                  border:'1px solid var(--border)', cursor:'pointer' }}
                disabled={loading} onClick={onReject}>
                ✕ Rechazar
              </button>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
