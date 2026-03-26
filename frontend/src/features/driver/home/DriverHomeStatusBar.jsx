// frontend/src/features/driver/home/DriverHomeStatusBar.jsx
import { useEffect, useState } from 'react';
import { updateBagCapacity, fetchBagCapacity } from '../alerts/api';
import { useAuth } from '../../../contexts/AuthContext';

function BagCapacityModal({ isOpen, onClose, currentLiters, onSave, token }) {
  const [liters, setLiters] = useState(currentLiters);
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  useEffect(() => { setLiters(currentLiters); }, [currentLiters]);

  if (!isOpen) return null;

  const handleSave = async () => {
    const val = parseFloat(liters);
    if (isNaN(val) || val < 1)   { setError('La capacidad debe ser al menos 1 litro'); return; }
    if (val > 200)               { setError('La capacidad no puede exceder 200 litros'); return; }
    setSaving(true); setError('');
    try {
      await updateBagCapacity(val, token);
      onSave(val); onClose();
    } catch (e) { setError(e.message || 'Error al guardar'); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ position:'fixed', inset:0, zIndex:1000, background:'rgba(0,0,0,0.5)',
      display:'flex', alignItems:'center', justifyContent:'center' }} onClick={onClose}>
      <div style={{ background:'var(--bg-card)', borderRadius:16, padding:'1.25rem',
        width:'90%', maxWidth:320, boxShadow:'0 20px 40px rgba(0,0,0,0.3)' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight:700, fontSize:'1rem', marginBottom:'0.5rem' }}>🎒 Capacidad de mochila</div>
        <div style={{ fontSize:'0.75rem', color:'var(--text-secondary)', marginBottom:'1rem' }}>
          Define cuántos litros puedes cargar.
        </div>
        <input type="number" value={liters} onChange={e => setLiters(e.target.value)}
          step="1" min="1" max="200"
          style={{ width:'100%', padding:'0.6rem', borderRadius:10,
            border:'1px solid var(--border)', background:'var(--bg-input)',
            fontSize:'1rem', marginBottom:'0.5rem' }} />
        {error && <div style={{ fontSize:'0.7rem', color:'#dc2626', marginBottom:'0.75rem' }}>{error}</div>}
        <div style={{ display:'flex', gap:'0.5rem' }}>
          <button onClick={handleSave} disabled={saving}
            style={{ flex:1, padding:'0.6rem', borderRadius:10, background:'var(--brand)',
              color:'#fff', border:'none', fontWeight:600, cursor:saving ? 'wait' : 'pointer',
              opacity:saving ? 0.6 : 1 }}>
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
          <button onClick={onClose}
            style={{ flex:1, padding:'0.6rem', borderRadius:10, background:'var(--bg-raised)',
              border:'1px solid var(--border)', cursor:'pointer', fontWeight:600 }}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Iconos ────────────────────────────────────────────────────────────────────
function IconHandLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 11V6a2 2 0 00-2-2 2 2 0 00-2 2v5"/>
      <path d="M14 10V4a2 2 0 00-2-2 2 2 0 00-2 2v6"/>
      <path d="M10 10V5a2 2 0 00-2-2 2 2 0 00-2 2v9"/>
      <path d="M6 14v-3a2 2 0 00-4 0v6a8 8 0 0016 0v-5a2 2 0 00-4 0"/>
    </svg>
  );
}
function IconHandRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: 'scaleX(-1)' }}>
      <path d="M18 11V6a2 2 0 00-2-2 2 2 0 00-2 2v5"/>
      <path d="M14 10V4a2 2 0 00-2-2 2 2 0 00-2 2v6"/>
      <path d="M10 10V5a2 2 0 00-2-2 2 2 0 00-2 2v9"/>
      <path d="M6 14v-3a2 2 0 00-4 0v6a8 8 0 0016 0v-5a2 2 0 00-4 0"/>
    </svg>
  );
}
function IconGPS({ ok }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
      {!ok && <line x1="2" y1="2" x2="22" y2="22" stroke="#ef4444"/>}
    </svg>
  );
}

