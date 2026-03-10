import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useRealtimeOrders } from '../../hooks/useRealtimeOrders';
import { useDriverLocation } from '../../hooks/useDriverLocation';
import OfferCountdown from '../../components/OfferCountdown';

function fmt(cents) { return `$${((cents ?? 0) / 100).toFixed(2)}`; }

// Dirección corta: "Colonia · Calle NumExt"
// Maneja tanto formato libre ("Av. Revolución 1234 Col. Centro")
// como formato con campos separados por comas ("Av. Revolución 1234, Int. 2, Col. Centro, Morelia, Mich.")
function shortAddr(full) {
  if (!full || full === 'address-pending') return '';
  const parts = full.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length <= 1) {
    // Texto libre sin comas — devolver completo (mejor que devolver parcial)
    return full.trim();
  }
  // Formato con comas: parts[0]=calle+num, parts[1]=Int. X | colonia, etc.
  const streetAndNum = parts[0] || '';
  const second = parts[1] || '';
  const colonia = second.startsWith('Int.') ? (parts[2] || '') : second;
  if (colonia && streetAndNum) return `${colonia} · ${streetAndNum}`;
  return streetAndNum || colonia || full;
}

// Distancia geográfica en km (Haversine)
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2
    + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

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

// orderPins: [{ lat, lng, type:'restaurant'|'customer', label }]
function DriverMap({ driverPos, customPin, onCustomPin, hasActiveOrder, orderPins = [] }) {
  const containerRef  = useRef(null);
  const mapRef        = useRef(null); // { map, driverMarker, customMarker, orderMarkers[] }
  const DEFAULT_POS = { lat: 20.659699, lng: -103.349609 };

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    ensureLeafletCSS();
    const initPos = driverPos || DEFAULT_POS;
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
          zoomControl: false, attributionControl: false, tap: true, tapTolerance: 15,
        }).setView([initPos.lat, initPos.lng], driverPos ? 15 : 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          keepBuffer: 2, updateWhenIdle: false, detectRetina: true,
        }).addTo(map);
        L.control.zoom({ position: 'bottomright' }).addTo(map);

        // Pin fijo permanente de referencia
        const fixedIcon = L.divIcon({
          html: `<div style="width:26px;height:32px;position:relative;">
            <div style="width:26px;height:26px;border-radius:50% 50% 50% 0;background:#e53e3e;border:3px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,0.4);transform:rotate(-45deg);"></div>
            <div style="position:absolute;top:5px;left:5px;width:12px;height:12px;border-radius:50%;background:#fff;opacity:0.9;"></div>
          </div>`,
          iconSize: [26, 32], iconAnchor: [13, 32], className: '',
        });
        L.marker([19.755228329961394, -101.137419232067], { icon: fixedIcon, interactive: false, keyboard: false }).addTo(map);

        let driverMarker = null;
        if (driverPos) {
          driverMarker = L.circleMarker([driverPos.lat, driverPos.lng], {
            radius: 9, fillColor: '#2563eb', fillOpacity: 1, color: '#fff', weight: 2,
          }).addTo(map);
        }
        map.on('click', (e) => { if (!hasActiveOrder) onCustomPin?.({ lat: e.latlng.lat, lng: e.latlng.lng }); });
        mapRef.current = { map, driverMarker, customMarker: null, orderMarkers: [] };
        setTimeout(() => map.invalidateSize(), 300);
      }).catch(() => {});
    }, 50);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    return () => { if (mapRef.current?.map) { mapRef.current.map.remove(); mapRef.current = null; } };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !driverPos) return;
    import('leaflet').then(L => {
      if (!mapRef.current) return;
      const { map } = mapRef.current;
      if (mapRef.current.driverMarker) {
        mapRef.current.driverMarker.setLatLng([driverPos.lat, driverPos.lng]);
      } else {
        mapRef.current.driverMarker = L.circleMarker([driverPos.lat, driverPos.lng], {
          radius: 9, fillColor: '#2563eb', fillOpacity: 1, color: '#fff', weight: 2,
        }).addTo(map);
      }
      map.panTo([driverPos.lat, driverPos.lng], { animate: true, duration: 0.5 });
    }).catch(() => {});
  }, [driverPos?.lat, driverPos?.lng]);

  useEffect(() => {
    if (!mapRef.current?.map) return;
    const map = mapRef.current.map;
    map.off('click');
    if (!hasActiveOrder) map.on('click', (e) => onCustomPin?.({ lat: e.latlng.lat, lng: e.latlng.lng }));
  }, [hasActiveOrder, onCustomPin]);

  useEffect(() => {
    if (!mapRef.current) return;
    const { map } = mapRef.current;
    import('leaflet').then(L => {
      if (mapRef.current.customMarker) { mapRef.current.customMarker.remove(); mapRef.current.customMarker = null; }
      if (customPin && !hasActiveOrder) {
        const icon = L.divIcon({
          html: `<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;background:var(--brand);border:2px solid #fff;box-shadow:0 2px 6px #0004;transform:rotate(-45deg)"></div>`,
          iconSize: [22, 22], iconAnchor: [11, 22], className: ''
        });
        mapRef.current.customMarker = L.marker([customPin.lat, customPin.lng], { icon }).addTo(map);
      }
    });
  }, [customPin?.lat, customPin?.lng, hasActiveOrder]);

  // Pins de pedidos activos: tienda=verde 🏪, cliente=naranja 📦
  useEffect(() => {
    if (!mapRef.current) return;
    const { map } = mapRef.current;
    import('leaflet').then(L => {
      if (!mapRef.current) return;
      (mapRef.current.orderMarkers || []).forEach(m => m.remove());
      mapRef.current.orderMarkers = [];
      for (const pin of orderPins) {
        if (!pin?.lat || !pin?.lng) continue;
        const isRest = pin.type === 'restaurant';
        const color  = isRest ? '#16a34a' : '#ea580c';
        const emoji  = isRest ? '🏪' : '📦';
        const icon = L.divIcon({
          html: `<div style="background:${color};color:#fff;border-radius:20px;padding:3px 8px;font-size:13px;box-shadow:0 2px 6px rgba(0,0,0,0.35);border:2px solid #fff;white-space:nowrap;">${emoji}</div>`,
          iconSize: [36, 26], iconAnchor: [18, 13], className: '',
        });
        const m = L.marker([pin.lat, pin.lng], { icon, keyboard: false }).addTo(map);
        if (pin.label) m.bindTooltip(pin.label, { permanent: false, direction: 'top' });
        mapRef.current.orderMarkers.push(m);
      }
    });
  }, [JSON.stringify(orderPins)]);

  return (
    <div style={{ height:'100%', width:'100%', position:'relative' }}>
      <div ref={containerRef} style={{ height:'100%', width:'100%' }} />
      {!driverPos && (
        <div style={{
          position:'absolute', top:8, left:'50%', transform:'translateX(-50%)',
          background:'rgba(0,0,0,0.5)', color:'#fff', borderRadius:20,
          padding:'0.2rem 0.75rem', fontSize:'0.72rem', zIndex:5,
          pointerEvents:'none', whiteSpace:'nowrap',
        }}>
          📍 Sin GPS — toca el mapa para marcar posición
        </div>
      )}
    </div>
  );
}

