// components/AlertsPanel.jsx
import { useCallback, useEffect, useState } from 'react';
import { haversineMeters } from '../utils/geo';
import {
  voteZone, voteImpassable, deleteImpassable,
  updatePreference, deletePreference,
} from '../features/driver/alerts/api';

const ZONE_COLORS = {
  traffic: '#f97316', construction: '#eab308', accident: '#ef4444',
  flood: '#3b82f6', blocked: '#8b5cf6', other: '#6b7280',
};
const ZONE_LABELS = {
  traffic: 'Tráfico', construction: 'Obra', accident: 'Accidente',
  flood: 'Inundación', blocked: 'Bloqueada', other: 'Otro',
};
const ZONE_TYPES = ['traffic', 'construction', 'accident', 'flood', 'blocked', 'other'];
const PREF_COLORS = { preferred: '#16a34a', difficult: '#f59e0b', avoid: '#ef4444' };
const PREF_LABELS = { preferred: 'Favorita', difficult: 'Difícil', avoid: 'Evitar' };
const DUR_LABELS  = { days: '~días', weeks: '~semanas', months: '~meses', permanent: 'Permanente' };

const SEL_SRC    = 'alerts-sel-src';
const SEL_BORDER = 'alerts-sel-border';
const SEL_LINE   = 'alerts-sel-line';

function ensureSelectionLayer(map) {
  if (!map || !map.isStyleLoaded()) return;
  if (!map.getSource(SEL_SRC)) {
    map.addSource(SEL_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: SEL_BORDER, type: 'line', source: SEL_SRC,
      paint: { 'line-color': '#fff', 'line-width': 9, 'line-opacity': 0.7 },
      layout: { 'line-cap': 'round', 'line-join': 'round' } });
    map.addLayer({ id: SEL_LINE, type: 'line', source: SEL_SRC,
      paint: { 'line-color': ['get', 'color'], 'line-width': 5, 'line-opacity': 1 },
      layout: { 'line-cap': 'round', 'line-join': 'round' } });
  }
}

function updateSelectionLayer(selectedKeys, impassable, preferences) {
  const map = window.__map;
  if (!map || !map.style) return;
  if (!map.getSource(SEL_SRC)) {
    if (!map.isStyleLoaded()) {
      map.once('load', () => updateSelectionLayer(selectedKeys, impassable, preferences));
      return;
    }
    ensureSelectionLayer(map);
  }
  const features = [];
  for (const key of selectedKeys) {
    if (key.startsWith('i:')) {
      const report = impassable.find(r => r.way_id === key.slice(2));
      if (!report) continue;
      let coords = report.coords;
      if (typeof coords === 'string') { try { coords = JSON.parse(coords); } catch (_) { coords = null; } }
      if (!Array.isArray(coords) || coords.length < 2) continue;
      features.push({ type: 'Feature', properties: { color: '#ef4444' },
        geometry: { type: 'LineString', coordinates: coords } });
    } else if (key.startsWith('p:')) {
      const pref = preferences.find(p => p.way_id === key.slice(2));
      if (!pref) continue;
      let coords = pref.coords;
      if (typeof coords === 'string') { try { coords = JSON.parse(coords); } catch (_) { coords = null; } }
      if (!Array.isArray(coords) || coords.length < 2) continue;
      features.push({ type: 'Feature',
        properties: { color: PREF_COLORS[pref.preference] || '#6b7280' },
        geometry: { type: 'LineString', coordinates: coords } });
    }
  }
  try { map.getSource(SEL_SRC)?.setData({ type: 'FeatureCollection', features }); } catch (_) {}
}

function clearSelectionLayer() {
  try { if (window.__map?.style) window.__map.getSource(SEL_SRC)?.setData({ type: 'FeatureCollection', features: [] }); } catch (_) {}
}

function flyToOne(lat, lng) {
  if (window.__map?.style) window.__map.flyTo({ center: [lng, lat], zoom: 17, pitch: 0, bearing: 0, duration: 500, essential: true });
}

