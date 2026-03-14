// usePullToRefresh.js  — o pegarlo directo en Layout
import { useEffect, useRef } from 'react';

const HEADER_ZONE   = 64;   // px desde arriba donde se puede INICIAR el gesto
const TRIGGER_DIST  = 72;   // px mínimos para ejecutar el reload
const MAX_PULL      = 110;  // px máximo de desplazamiento visual

export function usePullToRefresh(scrollContainerRef) {
  const startY      = useRef(null);
  const startScrollY = useRef(0);
  const pulling     = useRef(false);
  const indicatorRef = useRef(null);

  useEffect(() => {
    const el = scrollContainerRef?.current;
    if (!el) return;

    // Crear indicador visual si no existe
    let indicator = document.getElementById('ptr-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'ptr-indicator';
  indicator.style.cssText = `
  position: fixed;
  top: 0; left: 50%;
  transform: translateX(-50%) translateY(-100%);
  z-index: 9999;
  background: #fff;
  border-radius: 0 0 20px 20px;
  padding: 6px 18px 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.12);
  font-size: 0.78rem;
  font-weight: 700;
  color: #e3aaaa;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: transform 0.15s ease;
  pointer-events: none;
  `;
  indicator.innerHTML = `<span id="ptr-spinner">↓</span> <span id="ptr-label">Jala para recargar</span>`;
  document.body.appendChild(indicator);
    }
    indicatorRef.current = indicator;

    function onTouchStart(e) {
      const touch = e.touches[0];

      // ── CLAVE: solo iniciar si el touch empieza en la zona del header ──
      if (touch.clientY > HEADER_ZONE) return;

      // Solo si el scroll está en el tope
      if (el.scrollTop > 0) return;

      startY.current = touch.clientY;
      startScrollY.current = el.scrollTop;
      pulling.current = false;
    }

    function onTouchMove(e) {
      if (startY.current === null) return;
      const touch  = e.touches[0];
      const deltaY = touch.clientY - startY.current;

      // Solo hacia abajo y sin scroll previo
      if (deltaY <= 0 || el.scrollTop > 0) {
        startY.current = null;
        return;
      }

      pulling.current = true;
      const pull = Math.min(deltaY, MAX_PULL);
      const ratio = pull / TRIGGER_DIST;

      // Mover indicador
      const translateY = Math.min(pull * 0.6, 48);
      indicator.style.transform = `translateX(-50%) translateY(${translateY - 100}%)`;

      // Cambiar texto según umbral
      const label = indicator.querySelector('#ptr-label');
      const spinner = indicator.querySelector('#ptr-spinner');
      if (pull >= TRIGGER_DIST) {
        label.textContent = 'Suelta para recargar';
        spinner.textContent = '↺';
      } else {
        label.textContent = 'Jala para recargar';
        spinner.textContent = '↓';
      }

      // Prevenir scroll nativo solo si estamos jalando activamente
      if (deltaY > 8) e.preventDefault();
    }

    function onTouchEnd(e) {
      if (startY.current === null || !pulling.current) {
        startY.current = null;
        return;
      }

      const touch  = e.changedTouches[0];
      const deltaY = touch.clientY - startY.current;

      // Resetear indicador
      indicator.style.transform = `translateX(-50%) translateY(-100%)`;
      startY.current = null;
      pulling.current = false;

      // Ejecutar reload si superó el umbral
      if (deltaY >= TRIGGER_DIST) {
        window.location.reload();
      }
    }

    el.addEventListener('touchstart',  onTouchStart, { passive: true });
    el.addEventListener('touchmove',   onTouchMove,  { passive: false });
    el.addEventListener('touchend',    onTouchEnd,   { passive: true });

    return () => {
      el.removeEventListener('touchstart',  onTouchStart);
      el.removeEventListener('touchmove',   onTouchMove);
      el.removeEventListener('touchend',    onTouchEnd);
    };
  }, [scrollContainerRef]);
}
