import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useRealtimeOrders } from '../../hooks/useRealtimeOrders';
import { useDriverLocation } from '../../hooks/useDriverLocation';
import OfferCountdown from '../../components/OfferCountdown';
import { useNavFeatures } from '../../hooks/useNavFeatures';
import ZoneLayer from '../../components/ZoneLayer';
import ZonePlacer from '../../components/ZonePlacer';
import WayPicker from '../../components/WayPicker';

// ── CSS global de animaciones — inyectado UNA sola vez, completamente fuera del render ──
if (typeof document !== 'undefined' && !document.getElementById('dh-animations')) {
  const s = document.createElement('style');
  s.id = 'dh-animations';
  s.textContent = `
  @keyframes dh-spin { to { transform: rotate(360deg); } }
  .dh-spinner { animation: dh-spin 0.75s linear infinite; transform-origin: 50% 50%; }
  .dh-ptr-indicator {
    position: absolute; top: 0; left: 50%;
    transform: translateX(-50%) translateY(-50px);
    will-change: transform; pointer-events: none;
  }
  .dh-ptr-indicator.pulling { transition: none; }
  .dh-ptr-indicator.releasing { transition: transform 0.18s ease; }
  .dh-ptr-content { will-change: transform; }
  .dh-ptr-content.releasing { transition: transform 0.22s ease; }
  .dh-offer-panel { will-change: transform; transform: translateZ(0); }
  .dh-fab { will-change: transform; }
  `;
  document.head.appendChild(s);
}

function fmt(cents) { return `$${((cents ?? 0) / 100).toFixed(2)}`; }

function getNotifPriorityMode() {
  try {
    return localStorage.getItem('morelivery_notif_priority') === 'high' ? 'high' : 'normal';
  } catch (_) {
    return 'normal';
  }
}

function playOfferAlertSound() {
  if (typeof window === 'undefined') return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    const ctx = new Ctx();
    const pulse = (offset, freq, duration = 0.12) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + offset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + duration + 0.03);
    };
    pulse(0.00, 880);
    pulse(0.18, 1180);
    setTimeout(() => ctx.close().catch(() => {}), 600);
  } catch (_) {}
}

const STATUS_LABELS = {
  created:'Recibido', assigned:'Asignado', accepted:'Aceptado',
  preparing:'En preparación', ready:'Listo para retiro',
  on_the_way:'En camino', delivered:'Entregado',
  cancelled:'Cancelado', pending_driver:'Buscando conductor',
};

function FeeBreakdown({ order }) {
  const sub    = order.total_cents          || 0;
  const svc    = order.service_fee_cents    || 0;
  const delFee = order.delivery_fee_cents   || 0;
  const tip    = order.tip_cents            || 0;
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

// ── MapLibre loader ─────────────────────────────────────────────────────────────
// OPT-4: guarda la referencia resuelta en variable de módulo — sin Promise.resolve() en cada tick GPS
let _ml = null;
function ensureMapLibreCSS() {
  if (document.getElementById('maplibre-css')) return;
  const lnk = document.createElement('link');
  lnk.id = 'maplibre-css'; lnk.rel = 'stylesheet';
  lnk.href = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css';
  document.head.appendChild(lnk);
}
function ensureMapLibreJS() {
  if (_ml) return Promise.resolve(_ml);
  if (window.maplibregl) { _ml = window.maplibregl; return Promise.resolve(_ml); }
  if (window.__mlPromise) return window.__mlPromise;
  window.__mlPromise = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js';
    s.async = true;
    s.onload = () => { _ml = window.maplibregl; res(_ml); };
    s.onerror = () => rej(new Error('No se pudo cargar MapLibre GL JS'));
    document.head.appendChild(s);
  });
  return window.__mlPromise;
}

// ── Helpers geométricos ────────────────────────────────────────────────────────
function normalizeBearing(d) { return (d + 360) % 360; }
function getBearing(from, to) {
  if (!from || !to) return 0;
  const la1 = from.lat * Math.PI / 180, la2 = to.lat * Math.PI / 180;
  const dL  = (to.lng - from.lng) * Math.PI / 180;
  const y   = Math.sin(dL) * Math.cos(la2);
  const x   = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dL);
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
    const a = d.address || {};
    const poi  = a.amenity || a.shop || a.office || a.building || a.tourism || null;
    const road = a.road || a.pedestrian || a.footway || '';
    const num  = a.house_number ? ` ${a.house_number}` : '';
    const col  = a.suburb || a.neighbourhood || a.city_district || '';
    if (poi)  return `${poi}${road ? ` · ${road}${num}` : ''}`;
    if (road) return `${road}${num}${col ? `, ${col}` : ''}`;
    return d.display_name?.split(',').slice(0,2).join(', ') || null;
  } catch { return null; }
}

