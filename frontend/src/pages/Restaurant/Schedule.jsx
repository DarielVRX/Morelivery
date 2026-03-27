// frontend/src/pages/Restaurant/Schedule.jsx
// Paso 8: horario 100% manual.
// - El toggle de apertura/cierre es el único mecanismo — no hay apertura automática.
// - El horario semanal sirve SOLO para los recordatorios push (no abre automáticamente).
// - Se elimina la opción de "volver a automático" del toggle.
// - Banner informativo explica que los recordatorios avisarán a la hora configurada.

import { useAuth } from '../../contexts/AuthContext';
import ScheduleEditor from '../../components/ScheduleEditor';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../api/client';

function IconSchedule() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ display:'block' }}>
      <rect x="3" y="4" width="18" height="18" rx="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8"  y1="2" x2="8"  y2="6"/>
      <line x1="3"  y1="10" x2="21" y2="10"/>
      <circle cx="12" cy="16" r="3"/>
      <polyline points="12 14.5 12 16 13 17"/>
    </svg>
  );
}

// ── Control de tiempo de preparación predeterminado ──────────────────────────
function PrepTimeDefault({ value, onChange, onSave, saving, saved }) {
  return (
    <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)',
      borderRadius:10, padding:'0.875rem 1rem', marginBottom:'1.25rem' }}>
      <div style={{ display:'flex', alignItems:'center', gap:'0.4rem', marginBottom:'0.6rem' }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--brand)"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ display:'block', flexShrink:0 }}>
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
            style={{ width:56, textAlign:'center', fontWeight:800, fontSize:'1.1rem',
              border:'1px solid var(--border)', borderRadius:8,
              padding:'0.3rem 0', color:'var(--text-primary)' }}
          />
          <span style={{ fontSize:'0.85rem', color:'var(--text-secondary)' }}>min</span>
        </div>
        <button onClick={() => onChange(value + 1)}
          style={{ width:36, height:36, borderRadius:8, border:'1px solid var(--border)',
            background:'var(--bg-raised)', color:'var(--text-primary)', cursor:'pointer',
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:'1.1rem', fontWeight:700, minHeight:'unset', flexShrink:0 }}>+</button>
      </div>
      <button onClick={onSave} disabled={saving} className="btn-primary btn-sm"
        style={{ opacity: saving ? 0.65 : 1 }}>
        {saving ? 'Guardando…' : 'Guardar como predeterminado'}
      </button>

      {/* Clientes frecuentes */}
      <div style={{ marginTop:'1rem', background:'var(--bg-card)', border:'1px solid var(--border)',
        borderRadius:10, padding:'0.875rem 1rem' }}>
        <p style={{ fontSize:'0.72rem', fontWeight:700, color:'var(--text-tertiary)',
          textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'0.5rem' }}>
          Clientes frecuentes
        </p>
        <label style={{ display:'flex', alignItems:'flex-start', gap:'0.65rem', cursor:'pointer' }}>
          <input
            type="checkbox"
            checked={allowFrequent}
            disabled={allowFrequentSaving}
            onChange={e => saveAllowFrequent(e.target.checked)}
            style={{ marginTop:3, accentColor:'var(--brand)', flexShrink:0 }}
          />
          <div>
            <div style={{ fontSize:'0.88rem', fontWeight:700, color:'var(--text-primary)', marginBottom:'0.2rem' }}>
              Permitir que clientes frecuentes superen el límite de 1 pedido activo
            </div>
            <div style={{ fontSize:'0.78rem', color:'var(--text-secondary)', lineHeight:1.4 }}>
              Por defecto los clientes solo pueden tener 1 pedido activo a la vez.
              Activar esto elimina esa restricción para quienes ya tienen 5+ pedidos en efectivo o 10+ en total.
              {allowFrequentSaving && <span style={{ color:'var(--text-tertiary)', marginLeft:'0.5rem' }}>Guardando…</span>}
            </div>
          </div>
        </label>
        {allowFrequentMsg && (
          <p style={{ fontSize:'0.78rem', marginTop:'0.4rem',
            color: allowFrequentMsg.startsWith('Error') ? 'var(--error)' : 'var(--success)' }}>
            {allowFrequentMsg.startsWith('Error') ? '' : '✓ '}{allowFrequentMsg}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Toggle manual de apertura ─────────────────────────────────────────────────
function ManualToggle({ isOpen, saving, onToggle }) {
  return (
    <div style={{ background:'var(--bg-card)', border:`2px solid ${isOpen ? 'var(--success)' : 'var(--border)'}`,
      borderRadius:12, padding:'1rem', marginBottom:'1.25rem', transition:'border-color 0.2s' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'1rem' }}>
        <div>
          <div style={{ fontWeight:800, fontSize:'0.95rem', color:'var(--text-primary)', marginBottom:'0.2rem' }}>
            {isOpen ? '🟢 Abierto — recibiendo pedidos' : '🔴 Cerrado — no recibe pedidos'}
          </div>
          <div style={{ fontSize:'0.75rem', color:'var(--text-secondary)', lineHeight:1.4 }}>
            {isOpen
              ? 'Toca para cerrar tu tienda. Los pedidos en curso no se cancelan.'
              : 'Toca para abrir tu tienda y empezar a recibir pedidos.'}
          </div>
        </div>
        <button
          onClick={() => onToggle(!isOpen)}
          disabled={saving}
          style={{
            padding:'0.65rem 1.25rem',
            borderRadius:20,
            fontWeight:800,
            fontSize:'0.88rem',
            border:'none',
            cursor: saving ? 'wait' : 'pointer',
            flexShrink: 0,
            background: isOpen ? '#dc2626' : 'var(--success)',
            color: '#fff',
            opacity: saving ? 0.6 : 1,
            transition: 'background 0.15s',
            minWidth: 90,
          }}>
          {saving ? '…' : isOpen ? 'Cerrar' : 'Abrir'}
        </button>
      </div>
    </div>
  );
}

export default function RestaurantSchedule() {
  const { auth } = useAuth();
  const [isOpen,     setIsOpen]     = useState(null);
  const [toggleSaving, setToggleSaving] = useState(false);
  const [prepMins,   setPrepMins]   = useState(15);
  const [prepSaving, setPrepSaving] = useState(false);
  const [prepSaved,  setPrepSaved]  = useState(false);
  const [cashLimit,  setCashLimit]  = useState('');
  const [allowFrequent,        setAllowFrequent]       = useState(false);
  const [allowFrequentSaving,  setAllowFrequentSaving] = useState(false);
  const [allowFrequentMsg,     setAllowFrequentMsg]    = useState('');
  const [cashLimitSaving, setCashLimitSaving] = useState(false);
  const [cashLimitMsg,    setCashLimitMsg]    = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!auth.token) return;
    apiFetch('/restaurants/my', {}, auth.token)
      .then(d => {
        if (d.restaurant) {
          setIsOpen(d.restaurant.is_open);
          if (d.restaurant.prep_time_estimate_s)
            setPrepMins(Math.round(d.restaurant.prep_time_estimate_s / 60));
          const maxCash = d.restaurant.max_cash_cents;
          if (maxCash && maxCash > 0) setCashLimit(String(maxCash / 100));
          if (d.restaurant.allow_frequent_customers != null)
            setAllowFrequent(Boolean(d.restaurant.allow_frequent_customers));
        }
      })
      .catch(() => {});
  }, [auth.token]);

  // Listener de acciones desde notificaciones push (abrir/cerrar desde el push)
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    function onMessage(event) {
      const { type, action } = event.data || {};
      if (type !== 'NOTIFICATION_ACTION') return;

      if (action === 'open_restaurant') {
        handleToggle(true);
      }
      if (action === 'close_restaurant') {
        handleToggle(false);
      }
    }

    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [auth.token]); // handleToggle usa auth.token internamente

  // Apertura/cierre manual estricto — override: true|false, NUNCA null
  async function handleToggle(open) {
    setToggleSaving(true);
    try {
      const r = await apiFetch('/restaurants/my/toggle',
        { method:'PATCH', body: JSON.stringify({ override: open }) },
        auth.token);
      setIsOpen(r.is_open);

      // Cancelar timer de recordatorio push en el SW si abrimos manualmente
      if (open && 'serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration().catch(() => null);
        reg?.active?.postMessage({ type: 'APP_FOCUSED' }); // limpia badges/timers
      }
    } catch (e) {
      setMsg(e.message || 'Error al cambiar estado');
      setTimeout(() => setMsg(''), 3000);
    } finally {
      setToggleSaving(false);
    }
  }

  async function savePrepDefault() {
    setPrepSaving(true);
    try {
      await apiFetch('/restaurants/my/prep-estimate',
        { method:'PATCH', body: JSON.stringify({ prep_time_estimate_s: Math.round(prepMins * 60) }) },
        auth.token);
      setPrepSaved(true);
      setTimeout(() => setPrepSaved(false), 2500);
    } catch (_) {}
    finally { setPrepSaving(false); }
  }

  async function saveAllowFrequent(val) {
    setAllowFrequentSaving(true); setAllowFrequentMsg('');
    try {
      await apiFetch('/restaurants/my/frequent-customers',
        { method:'PATCH', body: JSON.stringify({ allow: val }) }, auth.token);
      setAllowFrequent(val);
      setAllowFrequentMsg(val ? 'Activado.' : 'Desactivado.');
      setTimeout(() => setAllowFrequentMsg(''), 2500);
    } catch (e) { setAllowFrequentMsg(e.message || 'Error al guardar'); }
    finally { setAllowFrequentSaving(false); }
  }

  async function saveCashLimit() {
    setCashLimitSaving(true); setCashLimitMsg('');
    try {
      const pesos = parseFloat(cashLimit);
      const cents = (!cashLimit.trim() || isNaN(pesos) || pesos <= 0) ? 0 : Math.round(pesos * 100);
      await apiFetch('/restaurants/my/cash-limit',
        { method:'PATCH', body: JSON.stringify({ max_cash_cents: cents }) }, auth.token);
      setCashLimitMsg(cents === 0 ? 'Límite eliminado.' : `Guardado: $${(cents / 100).toFixed(2)}`);
      setTimeout(() => setCashLimitMsg(''), 3000);
    } catch (e) { setCashLimitMsg(e.message || 'Error al guardar'); }
    finally { setCashLimitSaving(false); }
  }

  return (
    <div style={{ backgroundColor:'var(--bg-base)', minHeight:'100vh', padding:'1rem' }}>

      {/* Header */}
      <div style={{ margin:'-1rem -1rem 1.25rem', padding:'0.75rem 1rem 0.65rem',
        background:'linear-gradient(135deg, #c97b7b 0%, #b56060 60%, #9e4f4f 100%)', color:'#fff' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:'0.5rem',
              fontWeight:800, fontSize:'1.05rem', letterSpacing:'-0.01em' }}>
              <IconSchedule /> Horario y apertura
            </div>
            <div style={{ fontSize:'0.75rem', opacity:0.85, marginTop:'0.1rem' }}>
              Apertura 100% manual — el horario solo envía recordatorios
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

      {msg && (
        <div className="flash flash-error" style={{ marginBottom:'1rem' }}>{msg}</div>
      )}

      {/* Toggle manual prominente */}
      {isOpen !== null && (
        <ManualToggle isOpen={isOpen} saving={toggleSaving} onToggle={handleToggle} />
      )}

      {/* Banner informativo — horario como recordatorio */}
      <div style={{ background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:10,
        padding:'0.75rem 1rem', marginBottom:'1.25rem', fontSize:'0.8rem',
        color:'#1e40af', lineHeight:1.5 }}>
        <div style={{ fontWeight:700, marginBottom:'0.25rem' }}>
          📅 ¿Para qué sirve el horario de abajo?
        </div>
        Tu tienda <strong>no se abre automáticamente</strong> — siempre necesitas
        tocar el botón de arriba. El horario configura a qué hora recibirás
        un <strong>recordatorio push</strong> con un botón de apertura rápida.
        Así nunca se te olvidará abrir sin que pase algo inesperado.
      </div>

      {/* Control de prep time */}
      <PrepTimeDefault
      value={prepMins}
      onChange={setPrepMins}
      onSave={savePrepDefault}
      saving={prepSaving}
      saved={prepSaved}
      allowFrequent={allowFrequent}
      allowFrequentSaving={allowFrequentSaving}
      onToggleAllowFrequent={saveAllowFrequent}
      allowFrequentMsg={allowFrequentMsg}
      />

      {/* Editor de horario — solo para recordatorios */}
      <div style={{ marginBottom:'0.5rem' }}>
        <div style={{ fontSize:'0.78rem', fontWeight:700, color:'var(--text-secondary)',
          textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'0.5rem' }}>
          Horario de recordatorios
        </div>
      </div>
      <ScheduleEditor
        token={auth.token}
        isOpen={isOpen}
        onIsOpenChange={setIsOpen}
        readOnlyToggle  // ← nueva prop: el ScheduleEditor NO muestra su propio toggle
      />

      {/* Límite de efectivo */}
      <div style={{ marginTop:'1.25rem', background:'var(--bg-card)',
        border:'1px solid var(--border)', borderRadius:10, padding:'0.875rem 1rem' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'0.4rem', marginBottom:'0.5rem' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
            stroke="var(--brand)" strokeWidth="2" strokeLinecap="round"
            strokeLinejoin="round" style={{ display:'block', flexShrink:0 }}>
            <rect x="2" y="6" width="20" height="12" rx="2"/>
            <circle cx="12" cy="12" r="2"/>
            <path d="M6 12h.01M18 12h.01"/>
          </svg>
          <span style={{ fontWeight:700, fontSize:'0.88rem', color:'var(--text-primary)' }}>
            Límite de pago en efectivo
          </span>
        </div>
        <p style={{ fontSize:'0.78rem', color:'var(--text-secondary)', marginBottom:'0.65rem', lineHeight:1.4 }}>
          Pedidos en efectivo que superen este monto serán rechazados. Deja en 0 para no tener límite.
        </p>
        <div style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
          <div style={{ position:'relative', flex:1 }}>
            <span style={{ position:'absolute', left:'0.65rem', top:'50%', transform:'translateY(-50%)',
              fontSize:'0.9rem', color:'var(--text-secondary)', pointerEvents:'none' }}>$</span>
            <input type="number" min="0" step="1" value={cashLimit}
              onChange={e => setCashLimit(e.target.value)}
              placeholder="0 = sin límite"
              style={{ width:'100%', paddingLeft:'1.5rem', boxSizing:'border-box' }} />
          </div>
          <button className="btn-primary btn-sm" style={{ flexShrink:0, opacity: cashLimitSaving ? 0.65 : 1 }}
            disabled={cashLimitSaving} onClick={saveCashLimit}>
            {cashLimitSaving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
        {cashLimitMsg && (
          <p style={{ fontSize:'0.78rem', marginTop:'0.4rem',
            color: cashLimitMsg.startsWith('Error') ? 'var(--error)' : 'var(--success)' }}>
            {cashLimitMsg.startsWith('Error') ? '' : '✓ '}{cashLimitMsg}
          </p>
        )}
      </div>
    </div>
  );
}
