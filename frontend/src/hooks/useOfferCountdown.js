// frontend/src/hooks/useOfferCountdown.js
import { useEffect, useRef, useState } from 'react';

/**
 * Cuenta regresiva basada en secondsLeft del SERVIDOR.
 * El intervalo corre solo cuando secondsLeft > 0.
 * El componente que lo usa DEBE recibir key={offer.id} para que
 * se desmonte/monte en cada oferta nueva → reset automático.
 */
export function useOfferCountdown(initialSecondsLeft) {
  const parse = (v) => {
    const n = typeof v === 'number' ? Math.round(v) : parseInt(v, 10);
    return isNaN(n) || n < 0 ? 0 : n;
  };

  const initial       = parse(initialSecondsLeft);
  const [secs, setSecs] = useState(initial);
  const ref           = useRef(initial);

  // Si el mismo componente recibe un nuevo initialSecondsLeft (resync desde SSE)
  useEffect(() => {
    const parsed = parse(initialSecondsLeft);
    ref.current  = parsed;
    setSecs(parsed);
  }, [initialSecondsLeft]);

  // Intervalo estable — se limpia al desmontar (key change fuerza un nuevo mount)
  useEffect(() => {
    if (ref.current <= 0) return;
    const id = setInterval(() => {
      if (ref.current <= 0) { clearInterval(id); return; }
      ref.current -= 1;
      setSecs(ref.current);
    }, 1000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    secondsLeft: secs,
    urgent:  secs > 0 && secs <= 15,
    expired: secs <= 0,
  };
}
