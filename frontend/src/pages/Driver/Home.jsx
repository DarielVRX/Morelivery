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

function ensureMapLibreCSS() {
  if (document.getElementById('maplibre-css')) return;
  const lnk = document.createElement('link');
  lnk.id = 'maplibre-css';
  lnk.rel = 'stylesheet';
  lnk.href = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css';
  document.head.appendChild(lnk);
}

function ensureMapLibreJS() {
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (window.__mapLibreLoadingPromise) return window.__mapLibreLoadingPromise;
  window.__mapLibreLoadingPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js';
    s.async = true;
    s.onload = () => resolve(window.maplibregl);
    s.onerror = () => reject(new Error('No se pudo cargar MapLibre GL JS'));
    document.head.appendChild(s);
  });
  return window.__mapLibreLoadingPromise;
}

function normalizeBearing(deg) { return (deg + 360) % 360; }

function getBearing(from, to) {
  if (!from || !to) return 0;
  const lat1 = from.lat * Math.PI / 180;
  const lat2 = to.lat * Math.PI / 180;
  const dLon = (to.lng - from.lng) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return normalizeBearing(Math.atan2(y, x) * 180 / Math.PI);
}

async function reverseGeocode(lat, lng) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`,
      { headers: { 'Accept-Language': 'es' } }
    );
    if (!r.ok) return null;
    const d = await r.json();
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

// ── SVG del marcador de navegación — aprox. 4× el original (20px → 80px) ──────
// Triángulo de avión con trazo rosa y relleno semitransparente
function navMarkerHTML(headingDeg) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 24 24"
    fill="rgba(227,170,170,0.55)" stroke="#e3aaaa" stroke-width="1.4" stroke-linejoin="round"
    style="transform:rotate(${headingDeg}deg);transform-origin:50% 55%;display:block;">
    <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/>
  </svg>`;
}

