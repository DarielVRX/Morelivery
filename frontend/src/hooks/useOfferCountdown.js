import { useEffect, useState } from 'react';

export function useOfferCountdown(initialSecondsLeft) {
  // Ahora recibimos un número entero, no una fecha
  const parsedInitial = parseInt(initialSecondsLeft);
  const [secondsLeft, setSecondsLeft] = useState(isNaN(parsedInitial) ? 60 : parsedInitial);

  useEffect(() => {
    // Si llega una actualización del backend (ej. por reconexión), resincronizamos
    setSecondsLeft(initialSecondsLeft);
  }, [initialSecondsLeft]);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const interval = setInterval(() => {
      setSecondsLeft(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [secondsLeft]); // depende del valor real, no del booleano

  return {
    secondsLeft,
    urgent: secondsLeft <= 15 && secondsLeft > 0,
    expired: secondsLeft <= 0,
  };
}
