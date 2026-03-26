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
      {/* ── Clientes frecuentes ──────────────────────────────────────── */}
      <div style={{
        marginTop: '1rem',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '0.875rem 1rem',
      }}>
        <p style={{
          fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-tertiary)',
          textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem',
        }}>
          Clientes frecuentes
        </p>
        <label style={{
          display: 'flex', alignItems: 'flex-start', gap: '0.65rem', cursor: 'pointer',
        }}>
          <input
            type="checkbox"
            checked={allowFrequent}
            disabled={allowFrequentSaving}
            onChange={e => saveAllowFrequent(e.target.checked)}
            style={{ marginTop: 3, accentColor: 'var(--brand)', flexShrink: 0 }}
          />
          <div>
            <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.2rem' }}>
              Permitir que clientes frecuentes superen el límite de 1 pedido activo
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
              Por defecto los clientes solo pueden tener 1 pedido activo a la vez.
              Activar esto elimina esa restricción para quienes ya tienen 5+ pedidos en efectivo o 10+ en total.
              {allowFrequentSaving && <span style={{ color: 'var(--text-tertiary)', marginLeft: '0.5rem' }}>Guardando…</span>}
            </div>
          </div>
        </label>
        {allowFrequentMsg && (
          <p style={{
            fontSize: '0.78rem', marginTop: '0.4rem',
            color: allowFrequentMsg.startsWith('Error') ? 'var(--error)' : 'var(--success)',
          }}>
            {allowFrequentMsg.startsWith('Error') ? '' : '✓ '}{allowFrequentMsg}
          </p>
        )}
      </div>

    </div>
  );
}

export default function RestaurantSchedule() {
  const { auth } = useAuth();
  const [isOpen,    setIsOpen]    = useState(null);
  const [prepMins,  setPrepMins]  = useState(15);
  const [prepSaving, setPrepSaving] = useState(false);
  const [prepSaved,  setPrepSaved]  = useState(false);

  // Límite de efectivo
  const [cashLimit,       setCashLimit]       = useState('');

  // Clientes frecuentes
  const [allowFrequent,       setAllowFrequent]       = useState(false);
  const [allowFrequentSaving, setAllowFrequentSaving] = useState(false);
  const [allowFrequentMsg,    setAllowFrequentMsg]    = useState('');
  const [cashLimitSaving, setCashLimitSaving] = useState(false);
  const [cashLimitMsg,    setCashLimitMsg]    = useState('');

  useEffect(() => {
    if (!auth.token) return;
    apiFetch('/restaurants/my', {}, auth.token)
      .then(d => {
        if (d.restaurant) {
          setIsOpen(d.restaurant.is_open);
          if (d.restaurant.prep_time_estimate_s) {
            setPrepMins(Math.round(d.restaurant.prep_time_estimate_s / 60));
          }
          // Cargar límite de efectivo si está configurado
          const maxCash = d.restaurant.max_cash_cents;
          if (maxCash && maxCash > 0) {
            setCashLimit(String(maxCash / 100));
          }
          if (d.restaurant.allow_frequent_customers != null) {
            setAllowFrequent(Boolean(d.restaurant.allow_frequent_customers));
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

  async function saveAllowFrequent(val) {
    setAllowFrequentSaving(true);
    setAllowFrequentMsg('');
    try {
      await apiFetch('/restaurants/my/frequent-customers',
        { method: 'PATCH', body: JSON.stringify({ allow: val }) },
        auth.token);
      setAllowFrequent(val);
      setAllowFrequentMsg(val ? 'Activado.' : 'Desactivado.');
      setTimeout(() => setAllowFrequentMsg(''), 2500);
    } catch (e) {
      setAllowFrequentMsg(e.message || 'Error al guardar');
    } finally {
      setAllowFrequentSaving(false);
    }
  }

  async function saveCashLimit() {
    setCashLimitSaving(true);
    setCashLimitMsg('');
    try {
      const pesos = parseFloat(cashLimit);
      const cents = (!cashLimit.trim() || isNaN(pesos) || pesos <= 0) ? 0 : Math.round(pesos * 100);
      await apiFetch('/restaurants/my/cash-limit',
        { method: 'PATCH', body: JSON.stringify({ max_cash_cents: cents }) },
        auth.token);
      setCashLimitMsg(cents === 0 ? 'Límite eliminado.' : `Guardado: $${(cents / 100).toFixed(2)}`);
      setTimeout(() => setCashLimitMsg(''), 3000);
    } catch (e) {
      setCashLimitMsg(e.message || 'Error al guardar');
    } finally {
      setCashLimitSaving(false);
    }
  }

  return (
    <div style={{ backgroundColor:'var(--bg-base)', minHeight:'100vh', padding:'1rem' }}>

      {/* ── Encabezado Horario ─────────────────────────────────────────── */}
      <div style={{ margin:'-1rem -1rem 1.25rem', padding:'0.75rem 1rem 0.65rem', background:'linear-gradient(135deg, #c97b7b 0%, #b56060 60%, #9e4f4f 100%)', color:'#fff' }}>
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

      {/* ── Límite de pago en efectivo ──────────────────────────────── */}
      <div style={{
        marginTop: '1.25rem',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '0.875rem 1rem',
      }}>
        <div style={{ display:'flex', alignItems:'center', gap:'0.4rem', marginBottom:'0.5rem' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display:'block', flexShrink:0 }}>
            <rect x="2" y="6" width="20" height="12" rx="2"/>
            <circle cx="12" cy="12" r="2"/>
            <path d="M6 12h.01M18 12h.01"/>
          </svg>
          <span style={{ fontWeight:700, fontSize:'0.88rem', color:'var(--text-primary)' }}>
            Límite de pago en efectivo
          </span>
        </div>
        <p style={{ fontSize:'0.78rem', color:'var(--text-secondary)', marginBottom:'0.65rem', lineHeight:1.4 }}>
          Pedidos en efectivo que superen este monto serán rechazados. Deja vacío o en 0 para no tener límite.
        </p>
        <div style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
          <div style={{ position:'relative', flex:1 }}>
            <span style={{
              position:'absolute', left:'0.65rem', top:'50%', transform:'translateY(-50%)',
              fontSize:'0.9rem', color:'var(--text-secondary)', pointerEvents:'none', userSelect:'none',
            }}>$</span>
            <input
              type="number"
              min="0"
              step="1"
              value={cashLimit}
              onChange={e => setCashLimit(e.target.value)}
              placeholder="0 = sin límite"
              style={{ width:'100%', paddingLeft:'1.5rem', boxSizing:'border-box' }}
            />
          </div>
          <button
            className="btn-primary btn-sm"
            style={{ flexShrink:0, opacity: cashLimitSaving ? 0.65 : 1 }}
            disabled={cashLimitSaving}
            onClick={saveCashLimit}>
            {cashLimitSaving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
        {cashLimitMsg && (
          <p style={{
            fontSize:'0.78rem', marginTop:'0.4rem',
            color: cashLimitMsg.startsWith('Error') ? 'var(--error)' : 'var(--success)',
          }}>
            {cashLimitMsg.startsWith('Error') ? '' : '✓ '}{cashLimitMsg}
          </p>
        )}
      </div>

    </div>
  );
}
