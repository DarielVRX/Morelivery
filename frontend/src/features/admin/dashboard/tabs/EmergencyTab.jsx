// frontend/src/features/admin/dashboard/tabs/EmergencyTab.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Panel de acciones de emergencia para el admin.
// Diseño: industrial/utilitarian — alta densidad, sin decoración, operabilidad máxima.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react';

// ── Helpers ───────────────────────────────────────────────────────────────────

// apiFetch se importa desde el cliente compartido del proyecto
import { apiFetch } from '../../../api/client';

const fmt = (cents) =>
  cents != null ? `$${(cents / 100).toFixed(2)}` : '—';

const STATUS_LABELS = {
  created: 'Recibido', pending_driver: 'Sin driver', assigned: 'Asignado',
  accepted: 'Aceptado', preparing: 'Preparando', ready: 'Listo',
  on_the_way: 'En camino', delivered: 'Entregado', cancelled: 'Cancelado',
};

const STATUS_COLOR = {
  created: '#6b7280', pending_driver: '#f59e0b', assigned: '#3b82f6',
  accepted: '#8b5cf6', preparing: '#f97316', ready: '#10b981',
  on_the_way: '#06b6d4', delivered: '#22c55e', cancelled: '#ef4444',
};

const VEHICLE_ICON = { bike: '🚲', motorcycle: '🏍', car: '🚗' };

// ── Sub-components ────────────────────────────────────────────────────────────

function Toast({ msg, type }) {
  if (!msg) return null;
  const bg = type === 'error' ? '#ef4444' : type === 'warn' ? '#f59e0b' : '#22c55e';
  return (
    <div style={{
      position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      background: bg, color: '#fff', padding: '10px 22px', borderRadius: 4,
      fontFamily: 'monospace', fontSize: 13, fontWeight: 700,
      zIndex: 9999, boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
      animation: 'fadeSlideUp 0.18s ease',
    }}>
      {msg}
    </div>
  );
}

function SectionHeader({ label, sub }) {
  return (
    <div style={{ borderBottom: '1px solid #374151', paddingBottom: 6, marginBottom: 12 }}>
      <span style={{ fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.12em', color: '#9ca3af', textTransform: 'uppercase' }}>
        {label}
      </span>
      {sub && <span style={{ color: '#6b7280', fontSize: 11, marginLeft: 10 }}>{sub}</span>}
    </div>
  );
}

function Btn({ label, onClick, color = '#374151', textColor = '#f9fafb', disabled, small, icon }) {
  const [loading, setLoading] = useState(false);
  const handle = async () => {
    if (loading || disabled) return;
    setLoading(true);
    try { await onClick(); } finally { setLoading(false); }
  };
  return (
    <button onClick={handle} disabled={loading || disabled} style={{
      background: loading ? '#1f2937' : color,
      color: loading ? '#6b7280' : textColor,
      border: `1px solid ${color}`,
      borderRadius: 3,
      padding: small ? '4px 10px' : '7px 14px',
      fontFamily: 'monospace',
      fontSize: small ? 11 : 12,
      fontWeight: 700,
      cursor: loading || disabled ? 'not-allowed' : 'pointer',
      whiteSpace: 'nowrap',
      transition: 'opacity 0.1s',
      opacity: disabled ? 0.4 : 1,
    }}>
      {loading ? '···' : (icon ? `${icon} ${label}` : label)}
    </button>
  );
}

function ConfirmBtn({ label, onConfirm, color, small, icon, confirmLabel }) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <Btn label={label} icon={icon} small={small} color={color}
        onClick={() => { setArmed(true); setTimeout(() => setArmed(false), 4000); }} />
    );
  }
  return (
    <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <Btn label={confirmLabel || '¿Confirmar?'} small={small} color="#ef4444"
        onClick={async () => { setArmed(false); await onConfirm(); }} />
      <Btn label="×" small color="#374151" onClick={() => setArmed(false)} />
    </span>
  );
}

