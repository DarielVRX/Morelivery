// frontend/src/hooks/useDriverLocation.js
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api/client';

const SEND_INTERVAL_MS = 12000; // 12s \u2014 buen balance bater\u00eda / precisi\u00f3n
const MIN_DISTANCE_METERS = 15; // no enviar si se movi\u00f3 menos de 15m

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Para drivers: obtiene posici\u00f3n GPS y la env\u00eda al backend peri\u00f3dicamente.
 * Solo activo si isActive=true (driver disponible o con pedido activo).
 */
export function useDriverLocation(token, isActive) {
  const [position, setPosition] = useState(null);
  const [error, setError] = useState(null);
  const lastSent = useRef(null);
  const intervalRef = useRef(null);
  const watchRef = useRef(null);

  useEffect(() => {
    if (!isActive || !token) {
      if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
      clearInterval(intervalRef.current);
      return;
    }

    if (!('geolocation' in navigator)) {
      setError('GPS no disponible en este dispositivo');
      return;
    }

    // Escuchar cambios de posici\u00f3n del dispositivo
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        // Ignorar posiciones con precisión peor que 2km (típico de geoloc por IP/WiFi impreciso)
        if (pos.coords.accuracy > 2000) {
          setError(`Precisión GPS baja (${Math.round(pos.coords.accuracy)}m) — activa el GPS del dispositivo`);
          return;
        }
        setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) });
        setError(null);
      },
      (err) => setError(err.message),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    );

    // Enviar al backend cada SEND_INTERVAL_MS si hubo movimiento suficiente
    intervalRef.current = setInterval(async () => {
      setPosition(current => {
        if (!current) return current;
        const prev = lastSent.current;
        if (prev) {
          const dist = haversineMeters(prev.lat, prev.lng, current.lat, current.lng);
          if (dist < MIN_DISTANCE_METERS) return current; // sin cambio significativo
        }
        lastSent.current = current;
        apiFetch('/drivers/location', {
          method: 'PATCH',
          body: JSON.stringify(current)
        }, token).catch(() => {});
        return current;
      });
    }, SEND_INTERVAL_MS);

    return () => {
      navigator.geolocation.clearWatch(watchRef.current);
      clearInterval(intervalRef.current);
    };
  }, [isActive, token]);

  return { position, error };
}
