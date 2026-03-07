// frontend/src/components/OfferCountdown.jsx
import { useEffect } from 'react';
import { useOfferCountdown } from '../hooks/useOfferCountdown';

const OFFER_TIMEOUT_SECONDS = 60;
const SVG_SIZE = 40;
const RADIUS   = 16;

/**
 * Props:
 *   secondsLeft  {number}   - segundos restantes enviados por el backend vía SSE
 *   onExpired    {function} - callback cuando el contador llega a 0
 */
export default function OfferCountdown({ secondsLeft: initialSeconds, onExpired }) {
  const { secondsLeft, urgent, expired } = useOfferCountdown(initialSeconds);

  // Llamar onExpired una sola vez
  useEffect(() => {
    if (expired && onExpired) {
      const t = setTimeout(onExpired, 100);
      return () => clearTimeout(t);
    }
  }, [expired, onExpired]);

  const color = expired
    ? '#9ca3af'
    : urgent
    ? '#dc2626'
    : secondsLeft <= 30
    ? '#f59e0b'
    : '#16a34a';

  const pct  = Math.max(0, Math.min(1, secondsLeft / OFFER_TIMEOUT_SECONDS));
  const circ = 2 * Math.PI * RADIUS;
  const dash = circ * pct;

  return (
    <div style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
      <div style={{ position:'relative', width:SVG_SIZE, height:SVG_SIZE, flexShrink:0 }}>
        <svg width={SVG_SIZE} height={SVG_SIZE} style={{ transform:'rotate(-90deg)' }}>
          <circle
            cx={SVG_SIZE/2} cy={SVG_SIZE/2} r={RADIUS}
            fill="none" stroke="#e5e7eb" strokeWidth="3.5"
          />
          <circle
            cx={SVG_SIZE/2} cy={SVG_SIZE/2} r={RADIUS}
            fill="none"
            stroke={color}
            strokeWidth="3.5"
            strokeDasharray={`${dash} ${circ}`}
            strokeLinecap="round"
            style={{ transition:'stroke-dasharray 0.9s linear, stroke 0.3s' }}
          />
        </svg>
        <div style={{
          position:'absolute', top:'50%', left:'50%',
          transform:'translate(-50%, -50%)',
          fontSize:'12px', fontWeight:700, fontFamily:'monospace', color
        }}>C</div>
      </div>
      <div>
        <div style={{ fontSize:'0.75rem', color:'var(--gray-600)', lineHeight:1 }}>Tiempo</div>
        <div style={{
          fontWeight:700, fontSize:'0.9rem', color,
          animation: urgent && !expired ? 'pulse-text 0.8s ease-in-out infinite' : 'none'
        }}>
          {expired ? 'Expirada' : urgent ? `⚠ ${secondsLeft}s` : `${secondsLeft}s`}
        </div>
      </div>
      <style>{`@keyframes pulse-text { 0%,100%{opacity:1} 50%{opacity:0.35} }`}</style>
    </div>
  );
}
