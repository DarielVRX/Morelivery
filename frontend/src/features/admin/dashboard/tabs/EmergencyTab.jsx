// frontend/src/features/admin/dashboard/tabs/EmergencyTab.jsx
import { useState, useCallback } from 'react';
import { apiFetch } from '../../../../api/client';

function Toast({ msg, type }) {
  if (!msg) return null;
  const bg = type === 'error' ? '#ef4444' : type === 'warn' ? '#f59e0b' : '#22c55e';
  return (
    <div style={{
      position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      background: bg, color: '#fff', padding: '10px 22px', borderRadius: 8,
      fontSize: 13, fontWeight: 700, zIndex: 9999,
      boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
      animation: 'fadeSlideUp 0.18s ease',
    }}>
      {msg}
    </div>
  );
}

function SectionHeader({ label }) {
  return (
    <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8, marginBottom: 14 }}>
      <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {label}
      </span>
    </div>
  );
}

function ConfirmBtn({ label, onConfirm, variant = 'default', small }) {
  const [armed, setArmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const base = {
    borderRadius: 8, fontWeight: 700, cursor: 'pointer',
    padding: small ? '0.25rem 0.6rem' : '0.4rem 0.85rem',
    fontSize: small ? '0.75rem' : '0.82rem', border: '1.5px solid',
    minHeight: 'unset',
  };
  const colors = {
    danger:  { background: 'var(--danger-bg)',   color: 'var(--danger)',   borderColor: 'var(--danger-border)' },
    success: { background: 'var(--success-bg)',  color: 'var(--success)',  borderColor: 'var(--success-border)' },
    default: { background: 'var(--bg-raised)',   color: 'var(--text-secondary)', borderColor: 'var(--border)' },
  };

  if (!armed) {
    return (
      <button style={{ ...base, ...colors[variant] }}
        onClick={() => { setArmed(true); setTimeout(() => setArmed(false), 4000); }}>
        {label}
      </button>
    );
  }
  return (
    <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <button style={{ ...base, background: '#fee2e2', color: '#dc2626', borderColor: '#fca5a5' }}
        disabled={loading}
        onClick={async () => {
          setArmed(false); setLoading(true);
          try { await onConfirm(); } finally { setLoading(false); }
        }}>
        {loading ? '…' : '¿Confirmar?'}
      </button>
      <button style={{ ...base, ...colors.default }} onClick={() => setArmed(false)}>✕</button>
    </span>
  );
}

export default function EmergencyTab({ token }) {
  const [toast,          setToast]          = useState(null);
  const [restaurants,    setRestaurants]    = useState([]);
  const [restsLoaded,    setRestsLoaded]    = useState(false);
  const [restsLoading,   setRestsLoading]   = useState(false);
  const [fastRegRole,    setFastRegRole]    = useState('driver');
  const [fastRegForm,    setFastRegForm]    = useState({ fullName: '', alias: '', email: '', password: '' });
  const [fastRegExtra,   setFastRegExtra]   = useState({ businessName: '', address: '', lat: '', lng: '' });
  const [fastRegLoading, setFastRegLoading] = useState(false);

  const notify = useCallback((msg, type = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  async function loadRestaurants() {
    if (restsLoaded) return;
    setRestsLoading(true);
    try {
      const d = await apiFetch('/admin/users', {}, token);
      setRestaurants((d.users || []).filter(u => u.restaurant_name));
      setRestsLoaded(true);
    } catch (e) { notify(e.message, 'error'); }
    finally { setRestsLoading(false); }
  }

  async function silentClose(userId, name) {
    await apiFetch(`/admin/restaurants/${userId}/silent-close`, { method: 'POST', body: '{}' }, token);
    setRestaurants(prev => prev.map(r => r.id === userId ? { ...r, restaurant_is_open: false } : r));
    notify(`${name} cerrado`);
  }

  async function silentOpen(userId, name) {
    await apiFetch(`/admin/restaurants/${userId}/silent-open`, { method: 'POST', body: '{}' }, token);
    setRestaurants(prev => prev.map(r => r.id === userId ? { ...r, restaurant_is_open: true } : r));
    notify(`${name} abierto`);
  }

  async function fastRegister() {
    const { fullName, alias, email, password } = fastRegForm;
    if (!fullName || !alias || !email || !password) { notify('Todos los campos son requeridos', 'warn'); return; }
    if (fastRegRole === 'restaurant' && !fastRegExtra.businessName) { notify('El nombre del negocio es requerido', 'warn'); return; }
    setFastRegLoading(true);
    try {
      const regRes = await apiFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ fullName, alias, username: alias, email, password, role: fastRegRole, skipEmailVerification: true }),
      }, token);
      const userId = regRes?.user?.id || regRes?.userId;

      if (fastRegRole === 'restaurant' && userId) {
        try {
          await apiFetch(`/admin/users/${userId}/create-restaurant`, {
            method: 'POST',
            body: JSON.stringify({
              name: fastRegExtra.businessName,
              address: fastRegExtra.address || '',
              lat: fastRegExtra.lat ? Number(fastRegExtra.lat) : null,
              lng: fastRegExtra.lng ? Number(fastRegExtra.lng) : null,
              is_open: false,
            }),
          }, token);
        } catch (e) { notify(`Usuario creado pero error en restaurante: ${e.message}`, 'warn'); }
      }

      if (fastRegRole === 'driver' && userId) {
        await apiFetch(`/admin/drivers/${userId}/force-unavailable`, { method: 'POST', body: '{}' }, token).catch(() => {});
      }

      const label = { driver: 'Driver', restaurant: 'Restaurante', customer: 'Cliente' }[fastRegRole];
      notify(`${label} "${alias}" registrado`);
      setFastRegForm({ fullName: '', alias: '', email: '', password: '' });
      setFastRegExtra({ businessName: '', address: '', lat: '', lng: '' });
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setFastRegLoading(false);
    }
  }

  const cardStyle = {
    background: 'var(--bg-card)', border: '1px solid var(--border)',
    borderRadius: 12, padding: '1.1rem 1.25rem', marginBottom: '1rem',
  };
  const inputStyle = {
    display: 'block', width: '100%', boxSizing: 'border-box',
    marginTop: 4, marginBottom: 8,
  };

  return (
    <div style={{ maxWidth: 720, padding: '0.25rem 0' }}>
      <style>{`@keyframes fadeSlideUp { from { opacity:0; transform:translateX(-50%) translateY(8px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }`}</style>
      <Toast msg={toast?.msg} type={toast?.type} />

      {/* ── Restaurantes ── */}
      <div style={cardStyle}>
        <SectionHeader label="Control de apertura de restaurantes" />
        {!restsLoaded ? (
          <button className="btn-sm" onClick={loadRestaurants} disabled={restsLoading}>
            {restsLoading ? 'Cargando…' : 'Cargar restaurantes'}
          </button>
        ) : restaurants.length === 0 ? (
          <p style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>Sin restaurantes registrados.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {restaurants.map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0.45rem 0', borderBottom: '1px solid var(--border-light)' }}>
                <div style={{ flex: 1 }}>
                  <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>{r.restaurant_name || r.full_name}</span>
                  <span style={{
                    marginLeft: 8, fontSize: '0.72rem', fontWeight: 700, borderRadius: 6, padding: '1px 7px',
                    background: r.restaurant_is_open ? 'var(--success-bg)' : 'var(--bg-sunken)',
                    color: r.restaurant_is_open ? 'var(--success)' : 'var(--text-tertiary)',
                    border: `1px solid ${r.restaurant_is_open ? 'var(--success-border)' : 'var(--border)'}`,
                  }}>
                    {r.restaurant_is_open ? 'Abierto' : 'Cerrado'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {r.restaurant_is_open ? (
                    <ConfirmBtn small label="Cerrar" variant="danger"
                      onConfirm={() => silentClose(r.id, r.restaurant_name)} />
                  ) : (
                    <ConfirmBtn small label="Abrir" variant="success"
                      onConfirm={() => silentOpen(r.id, r.restaurant_name)} />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Fast Register ── */}
      <div style={cardStyle}>
        <SectionHeader label="Registro rápido de usuario" />

        {/* Selector de rol */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {[['driver', '🏍 Driver'], ['restaurant', '🏪 Restaurante'], ['customer', '👤 Cliente']].map(([key, label]) => (
            <button key={key} onClick={() => setFastRegRole(key)} style={{
              flex: 1, padding: '0.35rem 0', fontWeight: 700, fontSize: '0.78rem',
              border: '1.5px solid', borderRadius: 8, cursor: 'pointer', minHeight: 'unset',
              background: fastRegRole === key ? 'var(--brand-light)' : 'var(--bg-raised)',
              color: fastRegRole === key ? 'var(--brand)' : 'var(--text-secondary)',
              borderColor: fastRegRole === key ? 'var(--brand)' : 'var(--border)',
            }}>
              {label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>
            Nombre completo
            <input style={inputStyle} value={fastRegForm.fullName}
              onChange={e => setFastRegForm(f => ({ ...f, fullName: e.target.value }))}
              placeholder="Nombre Apellido" />
          </label>
          <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>
            Alias / Username
            <input style={inputStyle} value={fastRegForm.alias}
              onChange={e => setFastRegForm(f => ({ ...f, alias: e.target.value }))}
              placeholder="usuario123" />
          </label>
          <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>
            Correo electrónico
            <input style={inputStyle} type="email" value={fastRegForm.email}
              onChange={e => setFastRegForm(f => ({ ...f, email: e.target.value }))}
              placeholder="correo@ejemplo.com" />
          </label>
          <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>
            Contraseña temporal
            <input style={inputStyle} type="password" value={fastRegForm.password}
              onChange={e => setFastRegForm(f => ({ ...f, password: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && fastRegister()} />
          </label>

          {fastRegRole === 'restaurant' && (
            <>
              <div style={{ height: 1, background: 'var(--border)', margin: '4px 0 12px' }} />
              <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>
                Nombre del negocio <span style={{ color: 'var(--danger)', fontWeight: 400 }}>*</span>
                <input style={inputStyle} value={fastRegExtra.businessName}
                  onChange={e => setFastRegExtra(f => ({ ...f, businessName: e.target.value }))} />
              </label>
              <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>
                Dirección (texto)
                <input style={inputStyle} value={fastRegExtra.address}
                  onChange={e => setFastRegExtra(f => ({ ...f, address: e.target.value }))} />
              </label>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <label style={{ flex: 1, fontSize: '0.82rem', fontWeight: 600 }}>
                  Latitud
                  <input style={{ ...inputStyle, marginBottom: 0 }} type="number" step="0.000001"
                    value={fastRegExtra.lat}
                    onChange={e => setFastRegExtra(f => ({ ...f, lat: e.target.value }))} />
                </label>
                <label style={{ flex: 1, fontSize: '0.82rem', fontWeight: 600 }}>
                  Longitud
                  <input style={{ ...inputStyle, marginBottom: 0 }} type="number" step="0.000001"
                    value={fastRegExtra.lng}
                    onChange={e => setFastRegExtra(f => ({ ...f, lng: e.target.value }))} />
                </label>
                <button title="GPS actual" style={{
                  alignSelf: 'flex-end', marginBottom: 0, padding: '0.4rem 0.6rem',
                  background: 'var(--bg-raised)', border: '1px solid var(--border)',
                  borderRadius: 8, cursor: 'pointer', fontSize: '1rem', minHeight: 'unset',
                }} onClick={() => {
                  navigator.geolocation?.getCurrentPosition(
                    pos => setFastRegExtra(f => ({ ...f, lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6) })),
                    () => {}
                  );
                }}>📍</button>
              </div>
            </>
          )}

          {fastRegRole === 'driver' && (
            <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginBottom: 8 }}>
              Se crea inactivo — el driver debe activarse desde la app o desde el panel de conductores.
            </p>
          )}

          <button className="btn-primary" disabled={fastRegLoading} onClick={fastRegister}
            style={{ marginTop: 4 }}>
            {fastRegLoading ? 'Registrando…' : `Registrar ${fastRegRole === 'driver' ? 'driver' : fastRegRole === 'restaurant' ? 'restaurante' : 'cliente'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