function StatusPill({ status }) {
  return (
    <span style={{
      background: STATUS_COLOR[status] + '22',
      color: STATUS_COLOR[status],
      border: `1px solid ${STATUS_COLOR[status]}55`,
      borderRadius: 2,
      padding: '1px 6px',
      fontSize: 10,
      fontFamily: 'monospace',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
    }}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function EmergencyTab({ token }) {
  const [toast, setToast] = useState(null);
  const [liveData, setLiveData] = useState(null);
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedOrder, setExpandedOrder] = useState(null);
  // Fast register extendido — paso 9
  const [fastRegRole, setFastRegRole] = useState('driver'); // 'driver' | 'restaurant' | 'customer'
  const [fastRegForm, setFastRegForm] = useState({ fullName: '', alias: '', email: '', password: '' });
  const [fastRegExtra, setFastRegExtra] = useState({ businessName: '', address: '', lat: '', lng: '' });
  const [fastRegLoading, setFastRegLoading] = useState(false);
  const [fastRegPickingMap, setFastRegPickingMap] = useState(false);
  const [orderStatusOverride, setOrderStatusOverride] = useState({});
  const [orderNoteOverride, setOrderNoteOverride] = useState({});

  const notify = useCallback((msg, type = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3200);
  }, []);

  const load = useCallback(async () => {
    try {
      const [live, rests] = await Promise.all([
        apiFetch('/admin/assignment-live', {}, token),
        apiFetch('/admin/users', {}, token).then(d => d.users.filter(u => u.restaurant_name)),
      ]);
      setLiveData(live);
      setRestaurants(rests);
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [notify, token]);

  useEffect(() => { load(); }, [load]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const forceOrderStatus = async (orderId) => {
    const status = orderStatusOverride[orderId];
    const note = orderNoteOverride[orderId] || '';
    if (!status) { notify('Selecciona un estado primero', 'warn'); return; }
    await apiFetch(`/admin/orders/${orderId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, note: note || `[ADMIN OVERRIDE] ${new Date().toISOString()}` }),
    }, token);
    notify(`✓ Pedido ${orderId.slice(0, 8)} → ${STATUS_LABELS[status]}`, 'ok');
    await load();
  };

  const clearPenalties = async (driverId, driverName) => {
    await apiFetch(`/admin/users/${driverId}/clear-penalties`, { method: 'POST', body: JSON.stringify({}) }, token);
    notify(`✓ Penalizaciones eliminadas — ${driverName}`, 'ok');
    await load();
  };

  const resetCooldowns = async (driverId, driverName) => {
    await apiFetch(`/admin/drivers/${driverId}/reset-cooldowns`, { method: 'POST', body: JSON.stringify({}) }, token);
    notify(`✓ Cooldowns reseteados — ${driverName}`, 'ok');
    await load();
  };

  const forceDriverAvailable = async (driverId, driverName) => {
    await apiFetch(`/admin/drivers/${driverId}/force-available`, { method: 'POST', body: JSON.stringify({}) }, token);
    notify(`✓ Driver ${driverName} marcado disponible`, 'ok');
    await load();
  };

  const silentCloseRestaurant = async (userId, name) => {
    await apiFetch(`/admin/restaurants/${userId}/silent-close`, { method: 'POST', body: JSON.stringify({}) }, token);
    notify(`✓ ${name} cerrado silenciosamente`, 'ok');
    await load();
  };

  const silentOpenRestaurant = async (userId, name) => {
    await apiFetch(`/admin/restaurants/${userId}/silent-open`, { method: 'POST', body: JSON.stringify({}) }, token);
    notify(`✓ ${name} abierto`, 'ok');
    await load();
  };

  const fastRegister = async () => {
    const { fullName, alias, email, password } = fastRegForm;
    if (!fullName || !alias || !email || !password) {
      notify('Todos los campos base son requeridos', 'warn'); return;
    }
    if (fastRegRole === 'restaurant' && !fastRegExtra.businessName) {
      notify('El nombre del negocio es requerido', 'warn'); return;
    }
    setFastRegLoading(true);
    try {
      // 1. Registrar usuario con el rol correspondiente
      const regBody = {
        fullName, alias, username: alias, email, password,
        role: fastRegRole,
        skipEmailVerification: true,
      };
      const regRes = await apiFetch('/auth/register', {
        method: 'POST', body: JSON.stringify(regBody),
      }, token);

      const userId = regRes?.user?.id || regRes?.userId;

      // 2. Si es restaurante: crear el perfil con nombre + ubicación
      if (fastRegRole === 'restaurant' && userId) {
        const restBody = {
          name: fastRegExtra.businessName,
          address: fastRegExtra.address || '',
          lat: fastRegExtra.lat ? Number(fastRegExtra.lat) : null,
          lng: fastRegExtra.lng ? Number(fastRegExtra.lng) : null,
          is_open: false,
          is_verified: false,
        };
        try {
          await apiFetch(`/admin/users/${userId}/create-restaurant`, {
            method: 'POST', body: JSON.stringify(restBody),
          }, token);
        } catch (e) {
          notify(`Usuario creado pero error al crear restaurante: ${e.message}`, 'warn');
        }
      }

      // 3. Si es driver: marcar is_available=false (require activación manual)
      if (fastRegRole === 'driver' && userId) {
        try {
          await apiFetch(`/admin/drivers/${userId}/force-unavailable`, {
            method: 'POST', body: JSON.stringify({}),
          }, token).catch(() => {}); // no crítico
        } catch (_) {}
      }

      const roleLabel = { driver: 'Driver', restaurant: 'Restaurante', customer: 'Cliente' }[fastRegRole];
      notify(`✓ ${roleLabel} "${alias}" registrado. Ya puede hacer login.`, 'ok');
      setFastRegForm({ fullName: '', alias: '', email: '', password: '' });
      setFastRegExtra({ businessName: '', address: '', lat: '', lng: '' });
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setFastRegLoading(false);
    }
  };

  const requeue = async (orderId) => {
    await apiFetch(`/admin/orders/${orderId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'pending_driver', note: '[ADMIN] Re-encolado manualmente' }),
    }, token);
    notify(`✓ Pedido ${orderId.slice(0, 8)} re-encolado`, 'ok');
    await load();
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const styles = {
    root: {
      background: '#0d1117',
      color: '#e5e7eb',
      minHeight: '100vh',
      fontFamily: 'monospace',
      padding: '16px',
    },
    grid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
      gap: 16,
    },
    card: {
      background: '#161b22',
      border: '1px solid #21262d',
      borderRadius: 4,
      padding: '14px 16px',
    },
    dangerCard: {
      background: '#161b22',
      border: '1px solid #ef444433',
      borderRadius: 4,
      padding: '14px 16px',
    },
    row: {
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 0',
      borderBottom: '1px solid #21262d',
    },
    label: { color: '#9ca3af', fontSize: 11 },
    val: { color: '#f9fafb', fontSize: 12, fontWeight: 700 },
    input: {
      background: '#0d1117',
      border: '1px solid #374151',
      borderRadius: 3,
      color: '#f9fafb',
      padding: '5px 8px',
      fontFamily: 'monospace',
      fontSize: 12,
      outline: 'none',
      flex: 1,
    },
    select: {
      background: '#0d1117',
      border: '1px solid #374151',
      borderRadius: 3,
      color: '#f9fafb',
      padding: '4px 6px',
      fontFamily: 'monospace',
      fontSize: 11,
      cursor: 'pointer',
    },
    badge: (color) => ({
      display: 'inline-block',
      background: color + '22',
      color,
      border: `1px solid ${color}44`,
      borderRadius: 2,
      padding: '1px 5px',
      fontSize: 10,
      fontWeight: 700,
    }),
    pageTitle: {
      fontFamily: 'monospace',
      fontSize: 11,
      letterSpacing: '0.18em',
      textTransform: 'uppercase',
      color: '#ef4444',
      marginBottom: 16,
      display: 'flex',
      alignItems: 'center',
      gap: 10,
    },
  };

  const activeOrders = liveData?.orders?.filter(o => !['delivered', 'cancelled'].includes(o.status)) ?? [];
  const drivers = liveData?.drivers ?? [];
  const stuckOrders = activeOrders.filter(o => !o.driver_id && o.status !== 'cancelled');
  const onTheWayOrders = activeOrders.filter(o => o.status === 'on_the_way');

  return (
    <div style={styles.root}>
      <style>{`
        @keyframes fadeSlideUp { from { opacity:0; transform:translateX(-50%) translateY(10px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }
        @keyframes blink { 0%,100% { opacity:1; } 50% { opacity:0.3; } }
        select:focus, input:focus { border-color: #ef4444 !important; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: #0d1117; }
        ::-webkit-scrollbar-thumb { background: #374151; border-radius: 2px; }
      `}</style>

      <Toast msg={toast?.msg} type={toast?.type} />

      {/* Header */}
      <div style={styles.pageTitle}>
        <span style={{ animation: 'blink 1.4s infinite', color: '#ef4444', fontSize: 16 }}>⚡</span>
        PANEL DE EMERGENCIAS
        <span style={{ color: '#4b5563', marginLeft: 'auto', fontSize: 10 }}>
          {new Date().toLocaleTimeString('es-MX')}
        </span>
        <Btn small label="↻ Actualizar" color="#21262d" onClick={load} />
      </div>

      {loading && (
        <div style={{ color: '#6b7280', fontFamily: 'monospace', fontSize: 12, padding: 20, textAlign: 'center' }}>
          Cargando datos...
        </div>
      )}

      {!loading && (
        <div style={styles.grid}>

          {/* ── 1. PEDIDOS ATASCADOS (sin driver) ─────────────────────────── */}
          <div style={{ ...styles.dangerCard, gridColumn: stuckOrders.length > 0 ? 'span 2' : 'span 1' }}>
            <SectionHeader
              label="Pedidos sin driver"
              sub={stuckOrders.length === 0 ? '✓ Ninguno' : `${stuckOrders.length} atascado${stuckOrders.length > 1 ? 's' : ''}`}
            />
            {stuckOrders.length === 0 && (
              <div style={{ color: '#22c55e', fontSize: 12, padding: '4px 0' }}>Todo en orden.</div>
            )}
            {stuckOrders.map((o) => (
              <div key={o.id} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid #21262d' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={styles.val}>{o.id.slice(0, 8)}</span>
                  <StatusPill status={o.status} />
                  <span style={styles.label}>{o.restaurant_name}</span>
                  <span style={{ ...styles.label, marginLeft: 'auto' }}>{fmt(o.total_cents)}</span>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <select
                    style={styles.select}
                    value={orderStatusOverride[o.id] || ''}
                    onChange={(e) => setOrderStatusOverride(s => ({ ...s, [o.id]: e.target.value }))}
                  >
                    <option value="">→ Cambiar estado</option>
                    {['pending_driver', 'assigned', 'accepted', 'preparing', 'ready', 'on_the_way', 'delivered', 'cancelled'].map(s => (
                      <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                  <input
                    style={{ ...styles.input, maxWidth: 180 }}
                    placeholder="Nota (opcional)"
                    value={orderNoteOverride[o.id] || ''}
                    onChange={(e) => setOrderNoteOverride(n => ({ ...n, [o.id]: e.target.value }))}
                  />
                  <Btn small label="Aplicar" color="#ef4444" onClick={() => forceOrderStatus(o.id)} />
                  <Btn small label="Re-encolar" color="#3b82f6" onClick={() => requeue(o.id)} />
                </div>
              </div>
            ))}
          </div>

          {/* ── 2. TODOS LOS PEDIDOS ACTIVOS ───────────────────────────────── */}
          <div style={{ ...styles.card, gridColumn: 'span 2' }}>
            <SectionHeader label="Pedidos activos" sub={`${activeOrders.length} total`} />
            {activeOrders.length === 0 && <div style={{ color: '#6b7280', fontSize: 12 }}>Sin pedidos activos.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {activeOrders.map((o) => (
                <div key={o.id}>
                  <div
                    onClick={() => setExpandedOrder(expandedOrder === o.id ? null : o.id)}
                    style={{
                      ...styles.row,
                      cursor: 'pointer',
                      background: expandedOrder === o.id ? '#21262d' : 'transparent',
                      padding: '6px 4px',
                      borderRadius: 3,
                    }}
                  >
                    <span style={{ ...styles.label, width: 72, flexShrink: 0 }}>{o.id.slice(0, 8)}</span>
                    <StatusPill status={o.status} />
                    <span style={styles.label}>{o.restaurant_name}</span>
                    <span style={{ ...styles.label, marginLeft: 'auto' }}>
                      {o.driver_name
                        ? <span style={{ color: '#10b981' }}>{VEHICLE_ICON[o.vehicle_type] || '🚚'} {o.driver_name.split(' ')[0]}</span>
                        : <span style={{ color: '#f59e0b' }}>Sin driver</span>
                      }
                    </span>
                    <span style={{ color: '#4b5563', fontSize: 10, marginLeft: 8 }}>{expandedOrder === o.id ? '▲' : '▼'}</span>
                  </div>

                  {expandedOrder === o.id && (
                    <div style={{
                      background: '#0d1117', border: '1px solid #21262d',
                      borderRadius: 3, padding: '10px 12px', margin: '4px 0 8px',
                    }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', marginBottom: 10 }}>
                        {[
                          ['ID completo', o.id],
                          ['Cliente', o.customer_name],
                          ['Restaurante', o.restaurant_name],
                          ['Driver', o.driver_name || '—'],
                          ['Total', fmt(o.total_cents)],
                          ['Ronda', o.round],
                          ['Rechazos', o.rejected_count],
                          ['Expirados', o.expired_count],
                        ].map(([k, v]) => (
                          <div key={k} style={{ display: 'flex', gap: 6 }}>
                            <span style={styles.label}>{k}:</span>
                            <span style={{ ...styles.val, fontSize: 11 }}>{String(v ?? '—')}</span>
                          </div>
                        ))}
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        <select
                          style={styles.select}
                          value={orderStatusOverride[o.id] || ''}
                          onChange={(e) => setOrderStatusOverride(s => ({ ...s, [o.id]: e.target.value }))}
                        >
                          <option value="">→ Override estado</option>
                          {['accepted', 'preparing', 'ready', 'on_the_way', 'delivered', 'cancelled', 'pending_driver'].map(s => (
                            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                          ))}
                        </select>
                        <input
                          style={{ ...styles.input, maxWidth: 200 }}
                          placeholder="Nota de admin"
                          value={orderNoteOverride[o.id] || ''}
                          onChange={(e) => setOrderNoteOverride(n => ({ ...n, [o.id]: e.target.value }))}
                        />
                        <Btn small label="Aplicar estado" color="#ef4444"
                          onClick={() => forceOrderStatus(o.id)} />
                        <Btn small label="Re-encolar" color="#3b82f6"
                          onClick={() => requeue(o.id)} />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* ── 3. DRIVERS ─────────────────────────────────────────────────── */}
          <div style={styles.card}>
            <SectionHeader label="Drivers" sub={`${drivers.filter(d => d.is_available).length}/${drivers.length} disponibles`} />
            {drivers.length === 0 && <div style={{ color: '#6b7280', fontSize: 12 }}>Sin drivers registrados.</div>}
            {drivers.map((d) => (
              <div key={d.id} style={{ ...styles.row, flexWrap: 'wrap', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 14 }}>{VEHICLE_ICON[d.vehicle_type] || '🚚'}</span>
                  <div>
                    <div style={styles.val}>{d.full_name?.split(' ')[0]} <span style={styles.label}>#{d.driver_number}</span></div>
                    <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                      <span style={styles.badge(d.is_available ? '#22c55e' : '#6b7280')}>
                        {d.is_available ? 'disponible' : 'inactivo'}
                      </span>
                      {d.active_orders > 0 && (
                        <span style={styles.badge('#3b82f6')}>{d.active_orders} pedido{d.active_orders > 1 ? 's' : ''}</span>
                      )}
                      {d.cooldowns?.length > 0 && (
                        <span style={styles.badge('#f59e0b')}>{d.cooldowns.length} cooldown{d.cooldowns.length > 1 ? 's' : ''}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  {!d.is_available && (
                    <ConfirmBtn small label="Activar" icon="✓" color="#22c55e"
                      confirmLabel="¿Activar ahora?"
                      onConfirm={() => forceDriverAvailable(d.id, d.full_name)} />
                  )}
                  {d.cooldowns?.length > 0 && (
                    <ConfirmBtn small label="Reset cooldowns" color="#f59e0b"
                      confirmLabel="¿Limpiar cooldowns?"
                      onConfirm={() => resetCooldowns(d.id, d.full_name)} />
                  )}
                  <ConfirmBtn small label="Limpiar penaliz." color="#6b7280"
                    confirmLabel="¿Eliminar penalizaciones?"
                    onConfirm={() => clearPenalties(d.id, d.full_name)} />
                </div>
              </div>
            ))}
          </div>

          {/* ── 4. RESTAURANTES ────────────────────────────────────────────── */}
          <div style={styles.card}>
            <SectionHeader label="Restaurantes — control de apertura" />
            {restaurants.length === 0 && <div style={{ color: '#6b7280', fontSize: 12 }}>Sin restaurantes.</div>}
            {restaurants.map((r) => (
              <div key={r.id} style={{ ...styles.row, flexWrap: 'wrap' }}>
                <div style={{ flex: 1 }}>
                  <span style={styles.val}>{r.restaurant_name || r.full_name}</span>
                  <span style={{ marginLeft: 8 }}>
                    <span style={styles.badge(r.restaurant_is_open ? '#22c55e' : '#6b7280')}>
                      {r.restaurant_is_open ? 'abierto' : 'cerrado'}
                    </span>
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {r.restaurant_is_open ? (
                    <ConfirmBtn small label="Cerrar silencioso" color="#ef4444"
                      confirmLabel="¿Cerrar ahora?"
                      onConfirm={() => silentCloseRestaurant(r.id, r.restaurant_name)} />
                  ) : (
                    <ConfirmBtn small label="Abrir silencioso" color="#22c55e"
                      confirmLabel="¿Abrir ahora?"
                      onConfirm={() => silentOpenRestaurant(r.id, r.restaurant_name)} />
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* ── 5. FAST REGISTER — MULTI-ROL ──────────────────────────────── */}
          <div style={styles.card}>
            <SectionHeader label="Fast register — nuevo usuario" />

            {/* Selector de rol */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
              {[
                { key: 'driver',     label: '🏍 Driver' },
                { key: 'restaurant', label: '🏪 Restaurante' },
                { key: 'customer',   label: '👤 Cliente' },
              ].map(({ key, label }) => (
                <button key={key} onClick={() => setFastRegRole(key)} style={{
                  flex: 1,
                  padding: '5px 0',
                  fontFamily: 'monospace',
                  fontSize: 11,
                  fontWeight: 700,
                  border: '1px solid',
                  borderRadius: 3,
                  cursor: 'pointer',
                  background: fastRegRole === key ? '#22c55e' : '#1f2937',
                  color:      fastRegRole === key ? '#0d1117' : '#9ca3af',
                  borderColor:fastRegRole === key ? '#22c55e' : '#374151',
                }}>
                  {label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {/* Campos base */}
              {[
                { key: 'fullName',  placeholder: 'Nombre completo' },
                { key: 'alias',     placeholder: 'Username / alias' },
                { key: 'email',     placeholder: 'Correo' },
                { key: 'password',  placeholder: 'Contraseña temporal', type: 'password' },
              ].map(({ key, placeholder, type }) => (
                <input
                  key={key}
                  type={type || 'text'}
                  placeholder={placeholder}
                  style={styles.input}
                  value={fastRegForm[key]}
                  onChange={(e) => setFastRegForm(f => ({ ...f, [key]: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && fastRegister()}
                />
              ))}

              {/* Campos extra para restaurante */}
              {fastRegRole === 'restaurant' && (
                <>
                  <div style={{ borderTop: '1px solid #374151', paddingTop: 8, marginTop: 2 }}>
                    <span style={{ color: '#9ca3af', fontSize: 10, fontFamily: 'monospace', letterSpacing: '0.08em' }}>
                      DATOS DEL NEGOCIO
                    </span>
                  </div>
                  <input
                    type="text"
                    placeholder="Nombre del negocio *"
                    style={{ ...styles.input, borderColor: '#22c55e33' }}
                    value={fastRegExtra.businessName}
                    onChange={(e) => setFastRegExtra(f => ({ ...f, businessName: e.target.value }))}
                  />
                  <input
                    type="text"
                    placeholder="Dirección (texto)"
                    style={styles.input}
                    value={fastRegExtra.address}
                    onChange={(e) => setFastRegExtra(f => ({ ...f, address: e.target.value }))}
                  />
                  {/* Coords lat/lng — entrada manual o via GPS */}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="number"
                      placeholder="Lat"
                      style={{ ...styles.input, flex: 1 }}
                      value={fastRegExtra.lat}
                      onChange={(e) => setFastRegExtra(f => ({ ...f, lat: e.target.value }))}
                      step="0.000001"
                    />
                    <input
                      type="number"
                      placeholder="Lng"
                      style={{ ...styles.input, flex: 1 }}
                      value={fastRegExtra.lng}
                      onChange={(e) => setFastRegExtra(f => ({ ...f, lng: e.target.value }))}
                      step="0.000001"
                    />
                    <button
                      title="Obtener coordenadas actuales del dispositivo"
                      style={{
                        ...styles.input,
                        flex: 'none', width: 36, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 14, padding: 0, border: '1px solid #374151',
                        borderRadius: 3, background: '#1f2937',
                      }}
                      onClick={() => {
                        if (!navigator.geolocation) return;
                        navigator.geolocation.getCurrentPosition(
                          (pos) => setFastRegExtra(f => ({
                            ...f,
                            lat: pos.coords.latitude.toFixed(6),
                            lng: pos.coords.longitude.toFixed(6),
                          })),
                          () => {}
                        );
                      }}>
                      📍
                    </button>
                  </div>
                  {(fastRegExtra.lat && fastRegExtra.lng) && (
                    <div style={{ fontSize: 10, color: '#4b5563', fontFamily: 'monospace' }}>
                      ✓ Coords: {Number(fastRegExtra.lat).toFixed(5)}, {Number(fastRegExtra.lng).toFixed(5)}
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: '#4b5563', fontFamily: 'monospace', lineHeight: 1.4 }}>
                    Se crea con is_open=false, is_verified=false.
                    El admin debe verificar manualmente antes de aparecer en la app.
                  </div>
                </>
              )}

              {fastRegRole === 'driver' && (
                <div style={{ fontSize: 10, color: '#4b5563', fontFamily: 'monospace', lineHeight: 1.4 }}>
                  Se crea con is_available=false. El driver debe activarse manualmente
                  desde la app o desde el panel de drivers.
                </div>
              )}

              <Btn
                label={fastRegLoading
                  ? 'Registrando...'
                  : `⚡ Registrar ${fastRegRole === 'driver' ? 'driver' : fastRegRole === 'restaurant' ? 'restaurante' : 'cliente'}`}
                color="#22c55e"
                textColor="#0d1117"
                disabled={fastRegLoading}
                onClick={fastRegister}
              />
            </div>
          </div>

          {/* ── 6. MAPA RÁPIDO DE ESTADO ────────────────────────────────────── */}
          <div style={styles.card}>
            <SectionHeader label="Resumen en vivo" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                { label: 'Pedidos activos', val: activeOrders.length, color: '#3b82f6' },
                { label: 'Sin driver', val: stuckOrders.length, color: stuckOrders.length > 0 ? '#ef4444' : '#22c55e' },
                { label: 'En camino', val: onTheWayOrders.length, color: '#06b6d4' },
                { label: 'Drivers activos', val: drivers.filter(d => d.is_available).length, color: '#22c55e' },
                { label: 'Restaurantes abiertos', val: restaurants.filter(r => r.restaurant_is_open).length, color: '#10b981' },
                { label: 'Drivers con cooldown', val: drivers.filter(d => d.cooldowns?.length > 0).length, color: '#f59e0b' },
              ].map(({ label, val, color }) => (
                <div key={label} style={{
                  background: '#0d1117', borderRadius: 3, padding: '10px 12px',
                  border: `1px solid ${color}33`,
                }}>
                  <div style={{ fontSize: 24, fontWeight: 900, color, fontFamily: 'monospace', lineHeight: 1 }}>{val}</div>
                  <div style={{ color: '#6b7280', fontSize: 10, marginTop: 3 }}>{label}</div>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
