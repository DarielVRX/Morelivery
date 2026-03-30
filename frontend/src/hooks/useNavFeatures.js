// frontend/src/hooks/useNavFeatures.js
import { useEffect, useRef, useState } from 'react';
import { buildVoiceInstruction, detectTurnDirection } from '../features/driver/home/navigation';

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

// ── Voz en español ────────────────────────────────────────────────────────────
let _voices = [];
function getSpanishVoice() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null;
  if (_voices.length === 0) _voices = window.speechSynthesis.getVoices();
  // Preferir voz de México, luego cualquier español
  return (
    _voices.find(v => v.lang === 'es-MX') ||
    _voices.find(v => v.lang?.startsWith('es')) ||
    null
  );
}

function speak(text) {
  if (!text || typeof window === 'undefined' || !window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel(); // cancelar utterance anterior
    const utt  = new SpeechSynthesisUtterance(text);
    utt.lang   = 'es-MX';
    utt.rate   = 1.0;
    utt.pitch  = 1.0;
    const voice = getSpanishVoice();
    if (voice) utt.voice = voice;
    window.speechSynthesis.speak(utt);
  } catch (_) {}
}

// Cargar voces al inicio (algunas implementaciones las cargan async)
if (typeof window !== 'undefined' && window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => {
    _voices = window.speechSynthesis.getVoices();
  };
}

// ── Tipos de step que NO ameritan anuncio ─────────────────────────────────────
const SILENT_MANEUVERS = new Set(['depart', 'arrive', 'new name', 'notification']);

function shouldAnnounceStep(step) {
  const maneuver = step?.maneuver?.type || step?.type || '';
  if (SILENT_MANEUVERS.has(maneuver)) return false;
  const dir = detectTurnDirection(step);
  // No anunciar "recto" — solo giros y salidas de rotonda
  if (dir === 'straight') return false;
  if (dir === null && maneuver === 'continue') return false;
  return true;
}

export function useNavFeatures({
  steps          = [],
  currentPos,
  activeZones    = [],
  impassableWays = [],
  routeGeometry  = [],
  hasActiveOrder = false,
  onVoice,      // SOLO para compatibilidad — ya NO se usa para toasts, solo para ETA si se necesita
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
    const shouldLock = true;

    async function acquire() {
      try {
        if (!('wakeLock' in navigator)) return;
        if (wakeLockRef.current) return;
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
  // Anuncia a 150m del step (anticipación), solo en intersecciones relevantes.
  // Sin toast visual — la voz es el único canal de salida.
  useEffect(() => {
    if (!voiceEnabled || !currentPos || !steps.length) return;
    if (!window.speechSynthesis) return;

    steps.forEach((step, idx) => {
      if (announcedSteps.current.has(idx) || !step.location) return;
      if (!shouldAnnounceStep(step)) return;

      const dist = euclideanMeters(
        currentPos.lat, currentPos.lng,
        step.location.lat, step.location.lng
      );

      // Anunciar a 150m (anticipación) o a 30m (confirmación)
      const ANNOUNCE_FAR  = 150;
      const ANNOUNCE_NEAR = 30;

      const farKey  = `${idx}_far`;
      const nearKey = `${idx}_near`;

      if (dist < ANNOUNCE_FAR && !announcedSteps.current.has(farKey)) {
        announcedSteps.current.add(farKey);
        const instruction = buildVoiceInstruction(step, dist);
        if (instruction) speak(instruction);
      }

      if (dist < ANNOUNCE_NEAR && !announcedSteps.current.has(nearKey)) {
        announcedSteps.current.add(nearKey);
        // Confirmación corta justo antes del giro
        const dir = detectTurnDirection(step);
        if (dir && dir !== 'straight') {
          const confirmation = dir === 'left'  ? 'Gira a la izquierda'
                             : dir === 'right' ? 'Gira a la derecha'
                             : dir === 'uturn' ? 'Da vuelta en U'
                             : null;
          if (confirmation) speak(confirmation);
        }
        announcedSteps.current.add(idx); // marcar como completamente anunciado
      }
    });
  }, [currentPos?.lat, currentPos?.lng, steps, voiceEnabled]);

  // ── Alertas de zonas (500m) — solo voz, sin toast ─────────────────────────
  useEffect(() => {
    if (!currentPos || !activeZones.length) return;
    const now      = Date.now();
    const COOLDOWN = 120_000;
    const ALERT_M  = 500;

    for (const zone of activeZones) {
      const dist = euclideanMeters(currentPos.lat, currentPos.lng, zone.lat, zone.lng);
      if (dist > ALERT_M) continue;

      const last = zoneAlertedMap.current.get(zone.id) || 0;
      if (now - last < COOLDOWN) continue;
      zoneAlertedMap.current.set(zone.id, now);

      const tipo = ZONE_LABELS[zone.type] || 'problema en la vía';
      if (voiceEnabled) speak(`Atención, hay ${tipo} cerca`);
      onZoneAlert?.(zone);
    }
  }, [currentPos?.lat, currentPos?.lng, activeZones, voiceEnabled, onZoneAlert]);

  // ── Alertas de calles no viables (50m) — solo voz, sin toast ─────────────
  useEffect(() => {
    if (!currentPos || !impassableWays.length) return;
    const now        = Date.now();
    const COOLDOWN   = 180_000;
    const ALERT_DIST = 50;

    for (const way of impassableWays) {
      if (!way.coords?.length) continue;

      let minDist = Infinity;
      for (const coord of way.coords) {
        const cLat = Array.isArray(coord) ? coord[1] : coord.lat;
        const cLng = Array.isArray(coord) ? coord[0] : coord.lng;
        const d    = euclideanMeters(currentPos.lat, currentPos.lng, cLat, cLng);
        if (d < minDist) minDist = d;
      }
      if (minDist > ALERT_DIST) continue;

      const last = wayAlertedMap.current.get(way.way_id) || 0;
      if (now - last < COOLDOWN) continue;
      wayAlertedMap.current.set(way.way_id, now);

      const nombre = way.name ? `en ${way.name}` : 'adelante';
      if (voiceEnabled) speak(`Calle no disponible ${nombre}`);
    }
  }, [currentPos?.lat, currentPos?.lng, impassableWays, voiceEnabled]);

  return { voiceEnabled, setVoiceEnabled, wakeLockActive };
}
