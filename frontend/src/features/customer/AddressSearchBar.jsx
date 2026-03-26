// src/features/customer/AddressSearchBar.jsx
//
// Componente único para selección de dirección de entrega.
// Reemplaza los clones en:
//   - features/customer/home/AddressSearchBar.jsx
//   - features/customer/restaurant-page/components (AddressSearchBar inline)
//   - pages/Customer/Payments.jsx (AddressSearchBar inline)
//
// Props:
//   userPos      { lat, lng } | null   — posición GPS del usuario (para centrar mapa)
//   homeAddress  string | null         — dirección guardada en perfil (botón casa)
//   onSelectPos  ({ lat, lng, label }) — callback al seleccionar ubicación
//   onError      (msg: string) => void — callback opcional para errores
//   variant      'hero' | 'default'    — 'hero' usa estilos translúcidos para header
//                                        con fondo oscuro (Home/RestaurantPage),
//                                        'default' usa variables CSS normales (Payments)

import { useEffect, useRef, useState } from 'react';
import { nominatimReverse } from '../../utils/geocode';

const STADIA_KEY  = import.meta.env?.VITE_STADIA_KEY || '';
const STYLE_LIGHT = STADIA_KEY
  ? `https://tiles.stadiamaps.com/styles/alidade_smooth.json?api_key=${STADIA_KEY}`
  : 'https://tiles.openfreemap.org/styles/bright';
const STYLE_DARK  = STADIA_KEY
  ? `https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json?api_key=${STADIA_KEY}`
  : 'https://tiles.openfreemap.org/styles/bright';

function IconPin() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
      <circle cx="12" cy="9" r="2.5"/>
    </svg>
  );
}

function IconMap() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
      <line x1="8" y1="2" x2="8" y2="18"/>
      <line x1="16" y1="6" x2="16" y2="22"/>
    </svg>
  );
}

function IconGPS() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4.5"/>
      <line x1="12" y1="2" x2="12" y2="5"/>
      <line x1="12" y1="19" x2="12" y2="22"/>
      <line x1="4.22" y1="4.22" x2="6.34" y2="6.34"/>
      <line x1="17.66" y1="17.66" x2="19.78" y2="19.78"/>
      <line x1="2" y1="12" x2="5" y2="12"/>
      <line x1="19" y1="12" x2="22" y2="12"/>
      <line x1="4.22" y1="19.78" x2="6.34" y2="17.66"/>
      <line x1="17.66" y1="6.34" x2="19.78" y2="4.22"/>
    </svg>
  );
}

function IconHome() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H5a1 1 0 01-1-1V9.5z"/>
      <polyline points="9 21 9 12 15 12 15 21"/>
    </svg>
  );
}

// Tokens de color según variant
function useVariantTokens(variant) {
  const isHero = variant === 'hero';
  return {
    triggerBg:       isHero ? 'rgba(255,255,255,0.15)' : 'var(--brand-light)',
    triggerBorder:   isHero ? '1px solid rgba(255,255,255,0.3)' : '1px solid var(--brand)',
    triggerColor:    isHero ? 'rgba(255,255,255,0.9)' : 'var(--brand)',
    barBg:           isHero ? 'rgba(255,255,255,0.15)' : 'var(--bg-sunken)',
    barBorder:       isHero ? '1px solid rgba(255,255,255,0.35)' : '1px solid var(--border)',
    inputColor:      isHero ? '#fff' : 'var(--text-primary)',
    iconStroke:      isHero ? 'rgba(255,255,255,0.9)' : 'currentColor',
    loadingColor:    isHero ? 'rgba(255,255,255,0.6)' : 'var(--text-tertiary)',
    mapBtnBg:        isHero ? 'rgba(255,255,255,0.2)' : 'var(--bg-raised)',
    closeColor:      isHero ? 'rgba(255,255,255,0.7)' : 'var(--text-tertiary)',
  };
}

