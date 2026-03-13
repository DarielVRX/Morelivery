// frontend/src/hooks/useNavFeatures.js
import { useEffect, useRef, useState } from 'react';

const ZONE_LABELS = {
  traffic:      'tráfico pesado',
  construction: 'obra en construcción',
  accident:     'accidente',
  flood:        'zona de inundación',
  blocked:      'calle bloqueada',
  other:        'problema en la vía',
};

function euclideanMeters(lat1, lng1, lat2, lng2) {
  const dlat = (lat2 - lat1) * 111320;
  const dlng = (lng2 - lng1) * 111320 * Math.cos((lat1 * Math.PI) / 180);
  return Math.sqrt(dlat * dlat + dlng * dlng);
}

// Verifica si algún punto de la ruta pasa cerca del waypoint impassable
function routeUsesWay(routeCoords, wayCoords, thresholdM = 30) {
  if (!routeCoords?.length || !wayCoords?.length) return false;
  for (const rp of routeCoords) {
    for (const wp of wayCoords) {
      const d = euclideanMeters(rp.lat ?? rp[1], rp.lng ?? rp[0], wp[1], wp[0]);
      if (d < thresholdM) return true;
    }
  }
  return false;
}

export function useNavFeatures({
  steps         = [],
  currentPos,
  activeZones   = [],
  impassableWays = [],   // [{way_id, coords:[...]}] confirmados
  routeGeometry  = [],   // coords de la ruta activa
  onVoice,
  onZoneAlert,           // callback (zone) cuando entra a 500m
}) {
  const [voiceEnabled,   setVoiceEnabled]   = useState(true);
  const [wakeLockActive, setWakeLockActive] = useState(false);

  const wakeLockRef      = useRef(null);
  const announcedSteps   = useRef(new Set());
  const zoneAlertedMap   = useRef(new Map()); // zoneId → timestamp
  const wayAlertedMap    = useRef(new Map()); // way_id  → timestamp

  // ── Wake Lock ──────────────────────────────────────────────────────────────
  useEffect(() => {
    async function req() {
      try {
        if (!('wakeLock' in navigator)) return;
        const lock = await navigator.wakeLock.request('screen');
        wakeLockRef.current = lock;
        setWakeLockActive(true);
        lock.addEventListener('release', () => setWakeLockActive(false));
      } catch (_) {}
    }
    req();
    const onVis = () => { if (!document.hidden) req(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      try { wakeLockRef.current?.release(); } catch (_) {}
    };
  }, []);

  // Limpiar steps al cambiar la ruta
  useEffect(() => { announcedSteps.current = new Set(); }, [steps]);

  // ── Voz turn-by-turn ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!voiceEnabled || !currentPos || !steps.length) return;
    if (!window.speechSynthesis) return;
    steps.forEach((step, idx) => {
      if (announcedSteps.current.has(idx) || !step.location) return;
      const dist = euclideanMeters(
        currentPos.lat, currentPos.lng,
        step.location.lat, step.location.lng
      );
      if (dist < 80) {
        announcedSteps.current.add(idx);
        const text = step.instruction || 'Continúa';
        try { window.speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } catch (_) {}
        onVoice?.(text);
      }
    });
  }, [currentPos?.lat, currentPos?.lng, steps, voiceEnabled, onVoice]);

  // ── Alertas de zonas (500 m) ───────────────────────────────────────────────
  useEffect(() => {
    if (!currentPos || !activeZones.length) return;
    const now       = Date.now();
    const COOLDOWN  = 120_000; // 2 min entre alertas de la misma zona
    const ALERT_M   = 500;

    for (const zone of activeZones) {
      const dist = euclideanMeters(currentPos.lat, currentPos.lng, zone.lat, zone.lng);
      if (dist > ALERT_M) continue;

      const last = zoneAlertedMap.current.get(zone.id) || 0;
      if (now - last < COOLDOWN) continue;
      zoneAlertedMap.current.set(zone.id, now);

      const msg = 'Se reportó una zona de alerta cerca, revisa el mapa';
      if (voiceEnabled) {
        try {
          window.speechSynthesis?.speak(new SpeechSynthesisUtterance(msg));
        } catch (_) {}
      }
      onVoice?.(msg);
      onZoneAlert?.(zone);
    }
  }, [currentPos?.lat, currentPos?.lng, activeZones, voiceEnabled, onVoice, onZoneAlert]);

  // ── Alertas de calles no viables (solo si la ruta pasa por ahí) ───────────
  useEffect(() => {
    if (!currentPos || !impassableWays.length || !routeGeometry.length) return;
    const now      = Date.now();
    const COOLDOWN = 180_000;

    for (const way of impassableWays) {
      if (!routeUsesWay(routeGeometry, way.coords)) continue;

      const dist = euclideanMeters(
        currentPos.lat, currentPos.lng,
        way.coords[0]?.[1] ?? currentPos.lat,
        way.coords[0]?.[0] ?? currentPos.lng
      );
      if (dist > 300) continue;

      const last = wayAlertedMap.current.get(way.way_id) || 0;
      if (now - last < COOLDOWN) continue;
      wayAlertedMap.current.set(way.way_id, now);

      const msg = `Atención: la calle ${way.name || 'adelante'} está reportada como no viable`;
      if (voiceEnabled) {
        try { window.speechSynthesis?.speak(new SpeechSynthesisUtterance(msg)); } catch (_) {}
      }
      onVoice?.(msg);
    }
  }, [currentPos?.lat, currentPos?.lng, impassableWays, routeGeometry, voiceEnabled, onVoice]);

  return { voiceEnabled, setVoiceEnabled, wakeLockActive };
}