// ── DriverMap ──────────────────────────────────────────────────────────────────
// OPT-4:  _ml evita Promise.resolve() en cada tick GPS
// OPT-5:  posición y heading separados — heading solo muta el SVG sin recrear DOM
// OPT-6:  SVG del marcador vive en el DOM; solo se muta su style.transform para rotar
// OPT-7:  hasActiveOrder se lee desde ref dentro del listener de click del mapa
// OPT-12: livePos y liveHeading son refs, NO estado — sin re-render en cada tick GPS
function DriverMap({
  driverPos, customPin, onCustomPin, hasActiveOrder,
  pickupPos, deliveryPos, pickupLabel, deliveryLabel,
  routeGeometry, onRouteError,
  navFollowEnabled, navHeadingDeg, onHeadingChange,
  centerSignal, onCenterDone,
  onMapReady,
}) {
  const containerRef       = useRef(null);
  const mapRef             = useRef(null);
  const markersRef         = useRef({ driver:null, driverSvg:null, custom:null, pickup:null, delivery:null });
  const livePosRef         = useRef(driverPos || null);  // OPT-12
  const liveHeadingRef     = useRef(0);                  // OPT-12
  const watchIdRef         = useRef(null);
  const prevWatchPosRef    = useRef(null);
  const hasActiveOrderRef  = useRef(hasActiveOrder);     // OPT-7
  const navFollowRef       = useRef(navFollowEnabled);   // leído en watchPosition sin deps
  const onHeadingChangeRef = useRef(onHeadingChange);
  const zoomCtrlRef        = useRef(null);
  const zoomTimeoutRef     = useRef(null);
  const [showAttrib, setShowAttrib] = useState(false);
  const [hasGPS,     setHasGPS]     = useState(Boolean(driverPos));

  const DEFAULT_POS = { lat: 19.70595, lng: -101.19498 };

  // Mantener refs sincronizadas sin recrear listeners
  useEffect(() => { hasActiveOrderRef.current  = hasActiveOrder;  }, [hasActiveOrder]);
  useEffect(() => { navFollowRef.current        = navFollowEnabled; }, [navFollowEnabled]);
  useEffect(() => { onHeadingChangeRef.current  = onHeadingChange;  }, [onHeadingChange]);
  useEffect(() => {
    if (driverPos) {
      livePosRef.current = driverPos;
      setHasGPS(true);
    }
  }, [driverPos?.lat, driverPos?.lng]);
  // Si el mapa ya está creado y se recibe la primera posición GPS después del load,
  // (re)construir el marcador para que siempre sea visible.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !_ml) return;
    if (!driverPos && !livePosRef.current) return;
    _buildDriverMarker(_ml, map);
  }, [driverPos?.lat, driverPos?.lng]);

  // watchPosition — suscripción ÚNICA, todo vía refs (OPT-12)
  // En cada tick: mueve el marcador directamente en el DOM, NO llama setState
  useEffect(() => {
    if (!navigator?.geolocation) return;
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const prev = prevWatchPosRef.current;
        if (prev) {
          const h = getBearing(prev, next);
          liveHeadingRef.current = h;
          onHeadingChangeRef.current?.(h);
          // OPT-6: rotar SVG directamente sin recrear ni setState
          const svg = markersRef.current.driverSvg;
          if (svg && navFollowRef.current) svg.style.transform = `rotate(${h}deg)`;
        }
        prevWatchPosRef.current = next;
        livePosRef.current = next;
        setHasGPS(true);
        // Mover marcador sin setState — mutación DOM directa
        if (markersRef.current.driver && mapRef.current) {
          markersRef.current.driver.setLngLat([next.lng, next.lat]);
          if (navFollowRef.current) {
            const map = mapRef.current;
            const h   = liveHeadingRef.current;
            map.easeTo({
              center: [next.lng, next.lat], bearing: h, pitch: 60, zoom: 19,
              duration: 250, offset: [0, Math.round(map.getContainer().clientHeight * 0.18)],
                       essential: true,
            });
          }
        }
      },
      () => {},
                                                             { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
    );
    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Crear el SVG del marcador del driver — se llama al montar y al cambiar modo follow
  // OPT-6: el SVG se crea con createElementNS (sin innerHTML) para no perder la referencia
  function _buildDriverMarker(ml, map) {
    if (markersRef.current.driver) {
      markersRef.current.driver.remove();
      markersRef.current.driver = null;
      markersRef.current.driverSvg = null;
    }
    const pos = livePosRef.current;
    if (!pos) return;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '80'); svg.setAttribute('height', '80');
    svg.setAttribute('viewBox', '0 0 24 24');
    // Colores invertidos: relleno más sólido y borde ligeramente translúcido
    const fillColor   = '#e3aaaa';
    const strokeColor = 'rgba(227,170,170,0.85)';
    svg.setAttribute('fill', fillColor);
    svg.setAttribute('stroke', strokeColor);
    svg.setAttribute('stroke-width', '1.4');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.style.cssText = 'display:block;transform-origin:50% 55%;';
    svg.style.transform = navFollowRef.current
    ? `rotate(${liveHeadingRef.current}deg)` : 'rotate(0deg)';

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z');
    svg.appendChild(path);

    const wrap = document.createElement('div');
    wrap.style.cssText = 'width:80px;height:80px';
    wrap.appendChild(svg);

    markersRef.current.driverSvg = svg;
    markersRef.current.driver = new ml.Marker({ element: wrap, anchor: 'center' })
    .setLngLat([pos.lng, pos.lat]).addTo(map);
  }

  // Inicializar mapa UNA sola vez
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    ensureMapLibreCSS();
    ensureMapLibreJS().then((ml) => {
      if (!containerRef.current || mapRef.current) return;
      const start = livePosRef.current || DEFAULT_POS;
      const map = new ml.Map({
        container: containerRef.current,
        style: 'https://tiles.openfreemap.org/styles/liberty',
        center: [start.lng, start.lat],
        zoom: 14, pitch: 30, bearing: 0, maxZoom: 20,
        attributionControl: false,
        antialias: false,           // OPT-perf: reduce overdraw en gama media
        preserveDrawingBuffer: false,
      });
      map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
      // Ocultar controles de zoom por defecto y solo mostrarlos tras interacción por 3s
      const ctrl = containerRef.current.querySelector('.maplibregl-ctrl-top-right');
      if (ctrl) {
        zoomCtrlRef.current = ctrl;
        ctrl.style.opacity = '0';
        ctrl.style.pointerEvents = 'none';
        ctrl.style.transition = 'opacity 0.18s ease';
      }
      const showZoomTemporarily = () => {
        const el = zoomCtrlRef.current;
        if (!el) return;
        el.style.opacity = '1';
        el.style.pointerEvents = 'auto';
        if (zoomTimeoutRef.current) clearTimeout(zoomTimeoutRef.current);
        zoomTimeoutRef.current = setTimeout(() => {
          el.style.opacity = '0';
          el.style.pointerEvents = 'none';
        }, 3000);
      };
      ['mousedown','touchstart','wheel','dragstart'].forEach(ev => {
        map.on(ev, showZoomTemporarily);
      });
      // OPT-7: leer hasActiveOrder desde ref, no closure estático
      map.on('click', (e) => {
        if (hasActiveOrderRef.current) return;
        onCustomPin?.({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      });
      map.once('load', () => _buildDriverMarker(ml, map));
      mapRef.current = map;
      onMapReady?.(map);
    }).catch(() => onRouteError?.('No se pudo inicializar el mapa'));
    return () => {
      if (zoomTimeoutRef.current) {
        clearTimeout(zoomTimeoutRef.current);
        zoomTimeoutRef.current = null;
      }
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // OPT-5: efecto separado para cambios de modo follow — reconstruye marcador + centra
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !_ml) return;
    _buildDriverMarker(_ml, map);
    if (navFollowEnabled) {
      const pos = livePosRef.current;
      if (!pos) return;
      const h = liveHeadingRef.current || navHeadingDeg || 0;
      map.easeTo({ center:[pos.lng,pos.lat], bearing:h, pitch:60, zoom:19,
        duration:350, offset:[0, Math.round(map.getContainer().clientHeight * 0.18)], essential:true });
    }
  }, [navFollowEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // OPT-5: efecto SOLO para heading cuando el marcador ya existe y el SVG está en el DOM
  useEffect(() => {
    const svg = markersRef.current.driverSvg;
    if (!svg) return;
    svg.style.transform = navFollowEnabled
    ? `rotate(${navHeadingDeg}deg)` : 'rotate(0deg)';
  }, [navHeadingDeg, navFollowEnabled]);

  // Pin personalizado
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !_ml) return;
    if (markersRef.current.custom) { markersRef.current.custom.remove(); markersRef.current.custom = null; }
    if (customPin && !hasActiveOrder) {
      const el = document.createElement('div');
      el.style.cssText = 'width:16px;height:16px;border-radius:999px;background:var(--brand);border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.35)';
      markersRef.current.custom = new _ml.Marker({ element: el })
      .setLngLat([customPin.lng, customPin.lat]).addTo(map);
    }
  }, [customPin?.lat, customPin?.lng, hasActiveOrder]);

  // Marcadores tienda / cliente
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !_ml) return;
    if (markersRef.current.pickup)   { markersRef.current.pickup.remove();   markersRef.current.pickup   = null; }
    if (markersRef.current.delivery) { markersRef.current.delivery.remove(); markersRef.current.delivery = null; }
    const mkr = (pos, emoji, color, label) => {
      const el = document.createElement('div');
      el.style.cssText = `width:28px;height:28px;border-radius:50%;background:${color};display:grid;place-items:center;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.3);font-size:15px`;
      el.textContent = emoji;
      return new _ml.Marker({ element: el }).setLngLat([pos.lng, pos.lat])
      .setPopup(new _ml.Popup({ closeButton: false }).setText(label));
    };
    if (pickupPos)   markersRef.current.pickup   = mkr(pickupPos,   '🏪', '#16a34a', pickupLabel   || 'Tienda').addTo(map);
    if (deliveryPos) markersRef.current.delivery = mkr(deliveryPos, '📦', '#f97316', deliveryLabel || 'Cliente').addTo(map);
  }, [pickupPos?.lat, pickupPos?.lng, deliveryPos?.lat, deliveryPos?.lng, pickupLabel, deliveryLabel]);

    // Ruta GeoJSON
    useEffect(() => {
      const map = mapRef.current;
      if (!map) return;
      const SRC = 'driver-route-source', LYR = 'driver-route-layer', BDR = 'driver-route-border';
      const draw = () => {
        const geo = { type:'Feature', properties:{},
        geometry:{ type:'LineString', coordinates:(routeGeometry||[]).map(p=>[p.lng,p.lat]) } };
        if (!map.getSource(SRC)) map.addSource(SRC, { type:'geojson', data:geo });
        else map.getSource(SRC).setData(geo);
        if (!map.getLayer(LYR)) map.addLayer({ id:LYR, type:'line', source:SRC,
          paint:{ 'line-color':'#ad1457', 'line-width':14, 'line-opacity':0.8 },
          layout:{ 'line-cap':'round', 'line-join':'round' } });
        if (!map.getLayer(BDR)) map.addLayer({ id:BDR, type:'line', source:SRC,
          paint:{ 'line-color':'#e3aaaa', 'line-width':8, 'line-opacity':0.6 },
          layout:{ 'line-cap':'round', 'line-join':'round' } });
      };
      if (map.isStyleLoaded()) draw(); else map.once('load', draw);
    }, [routeGeometry]);

      // Centrar — señal puntual del padre
      useEffect(() => {
        if (!centerSignal || !mapRef.current) return;
        const map = mapRef.current;
        const pos = livePosRef.current || driverPos;
        if (!pos) { onCenterDone?.(); return; }
        if (centerSignal === 'follow') {
          const h = liveHeadingRef.current || navHeadingDeg || 0;
          const offsetY = Math.round(map.getContainer().clientHeight * 0.18);
          map.easeTo({ center:[pos.lng,pos.lat], zoom:19, pitch:60, bearing:h,
            duration:350, offset:[0,offsetY], essential:true });
        } else {
          map.easeTo({ center:[pos.lng,pos.lat], zoom:14, pitch:30, bearing:0, duration:350, essential:true });
        }
        onCenterDone?.();
      }, [centerSignal]); // eslint-disable-line react-hooks/exhaustive-deps

      return (
        <div style={{ height:'100%', width:'100%', position:'relative' }}>
        <div ref={containerRef} style={{ height:'100%', width:'100%' }} />

        {showAttrib && (
          <div style={{ position:'absolute', bottom:52, left:8, zIndex:10,
            background:'rgba(255,255,255,0.92)', borderRadius:6, padding:'0.3rem 0.6rem',
                        fontSize:'0.65rem', color:'#444', boxShadow:'0 1px 6px #0002', maxWidth:260, pointerEvents:'none' }}>
                        © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer"
                        style={{ color:'#2563eb' }}>OpenStreetMap</a> contributors ·{' '}
                        <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer"
                        style={{ color:'#2563eb' }}>OpenFreeMap</a> ·{' '}
                        <a href="https://maplibre.org" target="_blank" rel="noopener noreferrer"
                        style={{ color:'#2563eb' }}>MapLibre</a>
                        </div>
        )}
        <button onClick={() => setShowAttrib(v => !v)} title="Atribuciones"
        style={{ position:'absolute', bottom:8, left:8, zIndex:10,
          background:'rgba(255,255,255,0.82)', border:'1px solid #ccc',
              borderRadius:4, width:22, height:22, cursor:'pointer',
              fontSize:'0.65rem', display:'flex', alignItems:'center', justifyContent:'center',
              color:'#555', padding:0 }}>ℹ</button>

              {!hasGPS && (
                <div style={{ position:'absolute', top:8, left:'50%', transform:'translateX(-50%)',
                  background:'rgba(0,0,0,0.5)', color:'#fff', borderRadius:20,
                           padding:'0.2rem 0.75rem', fontSize:'0.72rem', zIndex:5,
                           pointerEvents:'none', whiteSpace:'nowrap' }}>
                           📍 Sin GPS — toca el mapa para marcar posición
                           </div>
              )}
              </div>
      );
}

