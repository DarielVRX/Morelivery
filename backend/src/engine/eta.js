// backend/src/engine/eta.js
//
// EtaEstimator para producción.
// Reemplaza el haversine puro del simulador por llamadas reales a OSRM
// con caché agresiva por grilla de 75m.
//
// estimate() es la misma firma que en el simulador pero es async.
// Se usa en CandidateFinder y RouteInsertionSimulator.

import { estimateEta } from './osrm-cache.js';
import { haversineMeters } from '../utils/geo.js';
import { getParam } from './params.js';

export class EtaEstimator {
  constructor() {}

  /**
   * Estima el tiempo de viaje entre dos puntos en segundos.
   * Usa OSRM con caché. Si OSRM falla o está en backoff, usa haversine
   * con la velocidad del driver o 30 km/h como fallback.
   *
   * @param {{ lat: number, lng: number }} fromPos
   * @param {{ lat: number, lng: number }} toPos
   * @param {{ speed_kmh?: number } | null} driver
   * @returns {Promise<number>} segundos estimados
   */
  async estimate(fromPos, toPos, driver = null) {
    if (!fromPos || !toPos) return 0;
    if (!Number.isFinite(fromPos.lat) || !Number.isFinite(toPos.lat)) return 0;

    try {
      return await estimateEta(fromPos, toPos, driver);
    } catch {
      // Fallback haversine si el módulo OSRM explota
      const speedKmh  = Number.isFinite(driver?.speed_kmh) ? driver.speed_kmh : 30;
      const speedMs   = Math.max(1, (speedKmh * 1000) / 3600);
      return Math.round(haversineMeters(fromPos, toPos) / speedMs);
    }
  }

  /**
   * Versión síncrona rápida para ordenamiento previo donde la precisión importa menos.
   * Usa haversine puro — no hace I/O.
   */
  estimateSync(fromPos, toPos, driver = null) {
    if (!fromPos || !toPos) return 0;
    const speedKmh = Number.isFinite(driver?.speed_kmh) ? driver.speed_kmh : 30;
    const speedMs  = Math.max(1, (speedKmh * 1000) / 3600);
    return Math.round(haversineMeters(fromPos, toPos) / speedMs);
  }
}

export const etaEstimator = new EtaEstimator();
