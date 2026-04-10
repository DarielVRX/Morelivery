// frontend/src/features/driver/home/useDriverHomeRuntime.js
// FIX: openRoadRouteApi usa una ref sincronizada en el efecto de rerouting
// para evitar referencia stale cuando confirmedOrders cambia entre renders.

import { useCallback, useEffect, useRef, useState } from 'react';

import { reverseGeocode } from '../../../utils/geo';
import { getErrorMessage } from '../../../utils/errorMessage';
import { haversineMeters } from '../../../utils/geo';
import {
  createZoneReport,
  fetchActiveZones,
  fetchDriverCounters,
  fetchRouteModel,
  submitImpassableRoads,
  submitRoadPreferences,
} from './api';
import { fetchAllImpassable, fetchMyPreferences } from '../alerts/api';
import {
  buildGoogleMapsAppUrl,
  buildGoogleMapsWebUrl,
  buildGoogleNavigationUrl,
  formatRouteSummary,
  getDriverRouteStops,
  getGoogleNavigationTarget,
} from './navigation';

// ── Caché de rutas de oferta ──────────────────────────────────────────────────
const OFFER_ROUTE_CACHE_MS = 5 * 60 * 1000; // 5 minutos
const offerRouteCache = new Map();

function getOfferRouteCacheKey(offer) {
  const rLat = offer.restaurantLat ?? offer.restaurant_lat;
  const rLng = offer.restaurantLng ?? offer.restaurant_lng;
  const cLat = offer.customerLat   ?? offer.customer_lat;
  const cLng = offer.customerLng   ?? offer.customer_lng;
  return `${rLat},${rLng}-${cLat},${cLng}`;
}

