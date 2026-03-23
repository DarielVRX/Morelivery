// components/AlertsPanel.jsx
// Panel de alertas con dos sub-pestañas: Zonas y Vialidad
// Chips de filtro multi-selección por tipo
// Al tocar una alerta: flyTo en el mapa via window.__map

const ZONE_COLORS = {
  traffic:      '#f97316',
  construction: '#eab308',
  accident:     '#ef4444',
  flood:        '#3b82f6',
  blocked:      '#8b5cf6',
  other:        '#6b7280',
};

const ZONE_LABELS = {
  traffic:      '🚦 Tráfico',
  construction: '🚧 Obra',
  accident:     '🚨 Accidente',
  flood:        '🌊 Inundación',
  blocked:      '⛔ Bloqueada',
  other:        '⚠️ Otro',
};

const ZONE_TYPES = ['traffic', 'construction', 'accident', 'flood', 'blocked', 'other'];

const IMP_COLORS = {
  pending:   '#f97316',
  confirmed: '#ef4444',
};

const IMP_LABELS = {
  days:      '~días',
  weeks:     '~semanas',
  months:    '~meses',
  permanent: 'Permanente',
};

import { useState } from 'react';

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function flyTo(lat, lng, onClose) {
  const map = window.__map;
  if (!map) return;
  map.flyTo({ center: [lng, lat], zoom: 16, pitch: 0, bearing: 0, duration: 600, essential: true });
  onClose?.();
}

