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

// ── Control de tiempo de preparación default ──────────────────────────────────
// En Schedule es el valor default que se guarda en DB y se usa al abrir cada día.
function PrepTimeDefault({ value, onChange, onSave, saving, saved }) {
  const OPTS = [5, 10, 15, 20, 30, 45, 60];
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: '0.875rem 1rem',
      marginBottom: '1.25rem',
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:'0.4rem', marginBottom:'0.6rem' }}>
        <span style={{ display:'inline-flex', alignItems:'center', color:'var(--brand)' }}><IconClock /></span>
        <span style={{ fontWeight:700, fontSize:'0.88rem', color:'var(--text-primary)' }}>
          Tiempo de preparación default
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
      <div style={{ display:'flex', gap:'0.3rem', flexWrap:'wrap', marginBottom:'0.65rem' }}>
        {OPTS.map(m => (
          <button key={m} onClick={() => onChange(m)}
            style={{
              padding: '0.3rem 0.7rem', border: '1px solid', borderRadius: 6, cursor: 'pointer',
              fontSize: '0.78rem', fontWeight: value === m ? 800 : 500,
              background: value === m ? 'var(--brand)' : 'var(--bg-raised)',
              color: value === m ? '#fff' : 'var(--text-secondary)',
              borderColor: value === m ? 'var(--brand)' : 'var(--border)',
              minHeight: 'unset',
            }}>
            {m} min
          </button>
        ))}
      </div>
      <button onClick={onSave} disabled={saving}
        className="btn-primary btn-sm"
        style={{ opacity: saving ? 0.65 : 1 }}>
        {saving ? 'Guardando…' : 'Guardar como default'}
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
