import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useRealtimeOrders } from '../../hooks/useRealtimeOrders';
import { useDriverLocation } from '../../hooks/useDriverLocation';
import OfferCountdown from '../../components/OfferCountdown';

function fmt(cents) { return `$${((cents ?? 0) / 100).toFixed(2)}`; }

const STATUS_LABELS = {
  created:'Recibido', assigned:'Asignado', accepted:'Aceptado',
  preparing:'En preparación', ready:'Listo para retiro',
  on_the_way:'En camino', delivered:'Entregado',
  cancelled:'Cancelado', pending_driver:'Buscando conductor',
};

// Desglose para Conductor
function FeeBreakdown({ order }) {
  const sub           = order.total_cents          || 0;
  const svc           = order.service_fee_cents    || 0;
  const del_fee       = order.delivery_fee_cents   || 0;
  const tip           = order.tip_cents            || 0;
  const isCash        = (order.payment_method || 'cash') === 'cash';
  const driverEarning = del_fee + Math.round(svc * 0.5) + tip;
  const grandTotal    = sub + svc + del_fee + tip;
  if (!svc && !del_fee) return null;
  return (
    <div style={{ fontSize:'0.78rem', color:'var(--gray-500)', borderTop:'1px solid var(--gray-100)', paddingTop:'0.35rem', marginTop:'0.35rem' }}>
      {isCash && (
        <>
          <div style={{ display:'flex', justifyContent:'space-between', color:'var(--gray-700)' }}>
            <span>A pagar a tienda</span><span>{fmt(sub)}</span>
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', fontWeight:700, color:'var(--brand)', marginBottom:'0.15rem' }}>
            <span>Cobrar a cliente</span><span>{fmt(grandTotal)}</span>
          </div>
        </>
      )}
      <div style={{ display:'flex', justifyContent:'space-between', fontWeight:700, color:'var(--success)', marginTop:'0.1rem' }}>
        <span>Tu ganancia</span><span>{fmt(driverEarning)}</span>
      </div>
      {tip > 0 && (
        <div style={{ fontSize:'0.72rem', color:'var(--success)', textAlign:'right' }}>incl. agradecimiento {fmt(tip)}</div>
      )}
    </div>
  );
}

function ensureLeafletCSS() {
  if (document.getElementById('leaflet-css')) return;

  const lnk = document.createElement('link');
  lnk.id = 'leaflet-css';
  lnk.rel = 'stylesheet';
  lnk.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';

  document.head.appendChild(lnk);
}

