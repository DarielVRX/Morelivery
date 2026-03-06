// frontend/src/hooks/useOfferCountdown.js
import { useEffect, useState } from 'react';

const OFFER_TIMEOUT_SECONDS = 60; // debe coincidir con el backend

/**
 * Devuelve { secondsLeft, urgent, expired } para una oferta dada su offer_created_at.
 * Se actualiza cada segundo.
 */
export function useOfferCountdown(offerCreatedAt) {
  const [secondsLeft, setSecondsLeft] = useState(() => calcSecondsLeft(offerCreatedAt));

  useEffect(() => {
    if (!offerCreatedAt) return;
    const interval = setInterval(() => {
      setSecondsLeft(calcSecondsLeft(offerCreatedAt));
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
  if (!offerCreatedAt) return OFFER_TIMEOUT_SECONDS;
  const elapsed = (Date.now() - new Date(offerCreatedAt).getTime()) / 1000;
  return Math.floor(OFFER_TIMEOUT_SECONDS - elapsed);
}
