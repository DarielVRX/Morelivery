// components/DriverHomeStatusBar.jsx
import { useState } from 'react';
import { updateBagCapacity, fetchBagCapacity } from '../alerts/api';
import { useAuth } from '../../../contexts/AuthContext';

// Modal para editar capacidad de mochila
function BagCapacityModal({ isOpen, onClose, currentLiters, onSave, token }) {
  const [liters, setLiters] = useState(currentLiters);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSave = async () => {
    const val = parseFloat(liters);
    if (isNaN(val) || val < 1) {
      setError('La capacidad debe ser al menos 1 litro');
      return;
    }
    if (val > 200) {
      setError('La capacidad no puede exceder 200 litros');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await updateBagCapacity(val, token);
      onSave(val);
      onClose();
    } catch (e) {
      setError(e.message || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
    <div style={{
      background: 'var(--bg-card)', borderRadius: 16,
          padding: '1.25rem', width: '90%', maxWidth: 320,
          boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
    }} onClick={e => e.stopPropagation()}>
    <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '0.5rem' }}>
    🎒 Capacidad de mochila
    </div>
    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
    Define cuántos litros puedes cargar. Esto ayuda a calcular si un pedido cabe en tu ruta.
    </div>
    <input
    type="number"
    value={liters}
    onChange={e => setLiters(e.target.value)}
    step="1"
    min="1"
    max="200"
    style={{
      width: '100%', padding: '0.6rem', borderRadius: 10,
      border: '1px solid var(--border)', background: 'var(--bg-input)',
          fontSize: '1rem', marginBottom: '0.5rem',
    }}
    />
    {error && (
      <div style={{ fontSize: '0.7rem', color: '#dc2626', marginBottom: '0.75rem' }}>
      {error}
      </div>
    )}
    <div style={{ display: 'flex', gap: '0.5rem' }}>
    <button
    onClick={handleSave}
    disabled={saving}
    style={{
      flex: 1, padding: '0.6rem', borderRadius: 10,
      background: 'var(--brand)', color: '#fff', border: 'none',
          fontWeight: 600, cursor: saving ? 'wait' : 'pointer',
          opacity: saving ? 0.6 : 1,
    }}
    >
    {saving ? 'Guardando…' : 'Guardar'}
    </button>
    <button
    onClick={onClose}
    style={{
      flex: 1, padding: '0.6rem', borderRadius: 10,
      background: 'var(--bg-raised)', border: '1px solid var(--border)',
          cursor: 'pointer', fontWeight: 600,
    }}
    >
    Cancelar
    </button>
    </div>
    </div>
    </div>
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
}) {
  const { auth, patchUser } = useAuth();
  const [showBagModal, setShowBagModal] = useState(false);
  const [currentBagCapacity, setCurrentBagCapacity] = useState(null);

  const earnings = counters?.session_earnings_cents
  ? `$${(counters.session_earnings_cents / 100).toFixed(0)}`
  : null;
  const deliveries = counters?.session_deliveries ?? 0;

  // Cargar capacidad actual al montar o al cambiar usuario
  const loadBagCapacity = async () => {
    if (!auth.token) return;
    try {
      const capacity = await fetchBagCapacity(auth.token);
      setCurrentBagCapacity(capacity);
    } catch (_) {}
  };

  // Cargar cuando el token esté disponible
  if (auth.token && currentBagCapacity === null) {
    loadBagCapacity();
  }

  const handleSaveBagCapacity = (newLiters) => {
    setCurrentBagCapacity(newLiters);
    // Actualizar perfil local si es necesario
    patchUser?.({
      driver: {
        ...(auth.user?.driver || {}),
                bag_capacity_liters: newLiters,
      },
    });
  };

  return (
    <>
    <div style={{
      flexShrink: 0,
      background: 'linear-gradient(135deg, #c97b7b 0%, #b56060 60%, #9e4f4f 100%)',
          padding: '0.5rem 1rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
          zIndex: 10,
    }}>
    {/* Stats del día + mochila */}
    <div style={{
      display: 'flex', gap: '0.75rem', alignItems: 'center',
      fontSize: '0.74rem', color: 'rgba(255,255,255,0.9)', minWidth: 0,
    }}>
    <span style={{ fontWeight: 600 }}>
    <span style={{ opacity: 0.7, fontSize: '0.68rem' }}>Hoy </span>
    {earnings ?? '$0'}
    </span>
    <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)"
    strokeWidth="2.5" strokeLinecap="round">
    <polyline points="20 6 9 17 4 12"/>
    </svg>
    {deliveries}
    </span>

    {/* Ícono de mochila con capacidad — click para editar */}
    <button
    onClick={() => setShowBagModal(true)}
    style={{
      display: 'flex', alignItems: 'center', gap: 3,
      background: 'none', border: 'none', cursor: 'pointer',
      padding: '0.2rem 0.3rem', borderRadius: 12,
      transition: 'background 0.1s',
      color: 'rgba(255,255,255,0.9)',
    }}
    title={`Capacidad: ${currentBagCapacity ?? '?'} litros`}
    >
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round">
    <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
    <line x1="3" y1="6" x2="21" y2="6"/>
    <path d="M16 10a4 4 0 01-8 0"/>
    </svg>
    <span style={{ fontSize: '0.68rem', fontWeight: 500 }}>
    {currentBagCapacity ?? '?'}L
    </span>
    </button>

    {bagPct !== null && (
      <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)"
      strokeWidth="2" strokeLinecap="round">
      <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
      <line x1="3" y1="6" x2="21" y2="6"/>
      <path d="M16 10a4 4 0 01-8 0"/>
      </svg>
      {bagPct}%
      </span>
    )}
    </div>

    {/* Toggle */}
    <button
    onClick={onToggleAvailability}
    className={availability ? 'btn-primary btn-sm' : 'btn-sm'}
    style={{ flexShrink: 0 }}>
    {availability ? 'Disponible' : 'No disponible'}
    </button>
    </div>

    {/* Flash message */}
    {msg && (
      <div className="flash flash-error" style={{
        flexShrink: 0, borderRadius: 0, margin: 0,
        display: 'flex', justifyContent: 'space-between',
      }}>
      <span style={{ fontSize: '0.83rem' }}>{msg}</span>
      <button onClick={onDismissMsg}
      style={{ border: 'none', background: 'none', cursor: 'pointer', fontWeight: 700 }}>✕</button>
      </div>
    )}

    {/* Transfer banner */}
    {transferBanner && (
      <div style={{
        flexShrink: 0, zIndex: 25,
        background: transferBanner.type === 'order_transferred_in' ? 'var(--success-bg)' : 'var(--warn-bg)',
                        borderBottom: `2px solid ${transferBanner.type === 'order_transferred_in' ? 'var(--success)' : 'var(--warn)'}`,
                        padding: '0.6rem 1rem',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
      <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>
      {transferBanner.type === 'order_transferred_in'
        ? 'Se te asignó un pedido transferido'
    : 'Un pedido fue reasignado a otro conductor'}
    </span>
    <button onClick={onDismissTransferBanner}
    style={{ border: 'none', background: 'none', cursor: 'pointer',
      color: 'var(--text-tertiary)', fontWeight: 700, minHeight: 'unset' }}>✕</button>
      </div>
    )}

    {/* Modal de capacidad de mochila */}
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
