// frontend/src/hooks/useDriverLocation.js
// GPS activo cuando: driver disponible OR tiene pedido activo.
// Background sync: acumula posiciones offline y las envía al recuperar señal.

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api/client';

const MIN_SEND_INTERVAL_MS  = 4000;
const MIN_DISTANCE_METERS   = 15;
const MIN_RENDER_METERS     = 5;
const MAP_MATCH_BUFFER_SIZE = 8;
const MAP_MATCH_MAX_MS      = 30000;
const BATTERY_ALERT_PCT     = 15;   // notificar admin cuando batería < 15%
const OFFLINE_FLUSH_MAX     = 50;   // max posiciones acumuladas offline

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R    = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Background sync helpers ───────────────────────────────────────────────────
function postToSW(type, data) {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready
    .then(reg => reg.active?.postMessage({ type, ...data }))
    .catch(() => {});
}

function enqueueLocationBatch(driverId, positions, token) {
  postToSW('SYNC_LOCATION_BATCH', { driverId, positions, token });
}

// ── Battery monitoring ────────────────────────────────────────────────────────
async function watchBattery(driverId, token) {
  if (!('getBattery' in navigator)) return;
  try {
    const battery = await navigator.getBattery();
    let alerted   = false;

    const check = () => {
      const low = !battery.charging && battery.level * 100 <= BATTERY_ALERT_PCT;
      if (low && !alerted) {
        alerted = true;
        apiFetch(`/sync/drivers/${driverId}/battery-alert`, {
          method: 'POST',
          body: JSON.stringify({ level: Math.round(battery.level * 100), charging: battery.charging }),
        }, token).catch(() => {});
      }
      if (!low) alerted = false;
    };

    battery.addEventListener('levelchange',   check);
    battery.addEventListener('chargingchange', check);
    check();
  } catch (_) {}
}

export function useDriverLocation(token, isAvailable, hasActiveOrder = false, driverId = null) {
  const [position,        setPosition]        = useState(null);
  const [matchedPosition, setMatchedPosition] = useState(null);
  const [error,           setError]           = useState(null);

  const lastSentRef      = useRef(null);
  const lastSentAtRef    = useRef(0);
  const watchRef         = useRef(null);
  const posRef           = useRef(null);
  const offlineBufferRef = useRef([]);   // posiciones acumuladas sin red
  const isOnlineRef      = useRef(navigator.onLine);
  const batteryWatchRef  = useRef(false);

  const matchBufferRef   = useRef([]);
  const lastMatchAtRef   = useRef(0);
  const matchingRef      = useRef(false);

  const shouldTrack = Boolean(token && (isAvailable || hasActiveOrder));

  // ── Online/offline listeners ───────────────────────────────────────────────
  useEffect(() => {
    function onOnline() {
      isOnlineRef.current = true;
      // Flush buffered positions via background sync when connection returns
      if (offlineBufferRef.current.length > 0 && driverId) {
        enqueueLocationBatch(driverId, [...offlineBufferRef.current], token);
        offlineBufferRef.current = [];
      }
    }
    function onOffline() { isOnlineRef.current = false; }

    window.addEventListener('online',  onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online',  onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [driverId, token]);

  // ── Battery watch (once per session) ──────────────────────────────────────
  useEffect(() => {
    if (!shouldTrack || !driverId || batteryWatchRef.current) return;
    batteryWatchRef.current = true;
    watchBattery(driverId, token);
  }, [shouldTrack, driverId, token]);

  // ── Map matching ───────────────────────────────────────────────────────────
  const runMapMatch = useCallback(async (force = false) => {
    if (matchingRef.current) return;
    const buf = matchBufferRef.current;
    if (buf.length < 2) return;

    const now       = Date.now();
    const hasEnough = buf.length >= MAP_MATCH_BUFFER_SIZE;
    const tooOld    = now - lastMatchAtRef.current >= MAP_MATCH_MAX_MS;

    if (!force && !hasEnough && !tooOld) return;

    matchingRef.current    = true;
    lastMatchAtRef.current = now;
    const coords = [...buf];
    matchBufferRef.current = [];

    try {
      const data = await apiFetch('/nav/map-match', {
        method: 'POST',
        body:   JSON.stringify({ coordinates: coords }),
      }, token);

      if (data?.geometry?.length > 0) {
        const last = data.geometry[data.geometry.length - 1];
        if (last?.lat && last?.lng) setMatchedPosition({ lat: last.lat, lng: last.lng });
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
      offlineBufferRef.current = [];
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

      if (!isOnlineRef.current) {
        // Sin red: acumular para enviar cuando vuelva la conexión
        offlineBufferRef.current.push({ lat: current.lat, lng: current.lng, ts: Date.now() });
        if (offlineBufferRef.current.length > OFFLINE_FLUSH_MAX) {
          offlineBufferRef.current = offlineBufferRef.current.slice(-OFFLINE_FLUSH_MAX);
        }
        return;
      }

      apiFetch('/drivers/location', {
        method: 'PATCH',
        body: JSON.stringify(current),
      }, token).catch(() => {
        // Falló el envío — guardar en buffer offline
        offlineBufferRef.current.push({ lat: current.lat, lng: current.lng, ts: Date.now() });
      });
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

        const prev  = posRef.current;
        const moved = !prev || haversineMeters(prev.lat, prev.lng, p.lat, p.lng) >= MIN_RENDER_METERS;

        posRef.current = p;

        if (moved) {
          setPosition(p);
          setError(null);
          matchBufferRef.current.push({ lat: p.lat, lng: p.lng });
          runMapMatch();
        }

        sendLocation(p, !lastSentRef.current);
      },
      (err) => setError(err.message),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 }
    );

    const matchTimer = setInterval(() => runMapMatch(true), MAP_MATCH_MAX_MS);

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

// ── Marcar entregado con fallback offline ─────────────────────────────────────
// Llamar desde el componente de órdenes del driver en lugar de apiFetch directo.
export async function markOrderDelivered(orderId, token) {
  if (navigator.onLine) {
    return apiFetch(`/orders/${orderId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'delivered' }),
    }, token);
  }
  // Sin red: encolar en SW para envío automático al reconectar
  postToSW('SYNC_STATUS_UPDATE', {
    orderId,
    status: 'delivered',
    token,
  });
  // Lanzar error suave para que la UI muestre aviso
  throw Object.assign(new Error('Sin conexión — se enviará automáticamente al recuperar señal.'), { offline: true });
}