// Reverse geocoding con Nominatim (gratuito, sin API key)
async function reverseGeocode(lat, lng) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`,
      { headers: { 'Accept-Language': 'es' } }
    );
    if (!r.ok) return null;
    const d = await r.json();
    // Priorizar nombre de negocio/POI, luego dirección legible
    const addr = d.address || {};
    const poi  = addr.amenity || addr.shop || addr.office || addr.building || addr.tourism || null;
    const road = addr.road || addr.pedestrian || addr.footway || '';
    const num  = addr.house_number ? ` ${addr.house_number}` : '';
    const col  = addr.suburb || addr.neighbourhood || addr.city_district || '';
    if (poi) return `${poi}${road ? ` · ${road}${num}` : ''}`;
    if (road) return `${road}${num}${col ? `, ${col}` : ''}`;
    return d.display_name?.split(',').slice(0,2).join(', ') || null;
  } catch { return null; }
}

// Mapa ligero — instancia única destruida al desmontar
// customPin: { lat, lng } | null  — marcador manual del driver
// onCustomPin: (latlng | null) => void
// hasActiveOrder: boolean — si true, oculta el pin y deshabilita clicks
function DriverMap({ driverPos, customPin, onCustomPin, hasActiveOrder }) {
  const containerRef  = useRef(null);
  const mapRef        = useRef(null); // { map, driverMarker, customMarker }

  // Inicializar una vez cuando hay posición
  useEffect(() => {
    if (!containerRef.current || !driverPos) return;
    if (mapRef.current) return;

    ensureLeafletCSS();

    const t = setTimeout(() => {
      import('leaflet').then(L => {
        if (!containerRef.current || mapRef.current) return;

        delete L.Icon.Default.prototype._getIconUrl;
        L.Icon.Default.mergeOptions({
          iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
          iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
          shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
        });

        const map = L.map(containerRef.current, {
          zoomControl: false, attributionControl: false,
        }).setView([driverPos.lat, driverPos.lng], 15);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          keepBuffer: 1, updateWhenIdle: true,
        }).addTo(map);
        L.control.zoom({ position: 'bottomright' }).addTo(map);

        // Marcador GPS del driver (azul)
        const driverMarker = L.circleMarker([driverPos.lat, driverPos.lng], {
          radius: 9, fillColor: '#2563eb', fillOpacity: 1, color: '#fff', weight: 2,
        }).addTo(map);

        // Click en mapa → pin personalizado (solo sin pedido activo)
        map.on('click', (e) => {
          if (hasActiveOrder) return;
          onCustomPin?.({ lat: e.latlng.lat, lng: e.latlng.lng });
        });

        mapRef.current = { map, driverMarker, customMarker: null };
        setTimeout(() => map.invalidateSize(), 200);
      }).catch(() => {});
    }, 50);

    return () => clearTimeout(t);
  }, [Boolean(driverPos)]);

  // Destruir al desmontar
  useEffect(() => {
    return () => {
      if (mapRef.current?.map) {
        mapRef.current.map.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Actualizar posición GPS
  useEffect(() => {
    if (!mapRef.current || !driverPos) return;
    mapRef.current.driverMarker.setLatLng([driverPos.lat, driverPos.lng]);
    mapRef.current.map.panTo([driverPos.lat, driverPos.lng], { animate: true, duration: 0.5 });
  }, [driverPos?.lat, driverPos?.lng]);

  // Sincronizar hasActiveOrder en el listener del mapa
  useEffect(() => {
    if (!mapRef.current?.map) return;
    const map = mapRef.current.map;
    map.off('click');
    if (!hasActiveOrder) {
      map.on('click', (e) => onCustomPin?.({ lat: e.latlng.lat, lng: e.latlng.lng }));
    }
  }, [hasActiveOrder, onCustomPin]);

  // Agregar/quitar pin personalizado
  useEffect(() => {
    if (!mapRef.current) return;
    const { map } = mapRef.current;
    import('leaflet').then(L => {
      // Quitar pin anterior
      if (mapRef.current.customMarker) {
        mapRef.current.customMarker.remove();
        mapRef.current.customMarker = null;
      }
      // Agregar nuevo si existe y no hay pedido activo
      if (customPin && !hasActiveOrder) {
        const icon = L.divIcon({
          html: `<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;background:var(--brand);border:2px solid #fff;box-shadow:0 2px 6px #0004;transform:rotate(-45deg)"></div>`,
          iconSize: [22, 22], iconAnchor: [11, 22], className: ''
        });
        const cm = L.marker([customPin.lat, customPin.lng], { icon }).addTo(map);
        mapRef.current.customMarker = cm;
      }
    });
  }, [customPin?.lat, customPin?.lng, hasActiveOrder]);

  if (!driverPos) return (
    <div style={{ height:'100%', display:'flex', alignItems:'center', justifyContent:'center', background:'#f3f4f6' }}>
      <div style={{ textAlign:'center', color:'var(--gray-400)', fontSize:'0.85rem' }}>
        <div style={{ fontSize:'2rem', marginBottom:'0.5rem' }}>📍</div>
        Esperando señal GPS…
      </div>
    </div>
  );

  return <div ref={containerRef} style={{ height:'100%', width:'100%' }} />;
}

