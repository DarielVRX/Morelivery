// frontend/src/hooks/useOfferCountdown.js
import { useEffect, useState } from 'react';

const OFFER_TIMEOUT_SECONDS = 60; // debe coincidir con el backend

/**
 * Devuelve { secondsLeft, urgent, expired } para una oferta dada su offer_created_at.
 * Se actualiza cada segundo.
 */
export function useOfferCountdown(initialSecondsLeft) {
  const [secondsLeft, setSecondsLeft] = useState(initialSecondsLeft);

  useEffect(() => {
    // Sincronizar si llega un nuevo valor del backend
    setSecondsLeft(initialSecondsLeft);
  }, [initialSecondsLeft]);

  useEffect(() => {
    if (secondsLeft <= 0) return;

    const interval = setInterval(() => {
      setSecondsLeft((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(interval);
  }, [secondsLeft > 0]);

  return {
    secondsLeft,
    urgent: secondsLeft <= 15 && secondsLeft > 0,
    expired: secondsLeft <= 0,
  };
}

function calcSecondsLeft(offerCreatedAt) {
  if (!offerCreatedAt) return OFFER_TIMEOUT_SECONDS;
  const elapsed = (Date.now() - new Date(offerCreatedAt).getTime()) / 1000;
  return Math.floor(OFFER_TIMEOUT_SECONDS - elapsed);
}