// ── PullToRefresh ─────────────────────────────────────────────────────────────
// OPT-1: SIN setState en touchMove — manipula DOM directamente con refs
// OPT-2: spinner con CSS animation puro (@keyframes dh-spin), sin JS
// OPT-3: indicador posicionado con transform:translateY, nunca con `top` animado
const PTR_THRESHOLD  = 72;
const PTR_RESISTANCE = 0.45;

function PullToRefresh({ onRefresh, children }) {
  const wrapRef      = useRef(null);
  const contentRef   = useRef(null);
  const indicatorRef = useRef(null);
  const arcRef       = useRef(null);
  const startYRef    = useRef(null);
  const pullRef      = useRef(0);
  const loadingRef   = useRef(false);
  // Solo este bit de estado afecta el render (activa/desactiva spinner CSS)
  const [loading, setLoading] = useState(false);

  // Mutación directa del DOM — SIN setState, SIN re-render
  function _applyPull(px) {
    pullRef.current = px;
    const ind = indicatorRef.current, con = contentRef.current, arc = arcRef.current;
    if (!ind || !con) return;
    const indY = px > 4 ? Math.max(-36, px - 36) : -50;
    ind.style.transform = `translateX(-50%) translateY(${indY}px)`;
    con.style.transform = `translateY(${px}px)`;
    if (arc) {
      const p = Math.min(px / PTR_THRESHOLD, 1);
      arc.setAttribute('stroke-dasharray', `${p * 56.5} 56.5`);
      arc.style.transform = `rotate(${p * 270 - 90}deg)`;
    }
  }

  function _release() {
    const con = contentRef.current, ind = indicatorRef.current;
    ind?.classList.remove('pulling');
    ind?.classList.add('releasing');
    con?.classList.add('releasing');
    _applyPull(0);
    // Limpiar clases tras transición
    setTimeout(() => {
      ind?.classList.remove('releasing');
      con?.classList.remove('releasing');
    }, 250);
    if (arcRef.current) arcRef.current.setAttribute('stroke-dasharray', '0 56.5');
    pullRef.current = 0;
  }

  const onTouchStart = useCallback((e) => {
    if (loadingRef.current || (wrapRef.current?.scrollTop ?? 0) > 0) return;
    startYRef.current = e.touches[0].clientY;
    indicatorRef.current?.classList.add('pulling');
    contentRef.current?.classList.remove('releasing');
  }, []);

  const onTouchMove = useCallback((e) => {
    if (startYRef.current == null || loadingRef.current) return;
    if ((wrapRef.current?.scrollTop ?? 0) > 0) { startYRef.current = null; return; }
    const dy = e.touches[0].clientY - startYRef.current;
    if (dy <= 0) { if (pullRef.current > 0) _applyPull(0); return; }
    _applyPull(Math.min(dy * PTR_RESISTANCE, PTR_THRESHOLD + 20));
  }, []);

  const onTouchEnd = useCallback(() => {
    if (startYRef.current == null) return;
    startYRef.current = null;
    const shouldRefresh = pullRef.current >= PTR_THRESHOLD && !loadingRef.current;
    if (!shouldRefresh) {
      _release();
      return;
    }
    loadingRef.current = true;
    setLoading(true);
    // Mantener la posición "pull" mientras se recarga en segundo plano
    Promise.resolve(onRefresh()).then(() => {
      const con = contentRef.current;
      if (con) {
        con.style.transition = 'opacity 0.18s ease';
        con.style.opacity = '0';
        requestAnimationFrame(() => {
          con.style.opacity = '1';
        });
      }
    }).finally(() => {
      loadingRef.current = false;
      setLoading(false);
      _release();
    });
  }, [onRefresh]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={wrapRef} style={{ height:'100%', overflow:'hidden', position:'relative' }}
    onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>

    {/* OPT-3: posición siempre con transform, nunca con `top` */}
    <div ref={indicatorRef} className="dh-ptr-indicator releasing">
    <div style={{ width:36, height:36, borderRadius:'50%', background:'#fff',
      boxShadow:'0 2px 12px rgba(0,0,0,0.18)', display:'flex',
          alignItems:'center', justifyContent:'center' }}>
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <circle cx="11" cy="11" r="9" stroke="#e5e7eb" strokeWidth="2.5"/>
          {/* OPT-2: cuando loading, anima con CSS puro; cuando se arrastra, stroke-dasharray se muta por ref */}
          <circle ref={arcRef} cx="11" cy="11" r="9"
          stroke="var(--brand)" strokeWidth="2.5"
          strokeDasharray="0 56.5" strokeLinecap="round"
          style={{
            transformOrigin: '50% 50%',
            ...(loading ? { animation:'dh-spin 0.75s linear infinite' } : {}),
          }}
          />
          </svg>
          </div>
          </div>

          {/* OPT-1: transform gestionado por refs, NO por state */}
          <div ref={contentRef} className="dh-ptr-content"
          style={{ height:'100%', display:'flex', flexDirection:'column' }}>
          {children}
          </div>
          </div>
  );
}

