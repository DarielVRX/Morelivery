import { Router } from 'express';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { AppError } from '../../utils/errors.js';

const router = Router();

/**
 * Kalman filter para suavizar coordenadas GPS.
 * Q = varianza de proceso, R = varianza de medición.
 */
function kalmanFilter(coords) {
  const Q = 0.0001;
  const R = 0.01;

  let latEst = coords[0].lat;
  let lngEst = coords[0].lng;
  let P = 1;

  return coords.map((coord, i) => {
    if (i === 0) return { lat: latEst, lng: lngEst };

    // Predicción
    const P_pred = P + Q;

    // Ganancia de Kalman
    const K = P_pred / (P_pred + R);

    // Actualización
    latEst = latEst + K * (coord.lat - latEst);
    lngEst = lngEst + K * (coord.lng - lngEst);
    P = (1 - K) * P_pred;

    return { lat: latEst, lng: lngEst };
  });
}

// POST / — map matching con Kalman filter + OSRM
router.post('/', authenticate, authorize(['driver']), async (req, res, next) => {
  try {
    const { coordinates } = req.body || {};

    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      throw new AppError(400, 'coordinates debe ser un array de al menos 2 puntos');
    }
    if (coordinates.length > 100) {
      throw new AppError(400, 'coordinates no puede superar 100 puntos');
    }

    // Aplicar Kalman filter
    const filtered = kalmanFilter(coordinates);

    // Construir URL de OSRM map matching (lng,lat)
    const coordStr = filtered.map(c => `${c.lng},${c.lat}`).join(';');
    const osrmUrl  = `https://router.project-osrm.org/match/v1/driving/${coordStr}?overview=full&geometries=geojson&steps=false&annotations=false&tidy=true`;

    let matched = false;
    let geometry = filtered;

    try {
      const response = await fetch(osrmUrl, { method: 'GET' });
      if (response.ok) {
        const data = await response.json();
        if (data?.code === 'Ok' && data?.matchings?.length > 0) {
          const coords = data.matchings[0]?.geometry?.coordinates || [];
          if (coords.length > 0) {
            geometry = coords.map(([lng, lat]) => ({ lat: Number(lat), lng: Number(lng) }));
            matched = true;
          }
        }
      }
    } catch (_) {
      // Degraded mode: usar coordenadas filtradas por Kalman
    }

    return res.json({
      matched,
      geometry,
      raw_filtered: filtered,
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
