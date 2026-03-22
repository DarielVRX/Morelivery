// frontend/src/hooks/useDriverLocation.js
// GPS activo cuando: driver disponible OR tiene pedido activo
// Se detiene solo cuando AMBAS condiciones son falsas.
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api/client';

const MIN_SEND_INTERVAL_MS = 4000;
const MIN_DISTANCE_METERS = 15;
const MIN_RENDER_METERS   = 5;   // no actualizar estado UI si movimiento < 5m

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
  const lastSentRef = useRef(null);
  const lastSentAtRef = useRef(0);
  const watchRef    = useRef(null);
  const posRef      = useRef(null);

  const shouldTrack = Boolean(token && (isAvailable || hasActiveOrder));

  useEffect(() => {
    if (!shouldTrack) {
      navigator.geolocation?.clearWatch(watchRef.current);
      watchRef.current = null;
      posRef.current = null;
      lastSentRef.current = null;
      lastSentAtRef.current = 0;
      setPosition(null);
      setError(null);
      return;
    }

    if (!('geolocation' in navigator)) {
      setError('GPS no disponible en este dispositivo');
      return;
    }

    async function sendLocation(current, force = false) {
      if (!token || !current) return;
      const prevSent = lastSentRef.current;
      const movedEnough = !prevSent || haversineMeters(prevSent.lat, prevSent.lng, current.lat, current.lng) >= MIN_DISTANCE_METERS;
      const longEnough = Date.now() - lastSentAtRef.current >= MIN_SEND_INTERVAL_MS;

      if (!force && (!movedEnough || !longEnough)) return;

      lastSentRef.current = current;
      lastSentAtRef.current = Date.now();
      apiFetch('/drivers/location', { method:'PATCH', body: JSON.stringify(current) }, token).catch(() => {});
    }

    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        if (pos.coords.accuracy > 2000) {
          setError(`Precisión GPS baja (${Math.round(pos.coords.accuracy)}m)`);
          return;
        }
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) };
        // Solo re-renderizar si el driver se movió más de MIN_RENDER_METERS
        const prev = posRef.current;
        if (prev && haversineMeters(prev.lat, prev.lng, p.lat, p.lng) < MIN_RENDER_METERS) {
          posRef.current = p; // actualizar ref para envíos, sin re-render
          return;
        }
        posRef.current = p;
        setPosition(p);
        setError(null);

        // La experiencia visual del conductor vive en frontend; el backend
        // solo se sincroniza cuando realmente cambia la posición de forma útil.
        sendLocation(p, !lastSentRef.current);
      },
      (err) => setError(err.message),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 }
    );

    function maybeSend(force = false) {
      const current = posRef.current;
      if (!current) return;
      sendLocation(current, force);
    }

    function onVisible() { if (!document.hidden) maybeSend(true); }
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      navigator.geolocation.clearWatch(watchRef.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [shouldTrack, token]);

  return { position, error };
}