function fitBoundsMultiple(points) {
  const map = window.__map;
  if (!map || !map.style || !points.length) return;
  if (points.length === 1) { flyToOne(points[0][0], points[0][1]); return; }
  const ml = window.__maplibregl;
  if (!ml) { flyToOne(points[0][0], points[0][1]); return; }
  try {
    const lnglats = points.map(([lat, lng]) => [lng, lat]);
    const b = lnglats.reduce((acc, pt) => acc.extend(pt), new ml.LngLatBounds(lnglats[0], lnglats[0]));
    map.fitBounds(b, { padding: 80, maxZoom: 17, duration: 600, essential: true });
  } catch { flyToOne(points[0][0], points[0][1]); }
}

function boundsFromCoords(coords) {
  if (!coords || coords.length < 2) return null;
  return coords.map(c => Array.isArray(c) ? [c[1], c[0]] : [c.lat, c.lng]);
}

function timeAgo(d) {
  if (!d) return '';
  const m = Math.floor((Date.now() - new Date(d)) / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function SectionHeader({ label, onSelectAll, allSelected }) {
  return (
    <div style={{ padding: '0.28rem 0.75rem', fontSize: '0.66rem', fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: '0.05em',
      color: 'var(--text-tertiary)', background: 'var(--bg-raised)',
      borderBottom: '1px solid var(--border-light)',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span>{label}</span>
      {onSelectAll && (
        <button onClick={onSelectAll} style={{ fontSize: '0.62rem', fontWeight: 700,
          cursor: 'pointer', background: 'none', border: 'none', padding: 0,
          color: allSelected ? 'var(--brand)' : 'var(--text-tertiary)',
          textDecoration: 'underline' }}>
          {allSelected ? 'Deselec.' : 'Ver todas'}
        </button>
      )}
    </div>
  );
}

function SelectDot({ selected, color }) {
  return (
    <div style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0, marginTop: 2,
      border: `2px solid ${selected ? color : 'var(--border)'}`,
      background: selected ? color : 'transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'all 0.12s' }}>
      {selected && (
        <svg width="10" height="10" viewBox="0 0 10 10">
          <polyline points="1.5 5 4 7.5 8.5 2.5" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round"/>
        </svg>
      )}
    </div>
  );
}

// ── ZonesTab ──────────────────────────────────────────────────────────────────
function ZonesTab({ zones, token, onRefresh, myPosition, selected, onToggle, onSelectGroup }) {
  const [typeFilters,    setTypeFilters]    = useState(new Set());
  const [layerMine,      setLayerMine]      = useState(true);
  const [layerPending,   setLayerPending]   = useState(true);
  const [layerConfirmed, setLayerConfirmed] = useState(true);
  const [voting,         setVoting]         = useState(null);

  function toggleType(t) {
    setTypeFilters(prev => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n; });
  }

  async function vote(zone, v, e) {
    e.stopPropagation();
    setVoting(zone.id);
    try { await voteZone(zone.id, v, token); onRefresh(); }
    catch (_) {} finally { setVoting(null); }
  }

  const presentTypes = ZONE_TYPES.filter(t => zones.some(z => z.type === t));
  const filtered = zones.filter(z => {
    if (typeFilters.size > 0 && !typeFilters.has(z.type)) return false;
    if (z.is_mine && !layerMine) return false;
    if (!z.is_mine && z.confirmed  && !layerConfirmed) return false;
    if (!z.is_mine && !z.confirmed && !layerPending)   return false;
    return true;
  });
  const mine      = filtered.filter(z => z.is_mine);
  const pending   = filtered.filter(z => !z.is_mine && !z.confirmed);
  const confirmed = filtered.filter(z => !z.is_mine && z.confirmed);

  const LayerBtn = ({ label, active, color, count, onClick }) => (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 4,
      padding: '0.2rem 0.55rem', borderRadius: 20, fontSize: '0.68rem',
      fontWeight: active ? 700 : 500, cursor: 'pointer', minHeight: 'unset',
      background: active ? color + '18' : 'var(--bg-raised)',
      color: active ? color : 'var(--text-tertiary)',
      border: `1.5px solid ${active ? color : 'var(--border)'}` }}>
      {label}
      {count > 0 && (
        <span style={{ background: active ? color : 'var(--border)',
          color: active ? '#fff' : 'var(--text-tertiary)',
          borderRadius: 10, padding: '0 4px', fontSize: '0.6rem', fontWeight: 700 }}>
          {count}
        </span>
      )}
    </button>
  );

  function renderZone(z) {
    const color = ZONE_COLORS[z.type] || ZONE_COLORS.other;
    const isSel = selected.has(`z:${z.id}`);
    return (
      <div key={z.id} onClick={() => onToggle(`z:${z.id}`, z.lat, z.lng)} style={{
        borderBottom: '1px solid var(--border-light)', cursor: 'pointer',
        padding: '0.5rem 0.75rem', display: 'flex', alignItems: 'flex-start', gap: 8,
        background: isSel ? color + '0d' : 'none', transition: 'background 0.12s' }}>
        <SelectDot selected={isSel} color={color} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.76rem', fontWeight: 700, color, display: 'flex', alignItems: 'center', gap: 4 }}>
              {ZONE_LABELS[z.type] || 'Alerta'}
              {z.is_mine && (
                <span style={{ fontSize: '0.62rem', background: 'var(--brand-light)',
                  color: 'var(--brand)', borderRadius: 6, padding: '0.05rem 0.3rem' }}>
                  Mía
                </span>
              )}
              {z.confirmed && (
                <span style={{ fontSize: '0.62rem', background: '#f0fdf4',
                  color: '#16a34a', borderRadius: 6, padding: '0.05rem 0.3rem' }}>
                  Validada
                </span>
              )}
            </span>
            <span style={{ fontSize: '0.64rem', color: 'var(--text-tertiary)' }}>{timeAgo(z.created_at)}</span>
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: 1 }}>
            r: {z.radius_m}m · {z.estimated_hours}h
          </div>
          <div style={{ display: 'flex', gap: 5, marginTop: 3, alignItems: 'center', flexWrap: 'wrap' }}
            onClick={e => e.stopPropagation()}>
            {!z.is_mine && (
              <button onClick={e => vote(z, 'confirm', e)} disabled={voting === z.id} style={{
                padding: '0.15rem 0.4rem', borderRadius: 5, fontSize: '0.66rem', fontWeight: 700,
                background: '#f0fdf4', color: '#16a34a', border: '1px solid #86efac',
                cursor: 'pointer', minHeight: 'unset' }}>
                Confirmar {z.confirm_count || 0}/3
              </button>
            )}
            <button onClick={e => vote(z, 'dismiss', e)} disabled={voting === z.id} style={{
              padding: '0.15rem 0.4rem', borderRadius: 5, fontSize: '0.66rem', fontWeight: 700,
              background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca',
              cursor: 'pointer', minHeight: 'unset' }}>
              Descartar {z.dismiss_count || 0}/3
            </button>
            {z.pending_edit && (
              <span style={{ fontSize: '0.62rem', color: '#92400e',
                background: '#fffbeb', border: '1px solid #fbbf24',
                borderRadius: 5, padding: '0.05rem 0.3rem' }}>
                Edición pendiente: {ZONE_LABELS[z.pending_edit.type] || z.pending_edit.type}
                {z.pending_edit.estimated_hours ? ` · ${z.pending_edit.estimated_hours}h` : ''}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap',
        padding: '0.4rem 0.75rem 0.25rem', borderBottom: '1px solid var(--border-light)' }}>
        <LayerBtn label="Mías"       active={layerMine}      color="var(--brand)" count={zones.filter(z => z.is_mine).length}               onClick={() => setLayerMine(v => !v)} />
        <LayerBtn label="Pendientes" active={layerPending}   color="#f59e0b"      count={zones.filter(z => !z.is_mine && !z.confirmed).length} onClick={() => setLayerPending(v => !v)} />
        <LayerBtn label="Confirm."   active={layerConfirmed} color="#16a34a"      count={zones.filter(z => !z.is_mine && z.confirmed).length}  onClick={() => setLayerConfirmed(v => !v)} />
      </div>
      {presentTypes.length > 0 && (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap',
          padding: '0.25rem 0.75rem', borderBottom: '1px solid var(--border-light)' }}>
          {presentTypes.map(t => {
            const act = typeFilters.has(t); const col = ZONE_COLORS[t];
            return (
              <button key={t} onClick={() => toggleType(t)} style={{
                padding: '0.15rem 0.5rem', borderRadius: 20, fontSize: '0.66rem', minHeight: 'unset',
                fontWeight: act ? 700 : 500, cursor: 'pointer',
                background: act ? col : col + '14', color: act ? '#fff' : col,
                border: `1.5px solid ${col}` }}>{ZONE_LABELS[t]}</button>
            );
          })}
        </div>
      )}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {filtered.length === 0 && (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>
            Sin zonas con estos filtros
          </div>
        )}
        {mine.length > 0 && (
          <><SectionHeader label={`Mías · ${mine.length}`}
            onSelectAll={() => onSelectGroup(mine.map(z => [`z:${z.id}`, z.lat, z.lng]))}
            allSelected={mine.every(z => selected.has(`z:${z.id}`))} />
          {mine.map(renderZone)}</>
        )}
        {pending.length > 0 && (
          <><SectionHeader label={`Pendientes · ${pending.length}`}
            onSelectAll={() => onSelectGroup(pending.map(z => [`z:${z.id}`, z.lat, z.lng]))}
            allSelected={pending.every(z => selected.has(`z:${z.id}`))} />
          {pending.map(renderZone)}</>
        )}
        {confirmed.length > 0 && (
          <><SectionHeader label={`Confirmadas · ${confirmed.length}`}
            onSelectAll={() => onSelectGroup(confirmed.map(z => [`z:${z.id}`, z.lat, z.lng]))}
            allSelected={confirmed.every(z => selected.has(`z:${z.id}`))} />
          {confirmed.map(renderZone)}</>
        )}
      </div>
    </div>
  );
}

