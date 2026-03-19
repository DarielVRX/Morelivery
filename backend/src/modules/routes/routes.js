import { Router } from 'express';
import { query } from '../../config/db.js';
import { authenticate } from '../../middlewares/auth.js';
import { AppError } from '../../utils/errors.js';
import { env } from '../../config/env.js';

const router = Router();

// OSRM base URL — Railway instance preferred, public fallback
const OSRM_BASE = env.osrmUrl.replace(/\/$/, '');

function isValidCoord(point) {
  if (!point) return false;
  const lat = Number(point.lat);
  const lng = Number(point.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function normalizePoint(point) {
  return { lat: Number(point.lat), lng: Number(point.lng) };
}

function buildOsrmUrl(points, includeSteps) {
  const coords = points.map(p => `${p.lng},${p.lat}`).join(';');
  const params = new URLSearchParams({
    overview: 'full',
    geometries: 'geojson',
    steps: includeSteps ? 'true' : 'false',
    alternatives: 'true',
  });
  return `${OSRM_BASE}/route/v1/driving/${coords}?${params.toString()}`;
}

function mapStep(step, idx) {
  const maneuver = step?.maneuver || {};
  return {
    index: idx,
    instruction: step?.name ? `${maneuver.type || 'continue'} ${step.name}` : (maneuver.type || 'continue'),
    type: maneuver.type || 'continue',
    modifier: maneuver.modifier || null,
    distance_m: Number(step?.distance || 0),
    duration_s: Number(step?.duration || 0),
    location: Array.isArray(maneuver.location)
      ? { lng: Number(maneuver.location[0]), lat: Number(maneuver.location[1]) }
      : null,
  };
}

/**
 * Verifica si algún punto de la ruta intersecta alguna zona activa.
 * @param {Array} routeCoords — [{lat, lng}]
 * @param {Array} zones       — zonas con {lat, lng, radius_m}
 * @returns {boolean}
 */
function zonesIntersectsRoute(routeCoords, zones) {
  if (!zones.length || !routeCoords.length) return false;

  for (const point of routeCoords) {
    for (const zone of zones) {
      const dlat = (point.lat - zone.lat) * 111320;
      const dlng = (point.lng - zone.lng) * 111320 * Math.cos((zone.lat * Math.PI) / 180);
      const dist = Math.sqrt(dlat * dlat + dlng * dlng);
      if (dist < zone.radius_m) return true;
    }
  }
  return false;
}

router.post('/model', authenticate, async (req, res, next) => {
  try {
    const { origin, destination, waypoints = [], includeSteps = true } = req.body || {};

    if (!isValidCoord(origin) || !isValidCoord(destination)) {
      throw new AppError(400, 'origin y destination requieren lat/lng válidos');
    }
    if (!Array.isArray(waypoints)) {
      throw new AppError(400, 'waypoints debe ser un arreglo');
    }

    const normalizedWaypoints = waypoints.filter(Boolean).map(normalizePoint).filter(isValidCoord);
    const points = [normalizePoint(origin), ...normalizedWaypoints, normalizePoint(destination)];

    const osrmUrl = buildOsrmUrl(points, Boolean(includeSteps));
    const response = await fetch(osrmUrl, { method: 'GET' });
    if (!response.ok) {
      throw new AppError(502, 'No se pudo consultar el motor de rutas');
    }

    const data = await response.json();
    if (!data?.routes?.length) {
      throw new AppError(404, 'No se encontró ruta');
    }

    // Cargar zonas activas e impassable reports (silencioso si la tabla no existe)
    let activeZones = [];
    let impassableZones = [];

    try {
      const zonesRes = await query('SELECT * FROM road_zones WHERE expires_at > NOW() AND active = true');
      activeZones = zonesRes.rows;
    } catch (e) {
      if (e?.code !== '42P01') throw e;
    }

    try {
      const impassableRes = await query('SELECT way_id, lat, lng FROM impassable_reports WHERE confirmed = true');
      impassableZones = impassableRes.rows.map(r => ({ ...r, radius_m: 50 }));
    } catch (e) {
      if (e?.code !== '42P01') throw e;
    }

    const allZones = [...activeZones, ...impassableZones];

    // Elegir la primera ruta que no intersecte ninguna zona
    let selectedRoute = data.routes[0]; // fallback a la primera si todas intersectan

    for (const candidate of data.routes) {
      const routeCoords = Array.isArray(candidate?.geometry?.coordinates)
        ? candidate.geometry.coordinates.map(([lng, lat]) => ({ lat: Number(lat), lng: Number(lng) }))
        : [];

      if (!zonesIntersectsRoute(routeCoords, allZones)) {
        selectedRoute = candidate;
        break;
      }
    }

    const stepsRaw = selectedRoute?.legs?.flatMap(leg => leg?.steps || []) || [];

    return res.json({
      provider: 'osrm',
      mode: 'driving',
      input: { origin: points[0], destination: points[points.length - 1], waypoints: normalizedWaypoints },
      distance_m: Math.round(Number(selectedRoute.distance || 0)),
      duration_s: Math.round(Number(selectedRoute.duration || 0)),
      geometry: Array.isArray(selectedRoute?.geometry?.coordinates)
        ? selectedRoute.geometry.coordinates.map(([lng, lat]) => ({ lat: Number(lat), lng: Number(lng) }))
        : [],
      steps: Boolean(includeSteps) ? stepsRaw.map(mapStep) : [],
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