export default function DriverHome() {
  const { auth } = useAuth();
  const [activeOrder,   setActiveOrder]   = useState(null);
  const [availability,  setAvailability]  = useState(false);
  const [pendingOffer,  setPendingOffer]  = useState(null); // UNA sola oferta a la vez
  const [loadingOffer,  setLoadingOffer]  = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [releaseNote,   setReleaseNote]   = useState('');
  const [showRelease,   setShowRelease]   = useState(false);
  const [showOrderDetail, setShowOrderDetail] = useState(false);
  const [customPin,    setCustomPin]     = useState(null);   // { lat, lng }
  const [pinAddress,   setPinAddress]    = useState(null);   // string | null
  const [loadingPin,   setLoadingPin]    = useState(false);
  const [msg, setMsg] = useState('');
  const loadDataRef   = useRef(null);

  // GPS activo si disponible O tiene pedido activo
  const hasActiveOrder = Boolean(activeOrder && !['delivered','cancelled'].includes(activeOrder.status));

  // Limpiar pin personalizado cuando hay pedido activo
  useEffect(() => {
    if (hasActiveOrder) { setCustomPin(null); setPinAddress(null); }
  }, [hasActiveOrder]);

  // Reverse geocoding cuando cambia el pin
  useEffect(() => {
    if (!customPin) { setPinAddress(null); return; }
    setLoadingPin(true);
    reverseGeocode(customPin.lat, customPin.lng)
      .then(addr => setPinAddress(addr || `${customPin.lat.toFixed(5)}, ${customPin.lng.toFixed(5)}`))
      .finally(() => setLoadingPin(false));
  }, [customPin?.lat, customPin?.lng]);
  const { position: myPosition, error: gpsError } = useDriverLocation(auth.token, availability, hasActiveOrder);

  // Anunciar presencia al backend — solo al montar, no en cada loadData
  const announceListener = useCallback(async () => {
    if (!auth.token) return;
    try { await apiFetch('/drivers/listener', { method:'POST' }, auth.token); } catch (_) {}
  }, [auth.token]);

  const loadData = useCallback(async () => {
    if (!auth.token) return;
    try {
      const [od, off] = await Promise.all([
        apiFetch('/orders/my', {}, auth.token),
        apiFetch('/drivers/offers', {}, auth.token),
      ]);
      // Pedido más antiguo activo
      const active = (od.orders || [])
        .filter(o => !['delivered','cancelled'].includes(o.status))
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0] || null;
      setActiveOrder(active);
      // Una sola oferta a la vez
      const offers = off.offers || [];
      setPendingOffer(offers.length > 0 ? offers[0] : null);
    } catch (_) {}
  }, [auth.token]);

  useEffect(() => { loadDataRef.current = loadData; });
  useEffect(() => {
    setAvailability(Boolean(auth.user?.driver?.is_available));
    // Anunciar presencia y cargar datos al montar
    announceListener().then(() => loadData());
  }, [auth.token]);

  // SSE: recibir ofertas push sin esperar poll
  const handleNewOffer = useCallback((data) => {
    console.log(`[DriverHome] handleNewOffer orderId=${data.orderId} secondsLeft=${data.secondsLeft}`);
    setPendingOffer(prev => {
      if (prev) return prev; // Ya hay una oferta activa
      return { id: data.orderId, ...data, seconds_left: data.secondsLeft ?? 60 };
    });
    // Recargar para datos completos (items), pero sin llamar al listener de nuevo
    setTimeout(() => {
      apiFetch('/drivers/offers', {}, data._token || '').catch(() => {});
      loadDataRef.current?.();
    }, 400);
  }, []);

  useRealtimeOrders(
    auth.token,
    () => loadDataRef.current?.(),
    () => {},
    handleNewOffer,
  );

  async function toggleAvailability() {
    try {
      const r = await apiFetch('/drivers/availability', {
        method:'PATCH', body: JSON.stringify({ isAvailable: !availability })
      }, auth.token);
      setAvailability(r.profile.is_available);
    } catch (e) { setMsg(e.message); }
  }

  async function acceptOffer() {
    if (!pendingOffer) return;
    setLoadingOffer(true);
    try {
      await apiFetch(`/drivers/offers/${pendingOffer.id}/accept`, { method:'POST' }, auth.token);
      setPendingOffer(null);
      loadData();
    } catch (e) { setMsg(e.message); }
    finally { setLoadingOffer(false); }
  }

  async function rejectOffer() {
    if (!pendingOffer) return;
    setLoadingOffer(true);
    try {
      await apiFetch(`/drivers/offers/${pendingOffer.id}/reject`, { method:'POST' }, auth.token);
      setPendingOffer(null);
      loadData();
    } catch (e) { setMsg(e.message); }
    finally { setLoadingOffer(false); }
  }

  async function changeStatus(orderId, status) {
    setLoadingStatus(status);
    try {
      await apiFetch(`/orders/${orderId}/status`, { method:'PATCH', body: JSON.stringify({ status }) }, auth.token);
      loadData();
    } catch (e) { setMsg(e.message); }
    finally { setLoadingStatus(''); }
  }

  async function doRelease() {
    if (!activeOrder) return;
    try {
      await apiFetch(`/drivers/orders/${activeOrder.id}/release`, {
        method:'POST', body: JSON.stringify({ note: releaseNote })
      }, auth.token);
      setShowRelease(false); setReleaseNote(''); loadData();
    } catch (e) { setMsg(e.message); }
  }

  return (
    <div className="driver-map-root" style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>

      {/* ── Encabezado FIJO ─────────────────────────────────────────── */}
      <div style={{ flexShrink:0, background:'linear-gradient(135deg,var(--brand) 0%,#7c1d35 100%)', padding:'0.65rem 1rem', display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, zIndex:10 }}>
        <div>
          <div style={{ fontWeight:700, fontSize:'0.875rem', color:'#fff' }}>
            {availability ? '● Disponible' : '○ No disponible'}
          </div>
          {myPosition && <div style={{ fontSize:'0.7rem', color:'rgba(255,255,255,0.8)' }}>GPS · ±{myPosition.accuracy}m</div>}
          {gpsError   && <div style={{ fontSize:'0.7rem', color:'#ffb3b3', maxWidth:200 }}>{gpsError}</div>}
        </div>
        <button onClick={toggleAvailability} className={availability ? 'btn-primary btn-sm' : 'btn-sm'}>
          {availability ? 'Disponible' : 'No disponible'}
        </button>
      </div>

      {msg && (
        <div className="flash flash-error" style={{ flexShrink:0, borderRadius:0, margin:0, display:'flex', justifyContent:'space-between' }}>
          <span style={{ fontSize:'0.83rem' }}>{msg}</span>
          <button onClick={() => setMsg('')} style={{ border:'none', background:'none', cursor:'pointer', fontWeight:700 }}>✕</button>
        </div>
      )}

      {/* ── Mapa (ocupa el espacio restante) ───────────────────────── */}
      <div style={{ flex:1, minHeight:0, position:'relative', overflow:'hidden', zIndex:0 }}>
        <DriverMap
          driverPos={myPosition}
          customPin={customPin}
          onCustomPin={setCustomPin}
          hasActiveOrder={hasActiveOrder}
        />

        {/* Panel de pin personalizado */}
        {!hasActiveOrder && customPin && (
          <div style={{
            position:'absolute', bottom:16, left:'50%', transform:'translateX(-50%)',
            background:'#fff', borderRadius:10, padding:'0.5rem 0.875rem',
            boxShadow:'0 2px 12px #0003', maxWidth:'calc(100% - 2rem)', zIndex:10,
            display:'flex', alignItems:'center', gap:'0.5rem', minWidth:180,
          }}>
            <span style={{ fontSize:'1rem', flexShrink:0 }}>📍</span>
            <div style={{ flex:1, minWidth:0 }}>
              {loadingPin
                ? <span style={{ fontSize:'0.78rem', color:'var(--gray-400)' }}>Buscando dirección…</span>
                : <span style={{ fontSize:'0.78rem', color:'var(--gray-700)', fontWeight:600,
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', display:'block' }}>
                    {pinAddress}
                  </span>
              }
              <span style={{ fontSize:'0.7rem', color:'var(--gray-400)' }}>Toca de nuevo para mover</span>
            </div>
            <button
              onClick={() => { setCustomPin(null); setPinAddress(null); }}
              style={{ border:'none', background:'none', cursor:'pointer', color:'var(--gray-400)',
                fontSize:'1rem', lineHeight:1, padding:'0.15rem', flexShrink:0 }}>
              ✕
            </button>
          </div>
        )}

        {/* Hint inicial — solo si disponible y sin pin y sin oferta */}
        {!hasActiveOrder && !customPin && !pendingOffer && availability && myPosition && (
          <div style={{
            position:'absolute', bottom:16, left:'50%', transform:'translateX(-50%)',
            background:'#ffffffdd', borderRadius:20, padding:'0.4rem 1rem',
            fontSize:'0.78rem', color:'var(--gray-500)', boxShadow:'0 2px 8px #0002',
            whiteSpace:'nowrap', zIndex:5, pointerEvents:'none',
          }}>
            Toca el mapa para marcar tu ubicación
          </div>
        )}


      </div>

      {/* ── Oferta entrante (SOBRE el pedido activo) ────────────────── */}
      {pendingOffer && (
        <div style={{ flexShrink:0, background:'#fff', borderTop:'3px solid var(--brand)', padding:'0.75rem 1rem', boxShadow:'0 -4px 16px #0002', zIndex:20 }}>
          <div style={{ fontSize:'0.72rem', fontWeight:700, letterSpacing:'0.5px', textTransform:'uppercase', color:'var(--brand)', marginBottom:'0.4rem' }}>
            Nueva oferta
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'0.25rem' }}>
            <span style={{ fontWeight:700 }}>{pendingOffer.restaurant_name}</span>
            <span style={{ fontWeight:700 }}>{fmt(pendingOffer.total_cents)}</span>
          </div>
          <div style={{ fontSize:'0.8rem', color:'var(--gray-600)', marginBottom:'0.35rem' }}>
            {pendingOffer.restaurant_address && <div>Retiro: {pendingOffer.restaurant_address}</div>}
            {pendingOffer.customer_address   && <div>Entrega: {pendingOffer.customer_address}</div>}
          </div>
          {(pendingOffer.items||[]).length > 0 && (
            <ul style={{ fontSize:'0.78rem', margin:'0 0 0.35rem 1rem', color:'var(--gray-600)' }}>
              {pendingOffer.items.map(i => <li key={i.menuItemId}>{i.name} × {i.quantity}</li>)}
            </ul>
          )}
          <OfferCountdown
            key={pendingOffer.id}
            secondsLeft={pendingOffer.seconds_left ?? 60}
            onExpired={() => { setPendingOffer(null); loadData(); }}
          />
          <div style={{ display:'flex', gap:'0.5rem', marginTop:'0.5rem' }}>
            <button className="btn-primary btn-sm" style={{ flex:1 }} disabled={loadingOffer} onClick={acceptOffer}>
              {loadingOffer ? 'Aceptando…' : 'Aceptar'}
            </button>
            <button className="btn-sm" disabled={loadingOffer} onClick={rejectOffer}>Rechazar</button>
          </div>
        </div>
      )}

      {/* ── Pedido activo ────────────────────────────────────────────── */}
      {activeOrder && (
        <div style={{ flexShrink:0, background:'#fff', borderTop:'2px solid var(--success)', padding:'0.75rem 1rem', zIndex:10 }}>
          <div style={{ fontSize:'0.72rem', fontWeight:700, letterSpacing:'0.5px', textTransform:'uppercase', color:'var(--success)', marginBottom:'0.25rem' }}>
            Pedido en curso
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.25rem' }}>
            <span style={{ fontWeight:700, fontSize:'0.9rem' }}>{STATUS_LABELS[activeOrder.status]}</span>
            <button onClick={() => setShowOrderDetail(s => !s)}
              style={{ background:'none', border:'none', cursor:'pointer', fontSize:'0.78rem', color:'var(--brand)', fontWeight:600, padding:0 }}>
              {showOrderDetail ? 'Ocultar' : 'Ver detalle'}
            </button>
          </div>
          <div style={{ fontSize:'0.82rem', color:'var(--gray-600)', marginBottom:'0.3rem' }}>
            <strong>{activeOrder.restaurant_name}</strong> → {activeOrder.customer_address || activeOrder.delivery_address || '—'}
          </div>
          {showOrderDetail && (
            <div style={{ marginBottom:'0.4rem' }}>
              {activeOrder.payment_method && (
                <div style={{ fontSize:'0.78rem', color:'var(--gray-500)', marginBottom:'0.2rem' }}>
                  Pago: <strong>{{cash:'Efectivo',card:'Tarjeta',spei:'SPEI'}[activeOrder.payment_method]||activeOrder.payment_method}</strong>
                </div>
              )}
              {(activeOrder.items || []).length > 0 && (
                <ul style={{ fontSize:'0.82rem', margin:'0 0 0.25rem 1rem', color:'var(--gray-700)' }}>
                  {activeOrder.items.map(i => <li key={i.menuItemId}>{i.name} × {i.quantity}</li>)}
                </ul>
              )}
              <FeeBreakdown order={activeOrder} />
            </div>
          )}
          <div style={{ display:'flex', gap:'0.4rem', flexWrap:'wrap' }}>
            <button className="btn-sm"
              style={{ background: activeOrder.status==='ready' ? 'var(--brand)':'', color: activeOrder.status==='ready' ? '#fff':'' }}
              disabled={loadingStatus==='on_the_way' || activeOrder.status!=='ready'}
              onClick={() => changeStatus(activeOrder.id,'on_the_way')}>En camino</button>
            <button className="btn-sm"
              style={{ background: activeOrder.status==='on_the_way' ? 'var(--success)':'', color: activeOrder.status==='on_the_way' ? '#fff':'' }}
              disabled={loadingStatus==='delivered' || activeOrder.status!=='on_the_way'}
              onClick={() => changeStatus(activeOrder.id,'delivered')}>Entregado</button>
            {!['on_the_way','delivered','cancelled'].includes(activeOrder.status) && (
              <button className="btn-sm btn-danger" onClick={() => setShowRelease(s=>!s)}>Liberar</button>
            )}
          </div>
          {showRelease && (
            <div style={{ marginTop:'0.5rem' }}>
              <textarea value={releaseNote} onChange={e=>setReleaseNote(e.target.value)}
                placeholder="Motivo (obligatorio)" rows={2} style={{ width:'100%', boxSizing:'border-box', marginBottom:'0.4rem' }} />
              <div style={{ display:'flex', gap:'0.4rem' }}>
                <button className="btn-sm btn-danger" onClick={doRelease}>Confirmar</button>
                <button className="btn-sm" onClick={() => { setShowRelease(false); setReleaseNote(''); }}>Cancelar</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Espacio para nav móvil — el padding-bottom del page-content no aplica aquí */}
      <div style={{ height:'var(--nav-h-mobile)', flexShrink:0, background:'transparent' }} />
    </div>
  );
}