// ── VialidadTab ───────────────────────────────────────────────────────────────
function VialidadTab({ impassable, preferences, token, onRefresh, myPosition, selected, onToggle, onSelectGroup }) {
  const [voting,   setVoting]   = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [editing,  setEditing]  = useState(null);
  const [editPref, setEditPref] = useState('preferred');

  async function doVote(way_id, vote, e) {
    e.stopPropagation(); setVoting(way_id);
    try { await voteImpassable(way_id, vote, token); onRefresh(); }
    catch (_) {} finally { setVoting(null); }
  }
  async function doDeleteImp(way_id, e) {
    e.stopPropagation(); setDeleting(way_id);
    try { await deleteImpassable(way_id, token); onRefresh(); }
    catch (_) {} finally { setDeleting(null); }
  }
  async function doSavePref(way_id, e) {
    e.stopPropagation(); setDeleting(way_id + '_s');
    try { await updatePreference(way_id, editPref, token); setEditing(null); onRefresh(); }
    catch (_) {} finally { setDeleting(null); }
  }
  async function doDeletePref(way_id, e) {
    e.stopPropagation(); setDeleting(way_id);
    try { await deletePreference(way_id, token); onRefresh(); }
    catch (_) {} finally { setDeleting(null); }
  }

  const pending   = impassable.filter(r => !r.confirmed);
  const confirmed = impassable.filter(r => r.confirmed);

  function renderImp(r) {
    const isSel    = selected.has(`i:${r.way_id}`);
    const color    = r.confirmed ? '#16a34a' : '#f97316';
    const isVoting = voting === r.way_id;
    const hasCoords = (() => {
      let c = r.coords;
      if (typeof c === 'string') { try { c = JSON.parse(c); } catch (_) { c = null; } }
      return Array.isArray(c) && c.length >= 2;
    })();

    return (
      <div key={r.way_id} onClick={() => onToggle(`i:${r.way_id}`, r.lat, r.lng, r)} style={{
        borderBottom: '1px solid var(--border-light)', cursor: 'pointer',
        padding: '0.5rem 0.75rem', display: 'flex', alignItems: 'flex-start', gap: 8,
        background: isSel ? color + '0d' : 'none' }}>
        <SelectDot selected={isSel} color={color} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.76rem', fontWeight: 700, color, display: 'flex', alignItems: 'center', gap: 4 }}>
              {r.name || (r.confirmed ? 'Activa' : 'Pendiente')}
              {r.is_mine && (
                <span style={{ fontSize: '0.62rem', background: 'var(--brand-light)',
                  color: 'var(--brand)', borderRadius: 6, padding: '0.05rem 0.3rem' }}>Mía</span>
              )}
              {r.confirmed && (
                <span style={{ fontSize: '0.62rem', background: '#f0fdf4',
                  color: '#16a34a', borderRadius: 6, padding: '0.05rem 0.3rem' }}>Activa</span>
              )}
              {!hasCoords && (
                <span style={{ fontSize: '0.6rem', color: 'var(--text-tertiary)' }}>sin coords</span>
              )}
            </span>
            <span style={{ fontSize: '0.64rem', color: 'var(--text-tertiary)' }}>{timeAgo(r.created_at)}</span>
          </div>
          {r.description && (
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: 1,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.description}
            </div>
          )}
          <div style={{ display: 'flex', gap: 5, marginTop: 3, alignItems: 'center', flexWrap: 'wrap' }}
            onClick={e => e.stopPropagation()}>
            <span style={{ fontSize: '0.64rem', color: 'var(--text-tertiary)' }}>
              {DUR_LABELS[r.estimated_duration] || r.estimated_duration}
            </span>
            {!r.is_mine && (
              <>
                <button onClick={e => doVote(r.way_id, 'confirm', e)} disabled={isVoting} style={{
                  padding: '0.15rem 0.4rem', borderRadius: 5, fontSize: '0.66rem', fontWeight: 700,
                  background: '#f0fdf4', color: '#16a34a', border: '1px solid #86efac',
                  cursor: 'pointer', minHeight: 'unset' }}>
                  Confirmar {r.confirm_count || 0}/3
                </button>
                <button onClick={e => doVote(r.way_id, 'dismiss', e)} disabled={isVoting} style={{
                  padding: '0.15rem 0.4rem', borderRadius: 5, fontSize: '0.66rem', fontWeight: 700,
                  background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca',
                  cursor: 'pointer', minHeight: 'unset' }}>
                  Descartar {r.dismiss_count || 0}/3
                </button>
              </>
            )}
            {r.is_mine && (
              <button onClick={e => doDeleteImp(r.way_id, e)} disabled={deleting === r.way_id} style={{
                padding: '0.15rem 0.35rem', borderRadius: 5, fontSize: '0.66rem',
                background: 'var(--bg-raised)', color: 'var(--text-tertiary)',
                border: '1px solid var(--border)', cursor: 'pointer', minHeight: 'unset' }}>
                {deleting === r.way_id ? '…' : 'Eliminar'}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderPref(p) {
    const isSel  = selected.has(`p:${p.way_id}`);
    const color  = PREF_COLORS[p.preference] || '#6b7280';
    const isEdit = editing === p.way_id;
    const isDel  = deleting === p.way_id;
    return (
      <div key={p.way_id} onClick={() => onToggle(`p:${p.way_id}`, p.lat, p.lng, p)} style={{
        borderBottom: '1px solid var(--border-light)', cursor: 'pointer',
        padding: '0.5rem 0.75rem', display: 'flex', alignItems: 'flex-start', gap: 8,
        background: isSel ? color + '0d' : 'none' }}>
        <SelectDot selected={isSel} color={color} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.76rem', fontWeight: 700, color }}>
            {PREF_LABELS[p.preference] || p.preference}
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', marginTop: 1 }}>
            {p.name || p.way_id}
          </div>
          {isEdit ? (
            <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}
              onClick={e => e.stopPropagation()}>
              {Object.entries(PREF_LABELS).map(([v, l]) => (
                <button key={v} onClick={() => setEditPref(v)} style={{
                  padding: '0.15rem 0.4rem', borderRadius: 5, fontSize: '0.64rem', fontWeight: 700,
                  cursor: 'pointer', minHeight: 'unset',
                  background: editPref === v ? PREF_COLORS[v] : 'var(--bg-raised)',
                  color: editPref === v ? '#fff' : 'var(--text-secondary)',
                  border: `1px solid ${editPref === v ? PREF_COLORS[v] : 'var(--border)'}` }}>{l}</button>
              ))}
              <button onClick={e => doSavePref(p.way_id, e)} style={{
                padding: '0.15rem 0.4rem', borderRadius: 5, fontSize: '0.64rem', fontWeight: 700,
                background: '#f0fdf4', color: '#16a34a', border: '1px solid #86efac',
                cursor: 'pointer', minHeight: 'unset' }}>Guardar</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 4, marginTop: 3 }} onClick={e => e.stopPropagation()}>
              <button onClick={e => { e.stopPropagation(); setEditPref(p.preference); setEditing(p.way_id); }} style={{
                padding: '0.15rem 0.35rem', borderRadius: 5, fontSize: '0.66rem',
                background: 'var(--bg-raised)', color: 'var(--brand)',
                border: '1px solid var(--border)', cursor: 'pointer', minHeight: 'unset' }}>Editar</button>
              <button onClick={e => doDeletePref(p.way_id, e)} disabled={isDel} style={{
                padding: '0.15rem 0.35rem', borderRadius: 5, fontSize: '0.66rem',
                background: 'var(--bg-raised)', color: 'var(--text-tertiary)',
                border: '1px solid var(--border)', cursor: 'pointer', minHeight: 'unset' }}>
                {isDel ? '…' : 'Eliminar'}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {!impassable.length && !preferences.length && (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>
            Sin reportes de vialidad
          </div>
        )}
        {pending.length > 0 && (
          <><SectionHeader label={`Pendientes · ${pending.length}`}
            onSelectAll={() => onSelectGroup(pending.map(r => [`i:${r.way_id}`, r.lat, r.lng]))}
            allSelected={pending.every(r => selected.has(`i:${r.way_id}`))} />
          {pending.map(renderImp)}</>
        )}
        {confirmed.length > 0 && (
          <><SectionHeader label={`Activas en rutas · ${confirmed.length}`}
            onSelectAll={() => onSelectGroup(confirmed.map(r => [`i:${r.way_id}`, r.lat, r.lng]))}
            allSelected={confirmed.every(r => selected.has(`i:${r.way_id}`))} />
          {confirmed.map(renderImp)}</>
        )}
        {preferences.length > 0 && (
          <><SectionHeader label={`Mis preferencias · ${preferences.length}`}
            onSelectAll={() => onSelectGroup(preferences.map(p => [`p:${p.way_id}`, p.lat, p.lng]))}
            allSelected={preferences.every(p => selected.has(`p:${p.way_id}`))} />
          {preferences.map(renderPref)}</>
        )}
      </div>
    </div>
  );
}

// ── AlertsPanel ───────────────────────────────────────────────────────────────
export default function AlertsPanel({
  zones = [], impassable = [], preferences = [],
  myPosition = null, token, onRefresh,
}) {
  const [tab,      setTab]      = useState('zones');
  const [selected, setSelected] = useState(new Set());

  useEffect(() => { return () => clearSelectionLayer(); }, []);
  useEffect(() => { updateSelectionLayer(selected, impassable, preferences); }, [selected, impassable, preferences]);

  const coordMap = useCallback(() => {
    const m = new Map();
    zones.forEach(z       => m.set(`z:${z.id}`,     [Number(z.lat), Number(z.lng)]));
    impassable.forEach(r  => m.set(`i:${r.way_id}`, [Number(r.lat), Number(r.lng)]));
    preferences.forEach(p => m.set(`p:${p.way_id}`, [Number(p.lat), Number(p.lng)]));
    return m;
  }, [zones, impassable, preferences]);

  function onToggle(key, lat, lng, obj) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
        if (obj) {
          let coords = obj.coords;
          if (typeof coords === 'string') { try { coords = JSON.parse(coords); } catch (_) { coords = null; } }
          if (Array.isArray(coords) && coords.length >= 2) {
            const pts = boundsFromCoords(coords);
            if (pts) { fitBoundsMultiple(pts); return next; }
          }
        }
        flyToOne(lat, lng);
      }
      if (next.size > 1) {
        const pts = [...next].map(k => coordMap().get(k)).filter(p => p && p[0] && p[1]);
        if (pts.length > 1) fitBoundsMultiple(pts);
      }
      return next;
    });
  }

  function onSelectGroup(items) {
    const keys   = items.map(i => i[0]);
    const allSel = keys.every(k => selected.has(k));
    setSelected(prev => {
      const next = new Set(prev);
      if (allSel) { keys.forEach(k => next.delete(k)); }
      else        { keys.forEach(k => next.add(k)); }
      const pts = [...next].map(k => coordMap().get(k)).filter(p => p && p[0] && p[1]);
      if (pts.length) fitBoundsMultiple(pts);
      return next;
    });
    if (!allSel) {
      const pts = items.map(([, lat, lng]) => [Number(lat), Number(lng)]).filter(p => p[0] && p[1]);
      fitBoundsMultiple(pts);
    }
  }

  function selectAll() {
    const cm = coordMap();
    setSelected(new Set(cm.keys()));
    const pts = [...cm.values()].filter(p => p && p[0] && p[1]);
    fitBoundsMultiple(pts);
  }

  const totalAll = zones.length + impassable.length + preferences.length;

  const tabStyle = (active) => ({
    flex: 1, padding: '0.5rem 0', fontSize: '0.76rem', fontWeight: 700,
    cursor: 'pointer', border: 'none', background: 'none',
    borderBottom: active ? '2px solid var(--brand)' : '2px solid transparent',
    color: active ? 'var(--brand)' : 'var(--text-secondary)',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-light)', flexShrink: 0 }}>
        <button style={tabStyle(tab === 'zones')} onClick={() => setTab('zones')}>
          Zonas
          {zones.length > 0 && (
            <span style={{ marginLeft: 4, fontSize: '0.62rem',
              background: 'var(--brand)', color: '#fff', borderRadius: 10, padding: '0 5px' }}>
              {zones.length}
            </span>
          )}
        </button>
        <button style={tabStyle(tab === 'vialidad')} onClick={() => setTab('vialidad')}>
          Vialidad
          {(impassable.length + preferences.length) > 0 && (
            <span style={{ marginLeft: 4, fontSize: '0.62rem',
              background: '#ef4444', color: '#fff', borderRadius: 10, padding: '0 5px' }}>
              {impassable.length + preferences.length}
            </span>
          )}
        </button>
      </div>

      {totalAll > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0.28rem 0.75rem', background: 'var(--bg-raised)',
          borderBottom: '1px solid var(--border-light)', flexShrink: 0, fontSize: '0.68rem' }}>
          <span style={{ color: 'var(--text-tertiary)' }}>
            {selected.size > 0 ? `${selected.size} en mapa` : 'Toca para ver en mapa'}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {selected.size > 0 && (
              <button onClick={() => setSelected(new Set())} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-tertiary)', fontSize: '0.68rem', fontWeight: 600 }}>
                Limpiar
              </button>
            )}
            <button onClick={selectAll} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--brand)', fontSize: '0.68rem', fontWeight: 700 }}>
              Ver todas
            </button>
          </div>
        </div>
      )}

      {tab === 'zones' && (
        <ZonesTab zones={zones} token={token} onRefresh={onRefresh}
          myPosition={myPosition} selected={selected}
          onToggle={onToggle} onSelectGroup={onSelectGroup} />
      )}
      {tab === 'vialidad' && (
        <VialidadTab impassable={impassable} preferences={preferences}
          token={token} onRefresh={onRefresh} myPosition={myPosition}
          selected={selected} onToggle={onToggle} onSelectGroup={onSelectGroup} />
      )}
    </div>
  );
}
