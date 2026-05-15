// frontend/src/features/admin/dashboard/AdminMap.jsx
import { useEffect, useRef, useState, useCallback } from 'react';
import { apiFetch } from '../../../api/client';

// Palette: [border, fill] — 8 distinct driver colors
const DRIVER_COLORS = [
  ['#2563eb', '#3b82f6'],
  ['#dc2626', '#ef4444'],
  ['#059669', '#10b981'],
  ['#d97706', '#f59e0b'],
  ['#7c3aed', '#8b5cf6'],
  ['#db2777', '#ec4899'],
  ['#0891b2', '#06b6d4'],
  ['#ea580c', '#f97316'],
];

function colorFor(index) {
  return DRIVER_COLORS[index % DRIVER_COLORS.length];
}

// SVG circle marker with border + fill
function makeDriverIcon(L, index, isSelected) {
  const [border, fill] = colorFor(index);
  const size = isSelected ? 28 : 22;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <circle cx="${size/2}" cy="${size/2}" r="${size/2 - 2}" fill="${fill}" stroke="${border}" stroke-width="${isSelected ? 3 : 2}"/>
    ${isSelected ? `<circle cx="${size/2}" cy="${size/2}" r="${size/4}" fill="white" opacity="0.7"/>` : ''}
  </svg>`;
  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [size, size],
    iconAnchor: [size/2, size/2],
  });
}

function makeStopIcon(L, type) {
  const color = type === 'pickup' ? '#f59e0b' : '#10b981';
  const symbol = type === 'pickup' ? '🏪' : '📍';
  return L.divIcon({
    html: `<div style="font-size:18px;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.4))">${symbol}</div>`,
    className: '',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

export default function AdminMap({ token }) {
  const containerRef   = useRef(null);
  const mapRef         = useRef(null);
  const markersRef     = useRef([]);
  const linesRef       = useRef([]);
  const [drivers, setDrivers] = useState([]);
  const [selected, setSelected] = useState(null); // driverId or null
  const [paused, setPaused] = useState(false);
  const intervalRef = useRef(null);

  const fetchData = useCallback(async () => {
    if (!token) return;
    try {
      const d = await apiFetch('/admin/map-data', {}, token);
      setDrivers(d.drivers || []);
      setPaused(Boolean(d.paused));
    } catch (_) {}
  }, [token]);

  // Init Leaflet map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // Ensure Leaflet CSS
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id   = 'leaflet-css';
      link.rel  = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }

    import('leaflet').then(({ default: L }) => {
      if (mapRef.current) return;
      const map = L.map(containerRef.current, { zoomControl: true }).setView([19.7060, -101.1949], 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19,
      }).addTo(map);
      mapRef.current = map;
      fetchData();
    });

    return () => {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Polling
  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(fetchData, 15000);
    return () => clearInterval(intervalRef.current);
  }, [fetchData]);

  // Render markers + lines on map whenever drivers or selection changes
  useEffect(() => {
    if (!mapRef.current) return;

    import('leaflet').then(({ default: L }) => {
      const map = mapRef.current;
      if (!map) return;

      // Clear previous
      markersRef.current.forEach(m => m.remove());
      linesRef.current.forEach(l => l.remove());
      markersRef.current = [];
      linesRef.current   = [];

      drivers.forEach((driver, idx) => {
        if (!Number.isFinite(driver.lat) || !Number.isFinite(driver.lng)) return;

        const isSelected = selected === driver.id;
        const [border]   = colorFor(idx);

        // Driver marker
        const marker = L.marker([driver.lat, driver.lng], {
          icon: makeDriverIcon(L, idx, isSelected),
          zIndexOffset: isSelected ? 1000 : 0,
        }).addTo(map);

        const name = driver.name || 'Driver';
        marker.bindTooltip(`${name}<br/>${driver.activeOrders} pedido(s)`, {
          permanent: false, direction: 'top',
        });
        marker.on('click', () => setSelected(prev => prev === driver.id ? null : driver.id));
        markersRef.current.push(marker);

        const stops = driver.stops || [];
        if (stops.length === 0) return;

        // Default (unselected): only draw line to next stop
        if (!isSelected) {
          const nextStop = stops[0];
          if (Number.isFinite(nextStop.lat) && Number.isFinite(nextStop.lng)) {
            const line = L.polyline(
              [[driver.lat, driver.lng], [nextStop.lat, nextStop.lng]],
              { color: border, weight: 2, opacity: 0.8, dashArray: null }
            ).addTo(map);
            linesRef.current.push(line);

            // Stop marker
            const sm = L.marker([nextStop.lat, nextStop.lng], {
              icon: makeStopIcon(L, nextStop.type),
            }).addTo(map);
            sm.bindTooltip(nextStop.label || nextStop.type, { direction: 'top' });
            markersRef.current.push(sm);
          }
          return;
        }

        // Selected driver: show full route
        const points = [{ lat: driver.lat, lng: driver.lng }, ...stops];
        for (let i = 0; i < points.length - 1; i++) {
          const from = points[i];
          const to   = points[i + 1];
          if (!Number.isFinite(to.lat) || !Number.isFinite(to.lng)) continue;
          const line = L.polyline(
            [[from.lat, from.lng], [to.lat, to.lng]],
            { color: border, weight: i === 0 ? 3 : 2, opacity: 0.9, dashArray: i === 0 ? null : '6,4' }
          ).addTo(map);
          linesRef.current.push(line);
        }

        stops.forEach(stop => {
          if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) return;
          const sm = L.marker([stop.lat, stop.lng], {
            icon: makeStopIcon(L, stop.type),
          }).addTo(map);
          sm.bindTooltip(stop.label || stop.type, { direction: 'top', permanent: false });
          markersRef.current.push(sm);
        });
      });
    });
  }, [drivers, selected]);

  const selectedDriver = selected ? drivers.find(d => d.id === selected) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-card)', flexShrink: 0,
      }}>
        <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>Mapa en vivo</span>
        {paused && (
          <span style={{
            fontSize: '0.72rem', fontWeight: 700, borderRadius: 6, padding: '2px 8px',
            background: '#fee2e2', color: '#dc2626', border: '1px solid #fca5a5',
          }}>⏸ Plataforma pausada</span>
        )}
        <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
          {drivers.length} driver(s) activo(s)
        </span>
        <button
          onClick={fetchData}
          style={{
            fontSize: '0.75rem', padding: '0.25rem 0.6rem',
            background: 'var(--bg-raised)', border: '1px solid var(--border)',
            borderRadius: 6, cursor: 'pointer',
          }}
        >↻</button>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Map */}
        <div ref={containerRef} style={{ flex: 1, minHeight: 0 }} />

        {/* Info panel — shown when driver selected */}
        {selectedDriver && (
          <div style={{
            width: 220, flexShrink: 0, overflowY: 'auto',
            borderLeft: '1px solid var(--border)',
            background: 'var(--bg-card)', padding: '0.75rem',
            fontSize: '0.82rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontWeight: 700 }}>{selectedDriver.name}</span>
              <button
                onClick={() => setSelected(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', color: 'var(--text-tertiary)' }}
              >✕</button>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginBottom: 8 }}>
              {selectedDriver.isAvailable
                ? <span style={{ color: 'var(--success)', fontWeight: 600 }}>● Disponible</span>
                : <span style={{ color: 'var(--text-tertiary)' }}>○ No disponible</span>
              }
              {' · '}{selectedDriver.activeOrders} pedido(s)
            </div>
            {selectedDriver.stops?.length > 0 ? (
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  RUTA ({selectedDriver.stops.length} stop(s))
                </div>
                {selectedDriver.stops.map((stop, i) => (
                  <div key={`${stop.orderId}-${stop.type}`} style={{
                    padding: '0.4rem 0',
                    borderBottom: i < selectedDriver.stops.length - 1 ? '1px solid var(--border-light)' : 'none',
                  }}>
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: stop.type === 'pickup' ? '#f59e0b' : '#10b981' }}>
                      {stop.type === 'pickup' ? '🏪 Pickup' : '📍 Entrega'}
                    </span>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                      {stop.label}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>Sin paradas activas</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
