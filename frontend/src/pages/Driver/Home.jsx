// pages/Driver/Home.jsx — orquestador puro
// Toda la lógica de negocio está en useOrderManager
// Toda la lógica de mapa está en DriverMap
// Los componentes de UI son independientes y reciben solo props

import { useEffect, useRef, useState } from 'react';

import ActiveOrderPanel from '../../components/ActiveOrderPanel';
import OfferPanel from '../../components/OfferPanel';
import { useAuth } from '../../contexts/AuthContext';
import { ensureDriverHomeAnimations } from '../../features/driver/home/animations';
import DriverHomeMapSection from '../../features/driver/home/DriverHomeMapSection.jsx';
import { buildGoogleMapsAppUrl, buildGoogleMapsWebUrl, buildGoogleNavigationUrl, formatRouteSummary, getDriverRouteStops, getGoogleNavigationTarget } from '../../features/driver/home/navigation';
import DriverHomeStatusBar from '../../features/driver/home/DriverHomeStatusBar.jsx';
import { useDriverHomeRuntime } from '../../features/driver/home/useDriverHomeRuntime';
import { useAppBadge } from '../../hooks/useAppBadge';
import { useDriverLocation } from '../../hooks/useDriverLocation';
import { useNavFeatures } from '../../hooks/useNavFeatures';
import { useOrderManager } from '../../hooks/useOrderManager';
import { ZONE_LABELS } from '../../utils/format';

ensureDriverHomeAnimations();

export default function DriverHome({ registerRef }) {
  const { auth, patchUser } = useAuth();
  const order = useOrderManager(auth.token, patchUser, auth.user?.driver);

  // Conectar useDriverOrders (panel lateral) al SSE de useOrderManager.
  // useDriverOrders escribe sus handlers en registerRef.current.{onUpdate,onReconnect,onChat}.
  // Aquí los pasamos a useOrderManager para que los invoque al recibir eventos SSE.
  useEffect(() => {
    if (!registerRef) return;
    // Esperar a que DriverOrders haya montado y escrito sus handlers
    const wire = () => {
      if (registerRef.current.onUpdate)    order.registerOrdersUpdate(registerRef.current.onUpdate);
      if (registerRef.current.onReconnect) order.registerOrdersReconnect(registerRef.current.onReconnect);
      if (registerRef.current.onChat)      order.registerOrdersChat(registerRef.current.onChat);
      registerRef.current.loadData = order.loadData;
    };
    wire();
    // Re-intentar en el siguiente tick por si DriverOrders monta después
    const t = setTimeout(wire, 0);
    return () => clearTimeout(t);
  }, [registerRef, order.registerOrdersUpdate, order.registerOrdersReconnect, order.registerOrdersChat]);
  const badgeCount = order.pendingOffer ? 1 : (order.hasActiveOrder ? 1 : 0);
  useAppBadge(badgeCount);

  const [msg, setMsg] = useState('');
  const [panelHeight, setPanelHeight] = useState(0);
  const activePanelRef = useRef(null);

  // Medir altura del panel activo para subir FABs y atribución
  useEffect(() => {
    const el = activePanelRef.current;
    if (!el) { setPanelHeight(0); return; }
    const ro = new ResizeObserver(([entry]) => setPanelHeight(entry.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, [order.hasActiveOrder, order.pendingOffer]);

  const { position: myPosition, error: gpsError } = useDriverLocation(auth.token, order.availability, order.hasActiveOrder);
  const home = useDriverHomeRuntime({
    token: auth.token,
    availability: order.availability,
    activeOrder: order.activeOrder,
    hasActiveOrder: order.hasActiveOrder,
    myPosition,
    onMessage: setMsg,
  });

  const { voiceEnabled, setVoiceEnabled, wakeLockActive } = useNavFeatures({
    steps: home.routeSteps,
    currentPos: myPosition,
    activeZones: home.activeZones,
    hasActiveOrder: order.hasActiveOrder,
    onVoice: (text) => setMsg(text),
    onZoneAlert: (zone) => setMsg(`⚠️ Zona de alerta cerca: ${ZONE_LABELS[zone?.type] || zone?.type}`),
    impassableWays: [],
    routeGeometry: home.routeGeometry || [],
  });

  return (
    <div className="driver-map-root" style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden', position:'relative' }}>
        <DriverHomeStatusBar
          availability={order.availability}
          counters={home.counters}
          activeOrder={order.activeOrder}
          bagPct={order.routeBagPct}
          onToggleAvailability={() => order.toggleAvailability(setMsg)}
          msg={msg}
          onDismissMsg={() => setMsg('')}
          transferBanner={order.transferBanner}
          onDismissTransferBanner={() => order.setTransferBanner(null)}
        />

        <DriverHomeMapSection
          availability={order.availability}
          hasActiveOrder={order.hasActiveOrder}
          customPin={home.customPin}
          setCustomPin={home.setCustomPin}
          pinAddress={home.pinAddress}
          loadingPin={home.loadingPin}
          routeGeometry={home.routeGeometry}
          myPosition={myPosition}
          activeOrder={order.activeOrder}
          navFollowEnabled={home.navFollowEnabled}
          navHeadingDeg={home.navHeadingDeg}
          onHeadingChange={home.setNavHeadingDeg}
          centerSignal={home.centerSignal}
          onCenterDone={() => home.setCenterSignal(null)}
          setMapInstance={home.setMapInstance}
          mapInstance={home.mapInstance}
          activeZones={home.activeZones}
          token={auth.token}
          centerMode={home.centerMode}
          voiceEnabled={voiceEnabled}
          navMode={home.navMode}
          onCenterCycle={home.handleCenterCycle}
          onVoiceToggle={() => setVoiceEnabled((value) => !value)}
          onGoogleNav={home.openGoogleNavigation}
          onNavMode={home.setNavMode}
          setMsg={setMsg}
          onSubmitZone={home.handleZoneConfirm}
          onSubmitImpassable={home.handleImpassableConfirm}
          onSubmitPreference={home.handlePreferenceConfirm}
          bottomOffset={panelHeight + 8}
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
          panelRef={!order.hasActiveOrder ? activePanelRef : undefined}
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
          onRoute={home.openRoadRouteApi}
          panelRef={activePanelRef}
        />
    </div>
  );
}