export default function DriverHome() {
  const { auth } = useAuth();
  const [activeOrder,     setActiveOrder]     = useState(null);
  const [availability,    setAvailability]    = useState(false);
  const [pendingOffer,    setPendingOffer]    = useState(null);
  const [offerMinimized,  setOfferMinimized]  = useState(false);
  const [loadingOffer,    setLoadingOffer]    = useState(false);
  const [loadingStatus,   setLoadingStatus]   = useState('');
  const [releaseNote,     setReleaseNote]     = useState('');
  const [showRelease,     setShowRelease]     = useState(false);
  const [orderExpanded,   setOrderExpanded]   = useState(false);
  const [customPin,    setCustomPin]     = useState(null);   // { lat, lng }
  const [pinAddress,   setPinAddress]    = useState(null);   // string | null
  const [loadingPin,   setLoadingPin]    = useState(false);
  const [msg, setMsg] = useState('');
  const loadDataRef   = useRef(null);

  // Permiso de notificaciones al montar
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  function notifyNewOffer(data) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const earn = (data.delivery_fee_cents||0) + Math.round((data.service_fee_cents||0)*0.5) + (data.tip_cents||0) || 0;
    const rest = data.restaurant_name || data.restaurantName || 'Pedido nuevo';
    const body = [
      data.restaurant_address ? shortAddr(data.restaurant_address) : null,
      `Entrega: ${shortAddr(data.customer_address || data.delivery_address || '')}`,
      earn > 0 ? `Ganancia: ${fmt(earn)}` : null,
      `⏱ ${data.secondsLeft ?? data.seconds_left ?? 60}s para responder`,
    ].filter(Boolean).join('\n');
    const title = `🛵 Oferta${earn > 0 ? ` · ${fmt(earn)}` : ''} — ${rest}`;
    const opts = {
      body, icon: '/logo.svg', badge: '/logo.svg',
      tag: `offer-${data.orderId}`, renotify: true,
      requireInteraction: true, silent: false, vibrate: [200, 100, 200],
      data: { url: 'https://morelivery.vercel.app/driver' },
    };
    try {
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then(reg => reg.showNotification(title, opts)).catch(() => new Notification(title, opts));
      } else { new Notification(title, opts); }
    } catch (_) {}
  }

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

  const tokenRef = useRef(auth.token);
  useEffect(() => { tokenRef.current = auth.token; }, [auth.token]);

  // loadOrders: solo pedidos activos — no toca pendingOffer (SSE es source of truth)
  const loadOrders = useCallback(async () => {
    if (!auth.token) return;
    try {
      const od = await apiFetch('/orders/my', {}, auth.token);
      const active = (od.orders || [])
        .filter(o => !['delivered','cancelled'].includes(o.status))
        .sort((a, b) => new Date(a.accepted_at || a.created_at) - new Date(b.accepted_at || b.created_at))[0] || null;
      setActiveOrder(active);
    } catch (_) {}
  }, [auth.token]);

  // loadData: sincronización completa (al montar y después de aceptar/rechazar)
  const loadData = useCallback(async () => {
    if (!auth.token) return;
    try {
      const [od, off] = await Promise.all([
        apiFetch('/orders/my', {}, auth.token),
        apiFetch('/drivers/offers', {}, auth.token),
      ]);
      const active = (od.orders || [])
        .filter(o => !['delivered','cancelled'].includes(o.status))
        .sort((a, b) => new Date(a.accepted_at || a.created_at) - new Date(b.accepted_at || b.created_at))[0] || null;
      setActiveOrder(active);
      const offers = off.offers || [];
      const newOffer = offers.length > 0 ? offers[0] : null;
      setPendingOffer(prev => {
        if (newOffer?.id !== prev?.id) setOfferMinimized(false);
        return newOffer;
      });
    } catch (_) {}
  }, [auth.token]);

  // loadDataRef apunta a loadOrders (SSE es source of truth para ofertas)
  useEffect(() => { loadDataRef.current = loadOrders; });

  useEffect(() => {
    setAvailability(Boolean(auth.user?.driver?.is_available));
    loadData();
  }, [auth.token]);

  // SSE: fuente de verdad para nuevas ofertas
  const handleNewOffer = useCallback((data) => {
    console.log(`[DriverHome] handleNewOffer orderId=${data.orderId} secs=${data.secondsLeft}`);
    setPendingOffer(prev => {
      if (prev) return prev;
      notifyNewOffer(data);
      return { id: data.orderId, ...data, seconds_left: data.secondsLeft ?? 60 };
    });
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
      setPendingOffer(null); setOfferMinimized(false); setOrderExpanded(false);
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
    <div className="driver-map-root" style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden', position:'relative' }}>

      {/* ── Encabezado FIJO ─────────────────────────────────────────── */}
      <div style={{ flexShrink:0, background:'linear-gradient(135deg,var(--brand) 0%,#c0546a 100%)', padding:'0.65rem 1rem', display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, zIndex:10 }}>
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
        {/* Hint: toca el mapa para colocar marcador */}
        {!customPin && !hasActiveOrder && availability && (
          <div style={{
            position:'absolute', top:8, left:'50%', transform:'translateX(-50%)',
            background:'rgba(0,0,0,0.55)', color:'#fff', borderRadius:20,
            padding:'0.25rem 0.75rem', fontSize:'0.72rem', zIndex:5,
            pointerEvents:'none', whiteSpace:'nowrap',
          }}>
            📍 Toca el mapa para marcar tu posición
          </div>
        )}
        <DriverMap
          driverPos={myPosition}
          customPin={customPin}
          onCustomPin={setCustomPin}
          hasActiveOrder={hasActiveOrder}
          orderPins={activeOrder ? [
            activeOrder.restaurant_lat && activeOrder.restaurant_lng
              ? { lat: Number(activeOrder.restaurant_lat), lng: Number(activeOrder.restaurant_lng), type:'restaurant', label: activeOrder.restaurant_name || 'Tienda' }
              : null,
            activeOrder.customer_lat && activeOrder.customer_lng
              ? { lat: Number(activeOrder.customer_lat), lng: Number(activeOrder.customer_lng), type:'customer', label: 'Cliente' }
              : null,
          ].filter(Boolean) : []}
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
              <span style={{ fontSize:'0.7rem', color:'var(--gray-400)' }}>Toca el mapa para mover el marcador</span>
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

      {/* ── Panel de oferta — overlay sobre el pedido activo ───────────── */}
      {pendingOffer && (
        <div style={{
          position:'absolute', bottom:0, left:0, right:0,
          zIndex:30,
        }}>
          {/* Botón oreja — FUERA del div con overflow:hidden para que no se oculte */}
          {/* Botón colapsar — "oreja" centrada en el borde superior, siempre visible */}
          <button
            onClick={() => setOfferMinimized(m => !m)}
            style={{
              position:'absolute', top:-14, left:'50%', transform:'translateX(-50%)',
              background:'#f3e8ed', color:'var(--brand)', border:'1px solid #e8c8d4',
              borderBottom:'none', borderRadius:'6px 6px 0 0',
              padding:'0.1rem 0.5rem', cursor:'pointer', fontSize:'0.62rem', fontWeight:700,
              boxShadow:'0 -2px 6px rgba(0,0,0,0.06)',
              zIndex:31, whiteSpace:'nowrap', display:'flex', alignItems:'center', gap:3,
            }}
            aria-label={offerMinimized ? 'Expandir oferta' : 'Minimizar oferta'}
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <polyline points={offerMinimized ? '6 15 12 9 18 15' : '18 9 12 15 6 9'} />
            </svg>
            {offerMinimized ? 'Oferta' : '—'}
          </button>

          {/* Panel con overflow:hidden — el botón queda fuera de este */}
          <div style={{
            background:'#fff',
            borderTop:'3px solid var(--brand)',
            boxShadow:'0 -4px 20px rgba(0,0,0,0.14)',
            overflow:'hidden',
            transition:'max-height 0.3s ease',
            maxHeight: offerMinimized ? 0 : 340,
          }}>
          <div style={{ padding:'0.6rem 1rem 0.75rem', overflowY:'auto' }}>
            {/* Tienda, cliente y ganancia */}
            <div style={{ fontSize:'0.82rem', color:'var(--gray-700)', marginBottom:'0.3rem' }}>
              {(pendingOffer.restaurant_name || pendingOffer.restaurantAddress) && (
                <div style={{ marginBottom:'0.1rem' }}>
                  <span style={{ color:'var(--gray-400)', fontSize:'0.72rem' }}>Tienda: </span>
                  <strong>{pendingOffer.restaurant_name || pendingOffer.restaurantAddress}</strong>
                </div>
              )}
              {(pendingOffer.restaurant_address || pendingOffer.restaurantAddress) && (
                <div style={{ marginBottom:'0.1rem' }}>
                  <span style={{ color:'var(--gray-400)', fontSize:'0.72rem' }}>📍 </span>
                  <span>{shortAddr(pendingOffer.restaurant_address || pendingOffer.restaurantAddress)}</span>
                </div>
              )}
              {(pendingOffer.customer_address || pendingOffer.customerAddress || pendingOffer.delivery_address) && (
                <div style={{ marginBottom:'0.1rem' }}>
                  <span style={{ color:'var(--gray-400)', fontSize:'0.72rem' }}>Entrega: </span>
                  <span>{shortAddr(pendingOffer.customer_address || pendingOffer.customerAddress || pendingOffer.delivery_address)}</span>
                </div>
              )}
              {(() => {
                const rLat = pendingOffer.restaurant_lat ?? pendingOffer.restaurantLat;
                const rLng = pendingOffer.restaurant_lng ?? pendingOffer.restaurantLng;
                const cLat = pendingOffer.customer_lat   ?? pendingOffer.customerLat;
                const cLng = pendingOffer.customer_lng   ?? pendingOffer.customerLng;
                if (!rLat || !rLng || !cLat || !cLng) return null;
                const km = haversineKm(Number(rLat), Number(rLng), Number(cLat), Number(cLng)).toFixed(1);
                return (
                  <div style={{ fontSize:'0.72rem', color:'var(--gray-400)', marginTop:'0.1rem' }}>
                    📏 {km} km entre tienda y cliente
                  </div>
                );
              })()}
            </div>
            {/* Ganancia calculada desde los campos del backend */}
            {(() => {
              const earn = (pendingOffer.delivery_fee_cents||0)
                + Math.round((pendingOffer.service_fee_cents||0)*0.5)
                + (pendingOffer.tip_cents||0)
                || pendingOffer.driverEarning || 0;
              return earn > 0 ? (
                <div style={{ fontSize:'0.9rem', fontWeight:800, color:'var(--success)',
                  marginBottom:'0.35rem' }}>
                  Tu ganancia: {fmt(earn)}
                </div>
              ) : null;
            })()}
            <OfferCountdown
              key={pendingOffer.id}
              secondsLeft={pendingOffer.seconds_left ?? pendingOffer.secondsLeft ?? 60}
              onExpired={() => { setPendingOffer(null); setOfferMinimized(false); }}
            />
            <div style={{ display:'flex', gap:'0.5rem', marginTop:'0.45rem' }}>
              <button className="btn-primary btn-sm" style={{ flex:1 }}
                disabled={loadingOffer} onClick={acceptOffer}>
                {loadingOffer ? 'Aceptando…' : 'Aceptar'}
              </button>
              <button className="btn-sm" disabled={loadingOffer} onClick={rejectOffer}>
                Rechazar
              </button>
            </div>
          </div>
          </div>{/* fin panel con overflow */}
        </div>
      )}

      {/* ── Panel de pedido activo (zIndex:10) ──────────────────────────── */}
      {activeOrder && (() => {
        const isOnTheWay = activeOrder.status === 'on_the_way';
        const isCash     = (activeOrder.payment_method || 'cash') === 'cash';
        const grandTotal = (activeOrder.total_cents||0)+(activeOrder.service_fee_cents||0)
                          +(activeOrder.delivery_fee_cents||0)+(activeOrder.tip_cents||0);
        const driverEarn = (activeOrder.delivery_fee_cents||0)
                          + Math.round((activeOrder.service_fee_cents||0)*0.5)
                          + (activeOrder.tip_cents||0);
        // Distancia tienda → cliente
        const distKm = (activeOrder.restaurant_lat && activeOrder.restaurant_lng &&
                        activeOrder.customer_lat   && activeOrder.customer_lng)
          ? haversineKm(
              Number(activeOrder.restaurant_lat), Number(activeOrder.restaurant_lng),
              Number(activeOrder.customer_lat),   Number(activeOrder.customer_lng)
            ).toFixed(1)
          : null;
        const DRIVER_STATUS = {
          assigned:'Asignado — ve a recoger', on_the_way:'En camino al cliente',
          preparing:'Esperando en tienda', ready:'Listo para retiro',
          accepted:'Aceptado', created:'Nuevo pedido',
        };
        return (
          <div style={{ flexShrink:0, background:'#fff',
            borderTop:'2px solid var(--success)', zIndex:10, position:'relative',
            display:'flex', flexDirection:'column',
            maxHeight: orderExpanded ? 'min(72vh, 520px)' : 120,
            transition:'max-height 0.3s ease', overflow:'hidden' }}>

            {/* Vista compacta — siempre visible */}
            <div style={{ padding:'0.55rem 1rem 0', flexShrink:0 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span style={{ fontSize:'0.7rem', fontWeight:800, textTransform:'uppercase',
                  letterSpacing:'0.5px', color:'var(--success)' }}>
                  {DRIVER_STATUS[activeOrder.status] || activeOrder.status}
                </span>
                <button onClick={() => setOrderExpanded(e => !e)}
                  style={{ border:'none', background:'none', cursor:'pointer',
                    color:'var(--gray-400)', padding:'0.1rem 0.3rem', fontSize:'0.78rem',
                    display:'flex', alignItems:'center', gap:2 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <polyline points={orderExpanded ? '18 15 12 9 6 15' : '6 9 12 15 18 9'} />
                  </svg>
                </button>
              </div>

              {/* Info contextual según estado */}
              {!isOnTheWay ? (
                <div style={{ fontSize:'0.82rem', marginTop:'0.15rem' }}>
                  <strong>{activeOrder.restaurant_name}</strong>
                  {activeOrder.restaurant_address && (
                    <div style={{ color:'var(--gray-500)', fontSize:'0.77rem' }}>
                      {shortAddr(activeOrder.restaurant_address)}
                    </div>
                  )}
                  {distKm !== null && (
                    <div style={{ fontSize:'0.72rem', color:'var(--gray-400)', marginTop:'0.1rem' }}>
                      📏 {distKm} km entre tienda y cliente
                    </div>
                  )}
                  {isCash
                    ? <div style={{ fontWeight:700, color:'var(--brand)', fontSize:'0.8rem', marginTop:'0.1rem' }}>
                        Pagar a tienda: {fmt(activeOrder.total_cents||0)}
                      </div>
                    : <div style={{ fontSize:'0.77rem', color:'var(--gray-400)', marginTop:'0.1rem' }}>
                        {activeOrder.payment_method==='card' ? '💳 Pago con tarjeta — no cobrar' : '🏦 Pago SPEI — no cobrar'}
                      </div>
                  }
                </div>
              ) : (
                <div style={{ fontSize:'0.82rem', marginTop:'0.15rem' }}>
                  <strong>{activeOrder.customer_name || 'Cliente'}</strong>
                  {(activeOrder.customer_address || activeOrder.delivery_address) && (
                    <div style={{ color:'var(--gray-500)', fontSize:'0.77rem' }}>
                      {shortAddr(activeOrder.customer_address || activeOrder.delivery_address)}
                    </div>
                  )}
                  {distKm !== null && (
                    <div style={{ fontSize:'0.72rem', color:'var(--gray-400)', marginTop:'0.1rem' }}>
                      📏 {distKm} km entre tienda y cliente
                    </div>
                  )}
                  {isCash
                    ? <div style={{ fontWeight:700, color:'var(--success)', fontSize:'0.8rem', marginTop:'0.1rem' }}>
                        Cobrar a cliente: {fmt(grandTotal)}
                      </div>
                    : <div style={{ fontSize:'0.77rem', color:'var(--gray-400)', marginTop:'0.1rem' }}>
                        {activeOrder.payment_method==='card' ? '💳 Ya pagó con tarjeta' : '🏦 Ya pagó SPEI'}
                      </div>
                  }
                </div>
              )}
            </div>

            {/* Detalle expandible (scroll interno) */}
            {orderExpanded && (
              <div style={{ flex:1, overflowY:'auto', padding:'0.4rem 1rem 0.6rem',
                borderTop:'1px solid var(--gray-100)', marginTop:'0.35rem' }}>
                {(activeOrder.items||[]).length > 0 && (
                  <ul style={{ fontSize:'0.8rem', margin:'0 0 0.3rem 1rem', color:'var(--gray-700)' }}>
                    {activeOrder.items.map(i => <li key={i.menuItemId}>{i.name} × {i.quantity}</li>)}
                  </ul>
                )}
                <div style={{ fontSize:'0.78rem', color:'var(--gray-500)', marginBottom:'0.3rem' }}>
                  <span>Ganancia estimada: </span>
                  <strong style={{ color:'var(--success)' }}>{fmt(driverEarn)}</strong>
                </div>
                {/* Controles de estado */}
                <div style={{ display:'flex', gap:'0.4rem', flexWrap:'wrap', marginBottom:'0.4rem' }}>
                  <button className="btn-sm"
                    style={{ background: activeOrder.status==='ready' ? 'var(--brand)':'',
                      color: activeOrder.status==='ready' ? '#fff':'' }}
                    disabled={loadingStatus==='on_the_way' || activeOrder.status!=='ready'}
                    onClick={() => changeStatus(activeOrder.id,'on_the_way')}>
                    En camino
                  </button>
                  <button className="btn-sm"
                    style={{ background: activeOrder.status==='on_the_way' ? 'var(--success)':'',
                      color: activeOrder.status==='on_the_way' ? '#fff':'' }}
                    disabled={loadingStatus==='delivered' || activeOrder.status!=='on_the_way'}
                    onClick={() => changeStatus(activeOrder.id,'delivered')}>
                    Entregado
                  </button>
                  {!['on_the_way','delivered','cancelled'].includes(activeOrder.status) && (
                    <button className="btn-sm btn-danger"
                      onClick={() => setShowRelease(s => !s)}>
                      Liberar
                    </button>
                  )}
                </div>
                {showRelease && (
                  <div>
                    <textarea value={releaseNote} onChange={e => setReleaseNote(e.target.value)}
                      placeholder="Motivo (obligatorio)" rows={2}
                      style={{ width:'100%', boxSizing:'border-box', marginBottom:'0.3rem', fontSize:'0.82rem' }} />
                    <div style={{ display:'flex', gap:'0.3rem' }}>
                      <button className="btn-sm btn-danger" onClick={doRelease}>Confirmar</button>
                      <button className="btn-sm" onClick={() => { setShowRelease(false); setReleaseNote(''); }}>Cancelar</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Espacio para nav móvil — el padding-bottom del page-content no aplica aquí */}
      <div style={{ height:'var(--nav-h-mobile)', flexShrink:0, background:'transparent' }} />
    </div>
  );
}
