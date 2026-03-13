// components/DriverMap.jsx
// OPT-4:  _ml evita Promise.resolve() en cada tick GPS
// OPT-5:  posición y heading separados — heading solo muta el SVG sin recrear DOM
// OPT-6:  SVG del marcador vive en el DOM; solo se muta su style.transform para rotar
// OPT-7:  hasActiveOrder se lee desde ref dentro del listener de click del mapa
// OPT-12: livePos y liveHeading son refs, NO estado — sin re-render en cada tick GPS

import { useEffect, useRef, useState } from 'react';
import { ensureMapLibreCSS, ensureMapLibreJS, _ml } from '../utils/mapLibre';
import { getBearing } from '../utils/geo';

const DEFAULT_POS = { lat: 19.70595, lng: -101.19498 };

export default function DriverMap({
  driverPos, customPin, onCustomPin, hasActiveOrder,
  pickupPos, deliveryPos, pickupLabel, deliveryLabel,
  routeGeometry, onRouteError,
  navFollowEnabled, navHeadingDeg, onHeadingChange,
  centerSignal, onCenterDone,
  onMapReady,
}) {
  const containerRef       = useRef(null);
  const mapRef             = useRef(null);
  const markersRef         = useRef({ driver: null, driverSvg: null, custom: null, pickup: null, delivery: null });
  const livePosRef         = useRef(driverPos || null);  // OPT-12
  const liveHeadingRef     = useRef(0);                  // OPT-12
  const watchIdRef         = useRef(null);
  const prevWatchPosRef    = useRef(null);
  const hasActiveOrderRef  = useRef(hasActiveOrder);     // OPT-7
  const navFollowRef       = useRef(navFollowEnabled);
  const onHeadingChangeRef = useRef(onHeadingChange);
  const zoomCtrlRef        = useRef(null);
  const zoomTimeoutRef     = useRef(null);

  const [showAttrib, setShowAttrib] = useState(false);
  const [hasGPS,     setHasGPS]     = useState(Boolean(driverPos));

  // Mantener refs sincronizadas sin recrear listeners
  useEffect(() => { hasActiveOrderRef.current  = hasActiveOrder;  }, [hasActiveOrder]);
  useEffect(() => { navFollowRef.current        = navFollowEnabled; }, [navFollowEnabled]);
  useEffect(() => { onHeadingChangeRef.current  = onHeadingChange;  }, [onHeadingChange]);

  useEffect(() => {
    if (driverPos) { livePosRef.current = driverPos; setHasGPS(true); }
  }, [driverPos?.lat, driverPos?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // Si llega la primera posición GPS después del load, reconstruir marcador
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !_ml) return;
    if (!driverPos && !livePosRef.current) return;
    _buildDriverMarker(_ml, map);
  }, [driverPos?.lat, driverPos?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // watchPosition — suscripción ÚNICA, todo vía refs (OPT-12)
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
          // OPT-6: rotar SVG directamente sin setState
          const svg = markersRef.current.driverSvg;
          if (svg && navFollowRef.current) svg.style.transform = `rotate(${h}deg)`;
        }
        prevWatchPosRef.current = next;
        livePosRef.current      = next;
        setHasGPS(true);
        // Mover marcador — mutación DOM directa, sin setState
        if (markersRef.current.driver && mapRef.current) {
          markersRef.current.driver.setLngLat([next.lng, next.lat]);
          if (navFollowRef.current) {
            const map     = mapRef.current;
            const heading = liveHeadingRef.current;
            map.easeTo({
              center: [next.lng, next.lat], bearing: heading,
              pitch: 0, zoom: 19, duration: 250,
              offset: [0, Math.round(map.getContainer().clientHeight * 0.18)],
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

  // Construir marcador del conductor — se llama al montar y al cambiar modo follow
  function _buildDriverMarker(ml, map) {
    if (markersRef.current.driver) {
      markersRef.current.driver.remove();
      markersRef.current.driver    = null;
      markersRef.current.driverSvg = null;
    }
    const pos = livePosRef.current;
    if (!pos) return;

    const isFollow   = navFollowRef.current;
    const size       = isFollow ? 60 : 20;
    const fillColor  = '#e3aaaa';
    const strokeColor = 'rgba(227,170,170,0.85)';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width',  String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill',   fillColor);
    svg.setAttribute('stroke', strokeColor);
    svg.setAttribute('stroke-width',    '1.4');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.style.cssText = 'display:block;transform-origin:50% 55%;';
    svg.style.transform = isFollow
      ? `rotate(${liveHeadingRef.current}deg)`
      : 'rotate(0deg)';

    if (isFollow) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z');
      svg.appendChild(path);
    } else {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', '12'); circle.setAttribute('cy', '12'); circle.setAttribute('r', '10');
      svg.appendChild(circle);
    }

    const wrap = document.createElement('div');
    wrap.style.cssText = `width:${size}px;height:${size}px`;
    wrap.appendChild(svg);

    markersRef.current.driverSvg = svg;
    markersRef.current.driver    = new ml.Marker({ element: wrap, anchor: 'center' })
      .setLngLat([pos.lng, pos.lat]).addTo(map);
  }

  // Inicializar mapa UNA sola vez
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    ensureMapLibreCSS();
    ensureMapLibreJS().then((ml) => {
      if (!containerRef.current || mapRef.current) return;
      const start = livePosRef.current || DEFAULT_POS;
      const map   = new ml.Map({
        container:          containerRef.current,
        style:              'https://tiles.openfreemap.org/styles/liberty',
        center:             [start.lng, start.lat],
        zoom: 14, pitch: 0, bearing: 0, maxZoom: 20,
        attributionControl: false,
        antialias:          false,
        preserveDrawingBuffer: false,
        pitchWithRotate:    false,
        dragRotate:         false,
      });
      map.touchPitch?.disable();
      map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');

      // Mostrar zoom controls solo 3s tras interacción
      const ctrl = containerRef.current.querySelector('.maplibregl-ctrl-top-right');
      if (ctrl) {
        zoomCtrlRef.current  = ctrl;
        ctrl.style.opacity       = '0';
        ctrl.style.pointerEvents = 'none';
        ctrl.style.transition    = 'opacity 0.18s ease';
      }
      const showZoomTemporarily = () => {
        const el = zoomCtrlRef.current;
        if (!el) return;
        el.style.opacity       = '1';
        el.style.pointerEvents = 'auto';
        if (zoomTimeoutRef.current) clearTimeout(zoomTimeoutRef.current);
        zoomTimeoutRef.current = setTimeout(() => {
          el.style.opacity       = '0';
          el.style.pointerEvents = 'none';
        }, 3000);
      };
      ['mousedown', 'touchstart', 'wheel', 'dragstart'].forEach(ev => map.on(ev, showZoomTemporarily));

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
      if (zoomTimeoutRef.current) { clearTimeout(zoomTimeoutRef.current); zoomTimeoutRef.current = null; }
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // OPT-5: efecto separado para cambios de modo follow
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !_ml) return;
    _buildDriverMarker(_ml, map);
    if (navFollowEnabled) {
      const pos = livePosRef.current;
      if (!pos) return;
      const h = liveHeadingRef.current || navHeadingDeg || 0;
      map.easeTo({
        center: [pos.lng, pos.lat], bearing: h, pitch: 0, zoom: 19,
        duration: 350, offset: [0, Math.round(map.getContainer().clientHeight * 0.18)],
        essential: true,
      });
    }
  }, [navFollowEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // OPT-5: heading — solo muta el SVG, sin recrear
  useEffect(() => {
    const svg = markersRef.current.driverSvg;
    if (!svg) return;
    svg.style.transform = navFollowEnabled
      ? `rotate(${navHeadingDeg}deg)`
      : 'rotate(0deg)';
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
  }, [customPin?.lat, customPin?.lng, hasActiveOrder]); // eslint-disable-line react-hooks/exhaustive-deps

  // Marcadores tienda / cliente
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !_ml) return;
    ['pickup', 'delivery'].forEach(k => {
      if (markersRef.current[k]) { markersRef.current[k].remove(); markersRef.current[k] = null; }
    });
    const mkr = (pos, emoji, color, label) => {
      const el = document.createElement('div');
      el.style.cssText = `width:28px;height:28px;border-radius:50%;background:${color};display:grid;place-items:center;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.3);font-size:15px`;
      el.textContent = emoji;
      return new _ml.Marker({ element: el })
        .setLngLat([pos.lng, pos.lat])
        .setPopup(new _ml.Popup({ closeButton: false }).setText(label));
    };
    if (pickupPos)   markersRef.current.pickup   = mkr(pickupPos,   '🏪', '#16a34a', pickupLabel   || 'Tienda').addTo(map);
    if (deliveryPos) markersRef.current.delivery = mkr(deliveryPos, '📦', '#f97316', deliveryLabel || 'Cliente').addTo(map);
  }, [pickupPos?.lat, pickupPos?.lng, deliveryPos?.lat, deliveryPos?.lng, pickupLabel, deliveryLabel]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ruta GeoJSON
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const SRC = 'driver-route-source', LYR = 'driver-route-layer', BDR = 'driver-route-border';
    const draw = () => {
      const geo = {
        type: 'Feature', properties: {},
        geometry: { type: 'LineString', coordinates: (routeGeometry || []).map(p => [p.lng, p.lat]) },
      };
      if (!map.getSource(SRC)) map.addSource(SRC, { type: 'geojson', data: geo });
      else map.getSource(SRC).setData(geo);
      if (!map.getLayer(LYR)) map.addLayer({ id: LYR, type: 'line', source: SRC,
        paint:  { 'line-color': '#ad1457', 'line-width': 14, 'line-opacity': 0.8 },
        layout: { 'line-cap': 'round', 'line-join': 'round' } });
      if (!map.getLayer(BDR)) map.addLayer({ id: BDR, type: 'line', source: SRC,
        paint:  { 'line-color': '#e3aaaa', 'line-width': 8, 'line-opacity': 0.6 },
        layout: { 'line-cap': 'round', 'line-join': 'round' } });
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
      const h       = liveHeadingRef.current || navHeadingDeg || 0;
      const offsetY = Math.round(map.getContainer().clientHeight * 0.18);
      map.easeTo({ center: [pos.lng, pos.lat], zoom: 19, pitch: 0, bearing: h,
        duration: 350, offset: [0, offsetY], essential: true });
    } else {
      map.easeTo({ center: [pos.lng, pos.lat], zoom: 14, pitch: 0, bearing: 0, duration: 350, essential: true });
    }
    onCenterDone?.();
  }, [centerSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ height: '100%', width: '100%', position: 'relative' }}>
      <div ref={containerRef} style={{ height: '100%', width: '100%' }} />

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
