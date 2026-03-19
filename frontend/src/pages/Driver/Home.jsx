// pages/Driver/Home.jsx — orquestador puro
// Toda la lógica de negocio está en useOrderManager
// Toda la lógica de mapa está en DriverMap
// Los componentes de UI son independientes y reciben solo props

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useDriverLocation } from '../../hooks/useDriverLocation';
import { useNavFeatures } from '../../hooks/useNavFeatures';
import { useOrderManager } from '../../hooks/useOrderManager';
import { useAppBadge } from '../../hooks/useAppBadge';

import PullToRefresh    from '../../components/PullToRefresh';
import DriverMap        from '../../components/DriverMap';
import NavFABs          from '../../components/NavFABs';
import OfferPanel       from '../../components/OfferPanel';
import ActiveOrderPanel from '../../components/ActiveOrderPanel';
import ZoneLayer        from '../../components/ZoneLayer';
import ZonePlacer       from '../../components/ZonePlacer';
import WayPicker        from '../../components/WayPicker';

import { reverseGeocode } from '../../utils/geo';
import { ZONE_LABELS }    from '../../utils/format';

// CSS de animaciones — inyectado UNA sola vez fuera del render
if (typeof document !== 'undefined' && !document.getElementById('dh-animations')) {
  const s = document.createElement('style');
  s.id = 'dh-animations';
  s.textContent = `
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
  document.head.appendChild(s);
}

export default function DriverHome() {
  const { auth, patchUser } = useAuth();

  // ── Lógica de pedidos ────────────────────────────────────────────────────────
  const order = useOrderManager(auth.token, patchUser, auth.user?.driver);

  // Badge del ícono: 1 si hay oferta pendiente, o número de pedidos activos
  const badgeCount = order.pendingOffer ? 1 : (order.hasActiveOrder ? 1 : 0);
  useAppBadge(badgeCount);

  // ── Contadores de sesión ──────────────────────────────────────────────────────
  const [counters, setCounters] = useState(null);
  useEffect(() => {
    if (!auth.token || !order.availability) return;
    apiFetch('/drivers/me/counters', {}, auth.token)
    .then(d => setCounters(d.counters))
    .catch(() => {});
  }, [auth.token, order.availability]);

  // ── Estado de UI (solo Home sabe de esto) ───────────────────────────────────
  const [msg,           setMsg]           = useState('');
  const [customPin,     setCustomPin]     = useState(null);
  const [pinAddress,    setPinAddress]    = useState(null);
  const [loadingPin,    setLoadingPin]    = useState(false);
  const [routeGeometry, setRouteGeometry] = useState(null);
  const [routeSteps,    setRouteSteps]    = useState([]);
  const [navHeadingDeg, setNavHeadingDeg] = useState(0);
  const [centerSignal,  setCenterSignal]  = useState(null);
  const [centerMode,    setCenterMode]    = useState('off'); // 'off' | 'follow' | 'overview'
  const [activeZones,   setActiveZones]   = useState([]);
  const [navMode,       setNavMode]       = useState(null);
  const [mapInstance,   setMapInstance]   = useState(null);
  const [navFollowEnabled] = useState(false);

  const centerModeRef   = useRef('off');
  const autoCenterRef   = useRef(null);

  // ── GPS ──────────────────────────────────────────────────────────────────────
  const { position: myPosition, error: gpsError } =
  useDriverLocation(auth.token, order.availability, order.hasActiveOrder);

  // ── Geocodificación del pin ──────────────────────────────────────────────────
  useEffect(() => {
    if (order.hasActiveOrder) { setCustomPin(null); setPinAddress(null); }
  }, [order.hasActiveOrder]);

  useEffect(() => {
    if (!customPin) { setPinAddress(null); return; }
    setLoadingPin(true);
    reverseGeocode(customPin.lat, customPin.lng)
    .then(a => setPinAddress(a || `${customPin.lat.toFixed(5)}, ${customPin.lng.toFixed(5)}`))
    .finally(() => setLoadingPin(false));
  }, [customPin?.lat, customPin?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Ruta ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!order.activeOrder) { setRouteGeometry(null); setRouteSteps([]); }
  }, [order.activeOrder]);

  // ── Centrado automático tras interacción ────────────────────────────────────
  // ── Auto-recenter after user pans (only in follow mode) ─────────────────────
  const scheduleAutoCenter = useCallback(() => {
    if (autoCenterRef.current) clearTimeout(autoCenterRef.current);
    if (centerModeRef.current !== 'follow') return;
    autoCenterRef.current = setTimeout(() => {
      if (centerModeRef.current === 'follow') setCenterSignal('follow');
    }, 5000);
  }, []);

  useEffect(() => {
    const evs = ['touchstart', 'touchmove', 'pointerdown', 'wheel'];
    const h   = () => scheduleAutoCenter();
    evs.forEach(ev => document.addEventListener(ev, h, { passive: true }));
    return () => evs.forEach(ev => document.removeEventListener(ev, h));
  }, [scheduleAutoCenter]);

  // ── 3-mode center cycle ───────────────────────────────────────────────────────
  // off → follow (lock to driver position, high zoom) → overview (fit route + markers) → off
  function handleCenterCycle() {
    const modes = ['off', 'follow', 'overview'];
    const next  = modes[(modes.indexOf(centerModeRef.current) + 1) % modes.length];

    // overview only makes sense with a route — skip it if no route
    const effective = (next === 'overview' && (!routeGeometry || !routeGeometry.length))
    ? 'off'
    : next;

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

  // ── Navegación ───────────────────────────────────────────────────────────────
  const { voiceEnabled, setVoiceEnabled, wakeLockActive } = useNavFeatures({
    steps:      routeSteps,
    currentPos: myPosition,
    activeZones,
    hasActiveOrder: order.hasActiveOrder,
    onVoice:      msg => setMsg(msg),
                                                                           onZoneAlert:  zone => setMsg(`⚠️ Zona de alerta cerca: ${ZONE_LABELS[zone?.type] || zone?.type}`),
                                                                           impassableWays:  [],
                                                                           routeGeometry:   routeGeometry || [],
  });

  // ── Zonas activas (polling 2 min) ───────────────────────────────────────────
  useEffect(() => {
    function fetch() {
      apiFetch('/nav/zones/active', {}, null)
      .then(d => { if (Array.isArray(d?.zones)) setActiveZones(d.zones); })
      .catch(() => {});
    }
    fetch();
    const id = setInterval(fetch, 2 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // ── Ruta OSRM ────────────────────────────────────────────────────────────────
  function openRoadRouteApi() {
    if (!order.activeOrder) return;

    const pickup   = order.activeOrder.restaurant_lat
    ? { lat: Number(order.activeOrder.restaurant_lat), lng: Number(order.activeOrder.restaurant_lng) }
    : null;
    const delivery = order.activeOrder.delivery_lat
    ? { lat: Number(order.activeOrder.delivery_lat),   lng: Number(order.activeOrder.delivery_lng) }
    : order.activeOrder.customer_lat
    ? { lat: Number(order.activeOrder.customer_lat), lng: Number(order.activeOrder.customer_lng) }
    : null;

    if (!pickup || !delivery) return setMsg('Faltan coordenadas del pedido para trazar la ruta');

    // Use current GPS position as origin if available, else start from pickup
    const startPos = myPosition || pickup;

    const callRoute = (origin) => {
      apiFetch('/routes/model', {
        method: 'POST',
        body: JSON.stringify({
          origin,
          destination: delivery,
          waypoints: origin !== pickup ? [pickup] : [],
          includeSteps: true,
        }),
      }, auth.token)
      .then(d => {
        if (!d?.geometry?.length) throw new Error('Ruta vacía');
        setRouteGeometry(d.geometry);
        setRouteSteps(Array.isArray(d?.steps) ? d.steps : []);
        setMsg(`Ruta: ${Math.round(d.distance_m / 1000 * 10) / 10} km · ~${Math.round(d.duration_s / 60)} min`);
      })
      .catch(e => {
        setRouteGeometry(null);
        setRouteSteps([]);
        setMsg(e.message?.includes('502') ? 'Motor de rutas no disponible' : 'No se pudo calcular la ruta');
      });
    };

    if (myPosition) {
      callRoute(startPos);
    } else {
      // Request fresh GPS then calculate
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          pos => callRoute({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
                                                 ()  => callRoute(pickup), // fallback to starting from pickup
                                                 { timeout: 4000, maximumAge: 15000 }
        );
      } else {
        callRoute(pickup);
      }
    }
  }

  // ── Google Maps nativo ───────────────────────────────────────────────────────
  function openGoogleNavigation() {
    if (!order.activeOrder) return;
    const ot   = order.activeOrder.status === 'on_the_way';
    const dLat = ot ? Number(order.activeOrder.customer_lat)    : Number(order.activeOrder.restaurant_lat);
    const dLng = ot ? Number(order.activeOrder.customer_lng)    : Number(order.activeOrder.restaurant_lng);
    if (!dLat || !dLng) return setMsg('Faltan coordenadas para navegar');
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIOS) {
      const a = document.createElement('a');
      a.href = `comgooglemaps://?daddr=${dLat},${dLng}&directionsmode=driving`; a.click();
      setTimeout(() => window.open(`https://maps.google.com/maps?daddr=${dLat},${dLng}&directionsmode=driving`, '_blank', 'noopener'), 500);
    } else {
      window.location.href = `google.navigation:q=${dLat},${dLng}&mode=d`;
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <PullToRefresh onRefresh={order.loadData}>
    <div className="driver-map-root" style={{ display:'flex', flexDirection:'column',
      height:'100%', overflow:'hidden', position:'relative' }}>

      {/* Encabezado */}
      <div style={{ flexShrink:0,
        background:'var(--promo-gradient)',
          padding:'0.65rem 1rem', display:'flex', justifyContent:'space-between',
          alignItems:'center', gap:8, zIndex:10 }}>
          <div>
          <div style={{ fontWeight:700, fontSize:'0.875rem', color:'#fff' }}>
          {order.availability ? '● Disponible' : '○ No disponible'}
          </div>
          {myPosition && <div style={{ fontSize:'0.7rem', color:'rgba(255,255,255,0.8)' }}>GPS · ±{myPosition.accuracy}m</div>}
          <div style={{ fontSize:'0.68rem', color:'rgba(255,255,255,0.86)' }}>
          🔔 {order.notifPermission === 'granted' ? 'Notifs ON' : order.notifPermission === 'denied' ? 'Notifs bloqueadas' : 'Notifs pendientes'} ·
          prioridad {order.notifPriorityMode === 'high' ? 'alta' : 'normal'}
          </div>
          {wakeLockActive && <div style={{ fontSize:'0.68rem', color:'rgba(255,255,255,0.85)' }}>Pantalla activa para navegación</div>}
          {gpsError && <div style={{ fontSize:'0.7rem', color:'#ffb3b3', maxWidth:200 }}>{gpsError}</div>}
          {counters && (
            <div style={{ fontSize:'0.65rem', color:'rgba(255,255,255,0.7)', marginTop:'0.1rem', display:'flex', gap:'0.6rem' }}>
            {counters.session_releases   > 0 && <span>↩ {counters.session_releases} liberaciones</span>}
            {counters.session_rebalances > 0 && <span>⇄ {counters.session_rebalances} rebalanceos</span>}
            {counters.session_expires    > 0 && <span>⏱ {counters.session_expires} expiradas</span>}
            {counters.session_cancels    > 0 && <span>✕ {counters.session_cancels} canceladas</span>}
            </div>
          )}
          </div>
          <button onClick={() => order.toggleAvailability(setMsg)}
          className={order.availability ? 'btn-primary btn-sm' : 'btn-sm'}>
          {order.availability ? 'Disponible' : 'No disponible'}
          </button>
          </div>

          {/* Flash message */}
          {msg && (
            <div className="flash flash-error"
            style={{ flexShrink:0, borderRadius:0, margin:0, display:'flex', justifyContent:'space-between' }}>
            <span style={{ fontSize:'0.83rem' }}>{msg}</span>
            <button onClick={() => setMsg('')}
            style={{ border:'none', background:'none', cursor:'pointer', fontWeight:700 }}>✕</button>
            </div>
          )}

          {/* Banner de transferencia de pedido */}
          {order.transferBanner && (
            <div style={{
              flexShrink: 0, zIndex: 25,
              background: order.transferBanner.type === 'order_transferred_in' ? 'var(--success-bg)' : 'var(--warn-bg)',
                                    borderBottom: `2px solid ${order.transferBanner.type === 'order_transferred_in' ? 'var(--success)' : 'var(--warn)'}`,
                                    padding: '0.6rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            {order.transferBanner.type === 'order_transferred_in'
              ? '📦 Se te asignó un pedido transferido'
          : '↩️ Un pedido fue reasignado a otro conductor'}
          </span>
          <button onClick={() => order.setTransferBanner(null)}
          style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontWeight: 700, minHeight:'unset' }}>✕</button>
          </div>
          )}

          {/* Mapa */}
          <div style={{ flex:1, minHeight:0, position:'relative', overflow:'hidden', zIndex:0 }}>

          {!customPin && !order.hasActiveOrder && order.availability && (
            <div style={{ position:'absolute', top:8, left:'50%', transform:'translateX(-50%)',
              background:'rgba(0,0,0,0.55)', color:'#fff', borderRadius:20,
                                                                         padding:'0.25rem 0.75rem', fontSize:'0.72rem', zIndex:5,
                                                                         pointerEvents:'none', whiteSpace:'nowrap' }}>
                                                                         📍 Toca el mapa para marcar tu posición
                                                                         </div>
          )}

          <DriverMap
          driverPos={myPosition}
          customPin={customPin}
          onCustomPin={setCustomPin}
          hasActiveOrder={order.hasActiveOrder}
          pickupPos={order.activeOrder?.restaurant_lat
            ? { lat: Number(order.activeOrder.restaurant_lat), lng: Number(order.activeOrder.restaurant_lng) } : null}
            deliveryPos={order.activeOrder?.customer_lat
              ? { lat: Number(order.activeOrder.customer_lat), lng: Number(order.activeOrder.customer_lng) } : null}
              pickupLabel={order.activeOrder?.restaurant_name || 'Tienda'}
              deliveryLabel={order.activeOrder?.customer_name || order.activeOrder?.customer_first_name || 'Cliente'}
              routeGeometry={routeGeometry}
              onRouteError={setMsg}
              navFollowEnabled={navFollowEnabled}
              navHeadingDeg={navHeadingDeg}
              onHeadingChange={setNavHeadingDeg}
              centerSignal={centerSignal}
              onCenterDone={() => setCenterSignal(null)}
              onMapReady={setMapInstance}
              />

              {mapInstance && (
                <ZoneLayer
                map={mapInstance}
                zones={activeZones}
                token={auth.token}
                onZoneClick={z => setMsg(`Zona: ${ZONE_LABELS[z?.type] || z?.type}`)}
                />
              )}

              {/* Panel de pin personalizado */}
              {!order.hasActiveOrder && customPin && (
                <div style={{ position:'absolute', bottom:16, left:'50%', transform:'translateX(-50%)',
                  background:'var(--bg-card)', borderRadius:10, padding:'0.5rem 0.875rem',
                                                      boxShadow:'var(--panel-shadow)', maxWidth:'calc(100% - 2rem)',
                                                      zIndex:10, display:'flex', alignItems:'center', gap:'0.5rem', minWidth:180 }}>
                                                      <span style={{ fontSize:'1rem', flexShrink:0 }}>📍</span>
                                                      <div style={{ flex:1, minWidth:0 }}>
                                                      {loadingPin
                                                        ? <span style={{ fontSize:'0.78rem', color:'var(--text-tertiary)' }}>Buscando dirección…</span>
                                                        : <span style={{ fontSize:'0.78rem', color:'var(--text-primary)', fontWeight:600,
                                                          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', display:'block' }}>
                                                          {pinAddress}
                                                          </span>
                                                      }
                                                      <span style={{ fontSize:'0.7rem', color:'var(--text-tertiary)' }}>Toca el mapa para mover</span>
                                                      </div>
                                                      <button onClick={() => { setCustomPin(null); setPinAddress(null); }}
                                                      style={{ border:'none', background:'none', cursor:'pointer',
                                                        color:'var(--text-tertiary)', fontSize:'1rem', lineHeight:1, padding:'0.15rem', flexShrink:0, minHeight:'unset' }}>✕</button>
                                                        </div>
              )}

              {/* FABs + mini menú */}
              <NavFABs
              hasActiveOrder={order.hasActiveOrder}
              routeGeometry={routeGeometry}
              centerMode={centerMode}
              voiceEnabled={voiceEnabled}
              navMode={navMode}
              onCenterCycle={handleCenterCycle}
              onVoiceToggle={() => setVoiceEnabled(v => !v)}
              onGoogleNav={openGoogleNavigation}
              onNavMode={setNavMode}
              />

              {/* ZonePlacer */}
              {navMode === 'zone' && mapInstance && (
                <ZonePlacer
                map={mapInstance}
                onConfirm={params => {
                  apiFetch('/nav/zones', { method: 'POST', body: JSON.stringify(params) }, auth.token)
                  .then(() => {
                    setNavMode(null);
                    apiFetch('/nav/zones/active', {}, null)
                    .then(d => { if (Array.isArray(d?.zones)) setActiveZones(d.zones); })
                    .catch(() => {});
                    setMsg('Zona reportada ✓');
                  })
                  .catch(e => setMsg(e.message));
                }}
                onCancel={() => setNavMode(null)}
                />
              )}

              {/* WayPicker — impassable */}
              {navMode === 'impassable' && mapInstance && (
                <WayPicker
                map={mapInstance}
                mode="impassable"
                onConfirm={ways => {
                  const pos = myPosition || { lat: 0, lng: 0 };
                  apiFetch('/nav/road-prefs/impassable', {
                    method: 'POST',
                    body:   JSON.stringify({
                      lat: pos.lat, lng: pos.lng,
                      ways: ways.map(w => ({ way_id: w.way_id, estimated_duration: w.estimated_duration, description: w.description })),
                    }),
                  }, auth.token)
                  .then(() => { setNavMode(null); setMsg(`${ways.length} calle(s) reportada(s) ✓`); })
                  .catch(e => setMsg(e.message));
                }}
                onCancel={() => setNavMode(null)}
                />
              )}

              {/* WayPicker — preference */}
              {navMode === 'preference' && mapInstance && (
                <WayPicker
                map={mapInstance}
                mode="preference"
                onConfirm={ways => {
                  apiFetch('/nav/road-prefs/preference', {
                    method: 'POST',
                    body:   JSON.stringify({
                      ways: ways.map(w => ({ way_id: w.way_id, preference: w.preference, description: w.description })),
                    }),
                  }, auth.token)
                  .then(() => { setNavMode(null); setMsg(`${ways.length} preferencia(s) guardada(s) ✓`); })
                  .catch(e => setMsg(e.message));
                }}
                onCancel={() => setNavMode(null)}
                />
              )}

              </div>{/* fin mapa */}

              {/* Panel de oferta */}
              <OfferPanel
              offer={order.pendingOffer}
              minimized={order.offerMinimized}
              loading={order.loadingOffer}
              onAccept={() => order.acceptOffer(setMsg)}
              onReject={() => order.rejectOffer(setMsg)}
              onToggleMinimize={() => order.setOfferMinimized(m => !m)}
              onExpired={() => {
                const warn = order.handleOfferExpired();
                if (warn) setMsg(warn);
              }}
              />

              {/* Panel de pedido activo */}
              <ActiveOrderPanel
              order={order.hasActiveOrder ? order.activeOrder : null}
              expanded={order.orderExpanded}
              loadingStatus={order.loadingStatus}
              showRelease={order.showRelease}
              releaseNote={order.releaseNote}
              onToggleExpand={() => order.setOrderExpanded(e => !e)}
              onChangeStatus={(id, status) => order.changeStatus(id, status, setMsg)}
              onToggleRelease={() => order.setShowRelease(s => !s)}
              onReleaseNoteChange={order.setReleaseNote}
              onConfirmRelease={() => order.doRelease(setMsg)}
              onRebalance={() => order.doRebalance(setMsg)}
              onRoute={openRoadRouteApi}
              />

              </div>
              </PullToRefresh>
  );
}
