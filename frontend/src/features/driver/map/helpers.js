export const DRIVER_ROUTE_SOURCE_ID = 'driver-route-source';
export const DRIVER_ROUTE_LAYER_ID = 'driver-route-layer';
export const DRIVER_ROUTE_BORDER_ID = 'driver-route-border';

export function getDriverRouteFeature(routeGeometry) {
  const coordinates = (routeGeometry || []).map(point => [point.lng, point.lat]);
  if (!coordinates.length) return null;

  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates },
  };
}

export function clearDriverRouteLayers(map) {
  try { if (map.getLayer(DRIVER_ROUTE_BORDER_ID)) map.removeLayer(DRIVER_ROUTE_BORDER_ID); } catch (_) {}
  try { if (map.getLayer(DRIVER_ROUTE_LAYER_ID)) map.removeLayer(DRIVER_ROUTE_LAYER_ID); } catch (_) {}
  try { if (map.getSource(DRIVER_ROUTE_SOURCE_ID)) map.removeSource(DRIVER_ROUTE_SOURCE_ID); } catch (_) {}
}

export function syncDriverRouteLayers(map, routeGeometry) {
  const feature = getDriverRouteFeature(routeGeometry);
  if (!feature) {
    clearDriverRouteLayers(map);
    return;
  }

  if (map.getSource(DRIVER_ROUTE_SOURCE_ID)) {
    map.getSource(DRIVER_ROUTE_SOURCE_ID).setData(feature);
  } else {
    map.addSource(DRIVER_ROUTE_SOURCE_ID, { type: 'geojson', data: feature });
  }

  if (!map.getLayer(DRIVER_ROUTE_BORDER_ID)) {
    map.addLayer({
      id: DRIVER_ROUTE_BORDER_ID,
      type: 'line',
      source: DRIVER_ROUTE_SOURCE_ID,
      paint: { 'line-color': '#ffffff', 'line-width': 10, 'line-opacity': 0.4 },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });
  }

  if (!map.getLayer(DRIVER_ROUTE_LAYER_ID)) {
    map.addLayer({
      id: DRIVER_ROUTE_LAYER_ID,
      type: 'line',
      source: DRIVER_ROUTE_SOURCE_ID,
      paint: { 'line-color': '#6366f1', 'line-width': 5, 'line-opacity': 0.95 },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });
  }
}

export function createDriverPoiMarker(ml, pos, { emoji, color, label }) {
  const element = document.createElement('div');
  element.style.cssText = `width:28px;height:28px;border-radius:50%;background:${color};display:grid;place-items:center;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.3);font-size:15px`;
  element.textContent = emoji;

  return new ml.Marker({ element }).setLngLat([pos.lng, pos.lat]).setPopup(
    new ml.Popup({ closeButton: false }).setText(label)
  );
}
