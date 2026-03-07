import { useEffect, useRef, useState } from 'react';

/**
 * Cuenta regresiva para ofertas.
 * @param {number} initialSecondsLeft - segundos restantes desde el backend
 *   Se debe pasar como número (no como timestamp ISO).
 *   Al recargar la página, el SSE debe reenviar el valor correcto y este hook
 *   lo resincroniza automáticamente.
 */
export function useOfferCountdown(initialSecondsLeft) {
  const parse = (val) => {
    const n = parseInt(val, 10);
    return isNaN(n) || n < 0 ? 60 : n;
  };

  const [secondsLeft, setSecondsLeft] = useState(() => parse(initialSecondsLeft));
  // Ref para el valor actual — el intervalo la lee sin re-montarse
  const secondsRef = useRef(parse(initialSecondsLeft));

  // Resincronizar cuando el backend envía un nuevo valor (reconnect SSE)
  useEffect(() => {
    const parsed = parse(initialSecondsLeft);
    secondsRef.current = parsed;
    setSecondsLeft(parsed);
  }, [initialSecondsLeft]);

  // Intervalo estable — se monta una vez, lee secondsRef para tener siempre el valor actual
  useEffect(() => {
    const interval = setInterval(() => {
      if (secondsRef.current <= 0) return;
      secondsRef.current = secondsRef.current - 1;
      setSecondsLeft(secondsRef.current);
    }, 1000);
    return () => clearInterval(interval);
  }, []); // mount/unmount solo

  return {
    secondsLeft,
    urgent:  secondsLeft > 0 && secondsLeft <= 15,
    expired: secondsLeft <= 0,
  };
}
