import { useAuth } from '../../contexts/AuthContext';
import ScheduleEditor from '../../components/ScheduleEditor';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../api/client';

// ── Iconos SVG ────────────────────────────────────────────────────────────────
function IconSchedule() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ display:'block' }}>
      <rect x="3" y="4" width="18" height="18" rx="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
      <circle cx="12" cy="16" r="3"/>
      <polyline points="12 14.5 12 16 13 17"/>
    </svg>
  );
}
function IconClock() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display:'block' }}>
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>
  );
}

// ── Control de tiempo de preparación predeterminado ─────────────────────────
function PrepTimeDefault({ value, onChange, onSave, saving, saved }) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: '0.875rem 1rem',
      marginBottom: '1.25rem',
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:'0.4rem', marginBottom:'0.6rem' }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{display:'block',flexShrink:0}}>
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
        <span style={{ fontWeight:700, fontSize:'0.88rem', color:'var(--text-primary)' }}>
          Tiempo de preparación predeterminado
        </span>
        {saved && (
          <span style={{ fontSize:'0.72rem', color:'var(--success)', fontWeight:700, marginLeft:'auto' }}>
            ✓ Guardado
          </span>
        )}
      </div>
      <p style={{ fontSize:'0.78rem', color:'var(--text-secondary)', marginBottom:'0.65rem', lineHeight:1.4 }}>
        Estimado inicial al comenzar el día. El motor lo puede ajustar automáticamente según el historial.
      </p>
      <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'0.65rem' }}>
        <button onClick={() => onChange(Math.max(1, value - 1))}
          style={{ width:36, height:36, borderRadius:8, border:'1px solid var(--border)',
            background:'var(--bg-raised)', color:'var(--text-primary)', cursor:'pointer',
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:'1.1rem', fontWeight:700, minHeight:'unset', flexShrink:0 }}>−</button>
        <div style={{ display:'flex', alignItems:'center', gap:'0.3rem' }}>
          <input
            type="text" inputMode="numeric"
            value={value}
            onChange={e => { const n = parseInt(e.target.value, 10); if (!isNaN(n) && n > 0) onChange(n); }}
            style={{
              width:56, textAlign:'center',
              fontWeight:800, fontSize:'1.1rem',
              border:'1px solid var(--border)', borderRadius:8,
              padding:'0.3rem 0', color:'var(--text-primary)',
            }}
          />
          <span style={{ fontSize:'0.85rem', color:'var(--text-secondary)' }}>min</span>
        </div>
        <button onClick={() => onChange(value + 1)}
          style={{ width:36, height:36, borderRadius:8, border:'1px solid var(--border)',
            background:'var(--bg-raised)', color:'var(--text-primary)', cursor:'pointer',
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:'1.1rem', fontWeight:700, minHeight:'unset', flexShrink:0 }}>+</button>
      </div>
      <button onClick={onSave} disabled={saving}
        className="btn-primary btn-sm"
        style={{ opacity: saving ? 0.65 : 1 }}>
        {saving ? 'Guardando…' : 'Guardar como predeterminado'}
      </button>
    </div>
  );
}

export default function RestaurantSchedule() {
  const { auth } = useAuth();
  const [isOpen,    setIsOpen]    = useState(null);
  const [prepMins,  setPrepMins]  = useState(15);
  const [prepSaving, setPrepSaving] = useState(false);
  const [prepSaved,  setPrepSaved]  = useState(false);

  useEffect(() => {
    if (!auth.token) return;
    apiFetch('/restaurants/my', {}, auth.token)
      .then(d => {
        if (d.restaurant) {
          setIsOpen(d.restaurant.is_open);
          // Cargar el estimado guardado si existe
          if (d.restaurant.prep_time_estimate_s) {
            setPrepMins(Math.round(d.restaurant.prep_time_estimate_s / 60));
          }
        }
      })
      .catch(() => {});
  }, [auth.token]);

  async function savePrepDefault() {
    setPrepSaving(true);
    try {
      await apiFetch('/restaurants/my/prep-estimate',
        { method: 'PATCH', body: JSON.stringify({ prep_time_estimate_s: Math.round(prepMins * 60) }) },
        auth.token);
      setPrepSaved(true);
      setTimeout(() => setPrepSaved(false), 2500);
    } catch (_) {}
    finally { setPrepSaving(false); }
  }

  return (
    <div style={{ backgroundColor:'var(--bg-base)', minHeight:'100vh', padding:'1rem' }}>

      {/* ── Encabezado Horario ─────────────────────────────────────────── */}
      <div style={{ margin:'-1rem -1rem 1.25rem', padding:'0.75rem 1rem 0.65rem', background:'var(--promo-gradient)', color:'#fff' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', fontWeight:800, fontSize:'1.05rem', letterSpacing:'-0.01em' }}>
              <IconSchedule />
              Horario de atención
            </div>
            <div style={{ fontSize:'0.75rem', opacity:0.85, marginTop:'0.1rem' }}>
              Configura cuándo recibes pedidos
            </div>
          </div>
          {isOpen !== null && (
            <span style={{ fontWeight:700, fontSize:'0.82rem', padding:'0.2rem 0.65rem',
              background: isOpen ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)',
              borderRadius:20, border:'1px solid rgba(255,255,255,0.3)' }}>
              {isOpen ? '● Abierto' : '● Cerrado'}
            </span>
          )}
        </div>
      </div>

      {/* ── Control de tiempo de preparación default ─────────────────── */}
      <PrepTimeDefault
        value={prepMins}
        onChange={setPrepMins}
        onSave={savePrepDefault}
        saving={prepSaving}
        saved={prepSaved}
      />

      <ScheduleEditor
        token={auth.token}
        isOpen={isOpen}
        onIsOpenChange={setIsOpen}
      />
    </div>
  );
}
