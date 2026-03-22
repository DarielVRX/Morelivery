// frontend/src/components/DriverMap.jsx
//
// OPT-4:  _ml singleton — evita Promise.resolve() en cada tick GPS
// OPT-5:  posición y heading separados — heading solo muta el SVG sin recrear DOM
// OPT-6:  SVG del marcador vive en el DOM; solo se muta su style.transform para rotar
// OPT-7:  hasActiveOrder se lee desde ref dentro del listener de click del mapa
// OPT-12: livePos y liveHeading son refs, NO estado — sin re-render en cada tick GPS

import { useEffect, useRef, useState } from 'react';
import { DriverMapOverlays } from '../features/driver/map/overlays';
import { DEFAULT_POS, MORELIA_BOUNDS, STADIA_KEY, STYLE_DARK, STYLE_LIGHT } from '../features/driver/map/config';
import { createDriverPoiMarker, DRIVER_ROUTE_BORDER_ID, DRIVER_ROUTE_LAYER_ID, DRIVER_ROUTE_SOURCE_ID, getDriverRouteFeature, syncDriverRouteLayers } from '../features/driver/map/helpers';
import { useTheme } from '../contexts/ThemeContext';
import { getBearing } from '../utils/geo';
import { ensureMapLibreCSS, ensureMapLibreJS } from '../utils/mapLibre';

// OPT-4: singleton — se asigna una vez cuando la lib carga y se reutiliza
var _ml = null;

