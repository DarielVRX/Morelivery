export function useOfferCountdown(offerCreatedAt) {
  // Convertimos a segundos restantes desde ahora
  const initialSecondsLeft = Math.max(
    0,
    60 - Math.floor((Date.now() - new Date(offerCreatedAt).getTime()) / 1000)
  );

  const [secondsLeft, setSecondsLeft] = useState(initialSecondsLeft);

  useEffect(() => {
    const updated = Math.max(
      0,
      60 - Math.floor((Date.now() - new Date(offerCreatedAt).getTime()) / 1000)
    );
    setSecondsLeft(updated);
  }, [offerCreatedAt]);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const interval = setInterval(() => {
      setSecondsLeft(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [secondsLeft]);

  return {
    secondsLeft,
    urgent: secondsLeft <= 15 && secondsLeft > 0,
    expired: secondsLeft <= 0,
  };
}
