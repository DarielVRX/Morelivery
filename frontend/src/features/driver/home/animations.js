export function ensureDriverHomeAnimations() {
  if (typeof document === 'undefined' || document.getElementById('dh-animations')) return;

  const style = document.createElement('style');
  style.id = 'dh-animations';
  style.textContent = `
  @keyframes dh-spin { to { transform: rotate(360deg); } }
  .dh-spinner { animation: dh-spin 0.75s linear infinite; transform-origin: 50% 50%; }
  .dh-ptr-indicator {
    position: absolute; top: 0; left: 50%;
    transform: translateX(-50%) translateY(-50px);
    will-change: transform; pointer-events: none;
  }
  .dh-ptr-indicator.pulling   { transition: none; }
  .dh-ptr-indicator.releasing { transition: transform 0.18s ease; }
  .dh-ptr-content             { will-change: transform; }
  .dh-ptr-content.releasing   { transition: transform 0.22s ease; }
  .dh-offer-panel { will-change: transform; transform: translateZ(0); }
  .dh-fab         { will-change: transform; }
  `;
  document.head.appendChild(style);
}
