// frontend/src/hooks/useDriverLocation.js
// GPS activo cuando: driver disponible OR tiene pedido activo
// Se detiene solo cuando AMBAS condiciones son falsas.
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api/client';

const SEND_INTERVAL_MS    = 12000;
const MIN_DISTANCE_METERS = 15;

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/**
 * @param token       JWT del driver
 * @param isAvailable driver marcó disponibilidad
 * @param hasActiveOrder driver tiene pedido activo (accepted/on_the_way/etc)
 * GPS activo si isAvailable OR hasActiveOrder
 */
export function useDriverLocation(token, isAvailable, hasActiveOrder = false) {
  const [position, setPosition] = useState(null);
  const [error, setError]       = useState(null);
  const lastSent    = useRef(null);
  const intervalRef = useRef(null);
  const watchRef    = useRef(null);
  const posRef      = useRef(null);

  const shouldTrack = Boolean(token && (isAvailable || hasActiveOrder));

  useEffect(() => {
    if (!shouldTrack) {
      navigator.geolocation?.clearWatch(watchRef.current);
      watchRef.current = null;
      clearInterval(intervalRef.current);
      intervalRef.current = null;
      setPosition(null);
      setError(null);
      return;
    }

    if (!('geolocation' in navigator)) {
      setError('GPS no disponible en este dispositivo');
      return;
    }

    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        if (pos.coords.accuracy > 2000) {
          setError(`Precisión GPS baja (${Math.round(pos.coords.accuracy)}m)`);
          return;
        }
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) };
        posRef.current = p;
        setPosition(p);
        setError(null);
      },
      (err) => setError(err.message),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
    );

    async function maybeSend() {
      const current = posRef.current;
      if (!current) return;
      const prev = lastSent.current;
      if (prev && haversineMeters(prev.lat, prev.lng, current.lat, current.lng) < MIN_DISTANCE_METERS) return;
      lastSent.current = current;
      apiFetch('/drivers/location', { method:'PATCH', body: JSON.stringify(current) }, token).catch(() => {});
    }

    intervalRef.current = setInterval(maybeSend, SEND_INTERVAL_MS);

    function onVisible() { if (!document.hidden) maybeSend(); }
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      navigator.geolocation.clearWatch(watchRef.current);
      clearInterval(intervalRef.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [shouldTrack, token]);

  return { position, error };
}