export function useDriverHomeRuntime({
  token, availability, activeOrder, activeOrders,
  confirmedOrders,
  hasActiveOrder, myPosition, onMessage,
  routeStopsOverride,  // secuencia óptima del backend via SSE route_update
}) {
  const [counters,       setCounters]       = useState(null);
  const [customPin,      setCustomPin]      = useState(null);
  const [pinAddress,     setPinAddress]     = useState(null);
  const [loadingPin,     setLoadingPin]     = useState(false);
  const [routeGeometry,  setRouteGeometry]  = useState(null);
  const [routeSteps,     setRouteSteps]     = useState([]);
  const [navHeadingDeg,  setNavHeadingDeg]  = useState(0);
  const [centerSignal,   setCenterSignal]   = useState(null);
  const [centerMode,     setCenterMode]     = useState('free');
  const [routeActive,    setRouteActive]    = useState(false);
  const [activeZones,    setActiveZones]    = useState([]);
  const [activeImpassable, setActiveImpassable] = useState([]);
  const [myPreferences,  setMyPreferences]  = useState([]);
  const [navMode,        setNavMode]        = useState(null);
  const [mapInstance,    setMapInstance]    = useState(null);

  const [offerRouteGeometry, setOfferRouteGeometry] = useState(null);
  const [offerRouteLoading,  setOfferRouteLoading]  = useState(false);
  const [showFullOfferRoute, setShowFullOfferRoute]  = useState(false);
  const [offerMarkers,       setOfferMarkers]        = useState(null); // { restaurant: {lat,lng}, customer: {lat,lng} }
  const offerRouteGeometryRef = useRef(null); // ref para toggle — evita closure stale

  // Rerouting
  const lastRerouteRef        = useRef(0);
  const prevOfferCenterModeRef = useRef(null); // modo antes de activar oferta

  const centerModeRef      = useRef('free');
  const centerCycleRef     = useRef(0);
  const autoCenterRef      = useRef(null);
  const lastInteractionRef = useRef(Date.now());

  const refreshZones = useCallback(() => {
    fetchActiveZones()
      .then((data) => { if (Array.isArray(data?.zones)) setActiveZones(data.zones); })
      .catch(() => {});
    fetchAllImpassable(token)
      .then((reports) => { if (Array.isArray(reports)) setActiveImpassable(reports); })
      .catch(() => {});
    if (token) {
      fetchMyPreferences(token)
        .then((prefs) => { if (Array.isArray(prefs)) setMyPreferences(prefs); })
        .catch(() => {});
    }
  }, [token]);

  useEffect(() => {
    if (!token || !availability) return;
    fetchDriverCounters(token)
      .then((data) => setCounters(data.counters))
      .catch(() => {});
  }, [availability, token]);

  useEffect(() => {
    if (hasActiveOrder) { setCustomPin(null); setPinAddress(null); }
  }, [hasActiveOrder]);

  useEffect(() => {
    if (!customPin) { setPinAddress(null); return; }
    setLoadingPin(true);
    reverseGeocode(customPin.lat, customPin.lng)
      .then((address) => setPinAddress(address || `${customPin.lat.toFixed(5)}, ${customPin.lng.toFixed(5)}`))
      .finally(() => setLoadingPin(false));
  }, [customPin]);

  useEffect(() => {
    if (!activeOrder) {
      setRouteGeometry(null);
      setRouteSteps([]);
      setRouteActive(false);
      centerCycleRef.current = 0;
    }
  }, [activeOrder]);

  // ── Estado inicial del mapa al montar ────────────────────────────────────
  // Dispara centerSignal='free' una sola vez para que DriverMap aplique
  // pitch 0, zoom 15, bearing 0 desde el primer render.
  // Si el driver ya tiene pedido activo al entrar, activa modo nav y traza ruta.
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (hasActiveOrder) {
      // Pedido activo al montar — activar nav y trazar ruta automáticamente
      setCenterMode('nav');
      centerModeRef.current = 'nav';
      setCenterSignal('nav');
      // Pequeño delay para que openRoadRouteApi tenga activeOrder disponible
      setTimeout(() => openRoadRouteApiRef.current?.(), 300);
    } else {
      // Sin pedido — arrancar en free con pitch 0
      setCenterSignal('free');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { refreshZones(); }, [refreshZones]);

  const scheduleAutoCenter = useCallback(() => {
    if (autoCenterRef.current) clearTimeout(autoCenterRef.current);
    const mode = centerModeRef.current;

    // nextStop y overview: restaurar su propia vista tras 10s sin interacción
    // nav y free: restaurar follow tras 5s sin interacción
    const delay = (mode === 'nextStop' || mode === 'overview') ? 10000 : 5000;

    autoCenterRef.current = setTimeout(() => {
      const currentMode = centerModeRef.current;
      // Restaurar la vista del modo actual — cada modo recuerda su propia perspectiva
      if (currentMode === 'nav')      setCenterSignal('nav');
      else if (currentMode === 'free')     setCenterSignal('free');
      else if (currentMode === 'nextStop') setCenterSignal('nextStop');
      else if (currentMode === 'overview') setCenterSignal('overview');
    }, delay);
  }, []);

  const handleMapInteraction = useCallback(() => {
    lastInteractionRef.current = Date.now();
    scheduleAutoCenter();
  }, [scheduleAutoCenter]);

  useEffect(() => {
    const events = ['touchstart', 'touchmove', 'pointerdown', 'wheel'];
    events.forEach((ev) => document.addEventListener(ev, handleMapInteraction, { passive: true }));
    return () => events.forEach((ev) => document.removeEventListener(ev, handleMapInteraction));
  }, [handleMapInteraction]);

  // ── Ciclo de centrado en modo navegación ──────────────────────────────────
  const handleCenterCycle = useCallback(() => {
    if (!routeActive || !routeGeometry?.length) {
      setCenterMode('free');
      centerModeRef.current = 'free';
      clearTimeout(autoCenterRef.current);
      setCenterSignal('free');
      return;
    }

    const next = (centerCycleRef.current + 1) % 3;
    centerCycleRef.current = next;
    clearTimeout(autoCenterRef.current);

    if (next === 0) {
      setCenterMode('nav');
      centerModeRef.current = 'nav';
      setCenterSignal('nav');
      scheduleAutoCenter();
    } else if (next === 1) {
      setCenterMode('nextStop');
      centerModeRef.current = 'nextStop';
      setCenterSignal('nextStop');
    } else {
      setCenterMode('overview');
      centerModeRef.current = 'overview';
      setCenterSignal('overview');
    }
  }, [routeActive, routeGeometry, scheduleAutoCenter]);

  const onRouteToPin = useCallback((pinPos) => {
    if (!pinPos) return;
    const origin = myPosition || pinPos;
    fetchRouteModel({ origin, pickup: undefined, delivery: pinPos, token })
      .then((data) => {
        if (!data?.geometry?.length) throw new Error('Ruta vacía');
        setRouteGeometry(data.geometry);
        setRouteSteps(Array.isArray(data?.steps) ? data.steps : []);
        onMessage(formatRouteSummary(data));
      })
      .catch(() => onMessage('No se pudo calcular la ruta al pin'));
  }, [myPosition, onMessage, token]);

  // ── Ruta activa ───────────────────────────────────────────────────────────
  // Solo usa routeStopsOverride del backend. Si no hay override disponible,
  // no calcula ruta de respaldo — espera al route_update del backend.
  const openRoadRouteApi = useCallback(() => {
    if (!activeOrder) return;

    if (!Array.isArray(routeStopsOverride) || routeStopsOverride.length === 0) {
      // Sin override — no calcular ruta de respaldo, el backend la enviará via SSE
      onMessage('Calculando ruta óptima…');
      return;
    }

    const waypoints = routeStopsOverride
      .filter(s => s.pos && Number.isFinite(s.pos.lat) && Number.isFinite(s.pos.lng))
      .map(s => ({ lat: s.pos.lat, lng: s.pos.lng }));

    if (!waypoints.length) return;

    const buildRoute = (origin) => {
      const segments = [origin, ...waypoints];
      const fetches  = [];
      for (let i = 0; i < segments.length - 1; i++) {
        fetches.push(fetchRouteModel({ origin: segments[i], pickup: undefined, delivery: segments[i + 1], token }));
      }
      Promise.all(fetches)
        .then((results) => {
          const combined = results.flatMap(d => d?.geometry || []);
          if (!combined.length) throw new Error('Ruta vacía');
          const steps = results.flatMap(d => Array.isArray(d?.steps) ? d.steps : []);
          setRouteGeometry(combined);
          setRouteSteps(steps);
          setRouteActive(true);
          centerCycleRef.current = 0;
          const first = results[0];
          if (first) onMessage(formatRouteSummary(first));
          setCenterSignal('nav');
        })
        .catch((error) => {
          setRouteGeometry(null);
          setRouteSteps([]);
          onMessage(error.message?.includes('502') ? 'Motor de rutas no disponible' : 'No se pudo calcular la ruta');
        });
    };

    if (myPosition) { buildRoute(myPosition); return; }
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => buildRoute({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => buildRoute(waypoints[0]),
        { timeout: 4000, maximumAge: 15000 }
      );
      return;
    }
    buildRoute(waypoints[0]);
  }, [activeOrder, routeStopsOverride, myPosition, onMessage, token]);

  // FIX: ref siempre apunta a la versión más reciente de openRoadRouteApi.
  const openRoadRouteApiRef = useRef(openRoadRouteApi);
  useEffect(() => {
    openRoadRouteApiRef.current = openRoadRouteApi;
  }, [openRoadRouteApi]);

  // Rerouting silencioso eliminado — el backend maneja todo el recálculo
  // via SSE route_update. El frontend solo dibuja lo que recibe.

  const handleToggleRoute = useCallback(() => {
    if (routeActive) {
      setRouteActive(false);
      setRouteGeometry(null);
      setRouteSteps([]);
      setCenterMode('free');
      centerModeRef.current = 'free';
      centerCycleRef.current = 0;
      setCenterSignal('free');
      return;
    }
    openRoadRouteApi();
  }, [routeActive, openRoadRouteApi]);

  // ── Preview de ruta de oferta ─────────────────────────────────────────────
  // Toggle basado en ref para evitar closure stale — offerRouteGeometryRef
  // siempre refleja el valor actual sin necesitar offerRouteGeometry en deps.
  const openOfferRoutePreview = useCallback(async (offer) => {
    // Toggle — leer ref (siempre fresco, no stale)
    if (offerRouteGeometryRef.current?.length) {
      offerRouteGeometryRef.current = null;
      setOfferRouteGeometry(null);
      setOfferMarkers(null);
      return;
    }

    // Extraer coordenadas de restaurante y cliente para markers
    const rLat = offer?.restaurantLat ?? offer?.restaurant_lat;
    const rLng = offer?.restaurantLng ?? offer?.restaurant_lng;
    const cLat = offer?.customerLat   ?? offer?.customer_lat;
    const cLng = offer?.customerLng   ?? offer?.customer_lng;

    // Guardar modo actual antes de activar oferta
    prevOfferCenterModeRef.current = centerModeRef.current;

    // Setear markers inmediatamente — no esperar a la geometría
    if (rLat && cLat) {
      setOfferMarkers({
        restaurant: { lat: Number(rLat), lng: Number(rLng) },
        customer:   { lat: Number(cLat), lng: Number(cLng) },
      });
      // Centrar mapa para mostrar ambos markers de la oferta
      setCenterSignal('overview');
    }

    // Usar routeStops del engine si están disponibles — no calcular en cliente
    const routeStops = offer?.routeStops;
    if (Array.isArray(routeStops) && routeStops.length > 0) {
      const waypoints = routeStops
        .filter(s => s.pos && Number.isFinite(s.pos.lat) && Number.isFinite(s.pos.lng))
        .map(s => ({ lat: s.pos.lat, lng: s.pos.lng }));

      if (waypoints.length > 0) {
        setOfferRouteLoading(true);
        try {
          const origin = myPosition ?? waypoints[0];
          const segments = [origin, ...waypoints];
          const fetches = [];
          for (let i = 0; i < segments.length - 1; i++) {
            fetches.push(fetchRouteModel({ origin: segments[i], pickup: undefined, delivery: segments[i + 1], token }));
          }
          const results = await Promise.all(fetches);
          const combined = results.flatMap(d => d?.geometry || []);
          if (combined.length) {
            offerRouteGeometryRef.current = combined;
            setOfferRouteGeometry(combined);
          }
        } catch (_) {
          offerRouteGeometryRef.current = null;
          setOfferRouteGeometry(null);
        } finally {
          setOfferRouteLoading(false);
        }
        return;
      }
    }

    // Fallback: calcular desde coordenadas del offer
    if (!rLat || !cLat) return;

    const key = getOfferRouteCacheKey(offer);
    const cached = offerRouteCache.get(key);
    if (cached && Date.now() - cached.ts < OFFER_ROUTE_CACHE_MS) {
      offerRouteGeometryRef.current = cached.geometry;
      setOfferRouteGeometry(cached.geometry);
      return;
    }

    setOfferRouteLoading(true);
    try {
      const pickup   = { lat: Number(rLat), lng: Number(rLng) };
      const delivery = { lat: Number(cLat), lng: Number(cLng) };
      const data = await fetchRouteModel({ origin: pickup, pickup: undefined, delivery, token });
      if (data?.geometry?.length) {
        offerRouteCache.set(key, { geometry: data.geometry, ts: Date.now() });
        offerRouteGeometryRef.current = data.geometry;
        setOfferRouteGeometry(data.geometry);
      } else {
        offerRouteGeometryRef.current = null;
        setOfferRouteGeometry(null);
      }
    } catch (_) {
      offerRouteGeometryRef.current = null;
      setOfferRouteGeometry(null);
    } finally {
      setOfferRouteLoading(false);
    }
  }, [myPosition, token]); // offerRouteGeometry eliminado de deps — se usa ref

  const openFullOfferRoute = useCallback(async (offer) => {
    if (!offer?.restaurantLat) return;
    setShowFullOfferRoute(v => !v);
  }, []);

  const closeOfferPreview = useCallback(() => {
    setOfferRouteGeometry(null);
    setShowFullOfferRoute(false);
  }, []);

  // Llamar cuando se acepta/rechaza/expira la oferta para restaurar ruta activa
  const clearOfferRoute = useCallback(() => {
    offerRouteGeometryRef.current = null;
    setOfferRouteGeometry(null);
    setOfferMarkers(null);
    setShowFullOfferRoute(false);
    // Restaurar centerSignal al modo previo a la oferta
    const prev = prevOfferCenterModeRef.current;
    if (prev) {
      setCenterSignal(prev);
      prevOfferCenterModeRef.current = null;
    }
  }, []);

  const openGoogleNavigation = useCallback(() => {
    const target = getGoogleNavigationTarget(activeOrder);
    if (!target) { onMessage('Faltan coordenadas para navegar'); return; }

    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIOS) {
      const anchor = document.createElement('a');
      anchor.href = buildGoogleMapsAppUrl(target);
      anchor.click();
      setTimeout(() => window.open(buildGoogleMapsWebUrl(target), '_blank', 'noopener'), 500);
      return;
    }
    window.location.href = buildGoogleNavigationUrl(target);
  }, [activeOrder, onMessage]);

  const handleZoneConfirm = useCallback((params) => {
    createZoneReport(params, token)
      .then(() => { setNavMode(null); refreshZones(); onMessage('Zona reportada ✓'); })
      .catch((error) => onMessage(getErrorMessage(error, 'No se pudo reportar la zona')));
  }, [onMessage, refreshZones, token]);

  const handleImpassableConfirm = useCallback((ways) => {
    const pos = myPosition || { lat: 0, lng: 0 };
    submitImpassableRoads({ position: pos, ways, token })
      .then(() => { setNavMode(null); onMessage(`${ways.length} calle(s) reportada(s) ✓`); })
      .catch((error) => onMessage(getErrorMessage(error, 'No se pudieron reportar las calles')));
  }, [myPosition, onMessage, token]);

  const handlePreferenceConfirm = useCallback((ways) => {
    submitRoadPreferences({ ways, token })
      .then(() => { setNavMode(null); onMessage(`${ways.length} preferencia(s) guardada(s) ✓`); })
      .catch((error) => onMessage(getErrorMessage(error, 'No se pudieron guardar las preferencias')));
  }, [onMessage, token]);

  // allStops: usa el orden calculado por el backend (routeStopsOverride) cuando está
  // disponible. Fallback: pedidos confirmados en orden de aceptación.
  const allStops = (() => {
    if (Array.isArray(routeStopsOverride) && routeStopsOverride.length > 0) {
      // El backend ya calculó la secuencia óptima — usarla directamente
      return routeStopsOverride
        .filter(s => s.pos && Number.isFinite(s.pos.lat) && Number.isFinite(s.pos.lng))
        .map(s => ({
          lat:      s.pos.lat,
          lng:      s.pos.lng,
          type:     s.type,
          orderId:  s.orderId,
          orderIds: Array.isArray(s.orderIds) ? s.orderIds : [s.orderId], // P4
        }));
    }

    // Fallback: construir desde pedidos activos en orden de aceptación
    return (confirmedOrders?.length
      ? confirmedOrders
      : (activeOrder?.restaurant_confirmed !== false && activeOrder ? [activeOrder] : [])
    )
      .filter(o => !['delivered', 'cancelled'].includes(o.status))
      .flatMap(o => {
        const pts = [];
        if (o.restaurant_lat && o.restaurant_lng && !o.picked_up_at)
          pts.push({ lat: Number(o.restaurant_lat), lng: Number(o.restaurant_lng), type: 'pickup' });
        if (o.customer_lat && o.customer_lng)
          pts.push({ lat: Number(o.customer_lat), lng: Number(o.customer_lng), type: 'delivery' });
        return pts;
      });
  })();

  // ── Distancia al próximo stop ─────────────────────────────────────────────
  const distToNextStop = (() => {
    if (!myPosition || !activeOrder) return null;
    const isOTW = activeOrder.status === 'on_the_way';
    const stopLat = isOTW ? Number(activeOrder.delivery_lat  ?? activeOrder.customer_lat)  : Number(activeOrder.restaurant_lat);
    const stopLng = isOTW ? Number(activeOrder.delivery_lng  ?? activeOrder.customer_lng)  : Number(activeOrder.restaurant_lng);
    if (!Number.isFinite(stopLat) || !Number.isFinite(stopLng)) return null;
    return Math.round(haversineMeters(myPosition.lat, myPosition.lng, stopLat, stopLng));
  })();

  // ── P1: Ruta parcial driver→allStops[0] ──────────────────────────────────
  // La geometría completa es driver→stop1→stop2→...
  // Buscamos el punto de mínima distancia al próximo stop de forma progresiva
  // (forward scan) — el mínimo global marca el fin del tramo driver→stop1.

    const partialRouteGeometry = (() => {
    if (!routeGeometry?.length || !allStops?.length) return routeGeometry;
    const target = allStops[0];
    if (!target) return routeGeometry;

    let closestIdx  = 0;
    let closestDist = Infinity;

    for (let i = 0; i < routeGeometry.length; i++) {
      const pt    = routeGeometry[i];
      const ptLat = pt[1] ?? pt.lat;
      const ptLng = pt[0] ?? pt.lng;
      if (!Number.isFinite(ptLat) || !Number.isFinite(ptLng)) continue;
      const d = haversineMeters(ptLat, ptLng, target.lat, target.lng);
      if (d < closestDist) { closestDist = d; closestIdx = i; }
    }

    const endIdx = Math.max(closestIdx + 1, 2);
    return routeGeometry.slice(0, endIdx);
  })();

  // ── Reroute automático por desvío de ruta con bloqueo adaptativo ────────────
  //
  // Threshold consistente con reroute_lock_radius_m del backend (200m).
  // Tres escenarios:
  //   1. Driver regresa por la misma geometría → retroceder índice (no reroute)
  //   2. Retorno geométrico en la ruta → avanzar índice (no reroute)
  //   3. Driver abandona la geometría completamente → reroute con bloqueo
  //
  // Bloqueo adaptativo: si el driver ignora la nueva ruta, el radio de bloqueo
  // crece en navigation_block_step_m (200m) en cada intento.
  // El bloqueo se envía al backend como { blockPos, blockRadiusM } para que
  // rerouteDriver construya una ruta que evite esa zona.

  const REROUTE_THRESHOLD_M = 200; // consistente con reroute_lock_radius_m
  const REROUTE_COOLDOWN_MS = 30_000;
  const BLOCK_STEP_M        = 200; // navigation_block_step_m

  const blockStateRef       = useRef(null); // { pos, radiusM, attempts }
  const routeProgressRef    = useRef(0);    // índice del punto más cercano actual

  useEffect(() => {
    if (!myPosition || !routeGeometry?.length || !routeActive || !token) return;

    const pos = myPosition;

    // ── Encontrar punto más cercano y su índice en la geometría ──────────────
    let minDist    = Infinity;
    let minIdx     = 0;
    let minDistPrev = Infinity; // distancia mínima a puntos ANTERIORES al progreso actual

    for (let i = 0; i < routeGeometry.length; i++) {
      const pt    = routeGeometry[i];
      const ptLat = pt[1] ?? pt.lat;
      const ptLng = pt[0] ?? pt.lng;
      if (!Number.isFinite(ptLat) || !Number.isFinite(ptLng)) continue;
      const d = haversineMeters(pos.lat, pos.lng, ptLat, ptLng);
      if (d < minDist) { minDist = d; minIdx = i; }
      if (i < routeProgressRef.current && d < minDistPrev) minDistPrev = d;
    }

    // ── Escenario 1/2: driver sigue sobre la geometría (retroceso o retorno) ─
    if (minDist <= REROUTE_THRESHOLD_M) {
      // Actualizar progreso — avanza o retrocede según posición real
      routeProgressRef.current = minIdx;
      // Si había bloqueo activo y el driver volvió a la ruta → limpiar
      if (blockStateRef.current) blockStateRef.current = null;
      return;
    }

    // ── Escenario 3: driver fuera de geometría ────────────────────────────────
    // Verificar si está cerca de algún punto anterior (retroceso fuera de ruta)
    // o si realmente tomó otra vialidad
    const now = Date.now();
    if (now - lastRerouteRef.current < REROUTE_COOLDOWN_MS) return;
    lastRerouteRef.current = now;

    // Encontrar último punto de contacto (punto más cercano antes del desvío)
    const lastContactPt = routeGeometry[routeProgressRef.current];
    const lastContactPos = lastContactPt
      ? { lat: lastContactPt[1] ?? lastContactPt.lat, lng: lastContactPt[0] ?? lastContactPt.lng }
      : pos;

    // Calcular radio de bloqueo adaptativo
    let blockRadiusM = BLOCK_STEP_M;
    if (blockStateRef.current) {
      // El driver ignoró la última ruta sugerida — extender bloqueo
      const sameZone = haversineMeters(
        pos.lat, pos.lng,
        blockStateRef.current.pos.lat, blockStateRef.current.pos.lng
      ) < BLOCK_STEP_M * 2;

      if (sameZone) {
        blockRadiusM = blockStateRef.current.radiusM + BLOCK_STEP_M;
        blockStateRef.current.attempts++;
      } else {
        // Nuevo punto de abandono — reiniciar bloqueo
        blockStateRef.current = null;
        blockRadiusM = BLOCK_STEP_M;
      }
    }

    blockStateRef.current = {
      pos:      lastContactPos,
      radiusM:  blockRadiusM,
      attempts: blockStateRef.current?.attempts ?? 1,
    };

    // Enviar reroute con información de bloqueo
    fetch('/api/drivers/reroute', {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        blockPos:     lastContactPos,
        blockRadiusM: blockRadiusM,
      }),
    }).catch(() => {});

  }, [myPosition?.lat, myPosition?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    counters,
    customPin, setCustomPin,
    pinAddress, loadingPin,
    routeGeometry, routeSteps,
    partialRouteGeometry,
    navHeadingDeg, setNavHeadingDeg,
    centerSignal, setCenterSignal,
    centerMode, centerCycleRef,
    activeZones, activeImpassable, myPreferences,
    navMode, setNavMode,
    mapInstance, setMapInstance,
    lastInteractionRef,
    routeActive,
    handleToggleRoute,
    onRouteToPin,
    allStops,
    refreshZones,
    handleCenterCycle,
    openRoadRouteApi,
    openGoogleNavigation,
    handleZoneConfirm,
    handleImpassableConfirm,
    handlePreferenceConfirm,
    offerRouteGeometry,
    offerRouteLoading,
    offerMarkers,
    showFullOfferRoute,
    openOfferRoutePreview,
    openFullOfferRoute,
    closeOfferPreview,
    clearOfferRoute,
    distToNextStop,
  };
}
