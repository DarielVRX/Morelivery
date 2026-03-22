// pages/Driver/Home.jsx — orquestador puro
// Toda la lógica de negocio está en useOrderManager
// Toda la lógica de mapa está en DriverMap
// Los componentes de UI son independientes y reciben solo props

import { useCallback, useEffect, useRef, useState } from 'react';

import { apiFetch } from '../../api/client';
import ActiveOrderPanel from '../../components/ActiveOrderPanel';
import OfferPanel from '../../components/OfferPanel';
import PullToRefresh from '../../components/PullToRefresh';
import { useAuth } from '../../contexts/AuthContext';
import { createZoneReport, fetchActiveZones, fetchDriverCounters, submitImpassableRoads, submitRoadPreferences } from '../../features/driver/home/api';
import { ensureDriverHomeAnimations } from '../../features/driver/home/animations';
import DriverHomeMapSection from '../../features/driver/home/DriverHomeMapSection.jsx';
import { buildGoogleMapsAppUrl, buildGoogleMapsWebUrl, buildGoogleNavigationUrl, formatRouteSummary, getDriverRouteStops, getGoogleNavigationTarget } from '../../features/driver/home/navigation';
import DriverHomeStatusBar from '../../features/driver/home/DriverHomeStatusBar.jsx';
import { useAppBadge } from '../../hooks/useAppBadge';
import { useDriverLocation } from '../../hooks/useDriverLocation';
import { useNavFeatures } from '../../hooks/useNavFeatures';
import { useOrderManager } from '../../hooks/useOrderManager';
import { reverseGeocode } from '../../utils/geo';
import { ZONE_LABELS } from '../../utils/format';
import { getErrorMessage } from '../../utils/errorMessage';

ensureDriverHomeAnimations();

