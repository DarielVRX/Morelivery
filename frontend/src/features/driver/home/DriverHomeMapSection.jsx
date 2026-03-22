import DriverMap from '../../../components/DriverMap';
import NavFABs from '../../../components/NavFABs';
import WayPicker from '../../../components/WayPicker';
import ZoneLayer from '../../../components/ZoneLayer';
import ZonePlacer from '../../../components/ZonePlacer';
import { ZONE_LABELS } from '../../../utils/format';

import { useEffect, useRef } from 'react';
export default function DriverHomeMapSection({
  availability,
  hasActiveOrder,
  customPin,
  setCustomPin,
  pinAddress,
  loadingPin,
  routeGeometry,
  myPosition,
  activeOrder,
  navFollowEnabled,
  navHeadingDeg,
  onHeadingChange,
  centerSignal,
  onCenterDone,
  setMapInstance,
  mapInstance,
  activeZones,
  token,
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
}) {
  return (
    <div style={{ flex:1, minHeight:0, position:'relative', overflow:'hidden', zIndex:0 }}>
      {!customPin && !hasActiveOrder && availability && (
        <div style={{ position:'absolute', top:8, left:'50%', transform:'translateX(-50%)', background:'rgba(0,0,0,0.55)', color:'#fff', borderRadius:20, padding:'0.25rem 0.75rem', fontSize:'0.72rem', zIndex:5, pointerEvents:'none', whiteSpace:'nowrap' }}>
          📍 Toca el mapa para marcar tu posición
        </div>
      )}

      <DriverMap
        driverPos={myPosition}
        customPin={customPin}
        onCustomPin={setCustomPin}
        hasActiveOrder={hasActiveOrder}
        pickupPos={activeOrder?.restaurant_lat ? { lat: Number(activeOrder.restaurant_lat), lng: Number(activeOrder.restaurant_lng) } : null}
        deliveryPos={activeOrder?.customer_lat ? { lat: Number(activeOrder.customer_lat), lng: Number(activeOrder.customer_lng) } : null}
        pickupLabel={activeOrder?.restaurant_name || 'Tienda'}
        deliveryLabel={activeOrder?.customer_name || activeOrder?.customer_first_name || 'Cliente'}
        routeGeometry={routeGeometry}
        onRouteError={setMsg}
        navFollowEnabled={navFollowEnabled}
        navHeadingDeg={navHeadingDeg}
        onHeadingChange={onHeadingChange}
        centerSignal={centerSignal}
        onCenterDone={onCenterDone}
        onMapReady={setMapInstance}
        bottomOffset={bottomOffset}
        pinAddress={pinAddress}
        loadingPin={loadingPin}
        onClearPin={() => setCustomPin(null)}
      />

      {mapInstance && (
        <ZoneLayer
          map={mapInstance}
          zones={activeZones}
          token={token}
          onZoneClick={(zone) => setMsg(`Zona: ${ZONE_LABELS[zone?.type] || zone?.type}`)}
        />
      )}

      {/* Popup de dirección ahora se muestra sobre el pin via MapLibre Popup — ver DriverMap */}
      {/* El pin SVG se oculta automáticamente tras 5s o al tocar otro punto */}

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
      />

      {navMode === 'zone' && mapInstance && (
        <ZonePlacer map={mapInstance} onConfirm={onSubmitZone} onCancel={() => onNavMode(null)} bottomOffset={bottomOffset} />
      )}

      {navMode === 'impassable' && mapInstance && (
        <WayPicker map={mapInstance} mode="impassable" onConfirm={onSubmitImpassable} onCancel={() => onNavMode(null)} bottomOffset={bottomOffset} />
      )}

      {navMode === 'preference' && mapInstance && (
        <WayPicker map={mapInstance} mode="preference" onConfirm={onSubmitPreference} onCancel={() => onNavMode(null)} bottomOffset={bottomOffset} />
      )}
    </div>
  );
}
