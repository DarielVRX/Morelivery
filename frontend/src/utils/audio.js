// utils/audio.js — efectos de sonido con Web Audio API

export function playOfferAlertSound() {
  if (typeof window === 'undefined') return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    const ctx = new Ctx();
    const pulse = (offset, freq, duration = 0.12) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type           = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + offset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + duration + 0.03);
    };
    pulse(0.00, 880);
    pulse(0.18, 1180);
    setTimeout(() => ctx.close().catch(() => {}), 600);
  } catch (_) {}
}
