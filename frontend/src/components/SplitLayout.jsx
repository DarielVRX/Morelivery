// frontend/src/components/SplitLayout.jsx
//
// Desktop: panel Orders (33%) a la izquierda, Home (66%) a la derecha.
// Mobile:  Home normal. Orders como panel lateral deslizable desde la derecha,
//          colapsado en un tab de medio círculo con flecha "›".
//
// Props:
//   homeContent   — ReactNode (el componente Home del rol)
//   ordersContent — ReactNode (el componente Orders del rol)
//   role          — string ('customer' | 'driver' | 'restaurant')

import { useEffect, useRef, useState } from 'react';

const PANEL_W_MOBILE = '82vw'; // ancho cuando está abierto en móvil

export default function SplitLayout({ homeContent, ordersContent }) {
  // Desktop: tab activo dentro del panel Orders (activos | historial)
  // Esto no se pasa como prop — lo manejamos aquí con un portal de contexto.
  // El panel Orders interno ya tiene su propio estado; solo necesitamos
  // el footer fijo con el botón de alternar.

  // Mobile: panel abierto o cerrado
  const [mobileOpen, setMobileOpen] = useState(false);

  // Cerrar con swipe o clic fuera
  const overlayRef = useRef(null);

  // Bloquear scroll del body cuando el panel mobile está abierto
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  return (
    <>
      {/* ── Desktop layout ─────────────────────────────────────────────── */}
      <div className="split-layout">
        {/* Panel izquierdo: Orders */}
        <aside className="split-orders">
          <div className="split-orders-inner">
            {ordersContent}
          </div>
        </aside>

        {/* Panel derecho: Home */}
        <section className="split-home">
          {homeContent}
        </section>
      </div>

      {/* ── Mobile tab de pedidos ──────────────────────────────────────── */}
      {/* Tab colapsado — medio círculo con flecha */}
      <button
        className={`orders-tab-trigger${mobileOpen ? ' open' : ''}`}
        onClick={() => setMobileOpen(v => !v)}
        aria-label={mobileOpen ? 'Cerrar pedidos' : 'Ver pedidos'}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: mobileOpen ? 'rotate(180deg)' : 'none', transition:'transform 0.25s' }}>
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </button>

      {/* Overlay oscuro */}
      {mobileOpen && (
        <div
          ref={overlayRef}
          className="orders-overlay"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Panel deslizable */}
      <div className={`orders-drawer${mobileOpen ? ' open' : ''}`}>
        <div className="orders-drawer-inner">
          {ordersContent}
        </div>
      </div>

      <style>{`
        /* ── Split desktop ──────────────────────────────────────────────── */
        .split-layout {
          display: none; /* oculto en móvil */
        }
        @media (min-width: 768px) {
          .split-layout {
            display: flex;
            gap: 0;
            width: 100%;
            min-height: 0;
            flex: 1;
          }
          .split-orders {
            width: 33%;
            min-width: 260px;
            max-width: 380px;
            border-right: 1px solid var(--gray-200);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            position: relative;
            flex-shrink: 0;
          }
          .split-orders-inner {
            flex: 1;
            overflow-y: auto;
            padding: 1rem 1rem 0;
            /* Scrollbar discreta */
            scrollbar-width: thin;
            scrollbar-color: var(--gray-200) transparent;
          }
          .split-home {
            flex: 1;
            min-width: 0;
            overflow-y: auto;
            padding: 1rem 1.5rem;
          }
        }

        /* ── Mobile: ocultar split, mostrar drawer ──────────────────────── */
        @media (max-width: 767px) {
          .split-layout {
            display: block; /* en mobile solo muestra el home */
          }
          .split-orders { display: none; }
          .split-home   { display: block; }

          /* Tab trigger — medio círculo pegado al borde derecho */
          .orders-tab-trigger {
            position: fixed;
            right: 0;
            top: 50%;
            transform: translateY(-50%);
            z-index: 310;
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
            box-shadow: -2px 0 8px rgba(0,0,0,0.12);
            padding: 0;
            transition: background 0.2s;
            /* ocultar cuando el drawer está abierto se maneja con .open */
          }
          .orders-tab-trigger.open {
            background: var(--gray-600);
          }

          /* Overlay */
          .orders-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.35);
            z-index: 315;
            touch-action: none;
          }

          /* Drawer */
          .orders-drawer {
            position: fixed;
            top: 0;
            right: 0;
            bottom: 0;
            width: ${PANEL_W_MOBILE};
            max-width: 360px;
            background: #fff;
            z-index: 320;
            transform: translateX(100%);
            transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
            display: flex;
            flex-direction: column;
            box-shadow: -4px 0 24px rgba(0,0,0,0.12);
            /* top padding para no solapar con el header */
            padding-top: 56px;
            /* bottom padding para nav móvil */
            padding-bottom: var(--nav-h-mobile);
          }
          .orders-drawer.open {
            transform: translateX(0);
          }
          .orders-drawer-inner {
            flex: 1;
            overflow-y: auto;
            padding: 0.75rem 1rem;
            scrollbar-width: thin;
            scrollbar-color: var(--gray-200) transparent;
          }
        }
      `}</style>
    </>
  );
}
