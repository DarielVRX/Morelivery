import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';

const STADIA_KEY = import.meta.env?.VITE_STADIA_KEY || '';
const STYLE_LIGHT = STADIA_KEY ? `https://tiles.stadiamaps.com/styles/alidade_smooth.json?api_key=${STADIA_KEY}` : 'https://tiles.openfreemap.org/styles/bright';
const STYLE_DARK = STADIA_KEY ? `https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json?api_key=${STADIA_KEY}` : 'https://tiles.openfreemap.org/styles/bright';


async function nominatimReverse(lat, lng) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&countrycodes=mx&accept-language=es`,
      { headers: { 'Accept-Language': 'es', 'User-Agent': 'Morelivery/1.0' } }
    );
    const data = await r.json();
    const a = data.address || {};
    return {
      address: [a.road, a.house_number, a.suburb || a.neighbourhood, a.city || 'Morelia'].filter(Boolean).join(', ') || data.display_name?.split(',').slice(0,3).join(',') || '',
      colonia:    a.suburb || a.neighbourhood || a.quarter || '',
      ciudad:     a.city || a.town || a.municipality || 'Morelia',
      estado:     a.state || 'Michoacán',
    };
  } catch { return null; }
}

export function CPSearchBar({ token, onSelectAddress }) {
  const [showMap, setShowMap] = useState(false);
  const [pinPlaced, setPinPlaced] = useState(false);
  const [cpVal, setCpVal] = useState('');
  const [colonias, setColonias] = useState([]);
  const [cpLoading, setCpLoading] = useState(false);
  const [cpError, setCpError] = useState('');
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsToast, setGpsToast] = useState(false);
  const [cpContext, setCpContext] = useState(null);
  const debounceRef = useRef(null);
  const wrapRef = useRef(null);
  const mapContRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const pendingPos = useRef(null);
  const lastCp = useRef('');
  const toastShownRef = useRef(false);

  useEffect(() => {
    if (toastShownRef.current) return;
    toastShownRef.current = true;
    const t1 = setTimeout(() => setGpsToast(true), 500);
    const t2 = setTimeout(() => setGpsToast(false), 4200);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  useEffect(() => {
    if (!showMap) return;
    let cancelled = false;
    async function init() {
      await new Promise(r => setTimeout(r, 30));
      if (cancelled || !mapContRef.current) return;
      const { ensureMapLibreCSS, ensureMapLibreJS } = await import('../../utils/mapLibre');
      ensureMapLibreCSS();
      const ml = await ensureMapLibreJS();
      if (cancelled || !mapContRef.current) return;
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const map = new ml.Map({
        container: mapContRef.current,
        style: isDark ? STYLE_DARK : STYLE_LIGHT,
        center: [-101.195, 19.706],
        zoom: 13,
        attributionControl: false,
        maxBounds: [[-101.6, 19.5], [-100.8, 20.0]],
      });
      map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
      map.once('load', () => {
        if (!STADIA_KEY && isDark && mapContRef.current) mapContRef.current.style.filter = 'invert(1) hue-rotate(180deg) saturate(0.85) brightness(0.9)';
        map.resize();
      });
      map.on('click', e => {
        if (cancelled) return;
        const pos = { lat: e.lngLat.lat, lng: e.lngLat.lng };
        pendingPos.current = pos;
        setPinPlaced(true);
        if (markerRef.current) markerRef.current.setLngLat([pos.lng, pos.lat]);
        else {
          const el = document.createElement('div');
          el.style.cssText = 'font-size:24px;line-height:1;filter:drop-shadow(0 2px 4px #0005)';
          el.textContent = '📍';
          markerRef.current = new ml.Marker({ element: el, anchor: 'bottom' }).setLngLat([pos.lng, pos.lat]).addTo(map);
        }
      });
      mapRef.current = map;
    }
    init().catch(() => {});
    return () => {
      cancelled = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      markerRef.current = null;
      pendingPos.current = null;
      setPinPlaced(false);
    };
  }, [showMap]);

  async function confirmMapPin() {
    const pos = pendingPos.current;
    if (!pos) return;
    const geo = await nominatimReverse(pos.lat, pos.lng);
    onSelectAddress({
      lat:        pos.lat,
      lng:        pos.lng,
      address:    geo?.address || '',
      colonia:    geo?.colonia || '',
      ciudad:     geo?.ciudad || '',
      estado:     geo?.estado || '',
    });
    setShowMap(false);
  }

  function handleCpChange(val) {
    const cp = val.replace(/\D/g, '').slice(0, 5);
    setCpVal(cp);
    setCpError('');
    if (cp.length !== 5) { setColonias([]); setCpContext(null); return; }
    if (cp === lastCp.current) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setCpLoading(true);
      try {
        const result = await apiFetch(`/auth/postal/${cp}`, {}, token);
        lastCp.current = cp;
        if (!result || !result.colonias?.length) {
          setCpError('CP no encontrado');
          setColonias([]); setCpContext(null);
        } else {
          setColonias(result.colonias);
          setCpContext({ estado: result.estado || '', ciudad: result.ciudad || '' });
          setCpError('');
        }
      } catch {
        setCpError('Error al buscar el CP');
        setColonias([]); setCpContext(null);
      } finally { setCpLoading(false); }
    }, 600);
  }

  function selectColonia(colonia) {
    onSelectAddress({ estado: cpContext?.estado || '', ciudad: cpContext?.ciudad || '', colonia, postalCode: cpVal });
    setColonias([]);
  }

  function selectGPS() {
    setGpsLoading(true);
    navigator.geolocation?.getCurrentPosition(pos => {
      onSelectAddress({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      setGpsLoading(false);
    }, () => setGpsLoading(false), { timeout: 6000, maximumAge: 30000 });
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      {gpsToast && <div style={{ position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, right: 0, zIndex: 300, background: 'var(--brand)', color: '#fff', borderRadius: 8, padding: '0.5rem 0.75rem', fontSize: '0.78rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem', boxShadow: '0 4px 16px rgba(0,0,0,0.18)' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>La ubicación por GPS es la más precisa para entregas</div>}
      <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-sunken)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        <button type="button" onClick={selectGPS} disabled={gpsLoading} title="Usar mi ubicación GPS — más precisa" style={{ background: 'var(--brand-light)', border: 'none', borderRight: '1px solid var(--border)', cursor: gpsLoading ? 'default' : 'pointer', padding: '6px 8px', display: 'flex', alignItems: 'center', opacity: gpsLoading ? 0.5 : 1, minHeight: 'unset', flexShrink: 0, color: 'var(--brand)' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg></button>
        <input value={cpVal} inputMode="numeric" maxLength={5} onChange={e => handleCpChange(e.target.value)} placeholder="Código postal…" style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: '13px', minWidth: 0, padding: '6px 8px' }} />
        {cpLoading && <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', flexShrink: 0, paddingRight: '4px' }}>…</span>}
        <button type="button" onClick={() => setShowMap(true)} title="Elegir en mapa" style={{ background: 'var(--bg-raised)', border: 'none', borderLeft: '1px solid var(--border)', cursor: 'pointer', padding: '6px 8px', minHeight: 'unset', flexShrink: 0, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center' }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg></button>
      </div>
      {cpError && <span style={{ fontSize: '0.72rem', color: 'var(--error)', marginTop: '0.25rem', display: 'block' }}>{cpError}</span>}
      {colonias.length > 0 && <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', zIndex: 200, overflow: 'hidden', maxHeight: 200, overflowY: 'auto' }}>{cpContext && <div style={{ padding: '0.35rem 0.875rem', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border-light)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{[cpContext.ciudad, cpContext.estado].filter(Boolean).join(', ')}</div>}{colonias.map((col, i) => <button type="button" key={i} onClick={() => selectColonia(col)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', borderBottom: i < colonias.length - 1 ? '1px solid var(--border-light)' : 'none', padding: '0.5rem 0.875rem', cursor: 'pointer', fontSize: '0.82rem', color: 'var(--text-primary)', display: 'block', minHeight: 'unset' }}><span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>{col}</span></button>)}</div>}
      {showMap && <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={e => { if (e.target === e.currentTarget) setShowMap(false); }}><style>{`.addr-map-modal { background: var(--bg-card); display: flex; flex-direction: column; width: 100%; height: 100dvh; } @media (min-width: 520px) { .addr-map-modal { width: 500px; height: 70dvh; max-height: 600px; border-radius: 12px; } }`}</style><div className="addr-map-modal"><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', flexShrink: 0 }}><span style={{ fontWeight: 700, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>Elige tu ubicación</span><button type="button" onClick={() => setShowMap(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: 'var(--text-tertiary)', minHeight: 'unset', padding: '2px 6px' }}>✕</button></div><div ref={mapContRef} style={{ flex: 1, width: '100%', minHeight: 0 }} /><div style={{ display: 'flex', gap: '0.5rem', padding: '0.75rem 1rem', borderTop: '1px solid var(--border)', background: 'var(--bg-card)', flexShrink: 0 }}><span style={{ flex: 1, fontSize: '0.78rem', color: 'var(--text-tertiary)', alignSelf: 'center' }}>{pinPlaced ? <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>📍 Pin colocado — confirma o muévelo</span> : 'Toca el mapa para colocar un pin'}</span><button type="button" onClick={confirmMapPin} disabled={!pinPlaced} className="btn-primary btn-sm" style={{ opacity: pinPlaced ? 1 : 0.45 }}>Confirmar</button><button type="button" onClick={() => setShowMap(false)} className="btn-sm">Cancelar</button></div></div></div>}
    </div>
  );
}

export function Collapsible({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const [wasOpened, setWasOpened] = useState(defaultOpen);
  function toggleOpen() {
    setOpen(prev => { const next = !prev; if (next) setWasOpened(true); return next; });
  }
  return <div className="card" style={{ marginBottom: '0.75rem', padding: 0, overflow: 'hidden' }}><button onClick={toggleOpen} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.85rem 1rem', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.9rem', color: 'var(--gray-800)', borderBottom: open ? '1px solid var(--gray-200)' : 'none' }}><span>{title}</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}><path d="M6 9l6 6 6-6"/></svg></button>{(open || wasOpened) && <div style={{ padding: open ? '1rem' : 0, display: open ? 'block' : 'none' }}>{children}</div>}</div>;
}

export function Flash({ text, isError }) {
  if (!text) return null;
  return <p className={`flash ${isError ? 'flash-error' : 'flash-ok'}`} style={{ marginTop: '0.5rem' }}>{text}</p>;
}

export const ROLE_LABELS = { customer: 'Cliente', restaurant: 'Tienda', driver: 'Conductor', admin: 'Administrador' };
