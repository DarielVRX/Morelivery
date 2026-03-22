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