// ── DriverHome ─────────────────────────────────────────────────────────────────
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
  const [routeSteps,     setRouteSteps]     = useState([]);
  const [msg,            setMsg]            = useState('');
  const [notifPermission, setNotifPermission] = useState(
    (typeof window !== 'undefined' && 'Notification' in window) ? Notification.permission : 'unsupported'
  );
  const [notifPriorityMode, setNotifPriorityMode] = useState(getNotifPriorityMode);
  const [navFollowEnabled, setNavFollowEnabled] = useState(false);
  // OPT-12: heading como state solo para pasarlo a DriverMap como prop de fallback
  // El heading real se gestiona en DriverMap vía refs — este state solo actualiza 1 vez/segundo aprox.
  const [navHeadingDeg,  setNavHeadingDeg]  = useState(0);
  const [centerSignal,   setCenterSignal]   = useState(null);
  const [centerActive,   setCenterActive]   = useState(false);

  const [activeZones,  setActiveZones]  = useState([]);
  // navMode: null | 'menu' | 'zone' | 'impassable' | 'preference'
  const [navMode,      setNavMode]      = useState(null);
  const [mapInstance,  setMapInstance]  = useState(null);

  const loadDataRef     = useRef(null);
  const loadDebounceRef = useRef(null);

  // OPT-8: centerActive como ref — el handler de eventos globales NO se recrea al hacer toggle
  const centerActiveRef = useRef(false);
  const autoCenterRef   = useRef(null);

  const scheduleAutoCenter = useCallback(() => {
    if (autoCenterRef.current) clearTimeout(autoCenterRef.current);
    if (!centerActiveRef.current) return;
    autoCenterRef.current = setTimeout(() => {
      if (centerActiveRef.current) setCenterSignal('follow');
    }, 5000);
  }, []); // OPT-8: sin deps — lee centerActiveRef en lugar de centerActive state

  // OPT-8: addEventListener se ejecuta UNA vez porque scheduleAutoCenter es estable
  useEffect(() => {
    const evs = ['touchstart', 'touchmove', 'pointerdown', 'wheel'];
    const h = () => scheduleAutoCenter();
    evs.forEach(ev => document.addEventListener(ev, h, { passive: true }));
    return () => evs.forEach(ev => document.removeEventListener(ev, h));
  }, [scheduleAutoCenter]);

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
    .then(a => setPinAddress(a || `${customPin.lat.toFixed(5)}, ${customPin.lng.toFixed(5)}`))
    .finally(() => setLoadingPin(false));
  }, [customPin?.lat, customPin?.lng]);

  const { position: myPosition, error: gpsError } = useDriverLocation(auth.token, availability, hasActiveOrder);

  const prevPosRef = useRef(null);
  useEffect(() => {
    if (!myPosition) return;
    const prev = prevPosRef.current;
    if (prev) {
      const dy = myPosition.lat - prev.lat, dx = myPosition.lng - prev.lng;
      if (Math.abs(dx) + Math.abs(dy) > 0.00001)
        setNavHeadingDeg(((Math.atan2(dx, dy) * 180 / Math.PI) + 360) % 360);
    }
    prevPosRef.current = myPosition;
  }, [myPosition?.lat, myPosition?.lng]);

  const tokenRef = useRef(auth.token);
  const lastOfferAlertRef = useRef(null);
  useEffect(() => { tokenRef.current = auth.token; }, [auth.token]);

  useEffect(() => {
    const refreshNotifState = () => {
      if (typeof window === 'undefined') return;
      setNotifPriorityMode(getNotifPriorityMode());
      if ('Notification' in window) setNotifPermission(Notification.permission);
    };
    refreshNotifState();
    window.addEventListener('focus', refreshNotifState);
    window.addEventListener('storage', refreshNotifState);
    return () => {
      window.removeEventListener('focus', refreshNotifState);
      window.removeEventListener('storage', refreshNotifState);
    };
  }, []);

  useEffect(() => {
    if (!pendingOffer?.id) return;
    if (lastOfferAlertRef.current === pendingOffer.id) return;
    lastOfferAlertRef.current = pendingOffer.id;

    setMsg('Nueva oferta: revisa y responde antes de que expire.');
    playOfferAlertSound();

    const shouldUseHighPattern = notifPriorityMode === 'high' || notifPermission === 'granted';
    if (navigator?.vibrate) {
      navigator.vibrate(shouldUseHighPattern ? [300, 100, 300, 100, 300] : [180, 80, 180]);
    }
  }, [pendingOffer?.id, notifPriorityMode, notifPermission]);

  const announceListener = useCallback(async () => {
    if (!tokenRef.current) return;
    try { await apiFetch('/drivers/listener', { method:'POST' }, tokenRef.current); loadDataRef.current?.(); }
    catch (_) {}
  }, []);

  const loadData = useCallback(async () => {
    if (!auth.token) return;
    try {
      const [od, off] = await Promise.all([
        apiFetch('/orders/my?active=1', {}, auth.token),
                                          apiFetch('/drivers/offers',     {}, auth.token),
      ]);
      const active = (od.orders||[])
      .filter(o => !['delivered','cancelled'].includes(o.status))
      .sort((a,b) => new Date(a.accepted_at||a.created_at) - new Date(b.accepted_at||b.created_at))[0] || null;
      setActiveOrder(active);
      const newOffer = (off.offers||[]).length > 0 ? off.offers[0] : null;
      setPendingOffer(prev => { if (newOffer?.id !== prev?.id) setOfferMinimized(false); return newOffer; });
    } catch (_) {}
  }, [auth.token]);

  useEffect(() => { loadDataRef.current = loadData; });

  useEffect(() => {
    setAvailability(Boolean(auth.user?.driver?.is_available));
    loadData();
    if (!auth.token) return;
    apiFetch('/drivers/me', {}, auth.token)
    .then(d => {
      const fresh = Boolean(d?.profile?.is_available);
      setAvailability(fresh);
      patchUser({ driver: { ...(auth.user?.driver||{}), is_available: fresh } });
    }).catch(() => {});
  }, [auth.token]); // eslint-disable-line react-hooks/exhaustive-deps

  const availabilityRef     = useRef(availability);
  const pendingOfferRef     = useRef(pendingOffer);
  const hasActiveOrderRef2  = useRef(hasActiveOrder);
  const consecutiveTimeouts = useRef(0);
  useEffect(() => { availabilityRef.current    = availability;   }, [availability]);
  useEffect(() => { pendingOfferRef.current    = pendingOffer;   }, [pendingOffer]);
  useEffect(() => { hasActiveOrderRef2.current = hasActiveOrder; }, [hasActiveOrder]);

  useEffect(() => {
    const id = setInterval(() => {
      if (!availabilityRef.current || pendingOfferRef.current || hasActiveOrderRef2.current) return;
      announceListener();
    }, 4000);
    setTimeout(() => {
      if (availabilityRef.current && !pendingOfferRef.current && !hasActiveOrderRef2.current)
        announceListener();
    }, 500);
    return () => clearInterval(id);
  }, [announceListener]);

  const handleNewOffer = useCallback((data) => {
    setPendingOffer(prev => prev ? prev : { id:data.orderId, ...data, seconds_left:data.secondsLeft ?? 60 });
    setTimeout(() => loadDataRef.current?.(), 600);
  }, []);

  useRealtimeOrders(auth.token, () => scheduleLoad(), () => {}, handleNewOffer);

  async function toggleAvailability() {
    try {
      const r = await apiFetch('/drivers/availability',
                               { method:'PATCH', body:JSON.stringify({ isAvailable:!availability }) }, auth.token);
      const next = Boolean(r?.profile?.is_available);
      setAvailability(next);
      patchUser({ driver: { ...(auth.user?.driver||{}), is_available: next } });
    } catch (e) { setMsg(e.message); }
  }

  async function acceptOffer() {
    if (!pendingOffer) return;
    consecutiveTimeouts.current = 0;
    setLoadingOffer(true);
    try {
      await apiFetch(`/drivers/offers/${pendingOffer.id}/accept`, { method:'POST' }, auth.token);
      setPendingOffer(null); setOfferMinimized(false); setOrderExpanded(false); loadData();
    } catch (e) { setMsg(e.message); }
    finally { setLoadingOffer(false); }
  }

  async function rejectOffer() {
    if (!pendingOffer) return;
    consecutiveTimeouts.current = 0;
    setLoadingOffer(true);
    try {
      await apiFetch(`/drivers/offers/${pendingOffer.id}/reject`, { method:'POST' }, auth.token);
      setPendingOffer(null); loadData();
    } catch (e) { setMsg(e.message); }
    finally { setLoadingOffer(false); }
  }

  async function changeStatus(orderId, status) {
    setLoadingStatus(status);
    try {
      await apiFetch(`/orders/${orderId}/status`,
                     { method:'PATCH', body:JSON.stringify({ status }) }, auth.token);
      loadData();
    } catch (e) { setMsg(e.message); }
    finally { setLoadingStatus(''); }
  }

  async function doRelease() {
    if (!activeOrder) return;
    try {
      await apiFetch(`/drivers/orders/${activeOrder.id}/release`,
                     { method:'POST', body:JSON.stringify({ note: releaseNote }) }, auth.token);
      setShowRelease(false); setReleaseNote(''); loadData();
    } catch (e) { setMsg(e.message); }
  }

  function openRoadRouteApi() {
    if (!activeOrder) return;
    const start    = myPosition || (activeOrder.restaurant_lat
    ? { lat:Number(activeOrder.restaurant_lat), lng:Number(activeOrder.restaurant_lng) } : null);
    const pickup   = activeOrder.restaurant_lat
    ? { lat:Number(activeOrder.restaurant_lat), lng:Number(activeOrder.restaurant_lng) } : null;
    const delivery = activeOrder.customer_lat
    ? { lat:Number(activeOrder.customer_lat),   lng:Number(activeOrder.customer_lng)   } : null;
    if (!start || !pickup || !delivery) return setMsg('Faltan coordenadas para trazar la ruta');
    apiFetch('/routes/model', {
      method:'POST',
      body:JSON.stringify({ origin:start, destination:delivery, waypoints:[pickup], includeSteps:true }),
    }, auth.token)
    .then(d => {
      if (!d?.geometry?.length) throw new Error();
      setRouteGeometry(d.geometry);
      setRouteSteps(Array.isArray(d?.steps) ? d.steps : []);
      setMsg('Ruta trazada');
    })
    .catch(() => {
      setRouteGeometry(null);
      setRouteSteps([]);
      setMsg('No se pudo calcular la ruta');
    });
  }

  function openGoogleNavigation() {
    if (!activeOrder) return;
    const ot   = activeOrder.status === 'on_the_way';
    const dLat = ot ? Number(activeOrder.customer_lat)    : Number(activeOrder.restaurant_lat);
    const dLng = ot ? Number(activeOrder.customer_lng)    : Number(activeOrder.restaurant_lng);
    if (!dLat || !dLng) return setMsg('Faltan coordenadas para navegar');
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIOS) {
      const a = document.createElement('a');
      a.href = `comgooglemaps://?daddr=${dLat},${dLng}&directionsmode=driving`; a.click();
      setTimeout(() => window.open(`https://maps.google.com/maps?daddr=${dLat},${dLng}&directionsmode=driving`, '_blank', 'noopener'), 500);
    } else {
      window.location.href = `google.navigation:q=${dLat},${dLng}&mode=d`;
    }
  }

  useEffect(() => {
    if (!activeOrder) {
      setRouteGeometry(null);
      setRouteSteps([]);
    }
  }, [activeOrder]);

  const handleRefresh = useCallback(() => loadData(), [loadData]);

  const { voiceEnabled, setVoiceEnabled, wakeLockActive } =
    useNavFeatures({
      steps:       routeSteps,
      currentPos:  myPosition,
      activeZones,
      onVoice: (voiceMsg) => setMsg(voiceMsg),
    });

  // Carga de zonas activas — cada 2 minutos
  useEffect(() => {
    function fetchZones() {
      apiFetch('/nav/zones/active', {}, null)
        .then(d => { if (Array.isArray(d?.zones)) setActiveZones(d.zones); })
        .catch(() => {});
    }
    fetchZones();
    const id = setInterval(fetchZones, 2 * 60 * 1000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleCenterToggle() {
    const next = !centerActive;
    setCenterActive(next);
    centerActiveRef.current = next; // OPT-8: sincronizar ref
    setCenterSignal(next ? 'follow' : 'free');
    if (next) scheduleAutoCenter();
    else { clearTimeout(autoCenterRef.current); autoCenterRef.current = null; }
  }

  // OPT-11: CSS grid-template-rows en lugar de max-height — no genera reflow por frame
  const expandStyle = {
    display: 'grid',
    gridTemplateRows: orderExpanded ? '1fr' : '0fr',
    transition: 'grid-template-rows 0.22s ease',
    overflow: 'hidden',
  };

  return (
    <PullToRefresh onRefresh={handleRefresh}>
    <div className="driver-map-root" style={{ display:'flex', flexDirection:'column',
      height:'100%', overflow:'hidden', position:'relative' }}>

      {/* Encabezado */}
      <div style={{ flexShrink:0,
        background:'linear-gradient(135deg,var(--brand) 0%,#c0546a 100%)',
          padding:'0.65rem 1rem', display:'flex', justifyContent:'space-between',
          alignItems:'center', gap:8, zIndex:10 }}>
          <div>
          <div style={{ fontWeight:700, fontSize:'0.875rem', color:'#fff' }}>
          {availability ? '● Disponible' : '○ No disponible'}
          </div>
          {myPosition && <div style={{ fontSize:'0.7rem', color:'rgba(255,255,255,0.8)' }}>GPS · ±{myPosition.accuracy}m</div>}
          <div style={{ fontSize:'0.68rem', color:'rgba(255,255,255,0.86)' }}>
            🔔 {notifPermission === 'granted' ? 'Notifs ON' : notifPermission === 'denied' ? 'Notifs bloqueadas' : 'Notifs pendientes'} ·
            prioridad {notifPriorityMode === 'high' ? 'alta' : 'normal'}
          </div>
          {wakeLockActive && <div style={{ fontSize:'0.68rem', color:'rgba(255,255,255,0.85)' }}>Pantalla activa para navegación</div>}
          {gpsError   && <div style={{ fontSize:'0.7rem', color:'#ffb3b3', maxWidth:200 }}>{gpsError}</div>}
          </div>
          <button onClick={toggleAvailability}
          className={availability ? 'btn-primary btn-sm' : 'btn-sm'}>
          {availability ? 'Disponible' : 'No disponible'}
          </button>
          </div>

          {msg && (
            <div className="flash flash-error"
            style={{ flexShrink:0, borderRadius:0, margin:0, display:'flex', justifyContent:'space-between' }}>
            <span style={{ fontSize:'0.83rem' }}>{msg}</span>
            <button onClick={() => setMsg('')}
            style={{ border:'none', background:'none', cursor:'pointer', fontWeight:700 }}>✕</button>
            </div>
          )}

          {/* Mapa */}
          <div style={{ flex:1, minHeight:0, position:'relative', overflow:'hidden', zIndex:0 }}>

          {!customPin && !hasActiveOrder && availability && (
            <div style={{ position:'absolute', top:8, left:'50%', transform:'translateX(-50%)',
              background:'rgba(0,0,0,0.55)', color:'#fff', borderRadius:20,
                                                             padding:'0.25rem 0.75rem', fontSize:'0.72rem', zIndex:5,
                                                             pointerEvents:'none', whiteSpace:'nowrap' }}>
                                                             📍 Toca el mapa para marcar tu posición
                                                             </div>
          )}

          <DriverMap
          driverPos={myPosition}
          customPin={customPin}
          onCustomPin={setCustomPin}
          hasActiveOrder={hasActiveOrder}
          pickupPos={activeOrder?.restaurant_lat
            ? { lat:Number(activeOrder.restaurant_lat), lng:Number(activeOrder.restaurant_lng) } : null}
            deliveryPos={activeOrder?.customer_lat
              ? { lat:Number(activeOrder.customer_lat),   lng:Number(activeOrder.customer_lng)   } : null}
              pickupLabel={activeOrder?.restaurant_name || 'Tienda'}
              deliveryLabel={activeOrder?.customer_name || activeOrder?.customer_first_name || 'Cliente'}
              routeGeometry={routeGeometry}
              onRouteError={setMsg}
              navFollowEnabled={navFollowEnabled}
              navHeadingDeg={navHeadingDeg}
              onHeadingChange={setNavHeadingDeg}
              centerSignal={centerSignal}
              onCenterDone={() => setCenterSignal(null)}
              onMapReady={setMapInstance}
              />

              {mapInstance && (
                <ZoneLayer map={mapInstance} zones={activeZones} onZoneClick={(z) => setMsg(`Zona: ${z.type}`)} />
              )}

              {/* Panel de pin */}
              {!hasActiveOrder && customPin && (
                <div style={{ position:'absolute', bottom:16, left:'50%', transform:'translateX(-50%)',
                  background:'#fff', borderRadius:10, padding:'0.5rem 0.875rem',
                  boxShadow:'0 2px 12px #0003', maxWidth:'calc(100% - 2rem)',
                                                zIndex:10, display:'flex', alignItems:'center', gap:'0.5rem', minWidth:180 }}>
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
                                                style={{ border:'none', background:'none', cursor:'pointer',
                                                  color:'var(--gray-400)', fontSize:'1rem', lineHeight:1,
                                                padding:'0.15rem', flexShrink:0 }}>✕</button>
                                                </div>
              )}

              {/* Hint */}
              {!hasActiveOrder && !customPin && !pendingOffer && availability && myPosition && (
                <div style={{ position:'absolute', bottom:16, left:'50%', transform:'translateX(-50%)',
                  background:'#ffffffdd', borderRadius:20, padding:'0.4rem 1rem',
                  fontSize:'0.78rem', color:'var(--gray-500)', boxShadow:'0 2px 8px #0002',
                                                                                                whiteSpace:'nowrap', zIndex:5, pointerEvents:'none' }}>
                                                                                                Toca el mapa para marcar tu ubicación
                                                                                                </div>
              )}

              {/* ── FABs — columna derecha, sin solapamiento ──────────── */}

              {/* Centrar — toggle rosa/blanco */}
              <button onClick={handleCenterToggle}
              aria-label={centerActive ? 'Desactivar centrado' : 'Activar centrado'}
              className="dh-fab"
              style={{
                position:'absolute',
                bottom: hasActiveOrder && routeGeometry?.length > 0
                ? 'calc(16px + 196px + 8px + 36px + 8px + env(safe-area-inset-bottom,0px))'
                : 'calc(16px + env(safe-area-inset-bottom,0px))',
          right:12, zIndex:402,
          width:36, height:36, borderRadius:'50%',
          background: centerActive ? 'var(--brand)' : '#ffffff',
          color:       centerActive ? '#ffffff'     : '#111827',
          border: centerActive ? 'none' : '1px solid #d1d5db',
          boxShadow:'0 2px 8px rgba(0,0,0,0.18)', cursor:'pointer',
          display:'flex', alignItems:'center', justifyContent:'center',
          fontSize:'1rem', transition:'background 0.15s, color 0.15s',
              }}>⌖</button>

              {/* Google Navigation FAB */}
              {hasActiveOrder && routeGeometry?.length > 0 && (
                <button onClick={openGoogleNavigation}
                aria-label="Abrir en Google Maps" className="dh-fab"
                style={{
                  position:'absolute',
                  bottom:'calc(156px + env(safe-area-inset-bottom,0px))',
                                                               right:12, zIndex:400, width:56, height:56, borderRadius:'50%',
                                                               background:'var(--brand)', color:'#fff', border:'none',
                                                               cursor:'pointer', boxShadow:'0 4px 16px rgba(0,0,0,0.28)',
                                                               display:'flex', alignItems:'center', justifyContent:'center',
                }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                <polygon points="3 11 22 2 13 21 11 13 3 11" fill="#fff"/>
                </svg>
                </button>
              )}

              {/* Voz toggle FAB */}
              <button onClick={() => setVoiceEnabled(v => !v)}
              aria-label={voiceEnabled ? 'Desactivar voz' : 'Activar voz'}
              className="dh-fab"
              style={{
                position:'absolute',
                bottom: hasActiveOrder && routeGeometry?.length > 0
                ? 'calc(16px + 196px + 8px + 36px + 8px + 44px + env(safe-area-inset-bottom,0px))'
                : 'calc(16px + 44px + env(safe-area-inset-bottom,0px))',
                right:12, zIndex:402,
                width:36, height:36, borderRadius:'50%',
                background:'#ffffff', color:'#111827',
                border:'1px solid #d1d5db',
                boxShadow:'0 2px 8px rgba(0,0,0,0.18)', cursor:'pointer',
                display:'flex', alignItems:'center', justifyContent:'center',
                fontSize:'1rem',
              }}>{voiceEnabled ? '🔊' : '🔇'}</button>

              {/* FAB reportar incidencia — solo sin pedido activo y sin modo activo */}
              {!navMode && !hasActiveOrder && (
                <button
                  aria-label="Reportar incidencia de ruta"
                  className="dh-fab"
                  onClick={() => setNavMode('menu')}
                  style={{
                    position:'absolute',
                    bottom:'calc(16px + 44px + 44px + env(safe-area-inset-bottom,0px))',
                    right:12, zIndex:402,
                    width:36, height:36, borderRadius:'50%',
                    background:'#fff', color:'#374151',
                    border:'1px solid #d1d5db',
                    boxShadow:'0 2px 8px rgba(0,0,0,0.18)', cursor:'pointer',
                    display:'flex', alignItems:'center', justifyContent:'center',
                    fontSize:'1rem',
                  }}>⚑</button>
              )}

              {/* Mini menú de tipo de reporte */}
              {navMode === 'menu' && (
                <div style={{
                  position:'absolute',
                  bottom:'calc(16px + 44px + 44px + 8px + env(safe-area-inset-bottom,0px))',
                  right:12, zIndex:403,
                  display:'flex', flexDirection:'column', alignItems:'flex-end', gap:6,
                }}>
                  {[
                    { mode:'zone',       label:'🚦 Zona de alerta',      bg:'#f97316' },
                    { mode:'impassable', label:'⛔ Calle no viable',      bg:'#ef4444' },
                    { mode:'preference', label:'⭐ Preferencia de calle', bg:'#16a34a' },
                  ].map(opt => (
                    <button key={opt.mode} onClick={() => setNavMode(opt.mode)} style={{
                      padding:'0.32rem 0.75rem', borderRadius:20, fontSize:'0.76rem',
                      fontWeight:600, cursor:'pointer', whiteSpace:'nowrap',
                      background:opt.bg, color:'#fff', border:'none',
                      boxShadow:'0 2px 8px rgba(0,0,0,0.2)',
                    }}>{opt.label}</button>
                  ))}
                  <button onClick={() => setNavMode(null)} style={{
                    padding:'0.28rem 0.65rem', borderRadius:20, fontSize:'0.72rem',
                    background:'#f3f4f6', color:'#374151',
                    border:'1px solid #e5e7eb', cursor:'pointer', fontWeight:600,
                  }}>Cancelar</button>
                </div>
              )}

              {/* ZonePlacer — círculo fijo en pantalla, el mapa se mueve debajo */}
              {navMode === 'zone' && mapInstance && (
                <ZonePlacer
                  map={mapInstance}
                  onConfirm={params => {
                    apiFetch('/nav/zones', { method:'POST', body:JSON.stringify(params) }, auth.token)
                      .then(() => {
                        setNavMode(null);
                        apiFetch('/nav/zones/active', {}, null)
                          .then(d => { if (Array.isArray(d?.zones)) setActiveZones(d.zones); })
                          .catch(() => {});
                        setMsg('Zona reportada ✓');
                      })
                      .catch(e => setMsg(e.message));
                  }}
                  onCancel={() => setNavMode(null)}
                />
              )}

              {/* WayPicker — seleccionar tramos de calle para impassable */}
              {navMode === 'impassable' && mapInstance && (
                <WayPicker
                  map={mapInstance}
                  mode="impassable"
                  onConfirm={ways => {
                    const pos = myPosition || { lat:0, lng:0 };
                    apiFetch('/nav/road-prefs/impassable', {
                      method:'POST',
                      body: JSON.stringify({
                        lat: pos.lat, lng: pos.lng,
                        ways: ways.map(w => ({
                          way_id:             w.way_id,
                          estimated_duration: w.estimated_duration,
                          description:        w.description,
                        })),
                      }),
                    }, auth.token)
                      .then(() => { setNavMode(null); setMsg(`${ways.length} calle(s) reportada(s) ✓`); })
                      .catch(e => setMsg(e.message));
                  }}
                  onCancel={() => setNavMode(null)}
                />
              )}

              {/* WayPicker — seleccionar tramos de calle para preference */}
              {navMode === 'preference' && mapInstance && (
                <WayPicker
                  map={mapInstance}
                  mode="preference"
                  onConfirm={ways => {
                    apiFetch('/nav/road-prefs/preference', {
                      method:'POST',
                      body: JSON.stringify({
                        ways: ways.map(w => ({
                          way_id:     w.way_id,
                          preference: w.preference,
                          description: w.description,
                        })),
                      }),
                    }, auth.token)
                      .then(() => { setNavMode(null); setMsg(`${ways.length} preferencia(s) guardada(s) ✓`); })
                      .catch(e => setMsg(e.message));
                  }}
                  onCancel={() => setNavMode(null)}
                />
              )}

              </div>{/* fin mapa */}

              {/* ── Panel de oferta ─────────────────────────────────────── */}
              {pendingOffer && (
                <div style={{ position:'absolute', bottom:0, left:0, right:0, zIndex:30, pointerEvents:offerMinimized ? 'none' : 'auto' }}>
                  {/* OPT-10: will-change:transform en .dh-offer-panel */}
                  <div className="dh-offer-panel" style={{
                    transform: offerMinimized ? 'translateY(calc(100%))' : 'translateY(0)',
                                transition: 'transform 0.22s ease',
                  }}>
                  <button onClick={() => setOfferMinimized(m => !m)}
                  style={{ position:'absolute', top:-43, left:'50%', transform:'translateX(-50%)',
                    width:74, height:15, background:'#f3e8ed', color:'var(--brand)',
                                border:'1px solid #e8c8d4', borderRadius:'6px 6px 0 0',
                                padding:0, cursor:'pointer', fontSize:'0.62rem', fontWeight:700,
                                boxShadow:'0 -2px 6px rgba(0,0,0,0.06)', zIndex:31,
                                whiteSpace:'nowrap', display:'flex', alignItems:'center',
                                gap:3, justifyContent:'center', pointerEvents:'auto' }}
                                aria-label={offerMinimized ? 'Expandir oferta' : 'Minimizar oferta'}>
                                <svg width="9" height="9" viewBox="0 0 24 24" fill="none"
                                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                <polyline points={offerMinimized ? '6 15 12 9 18 15' : '18 9 12 15 6 9'} />
                                </svg>
                                Oferta
                                </button>
                                <div style={{ background:'#fff', borderTop:'1px solid #e8c8d4',
                                  boxShadow:'0 -4px 20px rgba(0,0,0,0.14)', overflow:'hidden',
                                pointerEvents:'auto' }}>
                                <div style={{ padding:'0.6rem 1rem 0.75rem', overflowY:'auto' }}>
                                <div style={{ fontSize:'0.82rem', color:'var(--gray-700)', marginBottom:'0.3rem' }}>
                                {(pendingOffer.restaurant_name||pendingOffer.restaurantAddress) && (
                                  <div style={{ marginBottom:'0.1rem' }}>
                                  <span style={{ color:'var(--gray-400)', fontSize:'0.72rem' }}>Tienda: </span>
                                  <strong>{pendingOffer.restaurant_name||pendingOffer.restaurantAddress}</strong>
                                  </div>
                                )}
                                {(pendingOffer.restaurant_address||pendingOffer.restaurantAddress) && (
                                  <div style={{ marginBottom:'0.1rem' }}>
                                  <span style={{ color:'var(--gray-400)', fontSize:'0.72rem' }}>Dir. tienda: </span>
                                  <strong>{pendingOffer.restaurant_address||pendingOffer.restaurantAddress}</strong>
                                  </div>
                                )}
                                {(pendingOffer.customer_address||pendingOffer.customerAddress||pendingOffer.delivery_address) && (
                                  <div style={{ marginBottom:'0.1rem' }}>
                                  <span style={{ color:'var(--gray-400)', fontSize:'0.72rem' }}>Entrega: </span>
                                  <strong>{pendingOffer.customer_address||pendingOffer.customerAddress||pendingOffer.delivery_address}</strong>
                                  </div>
                                )}
                                </div>
                                {(() => {
                                  const earn = (pendingOffer.delivery_fee_cents||0)
                                  + Math.round((pendingOffer.service_fee_cents||0)*0.5)
                                  + (pendingOffer.tip_cents||0) || pendingOffer.driverEarning || 0;
                                  return earn > 0
                                  ? <div style={{ fontSize:'0.9rem', fontWeight:800, color:'var(--success)', marginBottom:'0.35rem' }}>
                                  Tu ganancia: {fmt(earn)}
                                  </div>
                                  : null;
                                })()}
                                <OfferCountdown key={pendingOffer.id}
                                secondsLeft={pendingOffer.seconds_left ?? pendingOffer.secondsLeft ?? created_at + 60 - now}
                                onExpired={() => {
                                  setPendingOffer(null); loadData();
                                  consecutiveTimeouts.current += 1;
                                  if (consecutiveTimeouts.current >= 3) {
                                    consecutiveTimeouts.current = 0;
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
                                  background:'var(--gray-100)', color:'var(--gray-700)',
                                border:'1px solid var(--gray-200)', cursor:'pointer' }}
                                disabled={loadingOffer} onClick={rejectOffer}>
                                ✕ Rechazar
                                </button>
                                </div>
                                </div>
                                </div>
                                </div>
                                </div>
              )}

              {/* ── Panel de pedido activo ──────────────────────────────── */}
              {activeOrder && (() => {
                const isOTW  = activeOrder.status === 'on_the_way';
                const isCash = (activeOrder.payment_method || 'cash') === 'cash';
                const total  = (activeOrder.total_cents||0)+(activeOrder.service_fee_cents||0)
                +(activeOrder.delivery_fee_cents||0)+(activeOrder.tip_cents||0);
                const earn   = (activeOrder.delivery_fee_cents||0)
                + Math.round((activeOrder.service_fee_cents||0)*0.5)
                + (activeOrder.tip_cents||0);
                const DST = {
                  assigned:'Asignado — ve a recoger', on_the_way:'En camino al cliente',
                  preparing:'Esperando en tienda',    ready:'Listo para retiro',
                  accepted:'Aceptado',                created:'Nuevo pedido',
                };
                return (
                  <div style={{ flexShrink:0, background:'#fff',
                    borderTop:'2px solid var(--success)', zIndex:10, position:'absolute', bottom: 0, left: 0, right: 0, width: '100%',
                        display:'flex', flexDirection:'column' }}>

                        {/* Cabecera compacta */}
                        <div onClick={() => setOrderExpanded(e => !e)}
                        style={{ padding:'0.55rem 1rem 0.6rem', flexShrink:0, cursor:'pointer', userSelect:'none' }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        <span style={{ fontSize:'0.7rem', fontWeight:800, textTransform:'uppercase',
                          letterSpacing:'0.5px', color:'var(--success)' }}>
                          {DST[activeOrder.status] || activeOrder.status}
                          </span>
                          {/* Chevron animado con CSS transform, sin cambiar `points` */}
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                          stroke="var(--gray-400)" strokeWidth="2.5" strokeLinecap="round"
                          style={{ transform: orderExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                            transition:'transform 0.2s' }}>
                            <polyline points="6 9 12 15 18 9"/>
                            </svg>
                            </div>

                            {!isOTW ? (
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
                                Cobrar a cliente: {fmt(total)}
                                </div>
                                : <div style={{ fontSize:'0.77rem', color:'var(--gray-400)', marginTop:'0.1rem' }}>
                                {activeOrder.payment_method==='card' ? '💳 Ya pagó con tarjeta' : '🏦 Ya pagó SPEI'}
                                </div>
                              }
                              </div>
                            )}

                            <div style={{ display:'flex', gap:'0.35rem', marginTop:'0.45rem' }}
                            onClick={e => e.stopPropagation()}>
                            <button className="btn-sm" onClick={openRoadRouteApi}>🗺 Ruta</button>
                            </div>
                            </div>

                            {/* OPT-11: grid-template-rows — NO usa max-height, no genera reflow por frame */}
                            <div style={expandStyle}>
                            <div style={{ overflow:'hidden' }}>
                            <div style={{ padding:'0.4rem 1rem 0.6rem',
                              borderTop:'1px solid var(--gray-100)' }}>
                              {(activeOrder.items||[]).length > 0 && (
                                <ul style={{ fontSize:'0.8rem', margin:'0 0 0.3rem 1rem', color:'var(--gray-700)' }}>
                                {activeOrder.items.map(i => <li key={i.menuItemId}>{i.name} × {i.quantity}</li>)}
                                </ul>
                              )}
                              <div style={{ fontSize:'0.78rem', color:'var(--gray-500)', marginBottom:'0.3rem' }}>
                              Ganancia estimada:{' '}
                              <strong style={{ color:'var(--success)' }}>{fmt(earn)}</strong>
                              </div>
                              <div style={{ display:'flex', gap:'0.4rem', flexWrap:'wrap', marginBottom:'0.4rem' }}>
                              <button className="btn-sm"
                              style={{ background:activeOrder.status==='ready' ? 'var(--brand)':'',
                                color:activeOrder.status==='ready' ? '#fff':'' }}
                                disabled={loadingStatus==='on_the_way' || activeOrder.status!=='ready'}
                                onClick={() => changeStatus(activeOrder.id,'on_the_way')}>
                                En camino
                                </button>
                                <button className="btn-sm"
                                style={{ background:activeOrder.status==='on_the_way' ? 'var(--success)':'',
                                  color:activeOrder.status==='on_the_way' ? '#fff':'' }}
                                  disabled={loadingStatus==='delivered' || activeOrder.status!=='on_the_way'}
                                  onClick={() => changeStatus(activeOrder.id,'delivered')}>
                                  Entregado
                                  </button>
                                  {!['on_the_way','delivered','cancelled'].includes(activeOrder.status) && (
                                    <button className="btn-sm btn-danger"
                                    onClick={() => setShowRelease(s => !s)}>Liberar</button>
                                  )}
                                  </div>
                                  {showRelease && (
                                    <div>
                                    <textarea value={releaseNote} onChange={e => setReleaseNote(e.target.value)}
                                    placeholder="Motivo (obligatorio)" rows={2}
                                    style={{ width:'100%', boxSizing:'border-box', marginBottom:'0.3rem', fontSize:'0.82rem' }} />
                                    <div style={{ display:'flex', gap:'0.3rem' }}>
                                    <button className="btn-sm btn-danger" onClick={doRelease}>Confirmar</button>
                                    <button className="btn-sm"
                                    onClick={() => { setShowRelease(false); setReleaseNote(''); }}>Cancelar</button>
                                    </div>
                                    </div>
                                  )}
                                  </div>
                                  </div>
                                  </div>

                                  </div>
                );
              })()}

              </div>
              </PullToRefresh>
  );
}
