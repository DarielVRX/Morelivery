import { useEffect, useRef, useState } from 'react';
import { IconMap, IconPin } from './icons.jsx';

const STADIA_KEY  = import.meta.env?.VITE_STADIA_KEY || '';
const STYLE_LIGHT = STADIA_KEY
  ? `https://tiles.stadiamaps.com/styles/alidade_smooth.json?api_key=${STADIA_KEY}`
  : 'https://tiles.openfreemap.org/styles/bright';
const STYLE_DARK  = STADIA_KEY
  ? `https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json?api_key=${STADIA_KEY}`
  : 'https://tiles.openfreemap.org/styles/bright';

async function nominatimReverse(lat, lng) {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&countrycodes=mx&accept-language=es`,
      { headers: { 'Accept-Language': 'es', 'User-Agent': 'Morelivery/1.0' } }
    );
    const data = await response.json();
    const address = data.address || {};
    const parts = [address.road, address.house_number, address.suburb || address.neighbourhood, address.city || 'Morelia'].filter(Boolean);
    return parts.join(', ') || data.display_name?.split(',').slice(0, 3).join(',') || null;
  } catch (_) {
    return null;
  }
}

export default function AddressSearchBar({ userPos, homeAddress, onSelectPos, onError }) {
  const [open, setOpen] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [pinPlaced, setPinPlaced] = useState(false);
  const [inputVal, setInputVal] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef(null);
  const wrapRef = useRef(null);
  const mapContRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const pendingPos = useRef(null);

  useEffect(() => {
    function handler(event) {
      if (wrapRef.current && !wrapRef.current.contains(event.target) && !showMap) {
        setOpen(false);
        setResults([]);
      }
    }

    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMap]);

  useEffect(() => {
    if (!showMap) return;

    let cancelled = false;

    async function init() {
      await new Promise((resolve) => setTimeout(resolve, 30));
      if (cancelled || !mapContRef.current) return;

      const { ensureMapLibreCSS, ensureMapLibreJS } = await import('../../../utils/mapLibre');
      ensureMapLibreCSS();
      const mapLibre = await ensureMapLibreJS();
      if (cancelled || !mapContRef.current) return;

      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const center = userPos ? [userPos.lng, userPos.lat] : [-101.195, 19.706];
      const map = new mapLibre.Map({
        container: mapContRef.current,
        style: isDark ? STYLE_DARK : STYLE_LIGHT,
        center,
        zoom: 14,
        attributionControl: false,
      });

      map.addControl(new mapLibre.NavigationControl({ showCompass: false }), 'top-right');
      map.once('load', () => {
        if (!STADIA_KEY && isDark && mapContRef.current) {
          mapContRef.current.style.filter = 'invert(1) hue-rotate(180deg) saturate(0.85) brightness(0.9)';
        }
        map.resize();
      });

      map.on('click', (event) => {
        if (cancelled) return;

        const pos = { lat: event.lngLat.lat, lng: event.lngLat.lng };
        pendingPos.current = pos;
        setPinPlaced(true);

        if (markerRef.current) {
          markerRef.current.setLngLat([pos.lng, pos.lat]);
          return;
        }

        const el = document.createElement('div');
        el.style.cssText = 'font-size:24px;line-height:1;filter:drop-shadow(0 2px 4px #0005)';
        el.textContent = '📍';
        markerRef.current = new mapLibre.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([pos.lng, pos.lat])
          .addTo(map);
      });

      mapRef.current = map;
    }

    init().catch(() => onError?.('No se pudo cargar el selector de mapa'));

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      markerRef.current = null;
      pendingPos.current = null;
      setPinPlaced(false);
    };
  }, [showMap, userPos, onError]);

  async function confirmMapPin() {
    const pos = pendingPos.current;
    if (!pos) return;
    const label = (await nominatimReverse(pos.lat, pos.lng)) || `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`;
    onSelectPos({ ...pos, label });
    setShowMap(false);
    setOpen(false);
    setResults([]);
    setInputVal('');
  }

  function doSearch(value) {
    clearTimeout(debounceRef.current);
    if (!value.trim()) {
      setResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(`${value}, Morelia, Michoacán`)}&format=json&addressdetails=1&limit=6&countrycodes=mx&accept-language=es&viewbox=-101.5,19.9,-100.9,19.5&bounded=1`;
        const response = await fetch(url, { headers: { 'Accept-Language': 'es', 'User-Agent': 'Morelivery/1.0' } });
        const data = await response.json();
        const items = (data || []).map((item) => {
          const address = item.address || {};
          const parts = [address.road, address.house_number, address.suburb || address.neighbourhood, address.city || 'Morelia'].filter(Boolean);
          return {
            label: parts.join(', ') || item.display_name?.split(',').slice(0, 3).join(',') || 'Sin nombre',
            lat: Number(item.lat),
            lng: Number(item.lon),
          };
        }).filter((item) => item.lat && item.lng);
        setResults(items);
      } catch (_) {
        setResults([]);
        onError?.('No se pudo buscar la dirección');
      } finally {
        setSearching(false);
      }
    }, 400);
  }

  function selectGPS() {
    if (userPos) onSelectPos({ lat: userPos.lat, lng: userPos.lng, label: 'Ubicación actual' });
    setOpen(false);
    setResults([]);
    setInputVal('');
  }

  function selectHome() {
    if (homeAddress) onSelectPos({ label: homeAddress, preset: 'home' });
    setOpen(false);
    setResults([]);
    setInputVal('');
  }

  const hasHome = Boolean(homeAddress);

  return (
    <div ref={wrapRef} style={{ position:'relative' }}>
      {!open && !showMap && (
        <button onClick={() => setOpen(true)} title="Ubicación de entrega" style={{ background:'rgba(255,255,255,0.15)', border:'1px solid rgba(255,255,255,0.3)', borderRadius:8, width:32, height:32, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', flexShrink:0, minHeight:'unset', padding:0 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>
        </button>
      )}

      {open && !showMap && (
        <div style={{ display:'flex', alignItems:'center', gap:'4px', background:'rgba(255,255,255,0.15)', border:'1px solid rgba(255,255,255,0.35)', borderRadius:10, padding:'4px 6px', minWidth:240 }}>
          <button onClick={selectGPS} title="Ubicación actual" disabled={!userPos} style={{ background:'none', border:'none', cursor: userPos ? 'pointer' : 'default', padding:'4px', borderRadius:6, display:'flex', alignItems:'center', opacity: userPos ? 1 : 0.4, minHeight:'unset', flexShrink:0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4.5"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="4.22" y1="4.22" x2="6.34" y2="6.34"/><line x1="17.66" y1="17.66" x2="19.78" y2="19.78"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><line x1="4.22" y1="19.78" x2="6.34" y2="17.66"/><line x1="17.66" y1="6.34" x2="19.78" y2="4.22"/></svg>
          </button>
          <input autoFocus value={inputVal} onChange={(event) => { setInputVal(event.target.value); doSearch(event.target.value); }} placeholder="Buscar dirección…" style={{ flex:1, background:'none', border:'none', outline:'none', color:'#fff', fontSize:'13px', minWidth:0 }} />
          {searching && <span style={{ fontSize:'11px', color:'rgba(255,255,255,0.6)', flexShrink:0 }}>…</span>}
          <button onClick={() => { setShowMap(true); setOpen(false); }} title="Elegir en mapa" style={{ background:'rgba(255,255,255,0.2)', border:'none', cursor:'pointer', padding:'3px 5px', borderRadius:5, minHeight:'unset', flexShrink:0, color:'rgba(255,255,255,0.9)' }}><IconMap /></button>
          {hasHome && (
            <button onClick={selectHome} title="Casa" style={{ background:'none', border:'none', cursor:'pointer', padding:'4px', borderRadius:6, display:'flex', alignItems:'center', minHeight:'unset', flexShrink:0 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H5a1 1 0 01-1-1V9.5z"/><polyline points="9 21 9 12 15 12 15 21"/></svg>
            </button>
          )}
          <button onClick={() => { setOpen(false); setResults([]); setInputVal(''); }} style={{ background:'none', border:'none', cursor:'pointer', color:'rgba(255,255,255,0.7)', fontSize:'13px', padding:'2px 4px', minHeight:'unset', flexShrink:0 }}>✕</button>
        </div>
      )}

      {open && !showMap && (results.length > 0 || searching) && (
        <div style={{ position:'absolute', top:'calc(100% + 4px)', right:0, left: hasHome ? 'auto' : 0, minWidth:260, background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:10, boxShadow:'0 8px 24px rgba(0,0,0,0.18)', zIndex:100, overflow:'hidden' }}>
          {searching && <div style={{ padding:'0.6rem 0.875rem', fontSize:'0.8rem', color:'var(--text-tertiary)' }}>Buscando…</div>}
          {results.map((item, index) => (
            <button key={`${item.label}-${index}`} onClick={() => { onSelectPos(item); setOpen(false); setResults([]); setInputVal(''); }} style={{ width:'100%', textAlign:'left', background:'none', border:'none', borderBottom: index < results.length - 1 ? '1px solid var(--border-light)' : 'none', padding:'0.55rem 0.875rem', cursor:'pointer', fontSize:'0.82rem', color:'var(--text-primary)', display:'block', minHeight:'unset' }}>
              <span style={{display:'inline-flex',alignItems:'center',gap:'0.35rem'}}><IconPin />{item.label}</span>
            </button>
          ))}
        </div>
      )}

      {showMap && (
        <div style={{ position:'fixed', inset:0, zIndex:1000, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center' }} onClick={(event) => { if (event.target === event.currentTarget) setShowMap(false); }}>
          <div className="addr-map-modal">
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0.75rem 1rem', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
              <span style={{ fontWeight:700, fontSize:'0.95rem', display:'flex', alignItems:'center', gap:'0.4rem' }}><IconPin />Elige tu ubicación</span>
              <button onClick={() => setShowMap(false)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'1.1rem', color:'var(--text-tertiary)', minHeight:'unset', padding:'2px 6px' }}>✕</button>
            </div>
            <div ref={mapContRef} style={{ flex:1, width:'100%', minHeight:0 }} />
            <div style={{ display:'flex', gap:'0.5rem', padding:'0.75rem 1rem', borderTop:'1px solid var(--border)', background:'var(--bg-card)', flexShrink:0 }}>
              <span style={{ flex:1, fontSize:'0.78rem', color:'var(--text-tertiary)', alignSelf:'center' }}>
                {pinPlaced ? <span style={{display:'inline-flex',alignItems:'center',gap:'0.3rem'}}><IconPin />Pin colocado — confirma o muévelo</span> : 'Toca el mapa para colocar un pin'}
              </span>
              <button onClick={confirmMapPin} disabled={!pinPlaced} className="btn-primary btn-sm" style={{ opacity: pinPlaced ? 1 : 0.45 }}>Confirmar</button>
              <button onClick={() => setShowMap(false)} className="btn-sm">Cancelar</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .addr-map-modal { background: var(--bg-card); display: flex; flex-direction: column; width: 100%; height: 100dvh; }
        @media (min-width: 520px) {
          .addr-map-modal { width: 500px; height: 70dvh; max-height: 600px; border-radius: 12px; }
        }
      `}</style>
    </div>
  );
}
