// pages/Driver/Alerts.jsx
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { haversineMeters } from '../../utils/geo';
import {
  fetchAllZones, fetchAllImpassable, fetchMyPreferences,
  voteZone, confirmImpassable, updateImpassable, deleteImpassable,
  updatePreference, deletePreference,
} from '../../features/driver/alerts/api';

const ZONE_TYPE_LABELS = {
  traffic: 'Tráfico', construction: 'Obra', accident: 'Accidente',
  flood: 'Inundación', blocked: 'Bloqueada', other: 'Otro',
};
const ZONE_COLORS = {
  traffic: '#f97316', construction: '#eab308', accident: '#ef4444',
  flood: '#3b82f6', blocked: '#8b5cf6', other: '#6b7280',
};
const PREF_LABELS = { preferred: 'Favorita', difficult: 'Difícil', avoid: 'Evitar' };
const PREF_COLORS = { preferred: '#16a34a', difficult: '#f59e0b', avoid: '#ef4444' };
const DUR_LABELS  = { days: 'Días', weeks: 'Semanas', months: 'Meses', permanent: 'Permanente' };
const DUR_OPTS    = ['days', 'weeks', 'months', 'permanent'];

// Volar al tramo en el mapa usando coords o lat/lng
function flyToReport(report) {
  const map = window.__map;
  if (!map) return;
  try {
    const coords = report.coords
      ? (typeof report.coords === 'string' ? JSON.parse(report.coords) : report.coords)
      : null;
    if (coords && coords.length >= 2) {
      // Centrar en el punto medio del tramo
      const mid = coords[Math.floor(coords.length / 2)];
      map.flyTo({ center: mid, zoom: 17, pitch: 0, bearing: 0, duration: 600, essential: true });
    } else if (report.lat && report.lng) {
      map.flyTo({ center: [Number(report.lng), Number(report.lat)], zoom: 17, pitch: 0, duration: 600, essential: true });
    }
  } catch (_) {}
}

function LayerChip({ label, active, color, count, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 5,
      padding: '0.28rem 0.65rem', borderRadius: 20,
      fontSize: '0.72rem', fontWeight: active ? 700 : 500,
      cursor: 'pointer', transition: 'all 0.12s',
      background: active ? color + '18' : 'var(--bg-raised)',
      color: active ? color : 'var(--text-tertiary)',
      border: `1.5px solid ${active ? color : 'var(--border)'}`,
    }}>
      {label}
      {count > 0 && (
        <span style={{
          background: active ? color : 'var(--border)',
          color: active ? '#fff' : 'var(--text-tertiary)',
          borderRadius: 10, padding: '0 5px', fontSize: '0.65rem', fontWeight: 700,
        }}>{count}</span>
      )}
    </button>
  );
}

function ZoneCard({ zone, token, onRefresh }) {
  const [loading, setLoading] = useState(false);
  const color = ZONE_COLORS[zone.type] || '#6b7280';

  async function vote(v) {
    setLoading(true);
    try { await voteZone(zone.id, v, token); onRefresh(); }
    catch (_) {} finally { setLoading(false); }
  }

  const expiresIn = zone.expires_at
    ? Math.max(0, Math.round((new Date(zone.expires_at) - Date.now()) / 3600000))
    : null;

  return (
    <div style={{
      background: 'var(--bg-card)', borderRadius: 10, padding: '0.65rem 0.875rem',
      marginBottom: '0.5rem', borderLeft: `3px solid ${color}`,
      boxShadow: 'var(--panel-shadow)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <span style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.04em', color }}>
              {ZONE_TYPE_LABELS[zone.type] || zone.type}
            </span>
            {zone.confirmed && (
              <span style={{ fontSize: '0.62rem', background: '#f0fdf4', color: '#16a34a',
                border: '1px solid #86efac', borderRadius: 8, padding: '0.05rem 0.35rem', fontWeight: 700 }}>
                ✓ Confirmada
              </span>
            )}
            {zone.is_mine && (
              <span style={{ fontSize: '0.62rem', background: 'var(--brand-light)',
                color: 'var(--brand)', borderRadius: 8, padding: '0.05rem 0.35rem', fontWeight: 700 }}>
                Mía
              </span>
            )}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            Radio {zone.radius_m}m{expiresIn !== null && ` · expira en ~${expiresIn}h`}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 4, fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
            <span>✓ {zone.confirm_count || 0}</span>
            <span>✗ {zone.dismiss_count || 0}</span>
          </div>
          {zone.pending_edit && (
            <div style={{ marginTop: 4, fontSize: '0.68rem', color: '#92400e',
              background: '#fffbeb', border: '1px solid #fbbf24',
              borderRadius: 6, padding: '0.15rem 0.4rem', display: 'inline-block' }}>
              ✏ Cambio sugerido: {ZONE_TYPE_LABELS[zone.pending_edit.type] || zone.pending_edit.type}
              {zone.pending_edit.estimated_hours ? ` · ${zone.pending_edit.estimated_hours}h` : ''}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 5, flexShrink: 0, marginLeft: 8 }}>
          {!zone.is_mine && (
            <button onClick={() => vote('confirm')} disabled={loading} style={{
              padding: '0.25rem 0.5rem', borderRadius: 6, fontSize: '0.7rem', fontWeight: 700,
              background: '#f0fdf4', color: '#16a34a', border: '1px solid #86efac',
              cursor: 'pointer', minHeight: 'unset',
            }}>✓ {zone.confirm_count || 0}/3</button>
          )}
          <button onClick={() => vote('dismiss')} disabled={loading} style={{
            padding: '0.25rem 0.5rem', borderRadius: 6, fontSize: '0.7rem', fontWeight: 700,
            background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca',
            cursor: 'pointer', minHeight: 'unset',
          }}>✗ {zone.dismiss_count || 0}/3</button>
        </div>
      </div>
    </div>
  );
}

