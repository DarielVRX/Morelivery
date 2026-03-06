// frontend/src/hooks/useOfferCountdown.js
import { useEffect, useState } from 'react';

// Debe coincidir con OFFER_TIMEOUT_SECONDS del backend (assignment.js)
const OFFER_TIMEOUT_SECONDS = 60;

export function useOfferCountdown(offerCreatedAt) {
  const [secondsLeft, setSecondsLeft] = useState(() => calcSecondsLeft(offerCreatedAt));

  useEffect(() => {
    if (!offerCreatedAt) return;

    // Sincronizar inmediatamente al recibir una nueva fecha
    setSecondsLeft(calcSecondsLeft(offerCreatedAt));

    const interval = setInterval(() => {
      const remaining = calcSecondsLeft(offerCreatedAt);
      setSecondsLeft(remaining);
      if (remaining <= 0) clearInterval(interval);
    }, 1000);

      return () => clearInterval(interval);
  }, [offerCreatedAt]);

  return {
    secondsLeft: Math.max(0, secondsLeft),
    urgent: secondsLeft <= 15 && secondsLeft > 0,
    expired: secondsLeft <= 0,
  };
}

function calcSecondsLeft(offerCreatedAt) {
  if (!offerCreatedAt) return 0;

  /**
   * NORMALIZACIÓN DE ZONA HORARIA:
   * 1. Reemplazamos el espacio por 'T' para formato ISO.
   * 2. Si la fecha no termina en 'Z' (UTC), se la agregamos para forzar
   * al navegador a interpretarla como UTC, igual que en el servidor.
   */
  let dateStr = offerCreatedAt.toString().replace(' ', 'T');
  if (!dateStr.endsWith('Z') && !dateStr.includes('+')) {
    dateStr += 'Z';
  }

  const startTime = new Date(dateStr).getTime();
  const now = Date.now();

  if (isNaN(startTime)) return 0;

  const elapsedSeconds = (now - startTime) / 1000;
  return Math.floor(OFFER_TIMEOUT_SECONDS - elapsedSeconds);
}