export default function DriverMap({
  driverPos, customPin, onCustomPin, hasActiveOrder,
  pickupPos, deliveryPos, pickupLabel, deliveryLabel,
  routeGeometry, onRouteError,
  navFollowEnabled, navHeadingDeg, onHeadingChange,
  centerSignal, onCenterDone,
  onMapReady,
}) {
  const { isDark }        = useTheme();
  const containerRef      = useRef(null);
  const mapRef            = useRef(null);
  const markersRef        = useRef({ driver: null, driverSvg: null, custom: null, pickup: null, delivery: null });
  const livePosRef        = useRef(driverPos || null);
  const liveHeadingRef    = useRef(0);
  const watchIdRef        = useRef(null);
  const prevWatchPosRef   = useRef(null);
  const hasActiveOrderRef = useRef(hasActiveOrder);
  const navFollowRef      = useRef(navFollowEnabled);
  const onHeadingRef      = useRef(onHeadingChange);
  const zoomCtrlRef       = useRef(null);
  const zoomTimeRef       = useRef(null);
  const isDarkRef         = useRef(isDark);

  const [showAttrib, setShowAttrib] = useState(false);
  const [hasGPS,     setHasGPS]     = useState(Boolean(driverPos));

  useEffect(() => { isDarkRef.current = isDark; }, [isDark]);

  function applyDarkFilter(dark) {
    // Apply to the map container div — catches the canvas and all tile elements
    // Using the container avoids querySelector timing issues (canvas created async)
    const el = containerRef.current;
    if (el) {
      el.style.filter = dark
        ? 'invert(1) contrast(1.1) hue-rotate(180deg) brightness(0.85) saturate(1.5)'
        : 'contrast(1.1) saturate(1.8) brightness(0.9) grayscale(0.1)';
    }
  }

  useEffect(() => {
    if (STADIA_KEY) {
      const map = mapRef.current;
      if (!map || !map.isStyleLoaded()) return;
      const newStyle = isDark ? STYLE_DARK : STYLE_LIGHT;
      map.setStyle(newStyle);
      map.once('styledata', () => {
        const routeFeature = getDriverRouteFeature(routeGeometry);
        if (!routeFeature) return;
        try {
          if (!map.getSource(DRIVER_ROUTE_SOURCE_ID)) map.addSource(DRIVER_ROUTE_SOURCE_ID, { type: 'geojson', data: routeFeature });
          if (!map.getLayer(DRIVER_ROUTE_BORDER_ID)) map.addLayer({ id: DRIVER_ROUTE_BORDER_ID, type: 'line', source: DRIVER_ROUTE_SOURCE_ID,
            paint: { 'line-color': '#ffffff', 'line-width': 10, 'line-opacity': 0.4 },
            layout: { 'line-cap': 'round', 'line-join': 'round' } });
          if (!map.getLayer(DRIVER_ROUTE_LAYER_ID)) map.addLayer({ id: DRIVER_ROUTE_LAYER_ID, type: 'line', source: DRIVER_ROUTE_SOURCE_ID,
            paint: { 'line-color': '#6366f1', 'line-width': 5, 'line-opacity': 0.95 },
            layout: { 'line-cap': 'round', 'line-join': 'round' } });
        } catch (_) {}
      });
    } else {
      // CSS filter fallback — canvas may not exist yet if map is still loading;
      // applyDarkFilter is also called in map.once('load') below
      applyDarkFilter(isDark);
    }
  }, [isDark]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sincronizar refs sin recrear listeners ───────────────────────────────────
  useEffect(() => { hasActiveOrderRef.current = hasActiveOrder;  }, [hasActiveOrder]);
  useEffect(() => { navFollowRef.current      = navFollowEnabled; }, [navFollowEnabled]);
  useEffect(() => { onHeadingRef.current      = onHeadingChange;  }, [onHeadingChange]);

  useEffect(() => {
    if (driverPos) { livePosRef.current = driverPos; setHasGPS(true); }
  }, [driverPos?.lat, driverPos?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reconstruir marcador si el mapa ya existe y llega la primera posición GPS
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !_ml) return;
    if (!driverPos && !livePosRef.current) return;
    _buildDriverMarker(_ml, map);
  }, [driverPos?.lat, driverPos?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── watchPosition — suscripción ÚNICA, todo vía refs (OPT-12) ────────────────
  useEffect(() => {
    if (!navigator?.geolocation) return;
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const prev = prevWatchPosRef.current;
        if (prev) {
          const h = getBearing(prev, next);
          liveHeadingRef.current = h;
          onHeadingRef.current?.(h);
          // OPT-6: rotar SVG directamente — sin recrear ni setState
          const svg = markersRef.current.driverSvg;
          if (svg && navFollowRef.current) svg.style.transform = `rotate(${h}deg)`;
        }
        prevWatchPosRef.current = next;
        livePosRef.current      = next;
        setHasGPS(true);
        // Mover marcador sin setState — mutación DOM directa
        if (markersRef.current.driver && mapRef.current) {
          markersRef.current.driver.setLngLat([next.lng, next.lat]);
          if (navFollowRef.current) {
            const map = mapRef.current;
            const h   = liveHeadingRef.current;
            map.easeTo({
              center: [next.lng, next.lat], bearing: h, pitch: 0, zoom: 19,
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

  // ── Construir marcador del driver ────────────────────────────────────────────
  // Modo navegar (navFollowEnabled=true)  → flecha 60×60 px  (75% de 80px original)
  // Modo normal  (navFollowEnabled=false) → punto  20×20 px  (25% de 80px original)
  //
  // OPT-6: createElementNS para mantener referencia directa al SVG sin innerHTML.
  //        Cuando cambia el heading se muta solo svg.style.transform.
  function _buildDriverMarker(ml, map) {
    if (markersRef.current.driver) {
      markersRef.current.driver.remove();
      markersRef.current.driver    = null;
      markersRef.current.driverSvg = null;
    }
    const pos = livePosRef.current;
    if (!pos) return;

    const isDrive = navFollowRef.current;
    const wrap    = document.createElement('div');

    if (isDrive) {
      // ── Flecha de navegación ──────────────────────────────────────────────
      const arrowColor = isDarkRef.current ? '#c97f7f' : '#e3aaaa';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width',  '60');
      svg.setAttribute('height', '60');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill',            arrowColor);
      svg.setAttribute('stroke',          arrowColor + 'cc');
      svg.setAttribute('stroke-width',    '1.4');
      svg.setAttribute('stroke-linejoin', 'round');
      svg.style.cssText   = 'display:block;transform-origin:50% 55%;';
      svg.style.transform = `rotate(${liveHeadingRef.current}deg)`;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z');
      svg.appendChild(path);

      wrap.style.cssText = 'width:60px;height:60px';
      wrap.appendChild(svg);
      markersRef.current.driverSvg = svg; // ref para mutar heading en OPT-6
    } else {
      // ── Punto simple ──────────────────────────────────────────────────────
      const dot = document.createElement('div');
      const dotColor = isDarkRef.current ? '#c97f7f' : '#e3aaaa';
      dot.style.cssText = [
        'width:20px', 'height:20px', 'border-radius:50%',
        `background:${dotColor}`,
        'border:2.5px solid rgba(255,255,255,0.9)',
        'box-shadow:0 2px 8px rgba(0,0,0,0.35)',
      ].join(';');
      wrap.style.cssText = 'width:20px;height:20px';
      wrap.appendChild(dot);
      markersRef.current.driverSvg = null; // punto no rota
    }

    markersRef.current.driver = new ml.Marker({ element: wrap, anchor: 'center' })
      .setLngLat([pos.lng, pos.lat]).addTo(map);
  }

  // ── Inicializar mapa UNA sola vez ────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    ensureMapLibreCSS();
    ensureMapLibreJS().then((ml) => {
      _ml = ml; // OPT-4: guardar singleton
      if (!containerRef.current || mapRef.current) return;
      const start = livePosRef.current || DEFAULT_POS;

      const map = new ml.Map({
        container: containerRef.current,
        // "bright" — estilo más ligero de OpenFreeMap.
        // Zoom-dependent nativo: z10-12 carreteras principales;
        // z13-15 secundarias + colonias; z16+ calles completas + POIs.
        // ~35% menos memoria de spritesheet vs. "liberty".
        style:   isDarkRef.current ? STYLE_DARK : STYLE_LIGHT,
        center:  [start.lng, start.lat],
        zoom:    14,
        pitch:   0,       // sin inclinación — vista de planta para entregar
        bearing: 0,
        minZoom: 10,      // no alejarse del área metropolitana
        maxZoom: 20,
        maxBounds:            MORELIA_BOUNDS,
        attributionControl:   false,
        antialias:            false,  // OPT-perf: reduce overdraw en gama media
        preserveDrawingBuffer: false,
        dragRotate:      false,       // sin rotación manual — interfiere al conducir
        pitchWithRotate: false,
      });

      // Desactivar pitch táctil (iOS/Android)
      if (map.touchPitch) map.touchPitch.disable();

      map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');

      // Ocultar controles de zoom — mostrar 3 s tras interacción
      const ctrl = containerRef.current.querySelector('.maplibregl-ctrl-top-right');
      if (ctrl) {
        zoomCtrlRef.current       = ctrl;
        ctrl.style.opacity        = '0';
        ctrl.style.pointerEvents  = 'none';
        ctrl.style.transition     = 'opacity 0.18s ease';
      }
      const showZoom = () => {
        const el = zoomCtrlRef.current;
        if (!el) return;
        el.style.opacity       = '1';
        el.style.pointerEvents = 'auto';
        if (zoomTimeRef.current) clearTimeout(zoomTimeRef.current);
        zoomTimeRef.current = setTimeout(() => {
          el.style.opacity       = '0';
          el.style.pointerEvents = 'none';
        }, 3000);
      };
      ['mousedown', 'touchstart', 'wheel', 'dragstart'].forEach(ev => map.on(ev, showZoom));

      // OPT-7: leer hasActiveOrder desde ref, no closure estático
      map.on('click', (e) => {
        if (hasActiveOrderRef.current) return;
        onCustomPin?.({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      });

      map.once('load', () => {
        _buildDriverMarker(ml, map);
        // Apply dark mode on load — container is guaranteed to exist here
        if (!STADIA_KEY && document.documentElement.getAttribute('data-theme') === 'dark') {
          if (containerRef.current) {
            containerRef.current.style.filter =
              'invert(1) hue-rotate(180deg) saturate(0.85) brightness(0.9)';
          }
        }
      });
      mapRef.current = map;
      onMapReady?.(map);
    }).catch(() => onRouteError?.('No se pudo inicializar el mapa'));

    return () => {
      if (zoomTimeRef.current) { clearTimeout(zoomTimeRef.current); zoomTimeRef.current = null; }
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // OPT-5: reconstruir marcador (dot↔arrow) y centrar al cambiar modo follow
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !_ml) return;
    _buildDriverMarker(_ml, map);
    if (navFollowEnabled) {
      const pos = livePosRef.current;
      if (!pos) return;
      const h = liveHeadingRef.current || navHeadingDeg || 0;
      map.easeTo({ center: [pos.lng, pos.lat], bearing: h, pitch: 0, zoom: 19,
        duration: 350, offset: [0, Math.round(map.getContainer().clientHeight * 0.18)],
        essential: true });
    }
  }, [navFollowEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // OPT-5: efecto SOLO para heading — muta SVG, sin recrear marcador
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
  }, [customPin?.lat, customPin?.lng, hasActiveOrder]); // eslint-disable-line react-hooks/exhaustive-deps

  // Marcadores tienda / cliente
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !_ml) return;
    if (markersRef.current.pickup)   { markersRef.current.pickup.remove();   markersRef.current.pickup   = null; }
    if (markersRef.current.delivery) { markersRef.current.delivery.remove(); markersRef.current.delivery = null; }
    if (pickupPos) {
      markersRef.current.pickup = createDriverPoiMarker(_ml, pickupPos, { emoji: '🏪', color: '#16a34a', label: pickupLabel || 'Tienda' }).addTo(map);
    }
    if (deliveryPos) {
      markersRef.current.delivery = createDriverPoiMarker(_ml, deliveryPos, { emoji: '📦', color: '#f97316', label: deliveryLabel || 'Cliente' }).addTo(map);
    }
  }, [pickupPos?.lat, pickupPos?.lng, deliveryPos?.lat, deliveryPos?.lng, pickupLabel, deliveryLabel]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ruta GeoJSON
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    function draw() {
      try {
        syncDriverRouteLayers(map, routeGeometry);
      } catch (e) {
        console.warn('[DriverMap] route draw error:', e.message);
      }
    }

    // Guard: wait for both map load AND style load
    if (map.isStyleLoaded()) {
      draw();
    } else {
      // Use 'styledata' which fires when style is ready, including after tile changes
      map.once('styledata', draw);
    }
  }, [routeGeometry]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Centrar — señal puntual del padre ────────────────────────────────────────
  // 'follow'   → lock to driver, zoom 19, heading-aligned (nav activo)
  // 'overview' → fit bounds to driver + pickup + delivery (ver toda la ruta)
  // 'free'     → center on driver, zoom 15, north up (reset)
  useEffect(() => {
    if (!centerSignal || !mapRef.current) return;
    const map = mapRef.current;
    const pos = livePosRef.current || driverPos;

    if (centerSignal === 'follow') {
      if (!pos) { onCenterDone?.(); return; }
      const h       = liveHeadingRef.current || navHeadingDeg || 0;
      const offsetY = Math.round(map.getContainer().clientHeight * 0.18);
      map.easeTo({ center: [pos.lng, pos.lat], zoom: 19, pitch: 0, bearing: h,
        duration: 350, offset: [0, offsetY], essential: true });

    } else if (centerSignal === 'overview') {
      // Collect all relevant points
      const pts = [];
      if (pos)         pts.push([pos.lng, pos.lat]);
      if (pickupPos)   pts.push([pickupPos.lng, pickupPos.lat]);
      if (deliveryPos) pts.push([deliveryPos.lng, deliveryPos.lat]);

      if (pts.length >= 2 && _ml) {
        try {
          const bounds = pts.reduce(
            (b, pt) => b.extend(pt),
            new _ml.LngLatBounds(pts[0], pts[0])
          );
          map.fitBounds(bounds, {
            padding: { top: 80, bottom: 160, left: 40, right: 60 },
            maxZoom: 16,
            duration: 500,
            essential: true,
          });
        } catch (_) {
          // Fallback to simple center
          if (pos) map.easeTo({ center: [pos.lng, pos.lat], zoom: 13, duration: 400 });
        }
      } else if (pos) {
        map.easeTo({ center: [pos.lng, pos.lat], zoom: 13, pitch: 0, bearing: 0,
          duration: 400, essential: true });
      }

    } else {
      // 'free' — north up, medium zoom
      if (!pos) { onCenterDone?.(); return; }
      map.easeTo({ center: [pos.lng, pos.lat], zoom: 15, pitch: 0, bearing: 0,
        duration: 350, essential: true });
    }

    onCenterDone?.();
  }, [centerSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ height: '100%', width: '100%', position: 'relative' }}>
      <div ref={containerRef} style={{ height: '100%', width: '100%' }} />

      <DriverMapOverlays hasGPS={hasGPS} showAttrib={showAttrib} onToggleAttrib={() => setShowAttrib(v => !v)} />
    </div>
  );
}
