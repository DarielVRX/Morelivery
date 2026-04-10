// frontend/src/features/driver/home/DriverHomeMapSection.jsx
import { useEffect, useRef, useState } from 'react';
import DriverMap from '../../../components/DriverMap';
import NavFABs from '../../../components/NavFABs';
import RoadPrefsLayer from '../../../components/RoadPrefsLayer';
import WayPicker from '../../../components/WayPicker';
import ZoneLayer from '../../../components/ZoneLayer';
import ZonePlacer from '../../../components/ZonePlacer';
import { ZONE_LABELS } from '../../../utils/format';

export default function DriverHomeMapSection({
  availability,
  hasActiveOrder,
  customPin,
  setCustomPin,
  pinAddress,
  loadingPin,
  routeGeometry,
  partialRouteGeometry,  // tramo driver→nextstop (modos nav/nextStop)
  offerRouteGeometry,
  offerMarkers,
  allStops,
  routeActive,
  myPosition,
  activeOrder,
  navHeadingDeg,
  onHeadingChange,
  centerSignal,
  onCenterDone,
  onRouteToPin,
  setMapInstance,
  mapInstance,
  activeZones,
  activeImpassable,
  myPreferences,
  token,
  userId,
  centerMode,
  voiceEnabled,
  navMode,
  onCenterCycle,
  onVoiceToggle,
  onGoogleNav,
  onNavMode,
  setMsg,
  onSubmitZone,
  onSubmitImpassable,
  onSubmitPreference,
  bottomOffset,
  onQuickReport,
  isDark = false,
  handMode = 'left',
  onSupport,
  showSupport = false,
  showAttrib = false,
  onToggleAttrib,
}) {
  // ── Velocidad del driver derivada del GPS ────────────────────────────────
  const [speedKmh, setSpeedKmh] = useState(null);
  const prevPosRef   = useRef(null);
  const prevTimeRef  = useRef(null);

  useEffect(() => {
    if (!myPosition) return;
    const now = Date.now();
    if (prevPosRef.current && prevTimeRef.current) {
      const dtS  = (now - prevTimeRef.current) / 1000;
      if (dtS > 0 && dtS < 10) { // ignorar gaps grandes (app en background)
        const R    = 6371000;
        const dLat = (myPosition.lat - prevPosRef.current.lat) * Math.PI / 180;
        const dLng = (myPosition.lng - prevPosRef.current.lng) * Math.PI / 180;
        const a    = Math.sin(dLat / 2) ** 2
          + Math.cos(prevPosRef.current.lat * Math.PI / 180)
          * Math.cos(myPosition.lat * Math.PI / 180)
          * Math.sin(dLng / 2) ** 2;
        const distM   = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const speedMs = distM / dtS;
        setSpeedKmh(Math.min(speedMs * 3.6, 150)); // cap a 150 km/h
      }
    }
    prevPosRef.current  = myPosition;
    prevTimeRef.current = now;
  }, [myPosition?.lat, myPosition?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // La geometría a mostrar en el mapa:
  // - Si hay oferta con ruta → offerRouteGeometry siempre (sobre la ruta activa)
  // - En overview → ruta completa
  // - En nav/nextStop → ruta parcial driver→nextstop
  // - Sin ruta activa → nada
  const displayGeometry = (() => {
    if (offerRouteGeometry?.length) return offerRouteGeometry;
    if (!routeActive) return null;
    if (centerMode === 'overview') return routeGeometry;
    return partialRouteGeometry?.length ? partialRouteGeometry : routeGeometry;
  })();

  // Cuando hay oferta activa — usar markers de oferta y ocultar allStops del pedido activo
  const isOfferMode = Boolean(offerRouteGeometry?.length && offerMarkers);
  const displayPickupPos  = isOfferMode
    ? offerMarkers.restaurant
    : (activeOrder?.restaurant_lat ? { lat: Number(activeOrder.restaurant_lat), lng: Number(activeOrder.restaurant_lng) } : null);
  const displayDeliveryPos = isOfferMode
    ? offerMarkers.customer
    : (activeOrder?.customer_lat ? { lat: Number(activeOrder.customer_lat), lng: Number(activeOrder.customer_lng) } : null);
  const displayAllStops = isOfferMode ? null : allStops;

  return (
    <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden', zIndex: 0 }}>
      {!customPin && !hasActiveOrder && availability && (
        <div style={{
          position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.55)', color: '#fff', borderRadius: 20,
          padding: '0.25rem 0.75rem', fontSize: '0.72rem', zIndex: 5,
          pointerEvents: 'none', whiteSpace: 'nowrap',
        }}>
          📍 Toca el mapa para marcar tu posición
        </div>
      )}

      {/* Indicador de ruta de oferta activa */}
      {!routeActive && offerRouteGeometry?.length > 0 && (
        <div style={{
          position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(37,99,235,0.85)', color: '#fff', borderRadius: 20,
          padding: '0.2rem 0.75rem', fontSize: '0.7rem', zIndex: 5,
          pointerEvents: 'none', whiteSpace: 'nowrap', fontWeight: 600,
        }}>
          Vista previa de ruta
        </div>
      )}

      <DriverMap
        driverPos={myPosition}
        customPin={customPin}
        onCustomPin={setCustomPin}
        hasActiveOrder={hasActiveOrder}
        pickupPos={displayPickupPos}
        deliveryPos={displayDeliveryPos}
        pickupLabel={isOfferMode ? 'Tienda' : (activeOrder?.restaurant_name || 'Tienda')}
        deliveryLabel={isOfferMode ? 'Cliente' : (activeOrder?.customer_name || activeOrder?.customer_first_name || 'Cliente')}
        routeGeometry={displayGeometry}
        partialRouteGeometry={null}
        allStops={displayAllStops}
        routeActive={routeActive}
        onRouteError={setMsg}
        centerMode={centerMode}
        navHeadingDeg={navHeadingDeg}
        onHeadingChange={onHeadingChange}
        centerSignal={centerSignal}
        onCenterDone={onCenterDone}
        onMapReady={setMapInstance}
        bottomOffset={bottomOffset}
        pinAddress={pinAddress}
        loadingPin={loadingPin}
        onClearPin={() => setCustomPin(null)}
        onRouteToPin={onRouteToPin}
        impassableWays={activeImpassable}
        roadPreferences={myPreferences}
      />

      {mapInstance && (
        <>
          <ZoneLayer
            map={mapInstance}
            zones={activeZones}
            token={token}
            userId={userId}
            onZoneClick={(zone) => setMsg(`Zona: ${ZONE_LABELS[zone?.type] || zone?.type}`)}
            bottomOffset={bottomOffset}
          />
          <RoadPrefsLayer
            map={mapInstance}
            impassableWays={activeImpassable}
            roadPreferences={myPreferences}
          />
        </>
      )}

      <NavFABs
        hasActiveOrder={hasActiveOrder}
        routeGeometry={routeGeometry}
        centerMode={centerMode}
        voiceEnabled={voiceEnabled}
        navMode={navMode}
        onCenterCycle={onCenterCycle}
        onVoiceToggle={onVoiceToggle}
        onGoogleNav={onGoogleNav}
        onNavMode={onNavMode}
        bottomOffset={bottomOffset + 16}
        myPosition={myPosition}
        isDark={isDark}
        onQuickReport={onQuickReport}
        handMode={handMode}
        speedKmh={speedKmh}
        onSupport={onSupport}
        showSupport={showSupport}
        showAttrib={showAttrib}
        onToggleAttrib={onToggleAttrib}
      />

      {navMode === 'zone' && mapInstance && (
        <ZonePlacer map={mapInstance} onConfirm={onSubmitZone}
          onCancel={() => onNavMode(null)} bottomOffset={bottomOffset} />
      )}
      {navMode === 'impassable' && mapInstance && (
        <WayPicker map={mapInstance} mode="impassable" onConfirm={onSubmitImpassable}
          onCancel={() => onNavMode(null)} bottomOffset={bottomOffset} />
      )}
      {navMode === 'preference' && mapInstance && (
        <WayPicker map={mapInstance} mode="preference" onConfirm={onSubmitPreference}
          onCancel={() => onNavMode(null)} bottomOffset={bottomOffset} />
      )}
    </div>
  );
}
