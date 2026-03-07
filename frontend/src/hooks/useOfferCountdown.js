import { useEffect, useState } from 'react';

export function useOfferCountdown(initialSecondsLeft) {
  const parsedInitial = parseInt(initialSecondsLeft);
  const [secondsLeft, setSecondsLeft] = useState(isNaN(parsedInitial) ? 60 : parsedInitial);

  // Resincronizar si el backend envía un nuevo valor
  useEffect(() => {
    setSecondsLeft(isNaN(parsedInitial) ? 60 : parsedInitial);
  }, [initialSecondsLeft]);

  // Intervalo de cuenta regresiva
  useEffect(() => {
    if (secondsLeft <= 0) return; // nada que hacer si ya expiró
    const interval = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []); // solo se monta una vez

  return {
    secondsLeft,
    urgent: secondsLeft <= 15 && secondsLeft > 0,
    expired: secondsLeft <= 0,
  };
}
