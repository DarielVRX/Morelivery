// frontend/src/components/OfferPanel.jsx
import { useEffect, useRef, useState } from 'react';
import { getDriverEarningCents } from '../features/driver/shared/orderUtils';
import OfferCountdown from './OfferCountdown';
import { fmt } from '../utils/format';
import { ensureMapLibreCSS, ensureMapLibreJS } from '../utils/mapLibre';
import { syncDriverRouteLayers } from '../features/driver/map/helpers';

// ── Modal de ruta de oferta ───────────────────────────────────────────────────
function OfferRouteModal({ offer, geometry, loading, onClose, onShowFull, showingFull }) {
  const containerRef = useRef(null);
  const mapRef       = useRef(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    ensureMapLibreCSS();
    ensureMapLibreJS().then((ml) => {
      if (!containerRef.current || mapRef.current) return;
      const center = offer.restaurantLng
        ? [Number(offer.restaurantLng), Number(offer.restaurantLat)]
        : [-101.19, 19.70];

      const map = new ml.Map({
        container: containerRef.current,
        style: 'https://tiles.openfreemap.org/styles/bright',
        center,
        zoom: 13,
        pitch: 0,
        attributionControl: false,
        dragRotate: false,
      });

      map.on('load', () => {
        // Marcador tienda
        if (offer.restaurantLat && offer.restaurantLng) {
          const el = document.createElement('div');
          el.style.cssText = 'width:28px;height:28px;border-radius:50%;background:#16a34a;display:grid;place-items:center;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.3);font-size:15px;';
          el.textContent = '🏪';
          new ml.Marker({ element: el })
            .setLngLat([Number(offer.restaurantLng), Number(offer.restaurantLat)])
            .addTo(map);
        }
        // Marcador cliente
        if (offer.customerLat && offer.customerLng) {
          const el = document.createElement('div');
          el.style.cssText = 'width:28px;height:28px;border-radius:50%;background:#f97316;display:grid;place-items:center;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.3);font-size:15px;';
          el.textContent = '📦';
          new ml.Marker({ element: el })
            .setLngLat([Number(offer.customerLng), Number(offer.customerLat)])
            .addTo(map);
        }

        // Dibujar ruta si ya está disponible
        if (geometry?.length) {
          syncDriverRouteLayers(map, geometry);
          // fitBounds
          const pts = geometry.map(p => [p.lng, p.lat]);
          if (pts.length >= 2) {
            try {
              const bounds = pts.reduce((b, p) => b.extend(p), new ml.LngLatBounds(pts[0], pts[0]));
              map.fitBounds(bounds, { padding: 40, maxZoom: 15, duration: 400 });
            } catch (_) {}
          }
        }
      });

      mapRef.current = map;
    });

    return () => {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Actualizar ruta si llega la geometría después de que el mapa carga
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !geometry?.length) return;
    if (map.isStyleLoaded()) {
      syncDriverRouteLayers(map, geometry);
    } else {
      map.once('load', () => syncDriverRouteLayers(map, geometry));
    }
  }, [geometry]);

  return (
    <div style={{
      position:'fixed', inset:0, zIndex:500, background:'rgba(0,0,0,0.6)',
      display:'flex', flexDirection:'column',
    }} onClick={onClose}>
      <div style={{
        flex:1, display:'flex', flexDirection:'column',
        margin:'2rem 1rem 1rem',
        background:'var(--bg-card)', borderRadius:16,
        overflow:'hidden', boxShadow:'0 20px 40px rgba(0,0,0,0.4)',
      }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding:'0.75rem 1rem', borderBottom:'1px solid var(--border)',
          display:'flex', alignItems:'center', gap:'0.5rem' }}>
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:700, fontSize:'0.9rem' }}>Ruta del pedido</div>
            <div style={{ fontSize:'0.72rem', color:'var(--text-secondary)' }}>
              {offer.restaurantName || 'Tienda'} → {offer.customerAddress || 'Cliente'}
            </div>
          </div>
          <button
            onClick={onShowFull}
            style={{
              padding:'0.3rem 0.7rem', borderRadius:8, fontSize:'0.75rem', fontWeight:700,
              border:'1.5px solid var(--brand)', background: showingFull ? 'var(--brand)' : 'transparent',
              color: showingFull ? '#fff' : 'var(--brand)', cursor:'pointer',
            }}>
            {showingFull ? 'Ruta oferta' : 'Ruta total'}
          </button>
          <button onClick={onClose}
            style={{ background:'none', border:'none', cursor:'pointer', fontSize:'1.2rem',
              color:'var(--text-tertiary)', padding:'0.2rem' }}>✕</button>
        </div>

        {/* Mapa */}
        <div style={{ flex:1, position:'relative' }}>
          {loading && (
            <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center',
              justifyContent:'center', background:'rgba(255,255,255,0.7)', zIndex:10,
              fontSize:'0.85rem', color:'var(--text-secondary)' }}>
              Calculando ruta…
            </div>
          )}
          <div ref={containerRef} style={{ height:'100%', width:'100%' }} />
        </div>
      </div>
    </div>
  );
}

// ── Panel principal ───────────────────────────────────────────────────────────
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
  // Ruta de oferta
  offerRouteGeometry,
  offerRouteLoading,
  onRequestOfferRoute,
  onShowFullOfferRoute,
  showFullOfferRoute,
}) {
  const [showRouteModal, setShowRouteModal] = useState(false);

  // Pedir ruta automáticamente al mostrar la oferta
  useEffect(() => {
    if (offer?.restaurantLat && offer?.customerLat) {
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
      {showRouteModal && (
        <OfferRouteModal
          offer={offer}
          geometry={offerRouteGeometry}
          loading={offerRouteLoading}
          onClose={() => setShowRouteModal(false)}
          onShowFull={() => onShowFullOfferRoute?.()}
          showingFull={showFullOfferRoute}
        />
      )}

      <div style={{ position:'absolute', bottom:0, left:0, right:0, zIndex:30,
        pointerEvents: minimized ? 'none' : 'auto' }}>
        <div className="dh-offer-panel" style={{
          transform: minimized ? 'translateY(100%)' : 'translateY(0)',
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

          <div ref={panelRef} style={{ background:'var(--bg-card)', borderTop:'1px solid var(--border)',
            boxShadow:'0 -4px 20px rgba(0,0,0,0.14)', overflow:'hidden', pointerEvents:'auto' }}>
            <div style={{ padding:'0.6rem 1rem 0.75rem', overflowY:'auto' }}>

              {/* Indicador confirmación restaurante */}
              {!restaurantConfirmed && (
                <div style={{ background:'#fffbeb', border:'1px solid #fde68a',
                  borderRadius:8, padding:'0.35rem 0.65rem', marginBottom:'0.4rem',
                  fontSize:'0.75rem', color:'#92400e', fontWeight:600,
                  display:'flex', alignItems:'center', gap:6 }}>
                  ⏳ La tienda aún no confirma — puedes aceptar, pero la ruta se activará cuando confirme
                </div>
              )}

              {/* Info */}
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
                    background:'#eff6ff', color:'#1d4ed8',
                    border:'1.5px solid #3b82f6', cursor:'pointer',
                    display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:2 }}
                  onClick={() => setShowRouteModal(true)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <polygon points="3 11 22 2 13 21 11 13 3 11"/>
                  </svg>
                  <span style={{ fontSize:'0.65rem' }}>Ver ruta</span>
                </button>
              </div>

            </div>
          </div>
        </div>
      </div>
    </>
  );
}
