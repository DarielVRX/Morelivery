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

// routeUsesWay eliminado — la alerta de calles ahora usa distancia al polyline directamente

export function useNavFeatures({
  steps         = [],
  currentPos,
  activeZones   = [],
  impassableWays = [],
  routeGeometry  = [],
  hasActiveOrder = false,
  onVoice,
  onZoneAlert,
}) {
  const [voiceEnabled,   setVoiceEnabled]   = useState(true);
  const [wakeLockActive, setWakeLockActive] = useState(false);

  const wakeLockRef      = useRef(null);
  const announcedSteps   = useRef(new Set());
  const zoneAlertedMap   = useRef(new Map());
  const wayAlertedMap    = useRef(new Map());

  // ── Wake Lock — solo activo con pedido activo Y ruta calculada ─────────────
  useEffect(() => {
    const shouldLock = hasActiveOrder && routeGeometry?.length > 0;

    async function acquire() {
      try {
        if (!('wakeLock' in navigator)) return;
        if (wakeLockRef.current) return; // ya activo
        const lock = await navigator.wakeLock.request('screen');
        wakeLockRef.current = lock;
        setWakeLockActive(true);
        lock.addEventListener('release', () => {
          wakeLockRef.current = null;
          setWakeLockActive(false);
        });
      } catch (_) {}
    }

    function release() {
      try {
        wakeLockRef.current?.release();
        wakeLockRef.current = null;
        setWakeLockActive(false);
      } catch (_) {}
    }

    if (shouldLock) {
      acquire();
      // Re-adquirir al volver de background (iOS/Android liberan el lock al minimizar)
      const onVis = () => { if (!document.hidden && shouldLock) acquire(); };
      document.addEventListener('visibilitychange', onVis);
      return () => {
        document.removeEventListener('visibilitychange', onVis);
        release();
      };
    } else {
      release();
    }
  }, [hasActiveOrder, routeGeometry?.length]);

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

  // ── Alertas de calles no viables ────────────────────────────────────────────
  // Alerta cuando el conductor está a menos de 50m de CUALQUIER nodo del way
  // (no solo del primer nodo), independientemente de si la ruta pasa por ahí
  useEffect(() => {
    if (!currentPos || !impassableWays.length) return;
    const now      = Date.now();
    const COOLDOWN = 180_000;
    const ALERT_DIST = 50; // metros desde cualquier nodo del tramo

    for (const way of impassableWays) {
      if (!way.coords?.length) continue;

      // Distancia mínima al polyline completo (todos los nodos)
      let minDist = Infinity;
      for (const coord of way.coords) {
        // coords pueden ser [lng, lat] o {lat, lng}
        const cLat = Array.isArray(coord) ? coord[1] : coord.lat;
        const cLng = Array.isArray(coord) ? coord[0] : coord.lng;
        const d = euclideanMeters(currentPos.lat, currentPos.lng, cLat, cLng);
        if (d < minDist) minDist = d;
      }
      if (minDist > ALERT_DIST) continue;

      const last = wayAlertedMap.current.get(way.way_id) || 0;
      if (now - last < COOLDOWN) continue;
      wayAlertedMap.current.set(way.way_id, now);

      const msg = `⚠️ Calle no viable cerca: ${way.name || 'tramo adelante'}`;
      if (voiceEnabled) {
        try { window.speechSynthesis?.speak(new SpeechSynthesisUtterance(msg)); } catch (_) {}
      }
      onVoice?.(msg);
    }
  }, [currentPos?.lat, currentPos?.lng, impassableWays, voiceEnabled, onVoice]);

  return { voiceEnabled, setVoiceEnabled, wakeLockActive };
}