// ── Sub-pestaña Zonas ─────────────────────────────────────────────────────────
function ZonesTab({ zones, onClose }) {
  const [activeFilters, setActiveFilters] = useState(new Set());

  function toggleFilter(type) {
    setActiveFilters(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  }

  const filtered = activeFilters.size === 0
    ? zones
    : zones.filter(z => activeFilters.has(z.type));

  // Solo mostrar chips de tipos que tienen al menos una zona
  const presentTypes = ZONE_TYPES.filter(t => zones.some(z => z.type === t));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Chips filtro */}
      {presentTypes.length > 0 && (
        <div style={{
          display: 'flex', gap: 6, flexWrap: 'wrap',
          padding: '0.5rem 0.75rem 0.25rem',
          borderBottom: '1px solid var(--border-light)',
        }}>
          {presentTypes.map(t => {
            const active = activeFilters.has(t);
            const color  = ZONE_COLORS[t];
            return (
              <button key={t} onClick={() => toggleFilter(t)} style={{
                padding: '0.22rem 0.6rem', borderRadius: 20, fontSize: '0.7rem',
                fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
                background: active ? color : color + '14',
                color: active ? '#fff' : color,
                border: `1.5px solid ${color}`,
                transition: 'background 0.15s, color 0.15s',
              }}>
                {ZONE_LABELS[t]}
              </button>
            );
          })}
        </div>
      )}

      {/* Lista */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0.4rem 0' }}>
        {filtered.length === 0 && (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>
            Sin zonas activas
          </div>
        )}
        {filtered.map(z => {
          const color = ZONE_COLORS[z.type] || ZONE_COLORS.other;
          return (
            <button key={z.id} onClick={() => flyTo(z.lat, z.lng, onClose)} style={{
              width: '100%', textAlign: 'left', background: 'none', border: 'none',
              borderBottom: '1px solid var(--border-light)', cursor: 'pointer',
              padding: '0.55rem 0.75rem',
              display: 'flex', alignItems: 'flex-start', gap: 10,
            }}>
              <div style={{
                width: 10, height: 10, borderRadius: '50%',
                background: color, flexShrink: 0, marginTop: 4,
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, color }}>
                    {ZONE_LABELS[z.type] || '⚠️ Alerta'}
                  </span>
                  <span style={{ fontSize: '0.66rem', color: 'var(--text-tertiary)' }}>
                    {timeAgo(z.created_at)}
                  </span>
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                  r: {z.radius_m}m · exp: {z.estimated_hours}h
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 3, fontSize: '0.66rem', color: 'var(--text-tertiary)' }}>
                  <span>✓ {z.confirm_count ?? 0}/3</span>
                  <span>✗ {z.dismiss_count ?? 0}/3</span>
                  {z.confirmed && <span style={{ color: '#16a34a', fontWeight: 700 }}>Validada</span>}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Sub-pestaña Vialidad ──────────────────────────────────────────────────────
const IMP_FILTER_OPTS = [
  { value: 'pending',   label: '⏳ Pendiente', color: '#f97316' },
  { value: 'confirmed', label: '🔴 Confirmada', color: '#ef4444' },
];

function VialidadTab({ reports, onClose }) {
  const [activeFilters, setActiveFilters] = useState(new Set());

  function toggleFilter(val) {
    setActiveFilters(prev => {
      const next = new Set(prev);
      if (next.has(val)) next.delete(val); else next.add(val);
      return next;
    });
  }

  const filtered = activeFilters.size === 0
    ? reports
    : reports.filter(r => activeFilters.has(r.status));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Chips filtro */}
      <div style={{
        display: 'flex', gap: 6, flexWrap: 'wrap',
        padding: '0.5rem 0.75rem 0.25rem',
        borderBottom: '1px solid var(--border-light)',
      }}>
        {IMP_FILTER_OPTS.map(opt => {
          const active = activeFilters.has(opt.value);
          return (
            <button key={opt.value} onClick={() => toggleFilter(opt.value)} style={{
              padding: '0.22rem 0.6rem', borderRadius: 20, fontSize: '0.7rem',
              fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
              background: active ? opt.color : opt.color + '14',
              color: active ? '#fff' : opt.color,
              border: `1.5px solid ${opt.color}`,
              transition: 'background 0.15s, color 0.15s',
            }}>
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Lista */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0.4rem 0' }}>
        {filtered.length === 0 && (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>
            Sin reportes de vialidad
          </div>
        )}
        {filtered.map(r => {
          const color = IMP_COLORS[r.status] || '#6b7280';
          return (
            <button key={r.way_id} onClick={() => flyTo(r.lat, r.lng, onClose)} style={{
              width: '100%', textAlign: 'left', background: 'none', border: 'none',
              borderBottom: '1px solid var(--border-light)', cursor: 'pointer',
              padding: '0.55rem 0.75rem',
              display: 'flex', alignItems: 'flex-start', gap: 10,
            }}>
              <div style={{
                width: 10, height: 10, borderRadius: 2,
                background: color, flexShrink: 0, marginTop: 4,
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, color }}>
                    {r.status === 'confirmed' ? '🔴 Confirmada' : '⏳ Pendiente'}
                  </span>
                  <span style={{ fontSize: '0.66rem', color: 'var(--text-tertiary)' }}>
                    {timeAgo(r.created_at)}
                  </span>
                </div>
                {r.description && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: 2,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.description}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 3, fontSize: '0.66rem', color: 'var(--text-tertiary)' }}>
                  <span>✓ {r.confirmation_count ?? 0} confirmaciones</span>
                  {r.estimated_duration && (
                    <span>{IMP_LABELS[r.estimated_duration] || r.estimated_duration}</span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── AlertsPanel ───────────────────────────────────────────────────────────────
export default function AlertsPanel({ zones = [], impassable = [], onCloseMobileDrawer }) {
  const [subTab, setSubTab] = useState('zones');

  const tabStyle = (active) => ({
    flex: 1, padding: '0.5rem 0', fontSize: '0.78rem', fontWeight: 700,
    cursor: 'pointer', border: 'none', background: 'none',
    borderBottom: active ? '2px solid var(--brand)' : '2px solid transparent',
    color: active ? 'var(--brand)' : 'var(--text-secondary)',
    transition: 'color 0.15s, border-color 0.15s',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Sub-pestañas */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-light)', flexShrink: 0 }}>
        <button style={tabStyle(subTab === 'zones')} onClick={() => setSubTab('zones')}>
          🚦 Zonas {zones.length > 0 && <span style={{ fontSize: '0.65rem', marginLeft: 3,
            background: 'var(--brand)', color: '#fff', borderRadius: 10, padding: '0 5px' }}>
            {zones.length}
          </span>}
        </button>
        <button style={tabStyle(subTab === 'vialidad')} onClick={() => setSubTab('vialidad')}>
          🛣 Vialidad {impassable.length > 0 && <span style={{ fontSize: '0.65rem', marginLeft: 3,
            background: '#ef4444', color: '#fff', borderRadius: 10, padding: '0 5px' }}>
            {impassable.length}
          </span>}
        </button>
      </div>

      {subTab === 'zones'    && <ZonesTab    zones={zones}       onClose={onCloseMobileDrawer} />}
      {subTab === 'vialidad' && <VialidadTab reports={impassable} onClose={onCloseMobileDrawer} />}
    </div>
  );
}
