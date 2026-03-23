import { useCallback, useEffect, useRef, useState } from 'react';

import { reverseGeocode } from '../../../utils/geo';
import { getErrorMessage } from '../../../utils/errorMessage';
import {
  createZoneReport,
  fetchActiveZones,
  fetchDriverCounters,
  fetchRouteModel,
  submitImpassableRoads,
  submitRoadPreferences,
} from './api';
import { fetchAllImpassable } from '../alerts/api';
import {
  buildGoogleMapsAppUrl,
  buildGoogleMapsWebUrl,
  buildGoogleNavigationUrl,
  formatRouteSummary,
  getDriverRouteStops,
  getGoogleNavigationTarget,
} from './navigation';

export function useDriverHomeRuntime({ token, availability, activeOrder, activeOrders, hasActiveOrder, myPosition, onMessage }) {
  const [counters, setCounters] = useState(null);
  const [customPin, setCustomPin] = useState(null);
  const [pinAddress, setPinAddress] = useState(null);
  const [loadingPin, setLoadingPin] = useState(false);
  const [routeGeometry, setRouteGeometry] = useState(null);
  const [routeSteps, setRouteSteps] = useState([]);
  const [navHeadingDeg, setNavHeadingDeg] = useState(0);
  const [centerSignal, setCenterSignal] = useState(null);
  const [centerMode, setCenterMode] = useState('nav');
  const [activeZones, setActiveZones] = useState([]);
  const [activeImpassable, setActiveImpassable] = useState([]);
  const [navMode, setNavMode] = useState(null);
  const [mapInstance, setMapInstance] = useState(null);

  const centerModeRef     = useRef('nav');
  const autoCenterRef     = useRef(null);
  const lastInteractionRef = useRef(Date.now());

  const refreshZones = useCallback(() => {
    fetchActiveZones()
      .then((data) => {
        if (Array.isArray(data?.zones)) setActiveZones(data.zones);
      })
      .catch(() => {});
    fetchAllImpassable(token)
      .then((reports) => {
        if (Array.isArray(reports)) setActiveImpassable(reports);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!token || !availability) return;
    fetchDriverCounters(token)
      .then((data) => setCounters(data.counters))
      .catch(() => {});
  }, [availability, token]);

  useEffect(() => {
    if (hasActiveOrder) {
      setCustomPin(null);
      setPinAddress(null);
    }
  }, [hasActiveOrder]);

  useEffect(() => {
    if (!customPin) {
      setPinAddress(null);
      return;
    }

    setLoadingPin(true);
    reverseGeocode(customPin.lat, customPin.lng)
      .then((address) => setPinAddress(address || `${customPin.lat.toFixed(5)}, ${customPin.lng.toFixed(5)}`))
      .finally(() => setLoadingPin(false));
  }, [customPin]);

  useEffect(() => {
    if (!activeOrder) {
      setRouteGeometry(null);
      setRouteSteps([]);
    }
  }, [activeOrder]);

  useEffect(() => {
    refreshZones();
  }, [refreshZones]);

  const scheduleAutoCenter = useCallback(() => {
    if (autoCenterRef.current) clearTimeout(autoCenterRef.current);
    if (centerModeRef.current !== 'nav') return;
    autoCenterRef.current = setTimeout(() => {
      if (centerModeRef.current === 'nav') setCenterSignal('nav');
    }, 5000);
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

  const handleCenterCycle = useCallback(() => {
    // Ciclo: nav → overview → nav
    // overview solo disponible si hay ruta activa
    const next = centerModeRef.current === 'nav' && routeGeometry?.length
      ? 'overview'
      : 'nav';

    setCenterMode(next);
    centerModeRef.current = next;
    clearTimeout(autoCenterRef.current);

    if (next === 'nav') {
      setCenterSignal('nav');
      scheduleAutoCenter();
    } else {
      setCenterSignal('overview');
    }
  }, [routeGeometry, scheduleAutoCenter]);

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

  const openRoadRouteApi = useCallback(() => {
    if (!activeOrder) return;

    // Construir lista de stops encadenados desde todos los pedidos activos
    // Orden: por cada pedido (sorted by accepted_at), agregar pickup si no recogido, luego delivery
    const orders = (activeOrders?.length ? activeOrders : [activeOrder])
      .filter(o => !['delivered', 'cancelled'].includes(o.status))
      .sort((a, b) => new Date(a.accepted_at || a.created_at) - new Date(b.accepted_at || b.created_at));

    // Construir waypoints: [pickup?, delivery] por pedido
    const waypoints = [];
    for (const o of orders) {
      const { pickup, delivery } = getDriverRouteStops(o);
      // Solo incluir pickup si el pedido aún no fue recogido
      if (pickup && !o.picked_up_at) waypoints.push(pickup);
      if (delivery) waypoints.push(delivery);
    }

    if (waypoints.length === 0) {
      onMessage('Faltan coordenadas del pedido para trazar la ruta');
      return;
    }

    const buildRoute = (origin) => {
      // Para rutas multi-stop: llamadas encadenadas tramo a tramo y combinar geometrías
      const segments = [origin, ...waypoints];
      const fetches = [];
      for (let i = 0; i < segments.length - 1; i++) {
        fetches.push(
          fetchRouteModel({ origin: segments[i], pickup: null, delivery: segments[i + 1], token })
        );
      }
      Promise.all(fetches)
        .then((results) => {
          const combined = results.flatMap(d => d?.geometry || []);
          if (!combined.length) throw new Error('Ruta vacía');
          const steps = results.flatMap(d => Array.isArray(d?.steps) ? d.steps : []);
          setRouteGeometry(combined);
          setRouteSteps(steps);
          // Resumen del primer tramo
          const first = results[0];
          if (first) onMessage(formatRouteSummary(first));
          // Activar overview para ver toda la ruta
          setCenterSignal('overview');
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
  }, [activeOrder, activeOrders, myPosition, onMessage, token]);

  const openGoogleNavigation = useCallback(() => {
    const target = getGoogleNavigationTarget(activeOrder);
    if (!target) {
      onMessage('Faltan coordenadas para navegar');
      return;
    }

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
      .then(() => {
        setNavMode(null);
        refreshZones();
        onMessage('Zona reportada ✓');
      })
      .catch((error) => onMessage(getErrorMessage(error, 'No se pudo reportar la zona')));
  }, [onMessage, refreshZones, token]);

  const handleImpassableConfirm = useCallback((ways) => {
    const pos = myPosition || { lat: 0, lng: 0 };
    submitImpassableRoads({ position: pos, ways, token })
      .then(() => {
        setNavMode(null);
        onMessage(`${ways.length} calle(s) reportada(s) ✓`);
      })
      .catch((error) => onMessage(getErrorMessage(error, 'No se pudieron reportar las calles')));
  }, [myPosition, onMessage, token]);

  const handlePreferenceConfirm = useCallback((ways) => {
    submitRoadPreferences({ ways, token })
      .then(() => {
        setNavMode(null);
        onMessage(`${ways.length} preferencia(s) guardada(s) ✓`);
      })
      .catch((error) => onMessage(getErrorMessage(error, 'No se pudieron guardar las preferencias')));
  }, [onMessage, token]);

  // Todos los stops de pedidos activos — para fitBounds del overview multi-stop
  const allStops = (activeOrders?.length ? activeOrders : (activeOrder ? [activeOrder] : []))
    .filter(o => !['delivered', 'cancelled'].includes(o.status))
    .flatMap(o => {
      const pts = [];
      if (o.restaurant_lat && o.restaurant_lng && !o.picked_up_at)
        pts.push({ lat: Number(o.restaurant_lat), lng: Number(o.restaurant_lng) });
      if (o.customer_lat && o.customer_lng)
        pts.push({ lat: Number(o.customer_lat), lng: Number(o.customer_lng) });
      return pts;
    });

  return {
    counters,
    customPin,
    setCustomPin,
    pinAddress,
    loadingPin,
    routeGeometry,
    routeSteps,
    navHeadingDeg,
    setNavHeadingDeg,
    centerSignal,
    setCenterSignal,
    centerMode,
    activeZones,
    activeImpassable,
    navMode,
    setNavMode,
    mapInstance,
    setMapInstance,
    lastInteractionRef,
    onRouteToPin,
    allStops,
    refreshZones,
    handleCenterCycle,
    openRoadRouteApi,
    openGoogleNavigation,
    handleZoneConfirm,
    handleImpassableConfirm,
    handlePreferenceConfirm,
  };
}