export default function DriverHome() {
  const { auth, patchUser } = useAuth();
  const order = useOrderManager(auth.token, patchUser, auth.user?.driver);
  const badgeCount = order.pendingOffer ? 1 : (order.hasActiveOrder ? 1 : 0);
  useAppBadge(badgeCount);

  const [counters, setCounters] = useState(null);
  const [msg, setMsg] = useState('');
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

  useEffect(() => {
    if (!auth.token || !order.availability) return;
    fetchDriverCounters(auth.token)
      .then((data) => setCounters(data.counters))
      .catch(() => {});
  }, [auth.token, order.availability]);

  const { position: myPosition, error: gpsError } = useDriverLocation(auth.token, order.availability, order.hasActiveOrder);

  useEffect(() => {
    if (order.hasActiveOrder) {
      setCustomPin(null);
      setPinAddress(null);
    }
  }, [order.hasActiveOrder]);

  useEffect(() => {
    if (!customPin) {
      setPinAddress(null);
      return;
    }

    setLoadingPin(true);
    reverseGeocode(customPin.lat, customPin.lng)
      .then((address) => setPinAddress(address || `${customPin.lat.toFixed(5)}, ${customPin.lng.toFixed(5)}`))
      .finally(() => setLoadingPin(false));
  }, [customPin?.lat, customPin?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!order.activeOrder) {
      setRouteGeometry(null);
      setRouteSteps([]);
    }
  }, [order.activeOrder]);

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

  function handleCenterCycle() {
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
  }

  const { voiceEnabled, setVoiceEnabled, wakeLockActive } = useNavFeatures({
    steps: routeSteps,
    currentPos: myPosition,
    activeZones,
    hasActiveOrder: order.hasActiveOrder,
    onVoice: (text) => setMsg(text),
    onZoneAlert: (zone) => setMsg(`⚠️ Zona de alerta cerca: ${ZONE_LABELS[zone?.type] || zone?.type}`),
    impassableWays: [],
    routeGeometry: routeGeometry || [],
  });

  useEffect(() => {
    function fetchZones() {
      fetchActiveZones()
        .then((data) => {
          if (Array.isArray(data?.zones)) setActiveZones(data.zones);
        })
        .catch(() => {});
    }

    fetchZones();
    const id = setInterval(fetchZones, 2 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  function openRoadRouteApi() {
    if (!order.activeOrder) return;

    const { pickup, delivery } = getDriverRouteStops(order.activeOrder);
    if (!pickup || !delivery) {
      setMsg('Faltan coordenadas del pedido para trazar la ruta');
      return;
    }

    const callRoute = (origin) => {
      apiFetch('/routes/model', {
        method: 'POST',
        body: JSON.stringify({ origin, destination: delivery, waypoints: origin !== pickup ? [pickup] : [], includeSteps: true }),
      }, auth.token)
        .then((data) => {
          if (!data?.geometry?.length) throw new Error('Ruta vacía');
          setRouteGeometry(data.geometry);
          setRouteSteps(Array.isArray(data?.steps) ? data.steps : []);
          setMsg(formatRouteSummary(data));
        })
        .catch((error) => {
          setRouteGeometry(null);
          setRouteSteps([]);
          setMsg(error.message?.includes('502') ? 'Motor de rutas no disponible' : 'No se pudo calcular la ruta');
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
  }

  function openGoogleNavigation() {
    const target = getGoogleNavigationTarget(order.activeOrder);
    if (!target) {
      setMsg('Faltan coordenadas para navegar');
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
  }

  function refreshZones() {
    fetchActiveZones()
      .then((data) => {
        if (Array.isArray(data?.zones)) setActiveZones(data.zones);
      })
      .catch(() => {});
  }

  function handleZoneConfirm(params) {
    createZoneReport(params, auth.token)
      .then(() => {
        setNavMode(null);
        refreshZones();
        setMsg('Zona reportada ✓');
      })
      .catch((error) => setMsg(getErrorMessage(error, 'No se pudo reportar la zona')));
  }

  function handleImpassableConfirm(ways) {
    const pos = myPosition || { lat: 0, lng: 0 };
    submitImpassableRoads({ position: pos, ways, token: auth.token })
      .then(() => {
        setNavMode(null);
        setMsg(`${ways.length} calle(s) reportada(s) ✓`);
      })
      .catch((error) => setMsg(getErrorMessage(error, 'No se pudieron reportar las calles')));
  }

  function handlePreferenceConfirm(ways) {
    submitRoadPreferences({ ways, token: auth.token })
      .then(() => {
        setNavMode(null);
        setMsg(`${ways.length} preferencia(s) guardada(s) ✓`);
      })
      .catch((error) => setMsg(getErrorMessage(error, 'No se pudieron guardar las preferencias')));
  }

  return (
    <PullToRefresh onRefresh={order.loadData}>
      <div className="driver-map-root" style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden', position:'relative' }}>
        <DriverHomeStatusBar
          availability={order.availability}
          position={myPosition}
          notifPermission={order.notifPermission}
          notifPriorityMode={order.notifPriorityMode}
          wakeLockActive={wakeLockActive}
          gpsError={gpsError}
          counters={counters}
          onToggleAvailability={() => order.toggleAvailability(setMsg)}
          msg={msg}
          onDismissMsg={() => setMsg('')}
          transferBanner={order.transferBanner}
          onDismissTransferBanner={() => order.setTransferBanner(null)}
        />

        <DriverHomeMapSection
          availability={order.availability}
          hasActiveOrder={order.hasActiveOrder}
          customPin={customPin}
          setCustomPin={setCustomPin}
          pinAddress={pinAddress}
          loadingPin={loadingPin}
          routeGeometry={routeGeometry}
          myPosition={myPosition}
          activeOrder={order.activeOrder}
          navFollowEnabled={navFollowEnabled}
          navHeadingDeg={navHeadingDeg}
          onHeadingChange={setNavHeadingDeg}
          centerSignal={centerSignal}
          onCenterDone={() => setCenterSignal(null)}
          setMapInstance={setMapInstance}
          mapInstance={mapInstance}
          activeZones={activeZones}
          token={auth.token}
          centerMode={centerMode}
          voiceEnabled={voiceEnabled}
          navMode={navMode}
          onCenterCycle={handleCenterCycle}
          onVoiceToggle={() => setVoiceEnabled((value) => !value)}
          onGoogleNav={openGoogleNavigation}
          onNavMode={setNavMode}
          setMsg={setMsg}
          onSubmitZone={handleZoneConfirm}
          onSubmitImpassable={handleImpassableConfirm}
          onSubmitPreference={handlePreferenceConfirm}
        />

        <OfferPanel
          offer={order.pendingOffer}
          minimized={order.offerMinimized}
          loading={order.loadingOffer}
          onAccept={() => order.acceptOffer(setMsg)}
          onReject={() => order.rejectOffer(setMsg)}
          onToggleMinimize={() => order.setOfferMinimized((value) => !value)}
          onExpired={() => {
            const warning = order.handleOfferExpired();
            if (warning) setMsg(warning);
          }}
        />

        <ActiveOrderPanel
          order={order.hasActiveOrder ? order.activeOrder : null}
          expanded={order.orderExpanded}
          loadingStatus={order.loadingStatus}
          showRelease={order.showRelease}
          releaseNote={order.releaseNote}
          onToggleExpand={() => order.setOrderExpanded((expanded) => !expanded)}
          onChangeStatus={(id, status) => order.changeStatus(id, status, setMsg)}
          onToggleRelease={() => order.setShowRelease((show) => !show)}
          onReleaseNoteChange={order.setReleaseNote}
          onConfirmRelease={() => order.doRelease(setMsg)}
          onRebalance={() => order.doRebalance(setMsg)}
          onRoute={openRoadRouteApi}
        />
      </div>
    </PullToRefresh>
  );
}
