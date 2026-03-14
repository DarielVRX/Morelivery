// components/PullToRefresh.jsx — componente genérico, sin conocimiento de pedidos
// OPT-1: SIN setState en touchMove — manipula DOM directamente con refs
// OPT-2: spinner con CSS animation puro, sin JS
// OPT-3: posición con transform:translateY, nunca con `top` animado

import { useEffect, useRef, useState } from 'react';

const PTR_THRESHOLD  = 72;
const PTR_RESISTANCE = 0.45;
const HEADER_ZONE    = 64; // px desde el top — solo iniciar el gesto aquí

export default function PullToRefresh({ children }) {
  const wrapRef      = useRef(null);
  const contentRef   = useRef(null);
  const indicatorRef = useRef(null);
  const arcRef       = useRef(null);
  const startYRef    = useRef(null);
  const pullRef      = useRef(0);
  const loadingRef   = useRef(false);
  const [loading, setLoading] = useState(false);

  function _getScrollTop() {
    const wrap = wrapRef.current;
    if (!wrap) return 0;
    // Buscar el primer hijo con scroll real
    for (const child of wrap.querySelectorAll('*')) {
      if (child.scrollTop > 0) return child.scrollTop;
    }
    return wrap.scrollTop ?? 0;
  }

  function _applyPull(px) {
    pullRef.current = px;
    const ind = indicatorRef.current, con = contentRef.current, arc = arcRef.current;
    if (!ind || !con) return;
    const indY = px > 4 ? Math.max(-36, px - 36) : -50;
    ind.style.transform = `translateX(-50%) translateY(${indY}px)`;
    con.style.transform = `translateY(${px}px)`;
    if (arc) {
      const p = Math.min(px / PTR_THRESHOLD, 1);
      arc.setAttribute('stroke-dasharray', `${p * 56.5} 56.5`);
      arc.style.transform = `rotate(${p * 270 - 90}deg)`;
    }
  }

  function _release() {
    const con = contentRef.current, ind = indicatorRef.current;
    ind?.classList.remove('pulling');
    ind?.classList.add('releasing');
    con?.classList.add('releasing');
    _applyPull(0);
    setTimeout(() => {
      ind?.classList.remove('releasing');
      con?.classList.remove('releasing');
    }, 250);
    if (arcRef.current) arcRef.current.setAttribute('stroke-dasharray', '0 56.5');
    pullRef.current = 0;
  }

  useEffect(() => {
    function onTouchStart(e) {
      if (loadingRef.current) return;
      // Solo iniciar si el dedo empieza en la zona del header
      if (e.touches[0].clientY > HEADER_ZONE) return;
      // Solo si el contenido está en el tope
      if (_getScrollTop() > 0) return;
      startYRef.current = e.touches[0].clientY;
      indicatorRef.current?.classList.add('pulling');
      contentRef.current?.classList.remove('releasing');
    }

    function onTouchMove(e) {
      if (startYRef.current == null || loadingRef.current) return;
      if (_getScrollTop() > 0) { startYRef.current = null; return; }
      const dy = e.touches[0].clientY - startYRef.current;
      if (dy <= 0) { if (pullRef.current > 0) _applyPull(0); return; }
      e.preventDefault();
      _applyPull(Math.min(dy * PTR_RESISTANCE, PTR_THRESHOLD + 20));
    }

    function onTouchEnd() {
      if (startYRef.current == null) return;
      startYRef.current = null;
      const shouldRefresh = pullRef.current >= PTR_THRESHOLD && !loadingRef.current;
      if (!shouldRefresh) { _release(); return; }
      loadingRef.current = true;
      setLoading(true);
      _release();
      window.location.reload();
    }

    // Escuchar en window para capturar touches que empiecen en el header
    window.addEventListener('touchstart',  onTouchStart, { passive: true });
    window.addEventListener('touchmove',   onTouchMove,  { passive: false });
    window.addEventListener('touchend',    onTouchEnd,   { passive: true });

    return () => {
      window.removeEventListener('touchstart',  onTouchStart);
      window.removeEventListener('touchmove',   onTouchMove);
      window.removeEventListener('touchend',    onTouchEnd);
    };
  }, []);

  return (
    <div ref={wrapRef} style={{ height:'100%', overflow:'hidden', position:'relative' }}>

      <div ref={indicatorRef} className="dh-ptr-indicator releasing">
        <div style={{ width:36, height:36, borderRadius:'50%', background:'#fff',
          boxShadow:'0 2px 12px rgba(0,0,0,0.18)', display:'flex',
          alignItems:'center', justifyContent:'center' }}>
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <circle cx="11" cy="11" r="9" stroke="#e5e7eb" strokeWidth="2.5"/>
            <circle ref={arcRef} cx="11" cy="11" r="9"
              stroke="var(--brand)" strokeWidth="2.5"
              strokeDasharray="0 56.5" strokeLinecap="round"
              style={{
                transformOrigin: '50% 50%',
                ...(loading ? { animation:'dh-spin 0.75s linear infinite' } : {}),
              }}
            />
          </svg>
        </div>
      </div>

      <div ref={contentRef} className="dh-ptr-content"
        style={{ height:'100%', display:'flex', flexDirection:'column' }}>
        {children}
      </div>
    </div>
  );
}
