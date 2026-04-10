// frontend/src/pages/Driver/Home.jsx — orquestador puro

import { useCallback, useEffect, useRef, useState } from 'react';

import ActiveOrderPanel from '../../components/ActiveOrderPanel';
import SupportChat from '../../features/support/SupportChat';
import OfferPanel from '../../components/OfferPanel';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { ensureDriverHomeAnimations } from '../../features/driver/home/animations';
import DriverHomeMapSection from '../../features/driver/home/DriverHomeMapSection.jsx';
import { quickSelectWays } from '../../components/WayPicker';
import {
  buildGoogleMapsAppUrl, buildGoogleMapsWebUrl, buildGoogleNavigationUrl,
  formatRouteSummary, getDriverRouteStops, getGoogleNavigationTarget,
} from '../../features/driver/home/navigation';
import DriverHomeStatusBar from '../../features/driver/home/DriverHomeStatusBar.jsx';
import { useDriverHomeRuntime } from '../../features/driver/home/useDriverHomeRuntime';
import { useAppBadge } from '../../hooks/useAppBadge';
import { useDriverLocation } from '../../hooks/useDriverLocation';
import { useNavFeatures } from '../../hooks/useNavFeatures';
import { useOrderManager } from '../../hooks/useOrderManager';
import { ZONE_LABELS } from '../../utils/format';
import { brandStorageKey } from '../../config/brand';

ensureDriverHomeAnimations();

const HAND_MODE_KEY = brandStorageKey('hand_mode');

