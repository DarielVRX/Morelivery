// frontend/src/hooks/useOfferCountdown.js
import { useEffect, useRef, useState } from 'react';

/**
 * Cuenta regresiva basada en secondsLeft calculado por el SERVIDOR.
 * - No depende del reloj del cliente para el valor inicial.
 * - Al recargar, el SSE o el endpoint devuelven un secondsLeft fresco del servidor.
 * - Cada segundo hace -1 localmente (interpolación suave).
 *
 * @param {number} initialSecondsLeft  segundos restantes según el servidor (número entero ≥ 0)
 */
export function useOfferCountdown(initialSecondsLeft) {
  const parse = (v) => {
    const n = typeof v === 'number' ? Math.round(v) : parseInt(v, 10);
    return isNaN(n) || n < 0 ? 0 : n;
  };

  const [secondsLeft, setSecondsLeft] = useState(() => parse(initialSecondsLeft));
  const ref = useRef(parse(initialSecondsLeft));

  // Resincronizar cuando llega un valor nuevo del servidor (SSE push o recarga)
  useEffect(() => {
    const parsed = parse(initialSecondsLeft);
    ref.current = parsed;
    setSecondsLeft(parsed);
  }, [initialSecondsLeft]);

  // Intervalo estable — solo se monta una vez
  useEffect(() => {
    const id = setInterval(() => {
      if (ref.current <= 0) return;
      ref.current -= 1;
      setSecondsLeft(ref.current);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return {
    secondsLeft,
    urgent:  secondsLeft > 0 && secondsLeft <= 15,
    expired: secondsLeft <= 0,
  };
}