// ── Componente DriverMap ────────────────────────────────────────────────────────
function DriverMap({
  driverPos, customPin, onCustomPin, hasActiveOrder,
  pickupPos, deliveryPos, pickupLabel, deliveryLabel,
  routeGeometry, onRouteError,
  navFollowEnabled, navHeadingDeg, onHeadingChange,
  // centrar: 'follow' | 'free' | null  — señal del padre para centrar
  centerSignal, onCenterDone,
}) {
  const containerRef    = useRef(null);
  const mapRef          = useRef(null);          // instancia maplibregl.Map
  const markersRef      = useRef({ driver:null, custom:null, pickup:null, delivery:null });
  const localWatchIdRef = useRef(null);
  const prevWatchPosRef = useRef(null);
  const [livePos,     setLivePos]     = useState(driverPos || null);
  const [liveHeading, setLiveHeading] = useState(0);
  // attribution visible solo cuando el usuario la solicita
  const [showAttrib, setShowAttrib] = useState(false);

  const DEFAULT_POS = { lat: 19.70595, lng: -101.19498 };

  useEffect(() => { if (driverPos) setLivePos(driverPos); }, [driverPos?.lat, driverPos?.lng]);

  const onHeadingChangeRef = useRef(onHeadingChange);
  useEffect(() => { onHeadingChangeRef.current = onHeadingChange; }, [onHeadingChange]);

  // watchPosition interno — calcula heading real entre posiciones
  useEffect(() => {
    if (!navigator?.geolocation) return;
    if (localWatchIdRef.current != null) navigator.geolocation.clearWatch(localWatchIdRef.current);
    localWatchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setLivePos(next);
        if (prevWatchPosRef.current) {
          const h = getBearing(prevWatchPosRef.current, next);
          setLiveHeading(h);
          onHeadingChangeRef.current?.(h);
        }
        prevWatchPosRef.current = next;
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
    );
    return () => {
      if (localWatchIdRef.current != null) {
        navigator.geolocation.clearWatch(localWatchIdRef.current);
        localWatchIdRef.current = null;
      }
    };
  }, []); // sin deps — usa ref internamente, watchPosition solo se suscribe UNA vez

  // Inicializar mapa UNA sola vez
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    ensureMapLibreCSS();
    ensureMapLibreJS().then((maplibregl) => {
      if (!containerRef.current || mapRef.current) return;
      const start = livePos || driverPos || DEFAULT_POS;
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: 'https://tiles.openfreemap.org/styles/liberty',
        center: [start.lng, start.lat],
        zoom: 14,
        pitch: 30,
        bearing: 0,
        maxZoom: 20,
        // attribution oculta por defecto — disponible via botón legal
        attributionControl: false,
      });

      // Botón de zoom nativo (posición top-right para no chocar con FABs de abajo)
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

      map.on('click', (evt) => {
        if (hasActiveOrder) return;
        onCustomPin?.({ lat: evt.lngLat.lat, lng: evt.lngLat.lng });
      });

      mapRef.current = map;
    }).catch(() => {
      onRouteError?.('No se pudo inicializar el mapa de navegación');
    });
    return () => {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Destruir al desmontar (cobertura extra)
  useEffect(() => {
    return () => {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, []);

  // Marcador GPS del driver — recrear al cambiar posición o modo follow
  // Throttle de heading: ignorar cambios < 2° para evitar recreaciones innecesarias
  const lastHeadingRef = useRef(0);
  useEffect(() => {
    if (!mapRef.current) return;
    const headingDiff = Math.abs(((liveHeading - lastHeadingRef.current) + 360) % 360);
    const headingChanged = headingDiff > 2 && headingDiff < 358;
    if (!headingChanged && markersRef.current.driver) {
      // Solo mover el marcador existente sin recrearlo
      ensureMapLibreJS().then(() => {
        if (markersRef.current.driver && livePos) {
          markersRef.current.driver.setLngLat([livePos.lng, livePos.lat]);
        }
      });
      return;
    }
    lastHeadingRef.current = liveHeading;
    ensureMapLibreJS().then((maplibregl) => {
      const map = mapRef.current;
      if (markersRef.current.driver) { markersRef.current.driver.remove(); markersRef.current.driver = null; }
      if (!livePos) return;

      const heading = navFollowEnabled ? (liveHeading || navHeadingDeg || 0) : 0;
      const el = document.createElement('div');
      el.innerHTML = navMarkerHTML(heading);
      el.style.width = '80px';
      el.style.height = '80px';

      markersRef.current.driver = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([livePos.lng, livePos.lat])
        .addTo(map);

      if (navFollowEnabled) {
        const offsetY = Math.round(map.getContainer().clientHeight * 0.18);
        map.easeTo({
          center: [livePos.lng, livePos.lat],
          bearing: heading,
          pitch: 60,
          zoom: 19,
          duration: 300,
          offset: [0, offsetY],
          essential: true,
        });
      }
    });
  }, [livePos?.lat, livePos?.lng, navFollowEnabled, navHeadingDeg, liveHeading]);

  // Pin personalizado
  useEffect(() => {
    if (!mapRef.current) return;
    ensureMapLibreJS().then((maplibregl) => {
      const map = mapRef.current;
      if (markersRef.current.custom) { markersRef.current.custom.remove(); markersRef.current.custom = null; }
      if (customPin && !hasActiveOrder) {
        const el = document.createElement('div');
        el.style.cssText = 'width:16px;height:16px;border-radius:999px;background:var(--brand);border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.35)';
        markersRef.current.custom = new maplibregl.Marker({ element: el })
          .setLngLat([customPin.lng, customPin.lat])
          .addTo(map);
      }
    });
  }, [customPin?.lat, customPin?.lng, hasActiveOrder]);

  // Marcadores tienda / cliente
  useEffect(() => {
    if (!mapRef.current) return;
    ensureMapLibreJS().then((maplibregl) => {
      const map = mapRef.current;
      if (markersRef.current.pickup)   { markersRef.current.pickup.remove();   markersRef.current.pickup = null; }
      if (markersRef.current.delivery) { markersRef.current.delivery.remove(); markersRef.current.delivery = null; }

      const makeMarker = (pos, emoji, color, label) => {
        const el = document.createElement('div');
        el.style.cssText = `width:28px;height:28px;border-radius:50%;background:${color};display:grid;place-items:center;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.35);font-size:15px`;
        el.textContent = emoji;
        return new maplibregl.Marker({ element: el })
          .setLngLat([pos.lng, pos.lat])
          .setPopup(new maplibregl.Popup({ closeButton: false }).setText(label));
      };

      markersRef.current.pickup   = pickupPos   ? makeMarker(pickupPos,   '🏪', '#16a34a', pickupLabel   || 'Tienda').addTo(map)   : null;
      markersRef.current.delivery = deliveryPos ? makeMarker(deliveryPos, '📦', '#f97316', deliveryLabel || 'Cliente').addTo(map) : null;
    });
  }, [pickupPos?.lat, pickupPos?.lng, deliveryPos?.lat, deliveryPos?.lng, pickupLabel, deliveryLabel]);

  // Ruta — GeoJSON source/layer en MapLibre
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    const sourceId = 'driver-route-source';
    const layerId  = 'driver-route-layer';
    const draw = () => {
      const geoJson = {
        type: 'Feature', properties: {},
        geometry: { type: 'LineString', coordinates: (routeGeometry || []).map(p => [p.lng, p.lat]) },
      };
      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, { type: 'geojson', data: geoJson });
      } else {
        map.getSource(sourceId).setData(geoJson);
      }
      if (!map.getLayer(layerId)) {
        map.addLayer({ id: layerId, type: 'line', source: sourceId,
          paint: { 'line-color': '#e3aaaa', 'line-width': 5, 'line-opacity': 0.9 },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
      }
    };
    if (map.isStyleLoaded()) draw();
    else map.once('load', draw);
  }, [routeGeometry]);

  // Centrar — reacciona a la señal del padre
  useEffect(() => {
    if (!centerSignal || !mapRef.current) return;
    const map  = mapRef.current;
    const pos  = livePos || driverPos;
    if (!pos) { onCenterDone?.(); return; }

    if (centerSignal === 'follow') {
      const heading = liveHeading || navHeadingDeg || 0;
      const offsetY = Math.round(map.getContainer().clientHeight * 0.18);
      map.easeTo({
        center: [pos.lng, pos.lat],
        zoom: 19,
        pitch: 60,
        bearing: heading,
        duration: 400,
        offset: [0, offsetY],
        essential: true,
      });
    } else {
      // 'free': volver a norte arriba, pitch 30, zoom 14
      map.easeTo({
        center: [pos.lng, pos.lat],
        zoom: 14,
        pitch: 30,
        bearing: 0,
        duration: 400,
        essential: true,
      });
    }
    onCenterDone?.();
  }, [centerSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ height:'100%', width:'100%', position:'relative' }}>
      <div ref={containerRef} style={{ height:'100%', width:'100%' }} />

      {/* Attribution legal — oculta por defecto, visible al presionar el botón ℹ */}
      {showAttrib && (
        <div style={{
          position:'absolute', bottom:52, left:8, zIndex:10,
          background:'rgba(255,255,255,0.92)', borderRadius:6, padding:'0.3rem 0.6rem',
          fontSize:'0.65rem', color:'#444', boxShadow:'0 1px 6px #0002', maxWidth:260,
          pointerEvents:'none',
        }}>
          © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" style={{ color:'#2563eb' }}>OpenStreetMap</a> contributors ·{' '}
          <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer" style={{ color:'#2563eb' }}>OpenFreeMap</a> ·{' '}
          <a href="https://maplibre.org" target="_blank" rel="noopener noreferrer" style={{ color:'#2563eb' }}>MapLibre</a>
        </div>
      )}
      <button
        onClick={() => setShowAttrib(v => !v)}
        title="Atribuciones del mapa"
        style={{
          position:'absolute', bottom:8, left:8, zIndex:10,
          background:'rgba(255,255,255,0.82)', border:'1px solid #ccc',
          borderRadius:4, width:22, height:22, cursor:'pointer',
          fontSize:'0.65rem', display:'flex', alignItems:'center', justifyContent:'center',
          color:'#555', padding:0,
        }}
      >ℹ</button>

      {!livePos && (
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

// ── Pull-to-refresh estilo Instagram ───────────────────────────────────────────
function PullToRefresh({ onRefresh, children }) {
  const wrapRef    = useRef(null);
  const startYRef  = useRef(null);
  const [pull, setPull]         = useState(0);     // px tirados
  const [loading, setLoading]   = useState(false);
  const THRESHOLD = 72; // px para disparar recarga

  const onTouchStart = useCallback((e) => {
    if (wrapRef.current?.scrollTop > 0) return;
    startYRef.current = e.touches[0].clientY;
  }, []);

  const onTouchMove = useCallback((e) => {
    if (startYRef.current == null || loading) return;
    if (wrapRef.current?.scrollTop > 0) { startYRef.current = null; return; }
    const dy = e.touches[0].clientY - startYRef.current;
    if (dy <= 0) return;
    // Resistencia elástica
    const capped = Math.min(dy * 0.45, THRESHOLD + 20);
    setPull(capped);
  }, [loading]);

  const onTouchEnd = useCallback(async () => {
    if (startYRef.current == null) return;
    startYRef.current = null;
    if (pull >= THRESHOLD && !loading) {
      setPull(THRESHOLD); // fijar mientras carga
      setLoading(true);
      try { await onRefresh(); } catch (_) {}
      setLoading(false);
      setPull(0);
    } else {
      setPull(0);
    }
  }, [pull, loading, onRefresh]);

  const progress = Math.min(pull / THRESHOLD, 1);
  const spinDeg  = progress * 270 + (loading ? Date.now() / 5 % 360 : 0);

  return (
    <div ref={wrapRef} style={{ height:'100%', overflow:'hidden', position:'relative' }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Círculo de carga — aparece al tirar */}
      <div style={{
        position:'absolute', top: pull > 4 ? Math.max(-36, pull - 36) : -50,
        left:'50%', transform:'translateX(-50%)',
        zIndex:50, transition: loading ? 'none' : 'top 0.18s ease',
        pointerEvents:'none',
      }}>
        <div style={{
          width:36, height:36, borderRadius:'50%',
          background:'#fff', boxShadow:'0 2px 12px rgba(0,0,0,0.18)',
          display:'flex', alignItems:'center', justifyContent:'center',
        }}>
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <circle cx="11" cy="11" r="9" stroke="#e5e7eb" strokeWidth="2.5"/>
            <circle cx="11" cy="11" r="9"
              stroke="var(--brand)"
              strokeWidth="2.5"
              strokeDasharray={`${progress * 56.5} 56.5`}
              strokeLinecap="round"
              style={{ transform:`rotate(${loading ? spinDeg : -90}deg)`, transformOrigin:'50% 50%',
                transition: loading ? 'none' : 'stroke-dasharray 0.1s linear',
                animation: loading ? 'ptr-spin 0.7s linear infinite' : 'none',
              }}
            />
          </svg>
        </div>
      </div>

      {/* Contenido desplazado hacia abajo al tirar */}
      <div style={{
        height:'100%', display:'flex', flexDirection:'column',
        transform: `translateY(${pull}px)`,
        transition: pull === 0 && !loading ? 'transform 0.22s ease' : 'none',
      }}>
        {children}
      </div>

      <style>{`@keyframes ptr-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default function DriverHome() {
  const { auth, patchUser } = useAuth();
  const [activeOrder,    setActiveOrder]    = useState(null);
  const [availability,   setAvailability]   = useState(false);
  const [pendingOffer,   setPendingOffer]   = useState(null);
  const [offerMinimized, setOfferMinimized] = useState(false);
  const [loadingOffer,   setLoadingOffer]   = useState(false);
  const [loadingStatus,  setLoadingStatus]  = useState('');
  const [releaseNote,    setReleaseNote]    = useState('');
  const [showRelease,    setShowRelease]    = useState(false);
  const [orderExpanded,  setOrderExpanded]  = useState(false);
  const [customPin,      setCustomPin]      = useState(null);
  const [pinAddress,     setPinAddress]     = useState(null);
  const [loadingPin,     setLoadingPin]     = useState(false);
  const [routeGeometry,  setRouteGeometry]  = useState(null);
  const [msg,            setMsg]            = useState('');
  const [navFollowEnabled, setNavFollowEnabled] = useState(false);
  const [navHeadingDeg,    setNavHeadingDeg]    = useState(0);
  // Centrar: 'follow' | 'free' | null — señal puntual para el mapa
  const [centerSignal,   setCenterSignal]   = useState(null);
  const [centerActive,   setCenterActive]   = useState(false); // toggle UI rosa/blanco

  const loadDataRef    = useRef(null);
  const loadDebounceRef = useRef(null);

  // ── Padding de auto-centrado tras 5s de inactividad del usuario ────────────
  const userActivityRef  = useRef(null);
  const autoCenterRef    = useRef(null);

  const resetAutoCenter = useCallback(() => {
    if (autoCenterRef.current) clearTimeout(autoCenterRef.current);
    if (!centerActive) return; // solo si el centrado está activo
    autoCenterRef.current = setTimeout(() => {
      // Re-centrar en modo follow si sigue activo
      if (centerActive) setCenterSignal('follow');
    }, 5000);
  }, [centerActive]);

  // Escuchar eventos de actividad del usuario para resetear el timer
  useEffect(() => {
    const events = ['touchstart', 'touchmove', 'pointerdown', 'wheel'];
    const handler = () => resetAutoCenter();
    events.forEach(ev => document.addEventListener(ev, handler, { passive: true }));
    return () => events.forEach(ev => document.removeEventListener(ev, handler));
  }, [resetAutoCenter]);

  function scheduleLoad() {
    if (loadDebounceRef.current) clearTimeout(loadDebounceRef.current);
    loadDebounceRef.current = setTimeout(() => {
      loadDebounceRef.current = null;
      loadDataRef.current?.();
    }, 800);
  }

  const hasActiveOrder = Boolean(activeOrder && !['delivered','cancelled'].includes(activeOrder.status));

  useEffect(() => {
    if (hasActiveOrder) { setCustomPin(null); setPinAddress(null); }
  }, [hasActiveOrder]);

  useEffect(() => {
    if (!customPin) { setPinAddress(null); return; }
    setLoadingPin(true);
    reverseGeocode(customPin.lat, customPin.lng)
      .then(addr => setPinAddress(addr || `${customPin.lat.toFixed(5)}, ${customPin.lng.toFixed(5)}`))
      .finally(() => setLoadingPin(false));
  }, [customPin?.lat, customPin?.lng]);

  const { position: myPosition, error: gpsError } = useDriverLocation(auth.token, availability, hasActiveOrder);

  const prevPosRef = useRef(null);
  useEffect(() => {
    if (!myPosition) return;
    const prev = prevPosRef.current;
    if (prev) {
      const dy = myPosition.lat - prev.lat;
      const dx = myPosition.lng - prev.lng;
      if (Math.abs(dx) + Math.abs(dy) > 0.00001) {
        setNavHeadingDeg(((Math.atan2(dx, dy) * (180 / Math.PI)) + 360) % 360);
      }
    }
    prevPosRef.current = myPosition;
  }, [myPosition?.lat, myPosition?.lng]);

  const tokenRef = useRef(auth.token);
  useEffect(() => { tokenRef.current = auth.token; }, [auth.token]);

  const announceListener = useCallback(async () => {
    if (!tokenRef.current) return;
    try {
      await apiFetch('/drivers/listener', { method:'POST' }, tokenRef.current);
      loadDataRef.current?.();
    } catch (_) {}
  }, []);

  const loadData = useCallback(async () => {
    if (!auth.token) return;
    try {
      const [od, off] = await Promise.all([
        apiFetch('/orders/my?active=1', {}, auth.token),
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

  useEffect(() => { loadDataRef.current = loadData; });

  useEffect(() => {
    setAvailability(Boolean(auth.user?.driver?.is_available));
    loadData();
    if (!auth.token) return;
    apiFetch('/drivers/me', {}, auth.token)
      .then(data => {
        const fresh = Boolean(data?.profile?.is_available);
        setAvailability(fresh);
        patchUser({ driver: { ...(auth.user?.driver || {}), is_available: fresh } });
      })
      .catch(() => {});
  }, [auth.token]); // eslint-disable-line react-hooks/exhaustive-deps

  const availabilityRef       = useRef(availability);
  const pendingOfferRef       = useRef(pendingOffer);
  const hasActiveOrderRef     = useRef(hasActiveOrder);
  const consecutiveTimeoutsRef = useRef(0);
  useEffect(() => { availabilityRef.current   = availability;   }, [availability]);
  useEffect(() => { pendingOfferRef.current   = pendingOffer;   }, [pendingOffer]);
  useEffect(() => { hasActiveOrderRef.current = hasActiveOrder; }, [hasActiveOrder]);

  useEffect(() => {
    const id = setInterval(() => {
      if (!availabilityRef.current)   return;
      if (pendingOfferRef.current)    return;
      if (hasActiveOrderRef.current)  return;
      announceListener();
    }, 4000);
    setTimeout(() => {
      if (availabilityRef.current && !pendingOfferRef.current && !hasActiveOrderRef.current)
        announceListener();
    }, 500);
    return () => clearInterval(id);
  }, [announceListener]);

  const handleNewOffer = useCallback((data) => {
    setPendingOffer(prev => {
      if (prev) return prev;
      return { id: data.orderId, ...data, seconds_left: data.secondsLeft ?? 60 };
    });
    setTimeout(() => loadDataRef.current?.(), 600);
  }, []);

  useRealtimeOrders(auth.token, () => scheduleLoad(), () => {}, handleNewOffer);

  async function toggleAvailability() {
    try {
      const r = await apiFetch('/drivers/availability', {
        method:'PATCH', body: JSON.stringify({ isAvailable: !availability })
      }, auth.token);
      const next = Boolean(r?.profile?.is_available);
      setAvailability(next);
      patchUser({ driver: { ...(auth.user?.driver || {}), is_available: next } });
    } catch (e) { setMsg(e.message); }
  }

  async function acceptOffer() {
    if (!pendingOffer) return;
    consecutiveTimeoutsRef.current = 0;
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
    consecutiveTimeoutsRef.current = 0;
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

  function openRoadRouteApi() {
    if (!activeOrder) return;
    const start = myPosition || (activeOrder.restaurant_lat && activeOrder.restaurant_lng
      ? { lat: Number(activeOrder.restaurant_lat), lng: Number(activeOrder.restaurant_lng) } : null);
    const pickup   = activeOrder.restaurant_lat && activeOrder.restaurant_lng
      ? { lat: Number(activeOrder.restaurant_lat), lng: Number(activeOrder.restaurant_lng) } : null;
    const delivery = activeOrder.customer_lat && activeOrder.customer_lng
      ? { lat: Number(activeOrder.customer_lat), lng: Number(activeOrder.customer_lng) } : null;
    if (!start || !pickup || !delivery) return setMsg('Faltan coordenadas para trazar la ruta');
    apiFetch('/routes/model', {
      method:'POST',
      body: JSON.stringify({ origin: start, destination: delivery, waypoints: [pickup], includeSteps: true }),
    }, auth.token)
      .then(data => {
        const coords = data?.geometry;
        if (!coords?.length) throw new Error('No hay geometría de ruta');
        setRouteGeometry(coords);
        setMsg('Ruta trazada en el mapa');
      })
      .catch(() => { setRouteGeometry(null); setMsg('No se pudo calcular la ruta'); });
  }

  // Solo Google Navigation — directo sin pasar por picker de app
  function openGoogleNavigation() {
    if (!activeOrder) return;
    const isOnTheWay = activeOrder.status === 'on_the_way';
    const destLat = isOnTheWay ? Number(activeOrder.customer_lat)     : Number(activeOrder.restaurant_lat);
    const destLng = isOnTheWay ? Number(activeOrder.customer_lng)     : Number(activeOrder.restaurant_lng);
    if (!destLat || !destLng) return setMsg('Faltan coordenadas para navegar');

    const ua    = (navigator.userAgent || '').toLowerCase();
    const isIOS = /iphone|ipad|ipod/.test(ua);

    if (isIOS) {
      const gmaps = `comgooglemaps://?daddr=${destLat},${destLng}&directionsmode=driving`;
      const fallback = `https://maps.google.com/maps?daddr=${destLat},${destLng}&directionsmode=driving`;
      const a = document.createElement('a'); a.href = gmaps; a.click();
      setTimeout(() => { window.open(fallback, '_blank', 'noopener'); }, 500);
    } else {
      window.location.href = `google.navigation:q=${destLat},${destLng}&mode=d`;
    }
  }

  useEffect(() => { if (!activeOrder) setRouteGeometry(null); }, [activeOrder]);

  // Función de recarga manual (usada en Pull-to-Refresh)
  const handleRefresh = useCallback(async () => {
    await loadData();
  }, [loadData]);

  // ── Toggle del botón Centrar ───────────────────────────────────────────────
  function handleCenterToggle() {
    const next = !centerActive;
    setCenterActive(next);
    setCenterSignal(next ? 'follow' : 'free');
    if (next) resetAutoCenter();
    else if (autoCenterRef.current) { clearTimeout(autoCenterRef.current); autoCenterRef.current = null; }
  }

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <div className="driver-map-root" style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden', position:'relative' }}>

        {/* ── Encabezado ─────────────────────────────────────────────── */}
        <div style={{ flexShrink:0, background:'linear-gradient(135deg,var(--brand) 0%,#c0546a 100%)',
          padding:'0.65rem 1rem', display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, zIndex:10 }}>
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

        {/* ── Mapa ────────────────────────────────────────────────────── */}
        <div style={{ flex:1, minHeight:0, position:'relative', overflow:'hidden', zIndex:0 }}>

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
            pickupPos={activeOrder?.restaurant_lat && activeOrder?.restaurant_lng
              ? { lat:Number(activeOrder.restaurant_lat), lng:Number(activeOrder.restaurant_lng) } : null}
            deliveryPos={activeOrder?.customer_lat && activeOrder?.customer_lng
              ? { lat:Number(activeOrder.customer_lat), lng:Number(activeOrder.customer_lng) } : null}
            pickupLabel={activeOrder?.restaurant_name || 'Tienda'}
            deliveryLabel={activeOrder?.customer_name || activeOrder?.customer_first_name || 'Cliente'}
            routeGeometry={routeGeometry}
            onRouteError={setMsg}
            navFollowEnabled={navFollowEnabled}
            navHeadingDeg={navHeadingDeg}
            onHeadingChange={setNavHeadingDeg}
            centerSignal={centerSignal}
            onCenterDone={() => setCenterSignal(null)}
          />

          {/* Pin personalizado — panel inferior */}
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
                <span style={{ fontSize:'0.7rem', color:'var(--gray-400)' }}>Toca el mapa para mover</span>
              </div>
              <button onClick={() => { setCustomPin(null); setPinAddress(null); }}
                style={{ border:'none', background:'none', cursor:'pointer', color:'var(--gray-400)', fontSize:'1rem', lineHeight:1, padding:'0.15rem', flexShrink:0 }}>
                ✕
              </button>
            </div>
          )}

          {/* Hint — disponible, sin pin ni oferta */}
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

          {/* ── FABs flotantes — columna derecha, NO se solapan ──────── */}
          {/*
              Distribución de abajo a arriba (safe-area incluida):
              16px   — margen base
              56px   — FAB Navegación Google (flecha rosa) — solo con ruta
              8px    — gap
              36px   — Botón Seguir ON/OFF            — solo con ruta
              8px    — gap
              36px   — Botón Centrar (toggle rosa/blanco)
          */}

          {/* Centrar — siempre visible, toggle activo=rosa / inactivo=blanco */}
          <button
            onClick={handleCenterToggle}
            aria-label={centerActive ? 'Desactivar centrado' : 'Activar centrado'}
            style={{
              position:'absolute',
              bottom: hasActiveOrder && routeGeometry?.length > 0
                ? 'calc(16px + 56px + 8px + 36px + 8px + env(safe-area-inset-bottom, 0px))'
                : 'calc(16px + env(safe-area-inset-bottom, 0px))',
              right: 12,
              zIndex: 402,
              width: 36, height: 36,
              borderRadius: '50%',
              background: centerActive ? 'var(--brand)' : '#ffffff',
              color:       centerActive ? '#ffffff'     : '#111827',
              border: centerActive ? 'none' : '1px solid #d1d5db',
              boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1rem',
              transition: 'background 0.18s, color 0.18s',
            }}
          >
            ⌖
          </button>

          {/* Seguir ON/OFF — solo cuando hay ruta */}
          {hasActiveOrder && routeGeometry?.length > 0 && (
            <button
              onClick={() => setNavFollowEnabled(v => !v)}
              aria-label="Modo seguimiento"
              style={{
                position:'absolute',
                bottom: 'calc(16px + 56px + 8px + env(safe-area-inset-bottom, 0px))',
                right: 12,
                zIndex: 401,
                height: 36,
                borderRadius: 18,
                background: navFollowEnabled ? '#111827' : '#ffffff',
                color:       navFollowEnabled ? '#fff'    : '#111827',
                border: '1px solid #d1d5db',
                padding: '0 0.7rem',
                fontSize: '0.74rem',
                fontWeight: 700,
                boxShadow: '0 2px 8px rgba(0,0,0,0.14)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {navFollowEnabled ? 'Seguir ON' : 'Seguir OFF'}
            </button>
          )}

          {/* Google Navigation FAB — solo con ruta activa */}
          {hasActiveOrder && routeGeometry?.length > 0 && (
            <button
              onClick={openGoogleNavigation}
              aria-label="Abrir en Google Maps"
              style={{
                position:'absolute',
                bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
                right: 12,
                zIndex: 400,
                width: 56, height: 56,
                borderRadius: '50%',
                background: 'var(--brand)',
                color: '#fff',
                border: 'none',
                cursor: 'pointer',
                boxShadow: '0 4px 16px rgba(0,0,0,0.28)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <svg width="26" height="26" viewBox="0 0 24 24"
                fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="3 11 22 2 13 21 11 13 3 11" fill="#fff" stroke="none"/>
              </svg>
            </button>
          )}

        </div>{/* fin mapa */}

        {/* ── Panel de oferta ───────────────────────────────────────── */}
        {pendingOffer && (
          <div style={{
            position:'absolute', bottom:0, left:0, right:0,
            zIndex:30,
            pointerEvents: offerMinimized ? 'none' : 'auto',
          }}>
            <div style={{
              position:'relative',
              transform: offerMinimized ? 'translateY(calc(100% - 22px))' : 'translateY(0)',
              transition:'transform 0.22s ease',
            }}>
              <button
                onClick={() => setOfferMinimized(m => !m)}
                style={{
                  position:'absolute', top:-22, left:'50%', transform:'translateX(-50%)',
                  width:74, height:22,
                  background:'#f3e8ed', color:'var(--brand)', border:'1px solid #e8c8d4',
                  borderBottom:'1px solid #e8c8d4', borderRadius:'6px 6px 0 0',
                  padding:0, cursor:'pointer', fontSize:'0.62rem', fontWeight:700,
                  boxShadow:'0 -2px 6px rgba(0,0,0,0.06)',
                  zIndex:31, whiteSpace:'nowrap', display:'flex', alignItems:'center', gap:3,
                  justifyContent:'center', pointerEvents:'auto',
                }}
                aria-label={offerMinimized ? 'Expandir oferta' : 'Minimizar oferta'}
              >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <polyline points={offerMinimized ? '6 15 12 9 18 15' : '18 9 12 15 6 9'} />
                </svg>
                Oferta
              </button>

              <div style={{
                background:'#fff', borderTop:'1px solid #e8c8d4',
                boxShadow:'0 -4px 20px rgba(0,0,0,0.14)', overflow:'hidden',
                pointerEvents: offerMinimized ? 'none' : 'auto',
              }}>
                <div style={{ padding:'0.6rem 1rem 0.75rem', overflowY:'auto' }}>
                  <div style={{ fontSize:'0.82rem', color:'var(--gray-700)', marginBottom:'0.3rem' }}>
                    {(pendingOffer.restaurant_name || pendingOffer.restaurantAddress) && (
                      <div style={{ marginBottom:'0.1rem' }}>
                        <span style={{ color:'var(--gray-400)', fontSize:'0.72rem' }}>Tienda: </span>
                        <strong>{pendingOffer.restaurant_name || pendingOffer.restaurantAddress}</strong>
                      </div>
                    )}
                    {(pendingOffer.restaurant_address || pendingOffer.restaurantAddress) && (
                      <div style={{ marginBottom:'0.1rem' }}>
                        <span style={{ color:'var(--gray-400)', fontSize:'0.72rem' }}>Dir. tienda: </span>
                        <strong>{pendingOffer.restaurant_address || pendingOffer.restaurantAddress}</strong>
                      </div>
                    )}
                    {(pendingOffer.customer_address || pendingOffer.customerAddress || pendingOffer.delivery_address) && (
                      <div style={{ marginBottom:'0.1rem' }}>
                        <span style={{ color:'var(--gray-400)', fontSize:'0.72rem' }}>Entrega: </span>
                        <strong>{pendingOffer.customer_address || pendingOffer.customerAddress || pendingOffer.delivery_address}</strong>
                      </div>
                    )}
                  </div>
                  {(() => {
                    const earn = (pendingOffer.delivery_fee_cents||0)
                      + Math.round((pendingOffer.service_fee_cents||0)*0.5)
                      + (pendingOffer.tip_cents||0)
                      || pendingOffer.driverEarning || 0;
                    return earn > 0 ? (
                      <div style={{ fontSize:'0.9rem', fontWeight:800, color:'var(--success)', marginBottom:'0.35rem' }}>
                        Tu ganancia: {fmt(earn)}
                      </div>
                    ) : null;
                  })()}
                  <OfferCountdown
                    key={pendingOffer.id}
                    secondsLeft={pendingOffer.seconds_left ?? pendingOffer.secondsLeft ?? 60}
                    onExpired={() => {
                      setPendingOffer(null); loadData();
                      consecutiveTimeoutsRef.current += 1;
                      if (consecutiveTimeoutsRef.current >= 3) {
                        consecutiveTimeoutsRef.current = 0;
                        setMsg('Se han vencido 3 ofertas seguidas.');
                      }
                    }}
                  />
                  <div style={{ display:'flex', gap:'0.5rem', marginTop:'0.5rem' }}>
                    <button className="btn-primary"
                      style={{ flex:1, padding:'0.65rem 0', fontSize:'0.95rem', fontWeight:700, borderRadius:10 }}
                      disabled={loadingOffer} onClick={acceptOffer}>
                      {loadingOffer ? 'Aceptando…' : '✓ Aceptar'}
                    </button>
                    <button
                      style={{ flex:1, padding:'0.65rem 0', fontSize:'0.95rem', fontWeight:700, borderRadius:10,
                        background:'var(--gray-100)', color:'var(--gray-700)', border:'1px solid var(--gray-200)', cursor:'pointer' }}
                      disabled={loadingOffer} onClick={rejectOffer}>
                      ✕ Rechazar
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Panel de pedido activo ────────────────────────────────── */}
        {activeOrder && (() => {
          const isOnTheWay = activeOrder.status === 'on_the_way';
          const isCash     = (activeOrder.payment_method || 'cash') === 'cash';
          const grandTotal = (activeOrder.total_cents||0)+(activeOrder.service_fee_cents||0)
                            +(activeOrder.delivery_fee_cents||0)+(activeOrder.tip_cents||0);
          const driverEarn = (activeOrder.delivery_fee_cents||0)
                            + Math.round((activeOrder.service_fee_cents||0)*0.5)
                            + (activeOrder.tip_cents||0);
          const DRIVER_STATUS = {
            assigned:'Asignado — ve a recoger', on_the_way:'En camino al cliente',
            preparing:'Esperando en tienda', ready:'Listo para retiro',
            accepted:'Aceptado', created:'Nuevo pedido',
          };
          return (
            <div style={{ flexShrink:0, background:'#fff',
              borderTop:'2px solid var(--success)', zIndex:10, position:'relative',
              display:'flex', flexDirection:'column',
              maxHeight: orderExpanded ? 'min(72vh, 520px)' : 'none',
              transition:'max-height 0.3s ease', overflow:'hidden' }}>

              {/* Vista compacta */}
              <div onClick={() => setOrderExpanded(e => !e)}
                style={{ padding:'0.55rem 1rem 0.6rem', flexShrink:0, cursor:'pointer', userSelect:'none' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span style={{ fontSize:'0.7rem', fontWeight:800, textTransform:'uppercase',
                    letterSpacing:'0.5px', color:'var(--success)' }}>
                    {DRIVER_STATUS[activeOrder.status] || activeOrder.status}
                  </span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke="var(--gray-400)" strokeWidth="2.5" strokeLinecap="round">
                    <polyline points={orderExpanded ? '18 15 12 9 6 15' : '6 9 12 15 18 9'} />
                  </svg>
                </div>

                {!isOnTheWay ? (
                  <div style={{ fontSize:'0.82rem', marginTop:'0.15rem' }}>
                    <strong>{activeOrder.restaurant_name}</strong>
                    {activeOrder.restaurant_address && (
                      <div style={{ color:'var(--gray-500)', fontSize:'0.77rem' }}>{activeOrder.restaurant_address}</div>
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
                        {activeOrder.customer_address || activeOrder.delivery_address}
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

                {/* Solo botón Ruta nueva — Maps se eliminó */}
                <div style={{ display:'flex', gap:'0.35rem', marginTop:'0.45rem' }}
                  onClick={e => e.stopPropagation()}>
                  <button className="btn-sm" onClick={openRoadRouteApi}>🗺 Ruta nueva</button>
                </div>
              </div>

              {/* Detalle expandible */}
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
                      <button className="btn-sm btn-danger" onClick={() => setShowRelease(s => !s)}>Liberar</button>
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

      </div>{/* fin driver-map-root */}
    </PullToRefresh>
  );
}
