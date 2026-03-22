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
import {
  buildGoogleMapsAppUrl,
  buildGoogleMapsWebUrl,
  buildGoogleNavigationUrl,
  formatRouteSummary,
  getDriverRouteStops,
  getGoogleNavigationTarget,
} from './navigation';

export function useDriverHomeRuntime({ token, availability, activeOrder, hasActiveOrder, myPosition, onMessage }) {
  const [counters, setCounters] = useState(null);
  const [customPin, setCustomPin] = useState(null);
  const [pinAddress, setPinAddress] = useState(null);
  const [loadingPin, setLoadingPin] = useState(false);
  const [routeGeometry, setRouteGeometry] = useState(null);
  const [routeSteps, setRouteSteps] = useState([]);
  const [navHeadingDeg, setNavHeadingDeg] = useState(0);
  const [centerSignal, setCenterSignal] = useState(null);
  const [centerMode, setCenterMode] = useState('off');
  const [activeZones, setActiveZones] = useState([]);
  const [navMode, setNavMode] = useState(null);
  const [mapInstance, setMapInstance] = useState(null);
  const [navFollowEnabled] = useState(false);

  const centerModeRef = useRef('off');
  const autoCenterRef = useRef(null);

  const refreshZones = useCallback(() => {
    fetchActiveZones()
      .then((data) => {
        if (Array.isArray(data?.zones)) setActiveZones(data.zones);
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
    if (centerModeRef.current !== 'follow') return;
    autoCenterRef.current = setTimeout(() => {
      if (centerModeRef.current === 'follow') setCenterSignal('follow');
    }, 5000);
  }, []);

  useEffect(() => {
    const events = ['touchstart', 'touchmove', 'pointerdown', 'wheel'];
    const handler = () => scheduleAutoCenter();
    events.forEach((eventName) => document.addEventListener(eventName, handler, { passive: true }));
    return () => events.forEach((eventName) => document.removeEventListener(eventName, handler));
  }, [scheduleAutoCenter]);

  const handleCenterCycle = useCallback(() => {
    const modes = ['off', 'follow', 'overview'];
    const next = modes[(modes.indexOf(centerModeRef.current) + 1) % modes.length];
    const effective = (next === 'overview' && (!routeGeometry || !routeGeometry.length)) ? 'off' : next;

    setCenterMode(effective);
    centerModeRef.current = effective;
    clearTimeout(autoCenterRef.current);

    if (effective === 'follow') {
      setCenterSignal('follow');
      scheduleAutoCenter();
    } else if (effective === 'overview') {
      setCenterSignal('overview');
    } else {
      setCenterSignal('free');
    }
  }, [routeGeometry, scheduleAutoCenter]);

  const openRoadRouteApi = useCallback(() => {
    if (!activeOrder) return;

    const { pickup, delivery } = getDriverRouteStops(activeOrder);
    if (!pickup || !delivery) {
      onMessage('Faltan coordenadas del pedido para trazar la ruta');
      return;
    }

    const callRoute = (origin) => {
      fetchRouteModel({ origin, pickup, delivery, token })
        .then((data) => {
          if (!data?.geometry?.length) throw new Error('Ruta vacía');
          setRouteGeometry(data.geometry);
          setRouteSteps(Array.isArray(data?.steps) ? data.steps : []);
          onMessage(formatRouteSummary(data));
        })
        .catch((error) => {
          setRouteGeometry(null);
          setRouteSteps([]);
          onMessage(error.message?.includes('502') ? 'Motor de rutas no disponible' : 'No se pudo calcular la ruta');
        });
    };

    if (myPosition) {
      callRoute(myPosition);
      return;
    }

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => callRoute({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => callRoute(pickup),
        { timeout: 4000, maximumAge: 15000 }
      );
      return;
    }

    callRoute(pickup);
  }, [activeOrder, myPosition, onMessage, token]);

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
    navMode,
    setNavMode,
    mapInstance,
    setMapInstance,
    navFollowEnabled,
    refreshZones,
    handleCenterCycle,
    openRoadRouteApi,
    openGoogleNavigation,
    handleZoneConfirm,
    handleImpassableConfirm,
    handlePreferenceConfirm,
  };
}
