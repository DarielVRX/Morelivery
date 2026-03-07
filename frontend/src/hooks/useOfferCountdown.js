import { useEffect, useState } from 'react';

/**
 * Cuenta regresiva para ofertas.
 * @param {number|string} initialSecondsLeft - segundos restantes iniciales desde backend
 */
export function useOfferCountdown(initialSecondsLeft) {
  const parse = (val) => {
    const n = parseInt(val);
    return isNaN(n) || n < 0 ? 60 : n;
  };

  const [secondsLeft, setSecondsLeft] = useState(parse(initialSecondsLeft));

  // Resincronizar si el backend envía un nuevo valor
  useEffect(() => {
    setSecondsLeft(parse(initialSecondsLeft));
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
  }, []); // se monta solo una vez

  return {
    secondsLeft,
    urgent: secondsLeft > 0 && secondsLeft <= 15,
    expired: secondsLeft === 0,
  };
}
