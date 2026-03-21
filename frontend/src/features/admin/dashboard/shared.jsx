import { useEffect, useState } from 'react';

export function fmt(cents) { return cents != null ? `$${(cents / 100).toFixed(2)}` : '—'; }
export function fmtTs(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
export function secsSince(iso) {
  if (!iso) return null;
  return Math.max(0, Math.round((Date.now() - new Date(iso)) / 1000));
}
function secsLeft(iso, total = 60) {
  if (!iso) return null;
  const elapsed = secsSince(iso);
  return Math.max(0, total - elapsed);
}
function fmtSecs(s) {
  if (s == null) return '—';
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${s}s`;
}

const STATUS_LABEL = {
  created: 'Recibido', assigned: 'Asignado', accepted: 'Aceptado',
  preparing: 'Preparando', ready: 'Listo p/ retiro', on_the_way: 'En camino',
  delivered: 'Entregado', cancelled: 'Cancelado', pending_driver: 'Sin driver',
};
const STATUS_COLOR = {
  created: '#f59e0b', assigned: '#3b82f6', accepted: '#8b5cf6',
  preparing: '#f97316', ready: '#10b981', on_the_way: '#06b6d4',
  delivered: '#16a34a', cancelled: '#dc2626', pending_driver: '#ef4444',
};

function Badge({ status, label }) {
  const c = STATUS_COLOR[status] || '#9ca3af';
  return (
    <span style={{ background: `${c}22`, color: c, border: `1px solid ${c}55`, borderRadius: 10, padding: '0.1rem 0.5rem', fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
      {label || STATUS_LABEL[status] || status}
    </span>
  );
}

function Th({ children }) {
  return <th style={{ padding: '0.4rem 0.65rem', textAlign: 'left', whiteSpace: 'nowrap', fontWeight: 700, borderBottom: '2px solid var(--border)', background: 'var(--bg-sunken)', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{children}</th>;
}
function Td({ children, style = {} }) {
  return <td style={{ padding: '0.4rem 0.65rem', borderBottom: '1px solid var(--border-light)', fontSize: '0.8rem', verticalAlign: 'middle', color: 'var(--text-primary)', ...style }}>{children}</td>;
}

function useTick(interval = 1000) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), interval);
    return () => clearInterval(id);
  }, [interval]);
  return tick;
}

function CooldownBadge({ waitUntil }) {
  useTick();
  const secsR = Math.max(0, Math.round((new Date(waitUntil) - Date.now()) / 1000));
  const color = secsR > 60 ? '#dc2626' : secsR > 20 ? '#f59e0b' : '#9ca3af';
  return (
    <span style={{ background: `${color}22`, color, border: `1px solid ${color}55`, borderRadius: 10, padding: '0.1rem 0.5rem', fontSize: '0.72rem', fontWeight: 700 }}>
      ⏳ {fmtSecs(secsR)}
    </span>
  );
}

function DriversPanel({ drivers, orderId }) {
  const [open, setOpen] = useState(false);
  useTick();
  const MAX_ACTIVE = 4;
  const classified = drivers.map(d => {
    const isActive = d.active_orders > 0;
    const hasPending = d.pending_offer_order_id != null;
    const cooldownHere = (d.cooldowns || []).find(cd => cd.order_id === orderId);
    const hasCapacity = d.active_orders < MAX_ACTIVE;
    const isOfferingThisOrder = d.pending_offer_order_id === orderId;
    const availableForOrder = d.is_available && hasCapacity && !cooldownHere && !isOfferingThisOrder;
    let priority;
    if (isOfferingThisOrder) priority = 0;
    else if (availableForOrder && !hasPending) priority = 1;
    else if (availableForOrder && hasPending) priority = 2;
    else if (hasPending && !isOfferingThisOrder && !cooldownHere) priority = 3;
    else if (cooldownHere) priority = 4;
    else priority = 5;
    return { ...d, isActive, hasPending, cooldownHere, isOfferingThisOrder, hasCapacity, priority };
  }).sort((a, b) => a.priority - b.priority);

  return (
    <div style={{ marginTop: '0.5rem' }}>
      <button onClick={() => setOpen(o => !o)} style={{ fontSize: '0.75rem', background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', padding: '0.25rem 0.65rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.25rem', color: 'var(--text-primary)' }}>
        <span style={{ fontSize: '0.6rem' }}>{open ? '▲' : '▼'}</span>
        {open ? 'Ocultar drivers' : `👥 Drivers — ${classified.filter(d => d.priority === 0).length} con oferta, ${classified.filter(d => d.priority <= 2).length} elegibles`}
      </button>
      {open && (
        <div style={{ marginTop: '0.4rem', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
            <thead><tr><Th>#</Th><Th>Driver</Th><Th>Estado</Th><Th>Activos</Th><Th>GPS</Th><Th>Situación</Th></tr></thead>
            <tbody>
              {classified.map(d => {
                const secsR = d.cooldownHere ? Math.max(0, Math.round((new Date(d.cooldownHere.wait_until) - Date.now()) / 1000)) : null;
                let sitLabel; let sitColor; let rowBg;
                if (d.isOfferingThisOrder) { sitLabel = '📤 Oferta activa'; sitColor = '#2563eb'; rowBg = 'rgba(37,99,235,0.1)'; }
                else if (d.priority === 1) { sitLabel = `✅ Disponible (${d.active_orders}/${MAX_ACTIVE})`; sitColor = '#16a34a'; rowBg = 'rgba(22,163,74,0.1)'; }
                else if (d.priority === 2) { sitLabel = '⚡ Disponible + otra oferta'; sitColor = '#0d9488'; rowBg = 'rgba(13,148,136,0.1)'; }
                else if (d.hasPending && !d.isOfferingThisOrder && !d.cooldownHere) { sitLabel = '⏸ Oferta en otro pedido'; sitColor = '#f59e0b'; }
                else if (d.cooldownHere) { sitLabel = `🕐 Cooldown ${fmtSecs(secsR)}`; sitColor = '#dc2626'; rowBg = 'rgba(220,38,38,0.1)'; }
                else if (!d.is_available) { sitLabel = '🔴 Offline'; sitColor = '#9ca3af'; }
                else if (!d.hasCapacity) { sitLabel = `🚴 Saturado (${d.active_orders}/${MAX_ACTIVE})`; sitColor = '#6b7280'; }
                else { sitLabel = '—'; sitColor = '#9ca3af'; }
                return (
                  <tr key={d.id} style={{ background: rowBg }}>
                    <Td>{d.driver_number || '—'}</Td>
                    <Td><span style={{ fontWeight: d.priority <= 1 ? 700 : 400 }}>{d.full_name?.split('_')[0] || '—'}</span></Td>
                    <Td>{d.is_available ? <span style={{ color: 'var(--success)', fontWeight: 600, fontSize: '0.72rem' }}>● Disp.</span> : <span style={{ color: 'var(--text-tertiary)', fontSize: '0.72rem' }}>○ No</span>}</Td>
                    <Td style={{ textAlign: 'center' }}>{d.active_orders}</Td>
                    <Td>{(d.last_lat && d.last_lng) ? <span style={{ color: 'var(--success)', fontSize: '0.7rem' }}>✓</span> : <span style={{ color: '#9ca3af', fontSize: '0.7rem' }}>—</span>}</Td>
                    <Td style={{ color: sitColor, fontWeight: d.priority <= 1 ? 700 : 400 }}>{sitLabel}{d.cooldownHere && <CooldownBadge waitUntil={d.cooldownHere.wait_until} />}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value, color }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 7, padding: '0.4rem 0.6rem' }}>
      <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</div>
      <div style={{ fontSize: '0.82rem', fontWeight: 700, color: color || '#1f2937', marginTop: '0.1rem' }}>{value || '—'}</div>
    </div>
  );
}

export function OrderRow({ order, drivers }) {
  useTick();
  const [expanded, setExpanded] = useState(false);
  const ageMin = Math.floor(secsSince(order.created_at) / 60);

  return (
    <>
      <tr style={{ cursor: 'pointer', background: expanded ? 'rgba(37,99,235,0.07)' : undefined }} onClick={() => setExpanded(e => !e)}>
        <Td><span style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{order.id.slice(0, 8)}</span></Td>
        <Td><Badge status={order.status} />{order.status === 'pending_driver' && <span style={{ fontSize: '0.68rem', color: 'var(--danger)', marginLeft: 4 }}>(ronda {order.round})</span>}</Td>
        <Td>{order.restaurant_name}</Td>
        <Td><span style={{ fontSize: '0.72rem', color: order.restaurant_open ? '#16a34a' : '#dc2626', fontWeight: 600 }}>{order.restaurant_open ? '● Abierta' : '○ Cerrada'}</span></Td>
        <Td><span style={{ fontSize: '0.75rem' }}>{fmtTs(order.created_at)}</span><span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', marginLeft: 4 }}>({ageMin}m)</span></Td>
        <Td>{fmt(order.total_cents)}</Td>
        <Td><span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{expanded ? '▲' : '▼'}</span></Td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} style={{ padding: '0.75rem 1rem', background: 'var(--bg-sunken)', borderBottom: '2px solid var(--border)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <Detail label="Hora de creación" value={fmtDate(order.created_at)} />
              <Detail label="Última actualización" value={fmtDate(order.updated_at)} />
              <Detail label="Cliente" value={order.customer_name} />
              <Detail label="Tienda" value={order.restaurant_name} />
              <Detail label="Estado pedido" value={STATUS_LABEL[order.status] || order.status} />
              <Detail label="Tienda abierta" value={order.restaurant_open ? 'Sí' : 'No'} color={order.restaurant_open ? '#16a34a' : '#dc2626'} />
              <Detail label="Driver asignado" value={order.driver_name?.split('_')[0] || '—'} />
              <Detail label="Driver disponible" value={order.driver_id ? (order.driver_available ? 'Sí' : 'No') : '—'} />
              <Detail label="Vehículo" value={order.vehicle_type || '—'} />
              <Detail label="Ofertando a" value={order.pending_driver_name?.split('_')[0] || '—'} color="#3b82f6" />
              <Detail label="Oferta iniciada" value={order.offer_started_at ? fmtTs(order.offer_started_at) : '—'} />
              <Detail label="Ronda" value={order.driver_id ? '—' : String(order.round)} />
              <Detail label="Rechazos" value={String(order.rejected_count)} color={order.rejected_count > 0 ? '#dc2626' : undefined} />
              <Detail label="Expiradas" value={String(order.expired_count)} color={order.expired_count > 0 ? '#f59e0b' : undefined} />
              <Detail label="Total" value={fmt(order.total_cents)} />
              <Detail label="Pago" value={order.payment_method || 'cash'} />
              <Detail label="Servicio (tienda)" value={fmt(order.service_fee_cents)} />
              <Detail label="Envío" value={fmt(order.delivery_fee_cents)} />
              <Detail label="Propina" value={fmt(order.tip_cents)} />
            </div>
            <DriversPanel drivers={drivers} orderId={order.id} />
          </td>
        </tr>
      )}
    </>
  );
}
