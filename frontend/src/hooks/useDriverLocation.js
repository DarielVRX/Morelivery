// frontend/src/hooks/useDriverLocation.js
// GPS activo cuando: driver disponible OR tiene pedido activo
// Se detiene solo cuando AMBAS condiciones son falsas.
// Map matching: acumula posiciones en buffer → envía a /nav/map-match cada 8 puntos
// La posición matcheada se usa para actualizar el estado visible (snap to road).

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api/client';

const MIN_SEND_INTERVAL_MS  = 4000;
const MIN_DISTANCE_METERS   = 15;
const MIN_RENDER_METERS     = 5;
const MAP_MATCH_BUFFER_SIZE = 8;   // puntos acumulados antes de hacer match
const MAP_MATCH_MAX_MS      = 30000; // forzar match cada 30s aunque no haya 8 puntos

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R    = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * @param token         JWT del driver
 * @param isAvailable   driver marcó disponibilidad
 * @param hasActiveOrder driver tiene pedido activo
 * GPS activo si isAvailable OR hasActiveOrder
 * Retorna { position, matchedPosition, error }
 * - position:        posición GPS raw (para lógica interna)
 * - matchedPosition: posición snap-to-road (para mostrar en mapa)
 */
export function useDriverLocation(token, isAvailable, hasActiveOrder = false) {
  const [position,        setPosition]        = useState(null);
  const [matchedPosition, setMatchedPosition] = useState(null);
  const [error,           setError]           = useState(null);

  const lastSentRef      = useRef(null);
  const lastSentAtRef    = useRef(0);
  const watchRef         = useRef(null);
  const posRef           = useRef(null);

  // Buffer para map matching
  const matchBufferRef   = useRef([]);
  const lastMatchAtRef   = useRef(0);
  const matchingRef      = useRef(false); // evitar llamadas simultáneas

  const shouldTrack = Boolean(token && (isAvailable || hasActiveOrder));

  // ── Map matching ──────────────────────────────────────────────────────────
  const runMapMatch = useCallback(async (force = false) => {
    if (matchingRef.current) return;
    const buf = matchBufferRef.current;
    if (buf.length < 2) return;

    const now       = Date.now();
    const hasEnough = buf.length >= MAP_MATCH_BUFFER_SIZE;
    const tooOld    = now - lastMatchAtRef.current >= MAP_MATCH_MAX_MS;

    if (!force && !hasEnough && !tooOld) return;

    matchingRef.current = true;
    lastMatchAtRef.current = now;
    const coords = [...buf];
    matchBufferRef.current = []; // limpiar buffer

    try {
      const data = await apiFetch('/nav/map-match', {
        method: 'POST',
        body:   JSON.stringify({ coordinates: coords }),
      }, token);

      if (data?.geometry?.length > 0) {
        const last = data.geometry[data.geometry.length - 1];
        if (last?.lat && last?.lng) {
          setMatchedPosition({ lat: last.lat, lng: last.lng });
        }
      }
    } catch (_) {
      // Degraded: usar última posición raw
    } finally {
      matchingRef.current = false;
    }
  }, [token]);

  useEffect(() => {
    if (!shouldTrack) {
      navigator.geolocation?.clearWatch(watchRef.current);
      watchRef.current       = null;
      posRef.current         = null;
      lastSentRef.current    = null;
      lastSentAtRef.current  = 0;
      matchBufferRef.current = [];
      setPosition(null);
      setMatchedPosition(null);
      setError(null);
      return;
    }

    if (!('geolocation' in navigator)) {
      setError('GPS no disponible en este dispositivo');
      return;
    }

    async function sendLocation(current, force = false) {
      if (!token || !current) return;
      const prevSent    = lastSentRef.current;
      const movedEnough = !prevSent
        || haversineMeters(prevSent.lat, prevSent.lng, current.lat, current.lng) >= MIN_DISTANCE_METERS;
      const longEnough  = Date.now() - lastSentAtRef.current >= MIN_SEND_INTERVAL_MS;

      if (!force && (!movedEnough || !longEnough)) return;

      lastSentRef.current   = current;
      lastSentAtRef.current = Date.now();
      apiFetch('/drivers/location', { method: 'PATCH', body: JSON.stringify(current) }, token)
        .catch(() => {});
    }

    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        if (pos.coords.accuracy > 2000) {
          setError(`Precisión GPS baja (${Math.round(pos.coords.accuracy)}m)`);
          return;
        }

        const p = {
          lat:      pos.coords.latitude,
          lng:      pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy),
        };

        // Solo re-renderizar si el driver se movió más de MIN_RENDER_METERS
        const prev = posRef.current;
        const moved = !prev || haversineMeters(prev.lat, prev.lng, p.lat, p.lng) >= MIN_RENDER_METERS;

        posRef.current = p;

        if (moved) {
          setPosition(p);
          setError(null);

          // Acumular en buffer de map matching
          matchBufferRef.current.push({ lat: p.lat, lng: p.lng });
          runMapMatch();
        }

        sendLocation(p, !lastSentRef.current);
      },
      (err) => setError(err.message),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 }
    );

    // Timer de seguridad: forzar map match si pasaron 30s sin suficientes puntos
    const matchTimer = setInterval(() => {
      runMapMatch(true);
    }, MAP_MATCH_MAX_MS);

    function onVisible() {
      if (!document.hidden && posRef.current) sendLocation(posRef.current, true);
    }
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      navigator.geolocation.clearWatch(watchRef.current);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(matchTimer);
    };
  }, [shouldTrack, token, runMapMatch]);

  return { position, matchedPosition, error };
}
