import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.js';
import { AppError } from '../../utils/errors.js';

const router = Router();

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
    alternatives: 'false',
  });
  return `https://router.project-osrm.org/route/v1/driving/${coords}?${params.toString()}`;
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
    const route = data?.routes?.[0];
    if (!route) {
      throw new AppError(404, 'No se encontró ruta');
    }

    const stepsRaw = route?.legs?.flatMap(leg => leg?.steps || []) || [];

    return res.json({
      provider: 'osrm',
      mode: 'driving',
      input: { origin: points[0], destination: points[points.length - 1], waypoints: normalizedWaypoints },
      distance_m: Math.round(Number(route.distance || 0)),
      duration_s: Math.round(Number(route.duration || 0)),
      geometry: Array.isArray(route?.geometry?.coordinates)
        ? route.geometry.coordinates.map(([lng, lat]) => ({ lat: Number(lat), lng: Number(lng) }))
        : [],
      steps: Boolean(includeSteps) ? stepsRaw.map(mapStep) : [],
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
