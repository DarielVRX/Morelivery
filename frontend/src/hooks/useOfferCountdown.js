import { useEffect, useState } from 'react';

const OFFER_TIMEOUT_SECONDS = 60;

export function useOfferCountdown(offerCreatedAt) {
  const calcInitial = () => {
    const createdTime = new Date(offerCreatedAt).getTime();
    return Math.max(0, OFFER_TIMEOUT_SECONDS - Math.floor((Date.now() - createdTime)/1000));
  };

  const [secondsLeft, setSecondsLeft] = useState(calcInitial);

  // Resincronizar si el backend envía nueva fecha
  useEffect(() => {
    setSecondsLeft(calcInitial());
  }, [offerCreatedAt]);

  useEffect(() => {
    if (secondsLeft <= 0) return;

    const interval = setInterval(() => {
      setSecondsLeft(prev => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return {
    secondsLeft,
    urgent: secondsLeft > 0 && secondsLeft <= 15,
    expired: secondsLeft === 0,
  };
}
