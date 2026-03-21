import DriverMap from '../../../components/DriverMap';
import NavFABs from '../../../components/NavFABs';
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
      />

      {mapInstance && (
        <ZoneLayer
          map={mapInstance}
          zones={activeZones}
          token={token}
          onZoneClick={(zone) => setMsg(`Zona: ${ZONE_LABELS[zone?.type] || zone?.type}`)}
        />
      )}

      {!hasActiveOrder && customPin && (
        <div style={{ position:'absolute', bottom:16, left:'50%', transform:'translateX(-50%)', background:'var(--bg-card)', borderRadius:10, padding:'0.5rem 0.875rem', boxShadow:'var(--panel-shadow)', maxWidth:'calc(100% - 2rem)', zIndex:10, display:'flex', alignItems:'center', gap:'0.5rem', minWidth:180 }}>
          <span style={{ fontSize:'1rem', flexShrink:0 }}>📍</span>
          <div style={{ flex:1, minWidth:0 }}>
            {loadingPin
              ? <span style={{ fontSize:'0.78rem', color:'var(--text-tertiary)' }}>Buscando dirección…</span>
              : <span style={{ fontSize:'0.78rem', color:'var(--text-primary)', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', display:'block' }}>{pinAddress}</span>}
            <span style={{ fontSize:'0.7rem', color:'var(--text-tertiary)' }}>Toca el mapa para mover</span>
          </div>
          <button onClick={() => { setCustomPin(null); }} style={{ border:'none', background:'none', cursor:'pointer', color:'var(--text-tertiary)', fontSize:'1rem', lineHeight:1, padding:'0.15rem', flexShrink:0, minHeight:'unset' }}>✕</button>
        </div>
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
      />

      {navMode === 'zone' && mapInstance && (
        <ZonePlacer map={mapInstance} onConfirm={onSubmitZone} onCancel={() => onNavMode(null)} />
      )}

      {navMode === 'impassable' && mapInstance && (
        <WayPicker map={mapInstance} mode="impassable" onConfirm={onSubmitImpassable} onCancel={() => onNavMode(null)} />
      )}

      {navMode === 'preference' && mapInstance && (
        <WayPicker map={mapInstance} mode="preference" onConfirm={onSubmitPreference} onCancel={() => onNavMode(null)} />
      )}
    </div>
  );
}
