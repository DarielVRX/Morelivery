// frontend/src/components/ScheduleEditor.jsx
// CORRECCIONES aplicadas:
//   1. readOnlyToggle — prop implementada. Cuando es true, los botones de toggle
//      manual (Abrir ahora / Cerrar ahora / Seguir horario) quedan deshabilitados
//      y visualmente opacos. El padre puede pasarla para modo de solo lectura.

import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client';

const DAY_NAMES = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];

const DEFAULT_DAY = (i) => ({ day_of_week: i, opens_at: '09:00', closes_at: '22:00', is_closed: false });

// FIX: se agrega readOnlyToggle a la firma de props.
// Cuando readOnlyToggle=true los controles manuales se deshabilitan.
export default function ScheduleEditor({ token, isOpen: isOpenProp, onIsOpenChange, readOnlyToggle = false }) {
  const [schedule, setSchedule]   = useState(() => Array.from({ length: 7 }, (_, i) => DEFAULT_DAY(i)));
  const [override, setOverride]   = useState(null);   // null | true | false
  const [isOpen, setIsOpen]       = useState(Boolean(isOpenProp));
  const [saving, setSaving]       = useState(false);
  const [toggling, setToggling]   = useState(false);
  const [msg, setMsg]             = useState({ text: '', ok: true });

  useEffect(() => {
    if (!token) return;
    apiFetch('/restaurants/my/schedule', {}, token).then(d => {
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

      {/* ── Horario semanal ── */}
      <div style={{ overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.875rem' }}>
          <thead>
            <tr style={{ background:'var(--bg-sunken)', borderBottom:'1px solid var(--border)' }}>
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
                    style={{ padding:'0.2rem 0.4rem', borderRadius:4, border:'1px solid var(--border)',
                      width:90, fontSize:'0.875rem',
                      background: day.is_closed ? 'var(--bg-sunken)' : 'var(--bg-card)',
                      color: 'var(--text-primary)' }} />
                </td>
                <td style={{ padding:'0.45rem 0.75rem', textAlign:'center' }}>
                  <input type="time" value={day.closes_at || ''} disabled={day.is_closed}
                    onChange={e => updateDay(i, 'closes_at', e.target.value)}
                    style={{ padding:'0.2rem 0.4rem', borderRadius:4, border:'1px solid var(--border)',
                      width:90, fontSize:'0.875rem',
                      background: day.is_closed ? 'var(--bg-sunken)' : 'var(--bg-card)',
                      color: 'var(--text-primary)' }} />
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
