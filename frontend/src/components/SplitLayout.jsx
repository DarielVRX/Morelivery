// frontend/src/components/SplitLayout.jsx
import { useEffect, useState } from 'react';

export default function SplitLayout({ homeContent, ordersContent }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  return (
    <div className="split-root">

      {/* ── Desktop: columna órdenes sticky ──────────────────────────── */}
      <aside className="split-orders-col">
        {ordersContent}
      </aside>

      {/* ── Desktop: columna principal ────────────────────────────────── */}
      <section className="split-home-col">
        {homeContent}
      </section>

      {/* ── Mobile: botón tab fijo ────────────────────────────────────── */}
      <button
        className={`orders-tab-trigger${mobileOpen ? ' open' : ''}`}
        onClick={() => setMobileOpen(v => !v)}
        aria-label={mobileOpen ? 'Cerrar pedidos' : 'Ver pedidos'}
        style={{ right: mobileOpen ? 'min(85vw, 360px)' : 0,
                 transition:'right 0.28s cubic-bezier(0.4,0,0.2,1), background 0.2s' }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points={mobileOpen ? '15 18 9 12 15 6' : '9 18 15 12 9 6'}/>
        </svg>
      </button>

      {/* ── Mobile: drawer ────────────────────────────────────────────── */}
      <div className={`orders-drawer-wrap${mobileOpen ? ' open' : ''}`}>
        <div className="orders-drawer-inner">
          {ordersContent}
        </div>
      </div>

      {/* Overlay */}
      <div
        className={`orders-overlay${mobileOpen ? ' visible' : ''}`}
        onClick={() => setMobileOpen(false)}
      />

      <style>{`
        /* ── Raíz ────────────────────────────────────────────── */
        .split-root {
          display: flex;
          width: 100%;
          flex: 1;
          min-height: 0;
          position: relative;
        }

        /* ════════════ Desktop ≥768px ════════════════════════ */
        @media (min-width: 768px) {

          /* Columna Orders: sticky a la izquierda, alto total, scrollea sola */
          .split-orders-col {
            position: sticky;
            top: 0;
            align-self: flex-start;
            width: 33%;
            min-width: 260px;
            max-width: 380px;
            height: 100vh;            /* toda la pantalla */
            flex-shrink: 0;
            display: flex;
            flex-direction: column;
            border-right: 1px solid var(--gray-200);
            background: #fff;
            overflow: hidden;         /* el Orders interno maneja su scroll */
          }

          /* Columna Home: scrollea independientemente */
          .split-home-col {
            flex: 1;
            min-width: 0;
            min-height: 100vh;        /* mínimo viewport */
            overflow-y: auto;
            overflow-x: hidden;
          }

          /* DriverHome necesita altura fija sin scroll externo */
          .split-home-col:has(.driver-map-root) {
            height: 100vh;
            overflow: hidden;
          }

          /* Ocultar elementos mobile */
          .orders-drawer-wrap { display: none !important; }
          .orders-overlay     { display: none !important; }
          .orders-tab-trigger { display: none !important; }
        }

        /* ════════════ Mobile <768px ═════════════════════════ */
        @media (max-width: 767px) {

          .split-orders-col { display: none; }

          .split-home-col {
            flex: 1;
            min-width: 0;
            overflow-x: hidden;
          }

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

          /* Drawer */
          .orders-drawer-wrap {
            position: fixed;
            top: 0;
            right: 0;
            bottom: 0;
            width: 85vw;
            max-width: 360px;
            z-index: 320;
            transform: translateX(100%);
            transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
          }
          .orders-drawer-wrap.open {
            transform: translateX(0);
          }

          /* Botón tab: media luna fija en el borde derecho */
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
            /* Solo transicionar background — right se mueve via JS inline style */
            transition: background 0.2s;
          }
          .orders-tab-trigger.open {
            background: var(--gray-500);
          }

          /* Interior del drawer */
          .orders-drawer-inner {
            height: 100%;
            background: #fff;
            display: flex;
            flex-direction: column;
            overflow: hidden;          /* el Orders interno maneja su scroll */
            box-shadow: -4px 0 24px rgba(0,0,0,0.14);
          }
        }
      `}</style>
    </div>
  );
}
