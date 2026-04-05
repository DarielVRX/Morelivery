// frontend/src/components/OfferPanel.jsx
import { useEffect } from 'react';
import { getDriverEarningCents } from '../features/driver/shared/orderUtils';
import OfferCountdown from './OfferCountdown';
import { fmt } from '../utils/format';



import { useEffect, useRef, useState } from 'react';
import { getDriverEarningCents } from '../features/driver/shared/orderUtils';
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
  panelRef,
  handMode = 'left',
  offerRouteGeometry,
  offerRouteLoading,
  onRequestOfferRoute,
  onShowFullOfferRoute,
  showFullOfferRoute,
}) {
  // Swipe vertical para ocultar/mostrar
  const swipeStartRef = useRef(null);

  const handleTouchStart = (e) => {
    swipeStartRef.current = { y: e.touches[0].clientY, x: e.touches[0].clientX };
  };
  const handleTouchEnd = (e) => {
    if (!swipeStartRef.current) return;
    const dy = swipeStartRef.current.y - e.changedTouches[0].clientY;
    const dx = Math.abs(swipeStartRef.current.x - e.changedTouches[0].clientX);
    swipeStartRef.current = null;
    if (Math.abs(dy) < 25 || dx > Math.abs(dy) * 0.7) return;
    if (dy < 0 && !minimized) onToggleMinimize(); // swipe down → ocultar
    if (dy > 0 && minimized)  onToggleMinimize(); // swipe up → mostrar
  };

  // Área de activación cuando está minimizado — margen generoso arriba del tab
  const handleMinimizedAreaTouchStart = (e) => {
    swipeStartRef.current = { y: e.touches[0].clientY, x: e.touches[0].clientX };
  };

  useEffect(() => {
    const rLat = offer?.restaurantLat ?? offer?.restaurant_lat;
    const cLat = offer?.customerLat   ?? offer?.customer_lat;
    if (rLat && cLat) {
      onRequestOfferRoute?.(offer);
    }
  }, [offer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!offer) return null;

  const earn          = getDriverEarningCents(offer) || offer.driverEarning || 0;
  const bagOverflow   = offer.bagOverflowPct ?? 0;
  const showBagWarn   = bagOverflow > 100;
  const restaurantConfirmed = offer.restaurantConfirmed !== false;
  const isRight = handMode === 'right';

  return (
    <>
      <div style={{ position:'absolute', bottom:0, left:0, right:0, zIndex:30,
        pointerEvents: minimized ? 'none' : 'auto' }}>
        <div
          className="dh-offer-panel"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          style={{
            transform: minimized ? 'translateY(100%)' : 'translateY(0)',
            transition: 'transform 0.22s ease',
            touchAction: 'pan-x',
          }}>
          {/* Tab de toggle — siempre con pointerEvents */}
          <button onClick={onToggleMinimize}
            onTouchStart={handleMinimizedAreaTouchStart}
            onTouchEnd={handleTouchEnd}
            style={{ position:'absolute', top:-43, left:'50%', transform:'translateX(-50%)',
              width:74, height:44, // más alto cuando minimizado para margen generoso
              background:'#f3e8ed', color:'var(--brand)',
              border:'1px solid #e8c8d4', borderRadius:'6px 6px 0 0',
              padding:0, cursor:'pointer', fontSize:'0.62rem', fontWeight:700,
              boxShadow:'0 -2px 6px rgba(0,0,0,0.06)', zIndex:31,
              whiteSpace:'nowrap', display:'flex', alignItems:'flex-end', justifyContent:'center',
              paddingBottom:6,
              gap:3, pointerEvents:'auto' }}
            aria-label={minimized ? 'Expandir oferta' : 'Minimizar oferta'}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <polyline points={minimized ? '6 15 12 9 18 15' : '18 9 12 15 6 9'} />
            </svg>
            Oferta
          </button>

          <div ref={panelRef} style={{ background:'var(--bg-card)', borderTop:'1px solid var(--border)',
            boxShadow:'0 -4px 20px rgba(0,0,0,0.14)', overflow:'hidden', pointerEvents:'auto' }}>
            <div style={{ padding:'0.6rem 1rem 0.75rem', overflowY:'auto' }}>

              {!restaurantConfirmed && (
                <div style={{ background:'#fffbeb', border:'1px solid #fde68a',
                  borderRadius:8, padding:'0.35rem 0.65rem', marginBottom:'0.4rem',
                  fontSize:'0.75rem', color:'#92400e', fontWeight:600,
                  display:'flex', alignItems:'center', gap:6 }}>
                  ⏳ La tienda aún no confirma — puedes aceptar, pero la ruta se activará cuando confirme
                </div>
              )}

              <div style={{ fontSize:'0.82rem', color:'var(--text-primary)', marginBottom:'0.3rem' }}>
                {(offer.restaurant_name || offer.restaurantAddress) && (
                  <div style={{ marginBottom:'0.1rem' }}>
                    <span style={{ color:'var(--text-tertiary)', fontSize:'0.72rem' }}>Tienda: </span>
                    <strong>{offer.restaurant_name || offer.restaurantAddress}</strong>
                  </div>
                )}
                {(offer.restaurant_address || offer.restaurantAddress) && (
                  <div style={{ marginBottom:'0.1rem' }}>
                    <span style={{ color:'var(--text-tertiary)', fontSize:'0.72rem' }}>Dir: </span>
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

              {showBagWarn && (
                <div style={{
                  background:'var(--warn-bg)', border:'1.5px solid var(--warn-border)',
                  borderRadius:8, padding:'0.5rem 0.75rem', marginBottom:'0.4rem',
                  display:'flex', alignItems:'flex-start', gap:'0.5rem',
                }}>
                  <span style={{ fontSize:'1.2rem', lineHeight:1 }}>🎒</span>
                  <div style={{ fontSize:'0.78rem', color:'var(--warn)', lineHeight:1.4 }}>
                    <strong>Mochila al {bagOverflow}%</strong> — con este pedido tu capacidad
                    se excede en algún punto de la ruta.
                  </div>
                </div>
              )}

              <OfferCountdown
                key={offer.id}
                secondsLeft={offer.seconds_left ?? offer.secondsLeft ?? 60}
                totalSeconds={offer.seconds_left ?? offer.secondsLeft ?? 60}
                onExpired={onExpired}
              />

              {/* Botones */}
              <div style={{
                display:'flex', gap:'0.5rem', marginTop:'0.5rem',
                flexDirection: isRight ? 'row-reverse' : 'row',
              }}>
                <button className="btn-primary"
                  style={{ flex:2, padding:'0.7rem 0', fontSize:'0.95rem', fontWeight:700,
                    borderRadius:10, minHeight:52 }}
                  disabled={loading} onClick={onAccept}>
                  {loading ? 'Aceptando…' : '✓ Aceptar'}
                </button>
                <button
                  style={{ flex:1, padding:'0.7rem 0', fontSize:'0.88rem', fontWeight:700,
                    borderRadius:10, minHeight:52,
                    background:'var(--bg-raised)', color:'var(--text-primary)',
                    border:'1px solid var(--border)', cursor:'pointer' }}
                  disabled={loading} onClick={onReject}>
                  ✕
                </button>
                <button
                  style={{ flex:1, padding:'0.7rem 0', fontSize:'0.78rem', fontWeight:700,
                    borderRadius:10, minHeight:52,
                    background: offerRouteGeometry?.length ? '#eff6ff' : 'var(--bg-raised)',
                    color: offerRouteGeometry?.length ? '#1d4ed8' : 'var(--text-tertiary)',
                    border: offerRouteGeometry?.length ? '1.5px solid #3b82f6' : '1px solid var(--border)',
                    cursor:'pointer',
                    display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:2 }}
                  onClick={() => onRequestOfferRoute?.(offer)}>
                  {offerRouteLoading
                    ? <span style={{ fontSize:'0.65rem' }}>…</span>
                    : <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                          stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <polygon points="3 11 22 2 13 21 11 13 3 11"/>
                        </svg>
                        <span style={{ fontSize:'0.65rem' }}>Ver ruta</span>
                      </>
                  }
                </button>
              </div>

            </div>
          </div>
        </div>
      </div>
    </>
  );
}