function ImpassableCard({ report, token, onRefresh, myPosition }) {
  const [loading,  setLoading]  = useState(false);
  const [duration, setDuration] = useState('days');
  const [editing,  setEditing]  = useState(false);
  const [editDur,  setEditDur]  = useState(report.estimated_duration || 'days');
  const [editDesc, setEditDesc] = useState(report.description || '');

  const distM = myPosition && report.lat && report.lng
    ? haversineMeters(myPosition.lat, myPosition.lng, Number(report.lat), Number(report.lng))
    : Infinity;
  const canConfirm = !report.is_mine && !report.confirmed && distM <= 50;

  // Nombre legible: usar name si existe, si no way_id truncado
  const displayName = report.name || `ID: ${String(report.way_id).slice(0, 10)}…`;

  async function confirm() {
    setLoading(true);
    try { await confirmImpassable(report.way_id, duration, token); onRefresh(); }
    catch (_) {} finally { setLoading(false); }
  }

  async function saveEdit() {
    setLoading(true);
    try {
      await updateImpassable(report.way_id, { estimated_duration: editDur, description: editDesc }, token);
      setEditing(false);
      onRefresh();
    } catch (_) {} finally { setLoading(false); }
  }

  async function del() {
    setLoading(true);
    try { await deleteImpassable(report.way_id, token); onRefresh(); }
    catch (_) {} finally { setLoading(false); }
  }

  return (
    <div
      style={{
        background: 'var(--bg-card)', borderRadius: 10, padding: '0.65rem 0.875rem',
        marginBottom: '0.5rem', borderLeft: `3px solid ${report.confirmed ? '#16a34a' : '#ef4444'}`,
        boxShadow: 'var(--panel-shadow)', cursor: 'pointer',
      }}
      onClick={() => flyToReport(report)}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {displayName}
            </span>
            {report.confirmed
              ? <span style={{ fontSize: '0.62rem', background: '#f0fdf4', color: '#16a34a',
                  border: '1px solid #86efac', borderRadius: 8, padding: '0.05rem 0.35rem',
                  fontWeight: 700, flexShrink: 0 }}>✓ Confirmada</span>
              : <span style={{ fontSize: '0.62rem', background: '#fef3c7', color: '#92400e',
                  border: '1px solid #fcd34d', borderRadius: 8, padding: '0.05rem 0.35rem',
                  fontWeight: 700, flexShrink: 0 }}>Pendiente</span>
            }
            {report.is_mine && (
              <span style={{ fontSize: '0.62rem', background: 'var(--brand-light)',
                color: 'var(--brand)', borderRadius: 8, padding: '0.05rem 0.35rem',
                fontWeight: 700, flexShrink: 0 }}>Mía</span>
            )}
          </div>

          {!editing ? (
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
              {DUR_LABELS[report.consensus_duration || report.estimated_duration] || report.estimated_duration}
              {report.confirmation_count > 0 && ` · ${report.confirmation_count} conf.`}
              {report.description && (
                <span style={{ marginLeft: 6, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                  "{report.description}"
                </span>
              )}
            </div>
          ) : (
            <div onClick={e => e.stopPropagation()} style={{ marginTop: 6 }}>
              <select value={editDur} onChange={e => setEditDur(e.target.value)}
                style={{ fontSize: '0.72rem', borderRadius: 6, border: '1px solid var(--border)',
                  padding: '0.25rem 0.4rem', background: 'var(--bg-card)',
                  color: 'var(--text-primary)', marginBottom: 4, width: '100%' }}>
                {DUR_OPTS.map(d => <option key={d} value={d}>{DUR_LABELS[d]}</option>)}
              </select>
              <input
                type="text"
                value={editDesc}
                onChange={e => setEditDesc(e.target.value)}
                placeholder="Descripción (opcional)"
                maxLength={200}
                style={{ fontSize: '0.72rem', borderRadius: 6, border: '1px solid var(--border)',
                  padding: '0.25rem 0.4rem', background: 'var(--bg-card)',
                  color: 'var(--text-primary)', width: '100%', boxSizing: 'border-box' }}
              />
              <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                <button onClick={saveEdit} disabled={loading} style={{
                  padding: '0.25rem 0.6rem', borderRadius: 6, fontSize: '0.7rem', fontWeight: 700,
                  background: '#f0fdf4', color: '#16a34a', border: '1px solid #86efac',
                  cursor: 'pointer', minHeight: 'unset',
                }}>{loading ? '…' : '✓ Guardar'}</button>
                <button onClick={() => setEditing(false)} style={{
                  padding: '0.25rem 0.5rem', borderRadius: 6, fontSize: '0.7rem',
                  background: 'var(--bg-raised)', color: 'var(--text-tertiary)',
                  border: '1px solid var(--border)', cursor: 'pointer', minHeight: 'unset',
                }}>Cancelar</button>
              </div>
            </div>
          )}
        </div>

        {/* Acciones */}
        <div onClick={e => e.stopPropagation()}
          style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0, marginLeft: 8 }}>
          {canConfirm && (
            <div style={{ display: 'flex', gap: 4 }}>
              <select value={duration} onChange={e => setDuration(e.target.value)}
                style={{ fontSize: '0.68rem', borderRadius: 6, border: '1px solid var(--border)',
                  padding: '0.2rem 0.3rem', background: 'var(--bg-card)', color: 'var(--text-primary)' }}>
                {DUR_OPTS.map(d => <option key={d} value={d}>{DUR_LABELS[d]}</option>)}
              </select>
              <button onClick={confirm} disabled={loading} style={{
                padding: '0.25rem 0.5rem', borderRadius: 6, fontSize: '0.7rem', fontWeight: 700,
                background: '#f0fdf4', color: '#16a34a', border: '1px solid #86efac',
                cursor: 'pointer', minHeight: 'unset',
              }}>✓</button>
            </div>
          )}
          {!report.is_mine && !report.confirmed && distM > 50 && distM !== Infinity && (
            <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', textAlign: 'right' }}>
              ~{Math.round(distM)}m
            </div>
          )}
          {report.is_mine && !report.confirmed && !editing && (
            <button onClick={() => setEditing(true)} style={{
              padding: '0.25rem 0.5rem', borderRadius: 6, fontSize: '0.7rem',
              background: 'var(--bg-raised)', color: 'var(--brand)',
              border: '1px solid var(--border)', cursor: 'pointer', minHeight: 'unset',
            }}>✎</button>
          )}
          {report.is_mine && (
            <button onClick={del} disabled={loading} style={{
              padding: '0.25rem 0.5rem', borderRadius: 6, fontSize: '0.7rem',
              background: 'var(--bg-raised)', color: 'var(--text-tertiary)',
              border: '1px solid var(--border)', cursor: 'pointer', minHeight: 'unset',
            }}>🗑</button>
          )}
        </div>
      </div>
    </div>
  );
}

