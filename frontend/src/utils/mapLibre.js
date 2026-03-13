// utils/mapLibre.js — carga dinámica de MapLibre GL JS/CSS
// OPT-4: _ml vive en el módulo — sin Promise.resolve() en cada tick GPS

const ML_VERSION = '4.7.1';
const ML_BASE    = `https://unpkg.com/maplibre-gl@${ML_VERSION}/dist/maplibre-gl`;

// Referencia resuelta compartida entre todos los importadores
export let _ml = null;

export function ensureMapLibreCSS() {
  if (document.getElementById('maplibre-css')) return;
  const lnk = document.createElement('link');
  lnk.id   = 'maplibre-css';
  lnk.rel  = 'stylesheet';
  lnk.href = `${ML_BASE}.css`;
  document.head.appendChild(lnk);
}

export function ensureMapLibreJS() {
  if (_ml) return Promise.resolve(_ml);
  if (window.maplibregl) { _ml = window.maplibregl; return Promise.resolve(_ml); }
  if (window.__mlPromise) return window.__mlPromise;

  window.__mlPromise = new Promise((res, rej) => {
    const s    = document.createElement('script');
    s.src      = `${ML_BASE}.js`;
    s.async    = true;
    s.onload   = () => { _ml = window.maplibregl; res(_ml); };
    s.onerror  = () => rej(new Error('No se pudo cargar MapLibre GL JS'));
    document.head.appendChild(s);
  });
  return window.__mlPromise;
}
