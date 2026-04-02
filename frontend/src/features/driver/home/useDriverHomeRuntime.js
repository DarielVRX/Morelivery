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

  // Rerouting
  const lastRerouteRef   = useRef(0);
  const REROUTE_DIST_M   = 50;
  const REROUTE_COOLDOWN = 15_000;

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
    fetchRouteModel({ origin, pickup: null, delivery: pinPos, token })
      .then((data) => {
        if (!data?.geometry?.length) throw new Error('Ruta vacía');
        setRouteGeometry(data.geometry);
        setRouteSteps(Array.isArray(data?.steps) ? data.steps : []);
        onMessage(formatRouteSummary(data));
      })
      .catch(() => onMessage('No se pudo calcular la ruta al pin'));
  }, [myPosition, onMessage, token]);

  // ── Ruta activa ───────────────────────────────────────────────────────────
  // Usa routeStopsOverride del backend cuando está disponible.
  // Fallback: pedidos confirmados en orden de aceptación.
  const openRoadRouteApi = useCallback(() => {
    if (!activeOrder) return;

    // Si el backend ya calculó la secuencia óptima, usar ese orden para los waypoints
    if (Array.isArray(routeStopsOverride) && routeStopsOverride.length > 0) {
      const waypoints = routeStopsOverride
        .filter(s => s.pos && Number.isFinite(s.pos.lat) && Number.isFinite(s.pos.lng))
        .map(s => ({ lat: s.pos.lat, lng: s.pos.lng }));

      if (waypoints.length) {
        const buildRoute = (origin) => {
          const segments = [origin, ...waypoints];
          const fetches  = [];
          for (let i = 0; i < segments.length - 1; i++) {
            fetches.push(fetchRouteModel({ origin: segments[i], pickup: null, delivery: segments[i + 1], token }));
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
        return;
      }
    }

    // Fallback: construir waypoints desde pedidos confirmados en orden de aceptación
    const orders = (confirmedOrders?.length ? confirmedOrders : (activeOrder?.restaurant_confirmed !== false ? [activeOrder] : []))
      .filter(o => !['delivered', 'cancelled'].includes(o.status))
      .sort((a, b) => new Date(a.accepted_at || a.created_at) - new Date(b.accepted_at || b.created_at));

    if (!orders.length) {
      onMessage('Esperando confirmación del restaurante para trazar la ruta');
      return;
    }

    const waypoints = [];
    for (const o of orders) {
      const { pickup, delivery } = getDriverRouteStops(o);
      if (pickup && !o.picked_up_at) waypoints.push(pickup);
      if (delivery) waypoints.push(delivery);
    }

    if (!waypoints.length) {
      onMessage('Faltan coordenadas del pedido para trazar la ruta');
      return;
    }

    const buildRoute = (origin) => {
      const segments = [origin, ...waypoints];
      const fetches  = [];
      for (let i = 0; i < segments.length - 1; i++) {
        fetches.push(fetchRouteModel({ origin: segments[i], pickup: null, delivery: segments[i + 1], token }));
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
  }, [activeOrder, confirmedOrders, myPosition, onMessage, token]);

  // FIX: ref siempre apunta a la versión más reciente de openRoadRouteApi.
  // Evita stale closure en el efecto de rerouting cuando confirmedOrders cambia
  // sin necesidad de agregarlo como dependencia (lo que causaría loops infinitos).
  const openRoadRouteApiRef = useRef(openRoadRouteApi);
  useEffect(() => {
    openRoadRouteApiRef.current = openRoadRouteApi;
  }, [openRoadRouteApi]);

  // ── Rerouting silencioso ───────────────────────────────────────────────────
  useEffect(() => {
    if (!routeActive || !routeGeometry?.length || !myPosition) return;

    const now = Date.now();
    if (now - lastRerouteRef.current < REROUTE_COOLDOWN) return;

    let minDist = Infinity;
    for (const pt of routeGeometry) {
      const d = haversineMeters(myPosition.lat, myPosition.lng, pt.lat, pt.lng);
      if (d < minDist) minDist = d;
    }

    if (minDist > REROUTE_DIST_M) {
      lastRerouteRef.current = now;
      console.log(`[reroute] desviación ${Math.round(minDist)}m — recalculando`);
      // FIX: usar ref en lugar de closure directo — siempre apunta a la versión fresca
      openRoadRouteApiRef.current?.();
    }
  // FIX: openRoadRouteApi removido de las dependencias — se accede via ref
  }, [myPosition?.lat, myPosition?.lng, routeActive, routeGeometry]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const openOfferRoutePreview = useCallback(async (offer) => {
    const rLat = offer?.restaurantLat ?? offer?.restaurant_lat;
    const rLng = offer?.restaurantLng ?? offer?.restaurant_lng;
    const cLat = offer?.customerLat   ?? offer?.customer_lat;
    const cLng = offer?.customerLng   ?? offer?.customer_lng;
    if (!rLat || !cLat) return;

    const key = getOfferRouteCacheKey(offer);
    const cached = offerRouteCache.get(key);
    if (cached && Date.now() - cached.ts < OFFER_ROUTE_CACHE_MS) {
      setOfferRouteGeometry(cached.geometry);
      return;
    }

    setOfferRouteLoading(true);
    try {
      const pickup   = { lat: Number(rLat), lng: Number(rLng) };
      const delivery = { lat: Number(cLat), lng: Number(cLng) };
      const data = await fetchRouteModel({ origin: pickup, pickup: null, delivery, token });
      if (data?.geometry?.length) {
        offerRouteCache.set(key, { geometry: data.geometry, ts: Date.now() });
        setOfferRouteGeometry(data.geometry);
      }
    } catch (_) {
      setOfferRouteGeometry(null);
    } finally {
      setOfferRouteLoading(false);
    }
  }, [token]);

  const openFullOfferRoute = useCallback(async (offer) => {
    if (!offer?.restaurantLat) return;
    setShowFullOfferRoute(v => !v);
  }, []);

  const closeOfferPreview = useCallback(() => {
    setOfferRouteGeometry(null);
    setShowFullOfferRoute(false);
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
        .map(s => ({ lat: s.pos.lat, lng: s.pos.lng, type: s.type, orderId: s.orderId }));
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

  return {
    counters,
    customPin, setCustomPin,
    pinAddress, loadingPin,
    routeGeometry, routeSteps,
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
    showFullOfferRoute,
    openOfferRoutePreview,
    openFullOfferRoute,
    closeOfferPreview,
  };
}
