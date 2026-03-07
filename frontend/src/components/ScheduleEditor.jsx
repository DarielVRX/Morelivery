// frontend/src/components/ScheduleEditor.jsx
import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client';

const DAY_NAMES = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];

const DEFAULT_DAY = (i) => ({ day_of_week: i, opens_at: '09:00', closes_at: '22:00', is_closed: false });

export default function ScheduleEditor({ token, isOpen: isOpenProp, onIsOpenChange }) {
  const [schedule, setSchedule]   = useState(() => Array.from({ length: 7 }, (_, i) => DEFAULT_DAY(i)));
  const [override, setOverride]   = useState(null);   // null | true | false
  const [isOpen, setIsOpen]       = useState(Boolean(isOpenProp));
  const [saving, setSaving]       = useState(false);
  const [toggling, setToggling]   = useState(false);
  const [msg, setMsg]             = useState({ text: '', ok: true });

  useEffect(() => {
    if (!token) return;
    apiFetch('/restaurants/my/schedule', {}, token).then(d => {
      // Normalizar HH:MM:SS → HH:MM para el <input type="time">
      setSchedule(d.schedule.map(s => ({
        ...s,
        opens_at:  s.opens_at  ? s.opens_at.slice(0, 5)  : '09:00',
        closes_at: s.closes_at ? s.closes_at.slice(0, 5) : '22:00',
      })));
      setOverride(d.manual_open_override);
    }).catch(() => {});

    apiFetch('/restaurants/my', {}, token).then(d => {
      if (d.restaurant) setIsOpen(d.restaurant.is_open);
    }).catch(() => {});
  }, [token]);

  function updateDay(i, field, value) {
    setSchedule(prev => prev.map((d, idx) => idx === i ? { ...d, [field]: value } : d));
  }

  async function saveSchedule() {
    setSaving(true); setMsg({ text: '', ok: true });
    try {
      await apiFetch('/restaurants/my/schedule', { method: 'PUT', body: JSON.stringify({ schedule }) }, token);
      setMsg({ text: 'Horario guardado', ok: true });
    } catch (e) { setMsg({ text: e.message, ok: false }); }
    finally { setSaving(false); }
  }

  async function doToggle(value) {
    setToggling(true); setMsg({ text: '', ok: true });
    try {
      const d = await apiFetch('/restaurants/my/toggle', { method: 'PATCH', body: JSON.stringify({ override: value }) }, token);
      setOverride(d.manual_open_override);
      setIsOpen(d.is_open);
      onIsOpenChange?.(d.is_open);
      const labels = { true: 'Abierto manualmente', false: 'Cerrado manualmente', null: 'Siguiendo horario' };
      setMsg({ text: labels[String(value)], ok: true });
    } catch (e) { setMsg({ text: e.message, ok: false }); }
    finally { setToggling(false); }
  }

  const overrideLabel = override === true ? 'Abierto forzado' : override === false ? 'Cerrado forzado' : 'Automático (por horario)';

  return (
    <div>
      {/* ── Estado actual + controles manuales ── */}
      <div style={{ display:'flex', alignItems:'center', flexWrap:'wrap', gap:'0.75rem',
        padding:'0.75rem 1rem', background:'#f9fafb', borderRadius:8,
        border:'1px solid #e5e7eb', marginBottom:'1rem' }}>
        <div style={{ flex: '0 0 auto' }}>
          <span style={{ color: isOpen ? '#16a34a' : '#dc2626', fontWeight: 700, fontSize: '1rem' }}>
            {isOpen ? '● Abierto' : '● Cerrado'}
          </span>
          <span style={{ color: '#9ca3af', fontSize: '0.78rem', marginLeft: '0.5rem' }}>({overrideLabel})</span>
        </div>
        <div style={{ display:'flex', gap:'0.4rem', flexWrap:'wrap' }}>
          <button onClick={() => doToggle(true)}  disabled={toggling || override === true}
            style={{ padding:'0.3rem 0.75rem', borderRadius:6, border:'none', cursor:'pointer',
              background: override === true  ? '#16a34a' : '#e5e7eb',
              color:      override === true  ? '#fff'    : '#374151', fontWeight:600, fontSize:'0.82rem' }}>
            Abrir ahora
          </button>
          <button onClick={() => doToggle(false)} disabled={toggling || override === false}
            style={{ padding:'0.3rem 0.75rem', borderRadius:6, border:'none', cursor:'pointer',
              background: override === false ? '#dc2626' : '#e5e7eb',
              color:      override === false ? '#fff'    : '#374151', fontWeight:600, fontSize:'0.82rem' }}>
            Cerrar ahora
          </button>
          {override !== null && (
            <button onClick={() => doToggle(null)} disabled={toggling}
              style={{ padding:'0.3rem 0.75rem', borderRadius:6, border:'1px solid #e5e7eb',
                background:'#fff', cursor:'pointer', fontSize:'0.82rem' }}>
              Seguir horario
            </button>
          )}
        </div>
      </div>

      {/* ── Horario semanal ── */}
      <div style={{ overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.875rem' }}>
          <thead>
            <tr style={{ background:'#f9fafb', borderBottom:'1px solid #e5e7eb' }}>
              <th style={{ padding:'0.45rem 0.75rem', textAlign:'left' }}>Día</th>
              <th style={{ padding:'0.45rem 0.75rem', textAlign:'center' }}>Cerrado</th>
              <th style={{ padding:'0.45rem 0.75rem', textAlign:'center' }}>Apertura</th>
              <th style={{ padding:'0.45rem 0.75rem', textAlign:'center' }}>Cierre</th>
            </tr>
          </thead>
          <tbody>
            {schedule.map((day, i) => (
              <tr key={i} style={{ borderBottom:'1px solid #f3f4f6', opacity: day.is_closed ? 0.45 : 1 }}>
                <td style={{ padding:'0.45rem 0.75rem', fontWeight:600 }}>{DAY_NAMES[i]}</td>
                <td style={{ padding:'0.45rem 0.75rem', textAlign:'center' }}>
                  <input type="checkbox" checked={Boolean(day.is_closed)}
                    onChange={e => updateDay(i, 'is_closed', e.target.checked)}
                    style={{ width:16, height:16, cursor:'pointer' }} />
                </td>
                <td style={{ padding:'0.45rem 0.75rem', textAlign:'center' }}>
                  <input type="time" value={day.opens_at || ''} disabled={day.is_closed}
                    onChange={e => updateDay(i, 'opens_at', e.target.value)}
                    style={{ padding:'0.2rem 0.4rem', borderRadius:4, border:'1px solid #e5e7eb',
                      width:90, fontSize:'0.875rem', background: day.is_closed ? '#f9fafb' : '#fff' }} />
                </td>
                <td style={{ padding:'0.45rem 0.75rem', textAlign:'center' }}>
                  <input type="time" value={day.closes_at || ''} disabled={day.is_closed}
                    onChange={e => updateDay(i, 'closes_at', e.target.value)}
                    style={{ padding:'0.2rem 0.4rem', borderRadius:4, border:'1px solid #e5e7eb',
                      width:90, fontSize:'0.875rem', background: day.is_closed ? '#f9fafb' : '#fff' }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display:'flex', alignItems:'center', gap:'0.75rem', marginTop:'0.75rem' }}>
        <button onClick={saveSchedule} disabled={saving} style={{ padding:'0.5rem 1.25rem', fontWeight:600 }}>
          {saving ? 'Guardando…' : 'Guardar horario'}
        </button>
        {msg.text && (
          <span style={{ fontSize:'0.875rem', color: msg.ok ? '#16a34a' : '#dc2626' }}>{msg.text}</span>
        )}
      </div>
    </div>
  );
}