function PreferenceCard({ pref, token, onRefresh }) {
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [newPref, setNewPref] = useState(pref.preference);
  const color = PREF_COLORS[pref.preference] || '#6b7280';

  const displayName = pref.name || `ID: ${String(pref.way_id).slice(0, 10)}…`;

  async function save() {
    setLoading(true);
    try { await updatePreference(pref.way_id, newPref, token); setEditing(false); onRefresh(); }
    catch (_) {} finally { setLoading(false); }
  }
  async function del() {
    setLoading(true);
    try { await deletePreference(pref.way_id, token); onRefresh(); }
    catch (_) {} finally { setLoading(false); }
  }

  return (
    <div style={{
      background: 'var(--bg-card)', borderRadius: 10, padding: '0.65rem 0.875rem',
      marginBottom: '0.5rem', borderLeft: `3px solid ${color}`,
      boxShadow: 'var(--panel-shadow)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {displayName}
          </div>
          {!editing
            ? <div style={{ fontSize: '0.72rem', color, fontWeight: 600, marginTop: 2 }}>
                {PREF_LABELS[pref.preference]}
              </div>
            : <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                {Object.entries(PREF_LABELS).map(([v, l]) => (
                  <button key={v} onClick={() => setNewPref(v)} style={{
                    padding: '0.2rem 0.45rem', borderRadius: 6, fontSize: '0.7rem', fontWeight: 700,
                    cursor: 'pointer', minHeight: 'unset',
                    background: newPref === v ? PREF_COLORS[v] : 'var(--bg-raised)',
                    color: newPref === v ? '#fff' : 'var(--text-secondary)',
                    border: `1px solid ${newPref === v ? PREF_COLORS[v] : 'var(--border)'}`,
                  }}>{l}</button>
                ))}
              </div>
          }
        </div>
        <div style={{ display: 'flex', gap: 4, flexShrink: 0, marginLeft: 8 }}>
          {!editing
            ? <button onClick={() => setEditing(true)} style={{
                padding: '0.25rem 0.5rem', borderRadius: 6, fontSize: '0.7rem',
                background: 'var(--bg-raised)', color: 'var(--brand)',
                border: '1px solid var(--border)', cursor: 'pointer', minHeight: 'unset',
              }}>✎</button>
            : <button onClick={save} disabled={loading} style={{
                padding: '0.25rem 0.5rem', borderRadius: 6, fontSize: '0.7rem', fontWeight: 700,
                background: '#f0fdf4', color: '#16a34a', border: '1px solid #86efac',
                cursor: 'pointer', minHeight: 'unset',
              }}>✓</button>
          }
          <button onClick={del} disabled={loading} style={{
            padding: '0.25rem 0.5rem', borderRadius: 6, fontSize: '0.7rem',
            background: 'var(--bg-raised)', color: 'var(--text-tertiary)',
            border: '1px solid var(--border)', cursor: 'pointer', minHeight: 'unset',
          }}>🗑</button>
        </div>
      </div>
    </div>
  );
}

export default function AlertsPage() {
  const { auth } = useAuth();
  const [tab,           setTab]           = useState('zones');
  const [zones,         setZones]         = useState([]);
  const [impassable,    setImpassable]    = useState([]);
  const [preferences,   setPreferences]   = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [myPosition,    setMyPosition]    = useState(null);

  const [showMine,      setShowMine]      = useState(true);
  const [showPending,   setShowPending]   = useState(true);
  const [showConfirmed, setShowConfirmed] = useState(true);
  const [zoneTypes,     setZoneTypes]     = useState(
    new Set(['traffic','construction','accident','flood','blocked','other'])
  );

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      pos => setMyPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { timeout: 8000, maximumAge: 30000, enableHighAccuracy: true }
    );
  }, []);

  const load = useCallback(async () => {
    if (!auth.token) return;
    setLoading(true);
    try {
      const [z, imp, prefs] = await Promise.all([
        fetchAllZones(auth.token),
        fetchAllImpassable(auth.token),
        fetchMyPreferences(auth.token),
      ]);
      setZones(z);
      setImpassable(imp);
      setPreferences(prefs);
    } catch (_) {} finally { setLoading(false); }
  }, [auth.token]);

  useEffect(() => { load(); }, [load]);

  const filteredZones = zones.filter(z => {
    if (!zoneTypes.has(z.type)) return false;
    if (z.is_mine  && !showMine)                       return false;
    if (!z.is_mine && z.confirmed  && !showConfirmed)  return false;
    if (!z.is_mine && !z.confirmed && !showPending)    return false;
    return true;
  });

  const filteredImpassable = impassable.filter(r => {
    if (r.is_mine  && !showMine)                       return false;
    if (!r.is_mine && r.confirmed  && !showConfirmed)  return false;
    if (!r.is_mine && !r.confirmed && !showPending)    return false;
    return true;
  });

  function toggleZoneType(t) {
    setZoneTypes(prev => {
      const next = new Set(prev); next.has(t) ? next.delete(t) : next.add(t); return next;
    });
  }

  const mineZoneCount      = zones.filter(z => z.is_mine).length;
  const pendingZoneCount   = zones.filter(z => !z.is_mine && !z.confirmed).length;
  const confirmedZoneCount = zones.filter(z => !z.is_mine && z.confirmed).length;
  const mineRoadCount      = [...impassable.filter(r => r.is_mine), ...preferences].length;
  const pendingRoadCount   = impassable.filter(r => !r.is_mine && !r.confirmed).length;
  const confirmedRoadCount = impassable.filter(r => !r.is_mine && r.confirmed).length;

  return (
    <div style={{ background: 'var(--bg-base)', minHeight: '100vh' }}>
      <div style={{
        background: 'linear-gradient(135deg, #c97b7b 0%, #b56060 60%, #9e4f4f 100%)',
        padding: '0.65rem 1rem 0', flexShrink: 0,
      }}>
        <div style={{ fontWeight: 800, fontSize: '1rem', color: '#fff',
          letterSpacing: '-0.01em', marginBottom: '0.4rem' }}>
          Alertas de ruta
        </div>
        <div style={{ display: 'flex', gap: 0, borderTop: '1px solid rgba(255,255,255,0.2)' }}>
          {[['zones','Zonas'], ['roads','Caminos']].map(([val, label]) => (
            <button key={val} onClick={() => setTab(val)} style={{
              flex: 1, background: 'none', border: 'none', cursor: 'pointer',
              padding: '0.4rem 0.3rem', fontSize: '0.8rem',
              fontWeight: tab === val ? 800 : 500,
              color: tab === val ? '#fff' : 'rgba(255,255,255,0.65)',
              borderBottom: tab === val ? '2px solid #fff' : '2px solid transparent',
              marginBottom: '-1px',
            }}>{label}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: '0.75rem 1rem', paddingBottom: 'calc(var(--nav-h-mobile) + 1rem)' }}>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
          <LayerChip label="Mías"       active={showMine}      color="var(--brand)" count={tab === 'zones' ? mineZoneCount : mineRoadCount}           onClick={() => setShowMine(v => !v)} />
          <LayerChip label="Pendientes" active={showPending}   color="#f59e0b"      count={tab === 'zones' ? pendingZoneCount : pendingRoadCount}       onClick={() => setShowPending(v => !v)} />
          <LayerChip label="Confirmadas" active={showConfirmed} color="#16a34a"     count={tab === 'zones' ? confirmedZoneCount : confirmedRoadCount}   onClick={() => setShowConfirmed(v => !v)} />
        </div>

        {tab === 'zones' && (
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            {Object.entries(ZONE_TYPE_LABELS).map(([t, l]) => (
              <button key={t} onClick={() => toggleZoneType(t)} style={{
                padding: '0.2rem 0.5rem', borderRadius: 20, fontSize: '0.68rem', fontWeight: 600,
                cursor: 'pointer', minHeight: 'unset',
                background: zoneTypes.has(t) ? ZONE_COLORS[t] + '18' : 'var(--bg-raised)',
                color: zoneTypes.has(t) ? ZONE_COLORS[t] : 'var(--text-tertiary)',
                border: `1.5px solid ${zoneTypes.has(t) ? ZONE_COLORS[t] : 'var(--border)'}`,
              }}>{l}</button>
            ))}
          </div>
        )}

        {loading
          ? <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-tertiary)' }}>Cargando…</div>
          : tab === 'zones'
            ? filteredZones.length === 0
              ? <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Sin zonas con estos filtros.</p>
              : filteredZones.map(z => (
                  <ZoneCard key={z.id} zone={z} token={auth.token} onRefresh={load} />
                ))
            : (
              <>
                {filteredImpassable.length === 0 && preferences.length === 0 && (
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Sin reportes con estos filtros.</p>
                )}
                {filteredImpassable.map(r => (
                  <ImpassableCard key={r.way_id} report={r} token={auth.token}
                    onRefresh={load} myPosition={myPosition} />
                ))}
                {showMine && preferences.map(p => (
                  <PreferenceCard key={p.way_id} pref={p} token={auth.token} onRefresh={load} />
                ))}
              </>
            )
        }
      </div>
    </div>
  );
}
