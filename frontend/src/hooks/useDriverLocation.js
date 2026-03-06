// frontend/src/hooks/useDriverLocation.js
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api/client';

const SEND_INTERVAL_MS  = 12000; // 12s
const MIN_DISTANCE_METERS = 15;

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/**
 * Obtiene posición GPS y la envía al backend periódicamente.
 * Solo activo si isActive=true (driver disponible).
 * Soporte de background via Page Visibility API:
 *   - cuando la página queda en background, el watchPosition sigue corriendo
 *     porque es una API del dispositivo, no del tab.
 *   - cuando vuelve al frente, forzamos un send inmediato.
 */
export function useDriverLocation(token, isActive) {
  const [position, setPosition] = useState(null);
  const [error, setError]       = useState(null);
  const lastSent    = useRef(null);
  const intervalRef = useRef(null);
  const watchRef    = useRef(null);
  const posRef      = useRef(null); // copia sincrónica para el interval

  useEffect(() => {
    if (!isActive || !token) {
      // Detener todo cuando no disponible
      if (watchRef.current != null) {
        navigator.geolocation?.clearWatch(watchRef.current);
        watchRef.current = null;
      }
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

    // Escuchar cambios de posición
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

    // Enviar al backend periódicamente
    async function maybeSend() {
      const current = posRef.current;
      if (!current) return;
      const prev = lastSent.current;
      if (prev && haversineMeters(prev.lat, prev.lng, current.lat, current.lng) < MIN_DISTANCE_METERS) return;
      lastSent.current = current;
      apiFetch('/drivers/location', { method:'PATCH', body: JSON.stringify(current) }, token).catch(() => {});
    }

    intervalRef.current = setInterval(maybeSend, SEND_INTERVAL_MS);

    // Page Visibility API: cuando el tab vuelve al frente, enviar inmediatamente
    function onVisibilityChange() {
      if (!document.hidden) maybeSend();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      navigator.geolocation.clearWatch(watchRef.current);
      clearInterval(intervalRef.current);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [isActive, token]);

  return { position, error };
}
