// frontend/src/hooks/useOfferCountdown.js
import { useState, useEffect } from 'react';

/**
 * Hook para contar segundos restantes de una oferta desde su creación.
 * @param {string|Date} offerCreatedAt - Fecha/hora de creación de la oferta
 */
export function useOfferCountdown(offerCreatedAt) {
  // Calcula los segundos restantes desde ahora
  const computeSecondsLeft = () => {
    const diff = Math.floor((Date.now() - new Date(offerCreatedAt).getTime()) / 1000);
    return Math.max(0, 60 - diff);
  };

  const [secondsLeft, setSecondsLeft] = useState(computeSecondsLeft);

  // Resincroniza si cambia offerCreatedAt
  useEffect(() => {
    setSecondsLeft(computeSecondsLeft());
  }, [offerCreatedAt]);

  // Intervalo que decrementa cada segundo
  useEffect(() => {
    if (secondsLeft <= 0) return; // No crear interval si ya expiró

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
  }, []); // Nota: dependencias vacías para que no se reinicie cada segundo

  return {
    secondsLeft,
    urgent: secondsLeft > 0 && secondsLeft <= 15,
    expired: secondsLeft === 0,
  };
}
