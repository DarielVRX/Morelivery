// frontend/src/components/SplitLayout.jsx
// ordersContent se monta UNA sola vez — en desktop es columna fija,
// en móvil la misma columna se transforma en drawer via CSS (sin re-mount).
import { useEffect, useState } from 'react';

export default function SplitLayout({ homeContent, ordersContent }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  return (
    <div className="split-root">

    {/* ── Orders: una sola instancia — desktop col + mobile drawer ── */}
    <aside className={`split-orders-col${mobileOpen ? ' mobile-open' : ''}`}>
    {ordersContent}
    </aside>

    {/* ── Columna Home ──────────────────────────────────────────────── */}
    <section className="split-home-col">
    {homeContent}
    </section>

    {/* ── Mobile: botón tab fijo ────────────────────────────────────── */}
    <button
    className={`orders-tab-trigger${mobileOpen ? ' open' : ''}`}
    onClick={() => setMobileOpen(v => !v)}
    aria-label={mobileOpen ? 'Cerrar pedidos' : 'Ver pedidos'}
    style={{
      right: mobileOpen ? 'min(85vw, 360px)' : 0,
          transition:'right 0.28s cubic-bezier(0.4,0,0.2,1), background 0.2s'
    }}
    >
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points={mobileOpen ? '15 18 9 12 15 6' : '9 18 15 12 9 6'}/>
    </svg>
    </button>

    {/* Overlay */}
    <div
    className={`orders-overlay${mobileOpen ? ' visible' : ''}`}
    onClick={() => setMobileOpen(false)}
    />

    <style>{`
      .split-root {
        display: flex;
        flex-direction: row;
        width: 100%;
        flex: 1;
        min-height: 0;
        overflow: hidden;
      }

      /* ════════ Desktop ≥768px ══════════════════════════════════ */
      @media (min-width: 768px) {
        .split-orders-col {
          width: 33%;
          min-width: 260px;
          max-width: 380px;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          border-right: 1px solid var(--gray-200);
          background: #fff;
        }
        .split-home-col {
          flex: 1;
          min-width: 0;
          overflow-y: auto;
          overflow-x: hidden;
        }
        .split-home-col:has(.driver-map-root) {
          overflow: hidden;
        }
        .orders-overlay     { display: none !important; }
        .orders-tab-trigger { display: none !important; }
      }

      /* ════════ Mobile <768px ═══════════════════════════════════ */
      @media (max-width: 767px) {

        /* Orders col = drawer: hidden off-screen by default */
        .split-orders-col {
          position: fixed;
          top: 0;
          right: 0;
          bottom: 0;
          width: 85vw;
          max-width: 360px;
          z-index: 320;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          background: #fff;
          box-shadow: -4px 0 24px rgba(0,0,0,0.14);
          transform: translateX(100%);
          transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .split-orders-col.mobile-open {
          transform: translateX(0);
        }

        .split-home-col {
          flex: 1;
          min-width: 0;
          overflow-x: hidden;
        }

        .orders-overlay {
          display: none;
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.35);
          z-index: 315;
          touch-action: none;
        }
        .orders-overlay.visible { display: block; }

        .orders-tab-trigger {
          position: fixed;
          right: 0;
          top: 50%;
          transform: translateY(-50%);
          width: 28px;
          height: 56px;
          border-radius: 28px 0 0 28px;
          background: var(--brand);
          color: #fff;
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: -2px 0 8px rgba(0,0,0,0.18);
          z-index: 325;
          padding: 0;
          transition: background 0.2s;
        }
        .orders-tab-trigger.open {
          background: var(--gray-500);
        }
      }
      `}</style>
      </div>
  );
}
