// frontend/src/features/driver/home/navigation.js

export function getDriverRouteStops(activeOrder) {
  if (!activeOrder) return { pickup: null, delivery: null };

  const pickup = activeOrder.restaurant_lat
    ? { lat: Number(activeOrder.restaurant_lat), lng: Number(activeOrder.restaurant_lng) }
    : null;

  const delivery = activeOrder.delivery_lat
    ? { lat: Number(activeOrder.delivery_lat), lng: Number(activeOrder.delivery_lng) }
    : activeOrder.customer_lat
      ? { lat: Number(activeOrder.customer_lat), lng: Number(activeOrder.customer_lng) }
      : null;

  return { pickup, delivery };
}

export function getGoogleNavigationTarget(activeOrder) {
  if (!activeOrder) return null;

  const onTheWay = activeOrder.status === 'on_the_way';
  const lat = onTheWay ? Number(activeOrder.customer_lat) : Number(activeOrder.restaurant_lat);
  const lng = onTheWay ? Number(activeOrder.customer_lng) : Number(activeOrder.restaurant_lng);

  if (!lat || !lng) return null;
  return { lat, lng };
}

export function buildGoogleMapsAppUrl({ lat, lng }) {
  return `comgooglemaps://?daddr=${lat},${lng}&directionsmode=driving`;
}

export function buildGoogleMapsWebUrl({ lat, lng }) {
  return `https://maps.google.com/maps?daddr=${lat},${lng}&directionsmode=driving`;
}

export function buildGoogleNavigationUrl({ lat, lng }) {
  return `google.navigation:q=${lat},${lng}&mode=d`;
}

export function formatRouteSummary(data) {
  return `Ruta: ${Math.round(data.distance_m / 1000 * 10) / 10} km · ~${Math.round(data.duration_s / 60)} min`;
}

/**
 * Bounds para vista "next stop": posición actual + próximo stop del pedido activo.
 * Usado en el segundo clic del botón centrar en modo navegación.
 */
export function getNextStopBounds(activeOrder, myPosition) {
  if (!activeOrder) return null;
  const pts = [];
  if (myPosition) pts.push([myPosition.lng, myPosition.lat]);

  const isOTW = activeOrder.status === 'on_the_way';
  const stopLat = isOTW ? Number(activeOrder.customer_lat)    : Number(activeOrder.restaurant_lat);
  const stopLng = isOTW ? Number(activeOrder.customer_lng)    : Number(activeOrder.restaurant_lng);

  if (Number.isFinite(stopLat) && Number.isFinite(stopLng)) {
    pts.push([stopLng, stopLat]);
  }

  if (pts.length < 2) return null;
  return pts;
}

/**
 * Bounds para vista "ruta completa": posición actual + todos los stops activos.
 * Usado en el tercer clic del botón centrar en modo navegación.
 */
export function getFullRouteBounds(allStops, myPosition) {
  const pts = [];
  if (myPosition) pts.push([myPosition.lng, myPosition.lat]);
  if (Array.isArray(allStops)) {
    allStops.forEach(s => pts.push([s.lng, s.lat]));
  }
  if (pts.length < 2) return null;
  return pts;
}

/**
 * Detecta la dirección de giro a partir del nombre del step de OSRM.
 * Retorna: 'left' | 'right' | 'straight' | 'uturn' | null
 */
export function detectTurnDirection(step) {
  if (!step) return null;
  const maneuver = step.maneuver?.type || step.type || '';
  const modifier = step.maneuver?.modifier || step.modifier || '';
  const instruction = (step.instruction || step.name || '').toLowerCase();

  if (maneuver === 'arrive') return null;
  if (maneuver === 'continue' || modifier === 'straight') return 'straight';
  if (modifier.includes('uturn') || modifier.includes('u-turn')) return 'uturn';
  if (modifier.includes('left'))  return 'left';
  if (modifier.includes('right')) return 'right';

  // Fallback: detectar desde la instrucción en texto
  if (instruction.includes('izquierda') || instruction.includes('left'))  return 'left';
  if (instruction.includes('derecha')   || instruction.includes('right')) return 'right';
  if (instruction.includes('recto')     || instruction.includes('straight')) return 'straight';

  return null;
}

/**
 * Genera instrucción de voz en español a partir de un step de ruta.
 * Solo genera instrucción para steps que requieren acción (no continuar recto).
 */
export function buildVoiceInstruction(step, distanceM) {
  if (!step) return null;
  const dir = detectTurnDirection(step);

  if (!dir || dir === 'straight') return null; // no anunciar "continúa recto"

  const dist = distanceM != null
    ? distanceM < 100
      ? 'ahora'
      : `en ${Math.round(distanceM / 10) * 10} metros`
    : '';

  const dirLabel = {
    left:   'gira a la izquierda',
    right:  'gira a la derecha',
    uturn:  'da vuelta en U',
  }[dir] || 'continúa';

  const streetName = step.name && step.name !== '' ? ` hacia ${step.name}` : '';

  return `${dist ? dist + ', ' : ''}${dirLabel}${streetName}`.trim();
}
