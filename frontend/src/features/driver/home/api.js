import { apiFetch } from '../../../api/client';

export function fetchDriverCounters(token) {
  return apiFetch('/drivers/me/counters', {}, token);
}

export function fetchActiveZones() {
  return apiFetch('/nav/zones/active', {}, null);
}

export function createZoneReport(params, token) {
  return apiFetch('/nav/zones', {
    method: 'POST',
    body: JSON.stringify(params),
  }, token);
}

export function submitImpassableRoads({ position, ways, token }) {
  return apiFetch('/nav/road-prefs/impassable', {
    method: 'POST',
    body: JSON.stringify({
      lat: position.lat,
      lng: position.lng,
      ways: ways.map((way) => ({
        way_id: way.way_id,
        estimated_duration: way.estimated_duration,
        description: way.description,
      })),
    }),
  }, token);
}

export function submitRoadPreferences({ ways, token }) {
  return apiFetch('/nav/road-prefs/preference', {
    method: 'POST',
    body: JSON.stringify({
      ways: ways.map((way) => ({
        way_id: way.way_id,
        preference: way.preference,
        description: way.description,
      })),
    }),
  }, token);
}


export function fetchRouteModel({ origin, pickup, delivery, token }) {
  return apiFetch('/routes/model', {
    method: 'POST',
    body: JSON.stringify({
      origin,
      destination: delivery,
      waypoints: origin !== pickup ? [pickup] : [],
      includeSteps: true,
    }),
  }, token);
}
