// frontend/src/hooks/useNavFeatures.js
import { useEffect, useRef, useState } from 'react';

const ZONE_MESSAGES = {
  traffic:      'Aviso: tráfico pesado más adelante',
  construction: 'Aviso: obra en construcción más adelante',
  accident:     'Aviso: accidente reportado más adelante',
  flood:        'Aviso: zona de inundación más adelante',
  blocked:      'Aviso: calle bloqueada más adelante',
  other:        'Aviso: problema reportado más adelante',
};

function euclideanMeters(lat1, lng1, lat2, lng2) {
  const dlat = (lat2 - lat1) * 111320;
  const dlng = (lng2 - lng1) * 111320 * Math.cos((lat1 * Math.PI) / 180);
  return Math.sqrt(dlat * dlat + dlng * dlng);
}

/**
 * Hook de navegación: Wake Lock, voz turn-by-turn, alertas de zonas.
 *
 * @param {Object}   params
 * @param {Array}    params.steps       — pasos de la ruta [{instruction, distance_m, location}]
 * @param {Object}   params.currentPos  — posición actual {lat, lng}
 * @param {Array}    params.activeZones — zonas activas del backend
 * @param {Function} params.onVoice     — callback para reproducir mensaje de voz
 */
export function useNavFeatures({ steps = [], currentPos, activeZones = [], onVoice }) {
  const [voiceEnabled,  setVoiceEnabled]  = useState(true);
  const [wakeLockActive, setWakeLockActive] = useState(false);

  const wakeLockRef       = useRef(null);
  const announcedSteps    = useRef(new Set());
  const zoneAnnouncedMap  = useRef(new Map()); // zoneId → lastAnnouncedTimestamp

  // ── Wake Lock ──────────────────────────────────────────────────────────────
  useEffect(() => {
    async function requestWakeLock() {
      try {
        if (!('wakeLock' in navigator)) return;
        const lock = await navigator.wakeLock.request('screen');
        wakeLockRef.current = lock;
        setWakeLockActive(true);
        lock.addEventListener('release', () => setWakeLockActive(false));
      } catch (_) {
        // silencioso si no está disponible
      }
    }

    requestWakeLock();

    function onVisibilityChange() {
      if (!document.hidden && wakeLockRef.current?.released !== false) {
        requestWakeLock();
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      try { wakeLockRef.current?.release(); } catch (_) {}
    };
  }, []);

  // ── Limpiar set de pasos anunciados cuando cambian los steps ──────────────
  useEffect(() => {
    announcedSteps.current = new Set();
  }, [steps]);

  // ── Voz turn-by-turn ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!voiceEnabled || !currentPos || !steps.length) return;
    if (!window.speechSynthesis) return;

    steps.forEach((step, idx) => {
      if (announcedSteps.current.has(idx)) return;
      if (!step.location) return;

      const dist = euclideanMeters(
        currentPos.lat, currentPos.lng,
        step.location.lat, step.location.lng
      );

      if (dist < 80) {
        announcedSteps.current.add(idx);
        const text = step.instruction || 'Continúa';
        try {
          window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
        } catch (_) {}
        onVoice?.(text);
      }
    });
  }, [currentPos?.lat, currentPos?.lng, steps, voiceEnabled, onVoice]);

  // ── Alertas de zonas ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!voiceEnabled || !currentPos || !activeZones.length) return;

    const now = Date.now();
    const COOLDOWN_MS = 60_000;

    for (const zone of activeZones) {
      const dist = euclideanMeters(
        currentPos.lat, currentPos.lng,
        zone.lat, zone.lng
      );

      if (dist < zone.radius_m + 50) {
        const lastAnnounced = zoneAnnouncedMap.current.get(zone.id) || 0;
        if (now - lastAnnounced < COOLDOWN_MS) continue;

        const message = ZONE_MESSAGES[zone.type] || ZONE_MESSAGES.other;
        zoneAnnouncedMap.current.set(zone.id, now);

        try {
          if (window.speechSynthesis) {
            window.speechSynthesis.speak(new SpeechSynthesisUtterance(message));
          }
        } catch (_) {}
        onVoice?.(message);
      }
    }
  }, [currentPos?.lat, currentPos?.lng, activeZones, voiceEnabled, onVoice]);

  return { voiceEnabled, setVoiceEnabled, wakeLockActive };
}
