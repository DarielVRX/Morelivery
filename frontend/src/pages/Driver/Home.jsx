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
import DriverHomeMapSection from '../../features/driver/home/DriverHomeMapSection.jsx';
import DriverHomeStatusBar from '../../features/driver/home/DriverHomeStatusBar.jsx';
import { useAppBadge } from '../../hooks/useAppBadge';
import { useDriverLocation } from '../../hooks/useDriverLocation';
import { useNavFeatures } from '../../hooks/useNavFeatures';
import { useOrderManager } from '../../hooks/useOrderManager';
import { reverseGeocode } from '../../utils/geo';
import { ZONE_LABELS } from '../../utils/format';
import { getErrorMessage } from '../../utils/errorMessage';

if (typeof document !== 'undefined' && !document.getElementById('dh-animations')) {
  const style = document.createElement('style');
  style.id = 'dh-animations';
  style.textContent = `
  @keyframes dh-spin { to { transform: rotate(360deg); } }
  .dh-spinner { animation: dh-spin 0.75s linear infinite; transform-origin: 50% 50%; }
  .dh-ptr-indicator {
    position: absolute; top: 0; left: 50%;
    transform: translateX(-50%) translateY(-50px);
    will-change: transform; pointer-events: none;
  }
  .dh-ptr-indicator.pulling   { transition: none; }
  .dh-ptr-indicator.releasing { transition: transform 0.18s ease; }
  .dh-ptr-content             { will-change: transform; }
  .dh-ptr-content.releasing   { transition: transform 0.22s ease; }
  .dh-offer-panel { will-change: transform; transform: translateZ(0); }
  .dh-fab         { will-change: transform; }
  `;
  document.head.appendChild(style);
}

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
    apiFetch('/drivers/me/counters', {}, auth.token)
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
      apiFetch('/nav/zones/active', {}, null)
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

    const pickup = order.activeOrder.restaurant_lat
      ? { lat: Number(order.activeOrder.restaurant_lat), lng: Number(order.activeOrder.restaurant_lng) }
      : null;
    const delivery = order.activeOrder.delivery_lat
      ? { lat: Number(order.activeOrder.delivery_lat), lng: Number(order.activeOrder.delivery_lng) }
      : order.activeOrder.customer_lat
        ? { lat: Number(order.activeOrder.customer_lat), lng: Number(order.activeOrder.customer_lng) }
        : null;

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
          setMsg(`Ruta: ${Math.round(data.distance_m / 1000 * 10) / 10} km · ~${Math.round(data.duration_s / 60)} min`);
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
    if (!order.activeOrder) return;
    const onTheWay = order.activeOrder.status === 'on_the_way';
    const dLat = onTheWay ? Number(order.activeOrder.customer_lat) : Number(order.activeOrder.restaurant_lat);
    const dLng = onTheWay ? Number(order.activeOrder.customer_lng) : Number(order.activeOrder.restaurant_lng);
    if (!dLat || !dLng) {
      setMsg('Faltan coordenadas para navegar');
      return;
    }

    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIOS) {
      const anchor = document.createElement('a');
      anchor.href = `comgooglemaps://?daddr=${dLat},${dLng}&directionsmode=driving`;
      anchor.click();
      setTimeout(() => window.open(`https://maps.google.com/maps?daddr=${dLat},${dLng}&directionsmode=driving`, '_blank', 'noopener'), 500);
      return;
    }

    window.location.href = `google.navigation:q=${dLat},${dLng}&mode=d`;
  }

  function refreshZones() {
    apiFetch('/nav/zones/active', {}, null)
      .then((data) => {
        if (Array.isArray(data?.zones)) setActiveZones(data.zones);
      })
      .catch(() => {});
  }

  function handleZoneConfirm(params) {
    apiFetch('/nav/zones', { method: 'POST', body: JSON.stringify(params) }, auth.token)
      .then(() => {
        setNavMode(null);
        refreshZones();
        setMsg('Zona reportada ✓');
      })
      .catch((error) => setMsg(getErrorMessage(error, 'No se pudo reportar la zona')));
  }

  function handleImpassableConfirm(ways) {
    const pos = myPosition || { lat: 0, lng: 0 };
    apiFetch('/nav/road-prefs/impassable', {
      method: 'POST',
      body: JSON.stringify({
        lat: pos.lat,
        lng: pos.lng,
        ways: ways.map((way) => ({ way_id: way.way_id, estimated_duration: way.estimated_duration, description: way.description })),
      }),
    }, auth.token)
      .then(() => {
        setNavMode(null);
        setMsg(`${ways.length} calle(s) reportada(s) ✓`);
      })
      .catch((error) => setMsg(getErrorMessage(error, 'No se pudieron reportar las calles')));
  }

  function handlePreferenceConfirm(ways) {
    apiFetch('/nav/road-prefs/preference', {
      method: 'POST',
      body: JSON.stringify({ ways: ways.map((way) => ({ way_id: way.way_id, preference: way.preference, description: way.description })) }),
    }, auth.token)
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