export default function DriverHome({ registerRef, closeMobileDrawerRef }) {
  const { auth, patchUser } = useAuth();
  const { isDark } = useTheme();
  const order = useOrderManager(auth.token, patchUser, auth.user?.driver);

  // ── Modo de mano ──────────────────────────────────────────────────────────
  const [handMode, setHandMode] = useState(() => {
    try { return localStorage.getItem(HAND_MODE_KEY) || 'left'; } catch { return 'left'; }
  });
  const toggleHandMode = useCallback(() => {
    setHandMode(prev => {
      const next = prev === 'left' ? 'right' : 'left';
      try { localStorage.setItem(HAND_MODE_KEY, next); } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    if (!registerRef) return;
    const wire = () => {
      if (registerRef.current.onUpdate)    order.registerOrdersUpdate(registerRef.current.onUpdate);
      if (registerRef.current.onReconnect) order.registerOrdersReconnect(registerRef.current.onReconnect);
      if (registerRef.current.onChat)      order.registerOrdersChat(registerRef.current.onChat);
      registerRef.current.loadData = order.loadData;
    };
    wire();
    const t = setTimeout(wire, 0);
    return () => clearTimeout(t);
  }, [registerRef, order.registerOrdersUpdate, order.registerOrdersReconnect, order.registerOrdersChat]);

  const badgeCount = order.pendingOffer ? 1 : (order.hasActiveOrder ? 1 : 0);
  useAppBadge(badgeCount);

  const [msg, setMsg] = useState('');
  const [showSupport, setShowSupport] = useState(false);
  const [showAttrib,  setShowAttrib]  = useState(false);
  const [panelHeight, setPanelHeight] = useState(0);
  const activePanelRef = useRef(null);

  useEffect(() => {
    const el = activePanelRef.current;
    if (!el) { setPanelHeight(0); return; }
    const ro = new ResizeObserver(([entry]) => setPanelHeight(entry.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, [order.hasActiveOrder, order.pendingOffer]);


  const { position: myPosition, matchedPosition, error: gpsError } = useDriverLocation(
    auth.token, order.availability, order.hasActiveOrder, auth.user?.id
  );

  const displayPosition = matchedPosition || myPosition;

  useEffect(() => { order.setMyPosition(myPosition); }, [myPosition]); // eslint-disable-line react-hooks/exhaustive-deps

  const home = useDriverHomeRuntime({
    token: auth.token,
    availability: order.availability,
    activeOrder: order.activeOrder,
    activeOrders: order.activeOrders,
    confirmedOrders: order.confirmedOrders,
    hasActiveOrder: order.hasActiveOrder,
    myPosition: displayPosition,
    onMessage: setMsg,
    routeStopsOverride: order.routeStopsOverride,
  });

  const { voiceEnabled, setVoiceEnabled, wakeLockActive } = useNavFeatures({
    steps: home.routeSteps,
    currentPos: displayPosition,
    activeZones: home.activeZones,
    hasActiveOrder: order.hasActiveOrder,
    onVoice: () => {},
    onZoneAlert: (zone) => {},
    impassableWays: home.activeImpassable,
    routeGeometry: home.routeGeometry || [],
  });

  useEffect(() => {
    if (!registerRef) return;
    registerRef.current.activeZones      = home.activeZones;
    registerRef.current.activeImpassable = home.activeImpassable;
    registerRef.current.myPreferences    = home.myPreferences;
    registerRef.current.myPosition       = myPosition;
    registerRef.current.refreshZones     = home.refreshZones;
    registerRef.current.availability     = order.availability;
    registerRef.current.token            = auth.token;
    registerRef.current.notifyAlertsUpdate?.();
  }, [home.activeZones, home.activeImpassable, home.myPreferences]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="driver-map-root" style={{ display:'flex', flexDirection:'column',
      height:'100%', overflow:'hidden', position:'relative' }}>

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
        handMode={handMode}
        onToggleHandMode={toggleHandMode}
        gpsError={gpsError}
      />

      <DriverHomeMapSection
        availability={order.availability}
        hasActiveOrder={order.hasActiveOrder}
        customPin={home.customPin}
        setCustomPin={home.setCustomPin}
        pinAddress={home.pinAddress}
        loadingPin={home.loadingPin}
        routeGeometry={home.routeGeometry}
        partialRouteGeometry={home.partialRouteGeometry}
        allStops={home.allStops}
        routeActive={home.routeActive}
        myPosition={displayPosition}
        activeOrder={order.activeOrder}
        navHeadingDeg={home.navHeadingDeg}
        onHeadingChange={home.setNavHeadingDeg}
        centerSignal={home.centerSignal}
        onCenterDone={() => home.setCenterSignal(null)}
        onRouteToPin={home.onRouteToPin}
        setMapInstance={home.setMapInstance}
        mapInstance={home.mapInstance}
        activeZones={home.activeZones}
        activeImpassable={home.activeImpassable}
        myPreferences={home.myPreferences}
        token={auth.token}
        userId={auth.user?.id}
        centerMode={home.centerMode}
        voiceEnabled={voiceEnabled}
        navMode={home.navMode}
        onCenterCycle={home.handleCenterCycle}
        onVoiceToggle={() => setVoiceEnabled((v) => !v)}
        onGoogleNav={home.openGoogleNavigation}
        onNavMode={home.setNavMode}
        setMsg={setMsg}
        onSubmitZone={home.handleZoneConfirm}
        onSubmitImpassable={home.handleImpassableConfirm}
        onSubmitPreference={home.handlePreferenceConfirm}
        bottomOffset={panelHeight + 8}
        isDark={isDark}
        handMode={handMode}
        offerRouteGeometry={home.offerRouteGeometry}
        onSupport={() => setShowSupport(v => !v)}
        showSupport={showSupport}
        showAttrib={showAttrib}
        onToggleAttrib={() => setShowAttrib(v => !v)}
        onQuickReport={async (type, pos) => {
          if (type === 'zone') {
            home.handleZoneConfirm({ lat: pos.lat, lng: pos.lng, type: 'other', radius_m: 500, estimated_hours: 1 });
          } else if (type === 'impassable') {
            try {
              const ways = await quickSelectWays(pos, 'impassable');
              home.handleImpassableConfirm(ways);
            } catch (_) { setMsg('No se pudo detectar la calle.'); }
          } else if (type === 'preference') {
            try {
              const ways = await quickSelectWays(pos, 'preference');
              home.handlePreferenceConfirm(ways);
            } catch (_) { setMsg('No se pudo detectar la calle.'); }
          }
        }}
      />

      {/* Panel de soporte — abierto desde NavFABs */}
      {showSupport && (
        <div style={{
          position: 'absolute',
          bottom: panelHeight + 8,
          [handMode === 'right' ? 'left' : 'right']: 14,
          width: 320, height: 480,
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          zIndex: 402,
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}>
          <SupportChat />
        </div>
      )}

      <OfferPanel
        offer={order.pendingOffer}
        minimized={order.offerMinimized}
        loading={order.loadingOffer}
        onAccept={() => { home.clearOfferRoute(); order.acceptOffer(setMsg); }}
        onReject={() => { home.clearOfferRoute(); order.rejectOffer(setMsg); }}
        onToggleMinimize={() => order.setOfferMinimized((v) => !v)}
        onExpired={() => {
          home.clearOfferRoute();
          const warning = order.handleOfferExpired();
          if (warning) setMsg(warning);
        }}
        panelRef={!order.hasActiveOrder ? activePanelRef : undefined}
        handMode={handMode}
        offerRouteGeometry={home.offerRouteGeometry}
        offerRouteLoading={home.offerRouteLoading}
        onRequestOfferRoute={home.openOfferRoutePreview}
        onShowFullOfferRoute={home.openFullOfferRoute}
        showFullOfferRoute={home.showFullOfferRoute}
      />

      <ActiveOrderPanel
        order={order.hasActiveOrder ? order.activeOrder : null}
        expanded={order.orderExpanded}
        loadingStatus={order.loadingStatus}
        showRelease={order.showRelease}
        releaseNote={order.releaseNote}
        onToggleExpand={() => order.setOrderExpanded((e) => !e)}
        onChangeStatus={(id, status) => order.changeStatus(id, status, () => {})}
        onToggleRelease={() => order.setShowRelease((s) => !s)}
        onReleaseNoteChange={order.setReleaseNote}
        onConfirmRelease={() => order.doRelease(setMsg)}
        onRebalance={() => order.doRebalance(setMsg)}
        onCancelDispute={() => order.doCancelDispute(setMsg)}
        onRoute={home.handleToggleRoute}
        // FIX: retornar la promesa para que ActiveOrderPanel pueda capturar el error
        onSimulatedCall={(target) => order.doSimulatedCall(target, setMsg)}
        authToken={auth.token}
        chatTick={order.chatTick}
        routeActive={home.routeActive}
        handMode={handMode}
        panelRef={activePanelRef}
        distToNextStop={home.distToNextStop}
        activeOrders={order.activeOrders}
        routeStopsOverride={order.routeStopsOverride}
      />
    </div>
  );
}
