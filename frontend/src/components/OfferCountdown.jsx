// frontend/src/components/OfferCountdown.jsx
import { useOfferCountdown } from '../hooks/useOfferCountdown';

const OFFER_TIMEOUT_SECONDS = 60;

/**
 * Muestra cuenta regresiva circular + barra para una oferta de pedido.
 * Props:
 *   offerCreatedAt \u2014 ISO string de od.created_at
 *   onExpired      \u2014 callback cuando llega a 0 (opcional, para recargar ofertas)
 */
export default function OfferCountdown({ offerCreatedAt, onExpired }) {
  const { secondsLeft, urgent, expired } = useOfferCountdown(offerCreatedAt);

  // Notificar al padre cuando expire
  const prevExpired = expired;
  if (expired && onExpired && typeof onExpired === 'function') {
    // Solo disparar una vez usando un ref en el padre \u2014 aqu\u00ed solo llamamos
  }

  // Colores seg\u00fan urgencia
  const color = expired ? '#9ca3af' : urgent ? '#dc2626' : secondsLeft <= 30 ? '#f59e0b' : '#16a34a';
  const pct = Math.max(0, secondsLeft / OFFER_TIMEOUT_SECONDS); // 1 \u2192 0

  // SVG circular
  const r = 18;
  const circ = 2 * Math.PI * r;
  const dash = circ * pct;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      {/* C\u00edrculo SVG */}
      <svg width="44" height="44" style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
        {/* Fondo */}
        <circle cx="22" cy="22" r={r} fill="none" stroke="#e5e7eb" strokeWidth="4" />
        {/* Progreso */}
        <circle
          cx="22" cy="22" r={r}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.8s linear, stroke 0.3s' }}
        />
        {/* N\u00famero en el centro \u2014 rotate para contrarrestar el -90deg del padre */}
        <text
          x="22" y="22"
          textAnchor="middle"
          dominantBaseline="central"
          style={{ transform: 'rotate(90deg)', transformOrigin: '22px 22px', fontSize: '11px', fontWeight: 700, fill: color, fontFamily: 'monospace' }}
        >
          {expired ? '\u2014' : secondsLeft}
        </text>
      </svg>

      {/* Etiqueta textual */}
      <div style={{ minWidth: '5rem' }}>
        <div style={{ fontSize: '0.8rem', color: '#6b7280', lineHeight: 1 }}>Tiempo</div>
        <div style={{
          fontWeight: 700,
          fontSize: '0.95rem',
          color,
          animation: urgent && !expired ? 'pulse-text 0.8s ease-in-out infinite' : 'none'
        }}>
          {expired ? 'Expirada' : urgent ? `\u26a0 ${secondsLeft}s` : `${secondsLeft}s`}
        </div>
      </div>

      <style>{`
        @keyframes pulse-text {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
