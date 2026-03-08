// frontend/src/components/SplitLayout.jsx
import { useEffect, useState } from 'react';

export default function SplitLayout({ homeContent, ordersContent }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  // Bloquear scroll del body en mobile cuando panel abierto
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const isMobile = window.innerWidth < 768;
    if (isMobile && mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  return (
    <div className="split-root">

      {/* ── Desktop: dos columnas ────────────────────────────────────── */}
      {/* Orders — 33% izquierda */}
      <aside className="split-orders-col">
        {ordersContent}
      </aside>

      {/* Home — 67% derecha */}
      <section className="split-home-col">
        {homeContent}
      </section>

      {/* ── Mobile: tab trigger + drawer ───────────────────────────── */}
      {/* Tab trigger: medio círculo en el borde del drawer, se mueve con él */}
      <div className={`orders-drawer-wrap${mobileOpen ? ' open' : ''}`}>
        {/* El trigger está DENTRO del wrapper para moverse junto al drawer */}
        <button
          className="orders-tab-trigger"
          onClick={() => setMobileOpen(v => !v)}
          aria-label={mobileOpen ? 'Cerrar pedidos' : 'Ver pedidos'}
        >
          {/* Flecha apunta hacia afuera (izquierda cerrado, derecha abierto) */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points={mobileOpen ? '15 18 9 12 15 6' : '9 18 15 12 9 6'}/>
          </svg>
        </button>
        <div className="orders-drawer-inner">
          {ordersContent}
        </div>
      </div>

      {/* Overlay oscuro detrás del drawer */}
      <div
        className={`orders-overlay${mobileOpen ? ' visible' : ''}`}
        onClick={() => setMobileOpen(false)}
      />

      <style>{`
        /* ── Contenedor raíz ────────────────────────────────── */
        .split-root {
          width: 100%;
          display: flex;
          flex: 1;
          min-height: 0;
          position: relative;
        }

        /* ── Desktop (≥768px) ───────────────────────────────── */
        @media (min-width: 768px) {
          .split-orders-col {
            width: 33%;
            min-width: 260px;
            max-width: 380px;
            flex-shrink: 0;
            border-right: 1px solid var(--gray-200);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            position: relative;
          }
          .split-home-col {
            flex: 1;
            min-width: 0;
            overflow-y: auto;   /* scroll independiente */
            overflow-x: hidden;
            position: relative;
          }
          /* DriverHome ocupa toda la altura sin scroll externo */
          .split-home-col:has(.driver-map-root) {
            overflow: hidden;
          }
          /* En desktop, el drawer y el overlay no se usan */
          .orders-drawer-wrap { display: none !important; }
          .orders-overlay     { display: none !important; }
        }

        /* ── Mobile (<768px) ────────────────────────────────── */
        @media (max-width: 767px) {
          /* Home ocupa todo */
          .split-orders-col { display: none; }
          .split-home-col   { flex: 1; min-width: 0; overflow: hidden; }

          /* Overlay */
          .orders-overlay {
            display: none;
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.35);
            z-index: 315;
            touch-action: none;
          }
          .orders-overlay.visible { display: block; }

          /* Drawer wrapper — se traslada junto al trigger */
          .orders-drawer-wrap {
            position: fixed;
            top: 0;
            right: 0;
            bottom: 0;
            width: 82vw;
            max-width: 360px;
            z-index: 320;
            transform: translateX(100%);
            transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
            display: flex;
          }
          .orders-drawer-wrap.open {
            transform: translateX(0);
          }

          /* Trigger: medio círculo pegado al borde izquierdo del drawer */
          .orders-tab-trigger {
            position: absolute;
            left: -28px;   /* sobresale a la izquierda del drawer */
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
            box-shadow: -2px 0 8px rgba(0,0,0,0.15);
            padding: 0;
            flex-shrink: 0;
            transition: background 0.2s;
          }
          .orders-drawer-wrap.open .orders-tab-trigger {
            background: var(--gray-500);
          }

          /* Contenido del drawer */
          .orders-drawer-inner {
            flex: 1;
            background: #fff;
            overflow-y: auto;
            padding: 0.75rem 1rem;
            padding-top: calc(56px + 0.75rem); /* header height */
            padding-bottom: calc(var(--nav-h-mobile) + 0.5rem);
            box-shadow: -4px 0 24px rgba(0,0,0,0.12);
            scrollbar-width: thin;
            scrollbar-color: var(--gray-200) transparent;
          }
        }
      `}</style>
    </div>
  );
}
