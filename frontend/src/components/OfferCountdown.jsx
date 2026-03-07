// frontend/src/components/OfferCountdown.jsx
import { useEffect } from 'react';
import { useOfferCountdown } from '../hooks/useOfferCountdown';

const OFFER_TIMEOUT_SECONDS = 60;

export default function OfferCountdown({ secondsLeft: serverSecondsLeft, onExpired }) {
  // CORRECCIÓN: Usamos serverSecondsLeft (la prop) para el hook
  const { secondsLeft: count, urgent, expired } = useOfferCountdown(serverSecondsLeft);

  useEffect(() => {
    if (expired && onExpired) {
      const t = setTimeout(onExpired, 100);
      return () => clearTimeout(t);
    }
  }, [expired, onExpired]);

  // CORRECCIÓN: Usamos 'count' en lugar de 'secondsLeft' para los estilos y el SVG
  const color = expired ? '#9ca3af' : urgent ? '#dc2626' : count <= 30 ? '#f59e0b' : '#16a34a';
  const pct   = Math.max(0, count / OFFER_TIMEOUT_SECONDS);
  const r     = 16;
  const circ  = 2 * Math.PI * r;
  const dash  = circ * pct;

  return (
    <div style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
      <svg width="40" height="40" style={{ transform:'rotate(-90deg)', flexShrink:0 }}>
        <circle cx="20" cy="20" r={r} fill="none" stroke="#e5e7eb" strokeWidth="3.5" />
        <circle cx="20" cy="20" r={r} fill="none" stroke={color} strokeWidth="3.5"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{ transition:'stroke-dasharray 0.9s linear, stroke 0.3s' }} />
        <text x="20" y="20" textAnchor="middle" dominantBaseline="central"
          style={{ transform:'rotate(90deg)', transformOrigin:'20px 20px', fontSize:'10px', fontWeight:700, fill:color, fontFamily:'monospace' }}>
          {expired ? '—' : count}
        </text>
      </svg>
      <div>
        <div style={{ fontSize:'0.75rem', color:'var(--gray-600)', lineHeight:1 }}>Tiempo</div>
        <div style={{ fontWeight:700, fontSize:'0.9rem', color,
          animation: urgent && !expired ? 'pulse-text 0.8s ease-in-out infinite' : 'none' }}>
          {expired ? 'Expirada' : urgent ? `⚠ ${count}s` : `${count}s`}
        </div>
      </div>
      <style>{`@keyframes pulse-text { 0%,100%{opacity:1} 50%{opacity:0.35} }`}</style>
    </div>
  );
}