export default function AddressSearchBar({ userPos, homeAddress, homePos, onSelectPos, onError, variant = 'hero', initialPos }) {
  const [open,      setOpen]      = useState(false);
  const [showMap,   setShowMap]   = useState(false);
  const [pinPlaced, setPinPlaced] = useState(false);
  const [inputVal,  setInputVal]  = useState('');
  const [results,   setResults]   = useState([]);
  const [searching, setSearching] = useState(false);

  const debounceRef = useRef(null);
  const wrapRef     = useRef(null);
  const mapContRef  = useRef(null);
  const mapRef      = useRef(null);
  const markerRef   = useRef(null);
  const pendingPos  = useRef(null);

  const t = useVariantTokens(variant);
  const hasHome = Boolean(homeAddress);

  // Cerrar al click fuera
  useEffect(() => {
    function handler(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target) && !showMap) {
        setOpen(false);
        setResults([]);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMap]);

  // Inicializar mapa
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

      const isDark  = document.documentElement.getAttribute('data-theme') === 'dark';
      const center = initialPos?.lat ? [initialPos.lng, initialPos.lat]
      : userPos ? [userPos.lng, userPos.lat]
      : [-101.195, 19.706];

      const map = new ml.Map({
        container: mapContRef.current,
        style: isDark ? STYLE_DARK : STYLE_LIGHT,
        center,
        zoom: 14,
        attributionControl: false,
      });

      map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
      map.once('load', () => {
        if (!STADIA_KEY && isDark && mapContRef.current) {
          mapContRef.current.style.filter = 'invert(1) hue-rotate(180deg) saturate(0.85) brightness(0.9)';
        }
        map.resize();

        // Colocar pin inicial si existe
        if (initialPos?.lat && initialPos?.lng) {
          map.setCenter([initialPos.lng, initialPos.lat]);
          pendingPos.current = { lat: initialPos.lat, lng: initialPos.lng };
          setPinPlaced(true);
          const el = document.createElement('div');
          el.style.cssText = 'font-size:24px;line-height:1;filter:drop-shadow(0 2px 4px #0005)';
          el.textContent = '📍';
          markerRef.current = new ml.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([initialPos.lng, initialPos.lat])
          .addTo(map);
        }
      });

      map.on('click', e => {
        if (cancelled) return;
        const pos = { lat: e.lngLat.lat, lng: e.lngLat.lng };
        pendingPos.current = pos;
        setPinPlaced(true);
        if (markerRef.current) {
          markerRef.current.setLngLat([pos.lng, pos.lat]);
        } else {
          const el = document.createElement('div');
          el.style.cssText = 'font-size:24px;line-height:1;filter:drop-shadow(0 2px 4px #0005)';
          el.textContent = '📍';
          markerRef.current = new ml.Marker({ element: el, anchor: 'bottom' })
            .setLngLat([pos.lng, pos.lat])
            .addTo(map);
        }
      });

      mapRef.current = map;
    }

    init().catch(() => onError?.('No se pudo cargar el selector de mapa'));

    return () => {
      cancelled = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      markerRef.current = null;
      pendingPos.current = null;
      setPinPlaced(false);
    };
  }, [showMap, userPos, onError]);

  async function confirmMapPin() {
    const pos = pendingPos.current;
    if (!pos) return;
    const geo = await nominatimReverse(pos.lat, pos.lng);
    const label = geo?.label || `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`;
    onSelectPos({ ...pos, label });
    setShowMap(false);
    setOpen(false);
    setResults([]);
    setInputVal('');
  }

  function doSearch(val) {
    clearTimeout(debounceRef.current);
    if (!val.trim()) { setResults([]); setSearching(false); return; }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(val + ', Morelia, Michoacán')}&format=json&addressdetails=1&limit=6&countrycodes=mx&accept-language=es&viewbox=-101.5,19.9,-100.9,19.5&bounded=1`;
        const r    = await fetch(url, { headers: { 'Accept-Language': 'es', 'User-Agent': 'Morelivery/1.0' } });
        const data = await r.json();
        const items = (data || []).map(item => {
          const a     = item.address || {};
          const col   = a.suburb || a.neighbourhood || a.village || '';
          const city  = a.city || a.county || 'Morelia';
          const parts = [a.road, a.house_number, col, city].filter(Boolean);
          return {
            label: parts.join(', ') || item.display_name?.split(',').slice(0, 3).join(',') || 'Sin nombre',
            lat:   Number(item.lat),
            lng:   Number(item.lon),
          };
        }).filter(i => i.lat && i.lng);
        setResults(items);
      } catch {
        setResults([]);
        onError?.('No se pudo buscar la dirección');
      } finally {
        setSearching(false);
      }
    }, 400);
  }

  async function selectGPS() {
    if (!userPos) return;
    const geo = await nominatimReverse(userPos.lat, userPos.lng);
    const label = geo?.label || 'Ubicación actual';
    onSelectPos({ lat: userPos.lat, lng: userPos.lng, label });
    setOpen(false);
    setResults([]);
    setInputVal('');
  }

  function selectHome() {
    if (!homeAddress) return;
    // Incluir coords de casa si están disponibles
    const lat = homePos?.lat != null ? Number(homePos.lat) : null;
    const lng = homePos?.lng != null ? Number(homePos.lng) : null;
    const pos = (Number.isFinite(lat) && Number.isFinite(lng))
      ? { label: homeAddress, lat, lng }
      : { label: homeAddress, preset: 'home' };
    onSelectPos(pos);
    setOpen(false);
    setResults([]);
    setInputVal('');
  }

  function close() {
    setOpen(false);
    setResults([]);
    setInputVal('');
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>

      {/* Botón trigger — cerrado */}
      {!open && !showMap && (
        <button
          onClick={() => setOpen(true)}
          title="Ubicación de entrega"
          style={{
            background:   t.triggerBg,
            border:       t.triggerBorder,
            borderRadius: 8,
            width:  32,
            height: 32,
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            cursor:      'pointer',
            flexShrink:  0,
            minHeight:   'unset',
            padding:     0,
            color:       t.triggerColor,
          }}
        >
          <IconPin />
        </button>
      )}

      {/* Barra de búsqueda — abierta */}
      {open && !showMap && (
        <div style={{
          display:     'flex',
          alignItems:  'center',
          gap:         '4px',
          background:  t.barBg,
          border:      t.barBorder,
          borderRadius: 10,
          padding:     '4px 6px',
          minWidth:    240,
        }}>
          {/* GPS */}
          <button
            onClick={selectGPS}
            title="Ubicación actual"
            disabled={!userPos}
            style={{
              background: 'none', border: 'none',
              cursor:   userPos ? 'pointer' : 'default',
              padding:  '4px',
              borderRadius: 6,
              display:  'flex',
              alignItems: 'center',
              opacity:  userPos ? 1 : 0.4,
              minHeight: 'unset',
              flexShrink: 0,
              color:    t.iconStroke,
            }}
          >
            <IconGPS />
          </button>

          {/* Input texto */}
          <input
            autoFocus
            value={inputVal}
            onChange={e => { setInputVal(e.target.value); doSearch(e.target.value); }}
            placeholder="Buscar dirección…"
            style={{
              flex:       1,
              background: 'none',
              border:     'none',
              outline:    'none',
              color:      t.inputColor,
              fontSize:   '13px',
              minWidth:   0,
            }}
          />

          {searching && (
            <span style={{ fontSize: '11px', color: t.loadingColor, flexShrink: 0 }}>…</span>
          )}

          {/* Mapa */}
          <button
            onClick={() => { setShowMap(true); setOpen(false); }}
            title="Elegir en mapa"
            style={{
              background:   t.mapBtnBg,
              border:       'none',
              cursor:       'pointer',
              padding:      '3px 5px',
              borderRadius: 5,
              minHeight:    'unset',
              flexShrink:   0,
              color:        t.iconStroke,
              display:      'flex',
              alignItems:   'center',
            }}
          >
            <IconMap />
          </button>

          {/* Casa */}
          {hasHome && (
            <button
              onClick={selectHome}
              title="Casa"
              style={{
                background: 'none', border: 'none',
                cursor: 'pointer', padding: '4px',
                borderRadius: 6, display: 'flex',
                alignItems: 'center', minHeight: 'unset', flexShrink: 0,
                color: t.iconStroke,
              }}
            >
              <IconHome />
            </button>
          )}

          {/* Cerrar */}
          <button
            onClick={close}
            style={{
              background: 'none', border: 'none',
              cursor: 'pointer', color: t.closeColor,
              fontSize: '13px', padding: '2px 4px',
              minHeight: 'unset', flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Dropdown resultados */}
      {open && !showMap && (results.length > 0 || searching) && (
        <div style={{
          position:     'absolute',
          top:          'calc(100% + 4px)',
          right:        0,
          left:         hasHome ? 'auto' : 0,
          minWidth:     260,
          background:   'var(--bg-card)',
          border:       '1px solid var(--border)',
          borderRadius: 10,
          boxShadow:    '0 8px 24px rgba(0,0,0,0.18)',
          zIndex:       100,
          overflow:     'hidden',
        }}>
          {searching && (
            <div style={{ padding: '0.6rem 0.875rem', fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
              Buscando…
            </div>
          )}
          {results.map((item, i) => (
            <button
              key={`${item.label}-${i}`}
              onClick={() => { onSelectPos(item); close(); }}
              style={{
                width:        '100%',
                textAlign:    'left',
                background:   'none',
                border:       'none',
                borderBottom: i < results.length - 1 ? '1px solid var(--border-light)' : 'none',
                padding:      '0.55rem 0.875rem',
                cursor:       'pointer',
                fontSize:     '0.82rem',
                color:        'var(--text-primary)',
                display:      'block',
                minHeight:    'unset',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                <IconPin />{item.label}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Modal mapa */}
      {showMap && (
        <div
          style={{
            position:       'fixed',
            inset:          0,
            zIndex:         1000,
            background:     'rgba(0,0,0,0.5)',
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
          }}
          onClick={e => { if (e.target === e.currentTarget) setShowMap(false); }}
        >
          <div className="addr-map-modal">
            {/* Header */}
            <div style={{
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'space-between',
              padding:        '0.75rem 1rem',
              borderBottom:   '1px solid var(--border)',
              flexShrink:     0,
            }}>
              <span style={{ fontWeight: 700, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <IconPin />Elige tu ubicación
              </span>
              <button
                onClick={() => setShowMap(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: 'var(--text-tertiary)', minHeight: 'unset', padding: '2px 6px' }}
              >
                ✕
              </button>
            </div>

            {/* Mapa */}
            <div ref={mapContRef} style={{ flex: 1, width: '100%', minHeight: 0 }} />

            {/* Footer */}
            <div style={{
              display:     'flex',
              gap:         '0.5rem',
              padding:     '0.75rem 1rem',
              borderTop:   '1px solid var(--border)',
              background:  'var(--bg-card)',
              flexShrink:  0,
            }}>
              <span style={{ flex: 1, fontSize: '0.78rem', color: 'var(--text-tertiary)', alignSelf: 'center' }}>
                {pinPlaced
                  ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}><IconPin />Pin colocado — confirma o muévelo</span>
                  : 'Toca el mapa para colocar un pin'}
              </span>
              <button onClick={confirmMapPin} disabled={!pinPlaced} className="btn-primary btn-sm" style={{ opacity: pinPlaced ? 1 : 0.45 }}>
                Confirmar
              </button>
              <button onClick={() => setShowMap(false)} className="btn-sm">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .addr-map-modal {
          background: var(--bg-card);
          display: flex;
          flex-direction: column;
          width: 100%;
          height: 100dvh;
        }
        @media (min-width: 520px) {
          .addr-map-modal {
            width: 500px;
            height: 70dvh;
            max-height: 600px;
            border-radius: 12px;
          }
        }
      `}</style>
    </div>
  );
}