export default function DriverHomeStatusBar({
  availability,
  onToggleAvailability,
  msg,
  onDismissMsg,
  transferBanner,
  onDismissTransferBanner,
  counters,
  bagPct = null,
  handMode = 'left',
  onToggleHandMode,
  gpsError = null,
}) {
  const { auth, patchUser } = useAuth();
  const [showBagModal,       setShowBagModal]       = useState(false);
  const [currentBagCapacity, setCurrentBagCapacity] = useState(null);

  useEffect(() => {
    if (!auth.token) return;
    fetchBagCapacity(auth.token)
      .then(cap => setCurrentBagCapacity(cap))
      .catch(() => {});
  }, [auth.token]);

  // Vibrar + alerta si GPS se pierde
  useEffect(() => {
    if (!gpsError) return;
    if (navigator?.vibrate) navigator.vibrate([200, 100, 200]);
  }, [gpsError]);

  const earnings   = counters?.session_earnings_cents
    ? `$${(counters.session_earnings_cents / 100).toFixed(0)}`
    : null;
  const deliveries = counters?.session_deliveries ?? 0;

  const handleSaveBagCapacity = (newLiters) => {
    setCurrentBagCapacity(newLiters);
    patchUser?.({ driver: { ...(auth.user?.driver || {}), bag_capacity_liters: newLiters } });
  };

  const isRight = handMode === 'right';

  return (
    <>
      <div style={{
        flexShrink: 0,
        background: 'linear-gradient(135deg, #c97b7b 0%, #b56060 60%, #9e4f4f 100%)',
        padding: '0.5rem 1rem',
        display: 'flex',
        flexDirection: isRight ? 'row-reverse' : 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 8,
        zIndex: 10,
      }}>
        {/* Stats del día + mochila */}
        <div style={{
          display:'flex', gap:'0.75rem', alignItems:'center',
          fontSize:'0.74rem', color:'rgba(255,255,255,0.9)', minWidth:0,
          flexDirection: isRight ? 'row-reverse' : 'row',
        }}>
          <span style={{ fontWeight:600 }}>
            <span style={{ opacity:0.7, fontSize:'0.68rem' }}>Hoy </span>
            {earnings ?? '$0'}
          </span>
          <span style={{ display:'flex', alignItems:'center', gap:3 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
              stroke="rgba(255,255,255,0.85)" strokeWidth="2.5" strokeLinecap="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            {deliveries}
          </span>

          {/* Indicador GPS */}
          <button
            title={gpsError || 'GPS activo'}
            style={{
              background: gpsError ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.12)',
              border: gpsError ? '1px solid rgba(239,68,68,0.5)' : '1px solid rgba(255,255,255,0.2)',
              borderRadius: 8, padding:'0.15rem 0.35rem', cursor:'default',
              display:'flex', alignItems:'center', gap:3,
              color: gpsError ? '#fca5a5' : 'rgba(255,255,255,0.85)',
            }}>
            <IconGPS ok={!gpsError} />
            {gpsError && <span style={{ fontSize:'0.62rem', fontWeight:700 }}>GPS</span>}
          </button>

          {/* Mochila */}
          <button onClick={() => setShowBagModal(true)}
            style={{ display:'flex', alignItems:'center', gap:3, background:'none',
              border:'none', cursor:'pointer', padding:'0.2rem 0.3rem', borderRadius:12,
              color:'rgba(255,255,255,0.9)' }}
            title={`Capacidad: ${currentBagCapacity ?? '?'} litros`}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
              <line x1="3" y1="6" x2="21" y2="6"/>
              <path d="M16 10a4 4 0 01-8 0"/>
            </svg>
            <span style={{ fontSize:'0.68rem', fontWeight:500 }}>
              {currentBagCapacity ?? '?'}L
            </span>
          </button>

          {bagPct !== null && (
            <span style={{ fontSize:'0.68rem', opacity:0.85 }}>{bagPct}%</span>
          )}
        </div>

        {/* Controles derecha/izquierda según handMode */}
        <div style={{ display:'flex', gap:6, alignItems:'center',
          flexDirection: isRight ? 'row-reverse' : 'row' }}>

          {/* Toggle modo de mano */}
          <button onClick={onToggleHandMode}
            title={isRight ? 'Modo mano derecha — cambiar a izquierda' : 'Modo mano izquierda — cambiar a derecha'}
            style={{
              background: 'rgba(255,255,255,0.15)', border:'1px solid rgba(255,255,255,0.3)',
              borderRadius:8, padding:'0.25rem 0.4rem', cursor:'pointer',
              color:'rgba(255,255,255,0.85)', display:'flex', alignItems:'center',
            }}>
            {isRight ? <IconHandRight /> : <IconHandLeft />}
          </button>

          {/* Toggle disponibilidad — botón grande */}
          <button
            onClick={onToggleAvailability}
            style={{
              padding: '0.45rem 1rem',
              borderRadius: 20,
              fontWeight: 800,
              fontSize: '0.82rem',
              border: 'none',
              cursor: 'pointer',
              background: availability ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.2)',
              color: availability ? '#9e4f4f' : 'rgba(255,255,255,0.9)',
              transition: 'all 0.15s',
              minWidth: 110,
            }}>
            {availability ? '● Disponible' : '○ No disponible'}
          </button>
        </div>
      </div>

      {/* Flash message */}
      {msg && (
        <div className="flash flash-error" style={{
          flexShrink:0, borderRadius:0, margin:0,
          display:'flex', justifyContent:'space-between',
        }}>
          <span style={{ fontSize:'0.83rem' }}>{msg}</span>
          <button onClick={onDismissMsg}
            style={{ border:'none', background:'none', cursor:'pointer', fontWeight:700 }}>✕</button>
        </div>
      )}

      {/* GPS error banner */}
      {gpsError && (
        <div style={{
          flexShrink:0, background:'#fef2f2', borderBottom:'2px solid #ef4444',
          padding:'0.4rem 1rem', fontSize:'0.75rem', color:'#dc2626',
          display:'flex', alignItems:'center', gap:6, fontWeight:600,
        }}>
          <IconGPS ok={false} />
          {gpsError}
        </div>
      )}

      {/* Transfer banner */}
      {transferBanner && (
        <div style={{
          flexShrink:0, zIndex:25,
          background: transferBanner.type === 'order_transferred_in' ? 'var(--success-bg)' : 'var(--warn-bg)',
          borderBottom: `2px solid ${transferBanner.type === 'order_transferred_in' ? 'var(--success)' : 'var(--warn)'}`,
          padding:'0.6rem 1rem', display:'flex', justifyContent:'space-between', alignItems:'center',
        }}>
          <span style={{ fontSize:'0.82rem', fontWeight:600, color:'var(--text-primary)' }}>
            {transferBanner.type === 'order_transferred_in'
              ? 'Se te asignó un pedido transferido'
              : 'Un pedido fue reasignado a otro conductor'}
          </span>
          <button onClick={onDismissTransferBanner}
            style={{ border:'none', background:'none', cursor:'pointer',
              color:'var(--text-tertiary)', fontWeight:700, minHeight:'unset' }}>✕</button>
        </div>
      )}

      <BagCapacityModal
        isOpen={showBagModal}
        onClose={() => setShowBagModal(false)}
        currentLiters={currentBagCapacity ?? 25}
        onSave={handleSaveBagCapacity}
        token={auth.token}
      />
    </>
  );
}
