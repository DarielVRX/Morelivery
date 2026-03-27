// frontend/src/features/admin/dashboard/sections.jsx
import { Badge, CooldownBadge, OfferBar, OrderRow, Th, Td } from './shared';

export function DashboardTabsBar({
  tab,
  onTabChange,
  onReload,
  unassignedCount,
  reportsCount,
  feedCount,
}) {
  const tabBtn = (key, label) => (
    <button
    key={key}
    onClick={() => onTabChange(key)}
    style={{
      padding: '0.4rem 0.875rem',
      border: 'none',
      cursor: 'pointer',
      borderRadius: 8,
      fontWeight: tab === key ? 700 : 400,
      fontSize: '0.85rem',
      background: tab === key ? 'var(--brand)' : 'transparent',
                                  color: tab === key ? '#fff' : 'var(--text-secondary)',
    }}
    >
    {label}
    </button>
  );

  return (
    <div
    style={{
      display: 'flex',
      gap: '0.25rem',
      marginBottom: '1.25rem',
      borderBottom: '1px solid var(--border)',
          paddingBottom: '0.5rem',
          flexWrap: 'wrap',
    }}
    >
    {tabBtn('assignment', `🛵 Asignaciones${unassignedCount ? ` (${unassignedCount})` : ''}`)}
    {tabBtn('orders', '📦 Pedidos')}
    {tabBtn('metrics', '📊 Métricas')}
    {tabBtn('users', '👥 Usuarios')}
    {tabBtn('engine', '⚙️ Motor')}
    {tabBtn('reports', `🚨 Reportes${reportsCount > 0 ? ` (${reportsCount})` : ''}`)}
    {tabBtn('notes', '📝 Notas')}
    {tabBtn('ratings', '⭐ Ratings')}
    {tabBtn('feed', `📡 Feed${feedCount > 0 ? ` (${feedCount})` : ''}`)}
    {tabBtn('system', '🔧 Sistema')}
    {tabBtn('emergency', '⚡ Emergencias')}
    {tabBtn('support', `🛟 Soporte${reportsCount > 0 ? ` (${reportsCount})` : ''}`)}
    <button
    onClick={onReload}
    style={{
      marginLeft: 'auto',
      padding: '0.4rem 0.75rem',
      border: '1px solid var(--border)',
          borderRadius: 8,
          cursor: 'pointer',
          fontSize: '0.8rem',
          background: 'var(--bg-card)',
    }}
    >
    ↻ Actualizar
    </button>
    </div>
  );
}

export function AssignmentTab({ liveData, tick }) {
  const unassignedOrders = liveData.orders.filter((order) => !order.driver_id);
  const sortedDrivers = [...liveData.drivers].sort((a, b) => {
    const score = (driver) => {
      if (driver.active_orders > 0) return 0;
      if (driver.is_available && !driver.pending_offer_order_id && !(driver.cooldowns || []).length) return 1;
      if (driver.is_available && driver.pending_offer_order_id) return 2;
      if ((driver.cooldowns || []).length > 0) return 3;
      return 4;
    };
    return score(a) - score(b);
  });

  return (
    <div>
    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
    {[
      { label: 'Pedidos activos', value: liveData.orders.length, color: '#60a5fa' },
      { label: 'Sin driver', value: unassignedOrders.length, color: '#ef4444' },
      {
        label: 'Con oferta',
        value: liveData.orders.filter((order) => order.pending_driver_id && !order.driver_id).length,
          color: '#f59e0b',
      },
      {
        label: 'Drivers disponibles',
        value: liveData.drivers.filter((driver) => driver.is_available).length,
          color: '#16a34a',
      },
      {
        label: 'Drivers en entrega',
        value: liveData.drivers.filter((driver) => driver.active_orders > 0).length,
          color: '#8b5cf6',
      },
    ].map(({ label, value, color }) => (
      <div
      key={label}
      style={{
        border: '1px solid var(--border)',
                                        borderRadius: 8,
                                        padding: '0.6rem 1rem',
                                        flex: '1 1 130px',
                                        minWidth: 130,
      }}
      >
      <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{label}</div>
      <div style={{ fontSize: '1.5rem', fontWeight: 800, color, lineHeight: 1.2 }}>{value}</div>
      </div>
    ))}
    </div>

    {liveData.orders.length === 0 ? (
      <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-tertiary)' }}>No hay pedidos activos.</div>
    ) : (
      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
      <thead>
      <tr>
      <Th>ID</Th>
      <Th>Estado</Th>
      <Th>Tienda</Th>
      <Th>Abierta</Th>
      <Th>Hora</Th>
      <Th>Total</Th>
      <Th></Th>
      </tr>
      </thead>
      <tbody>
      {unassignedOrders.map((order) => (
        <OrderRow key={order.id} order={order} drivers={liveData.drivers} tick={tick} />
      ))}
      </tbody>
      </table>
      </div>
    )}

    <div style={{ marginTop: '1.5rem', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
    <div
    style={{
      padding: '0.65rem 1rem',
      background: 'var(--bg-sunken)',
          fontWeight: 700,
          fontSize: '0.875rem',
          borderBottom: '1px solid var(--border)',
    }}
    >
    👥 Estado de todos los drivers
    </div>
    {liveData.drivers.length === 0 ? (
      <div style={{ padding: '1rem', color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>Sin drivers registrados.</div>
    ) : (
      <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
      <tr>
      <Th>#</Th>
      <Th>Driver</Th>
      <Th>Disponible</Th>
      <Th>Pedidos activos</Th>
      <Th>Oferta activa</Th>
      <Th>GPS</Th>
      <Th>Cooldowns</Th>
      </tr>
      </thead>
      <tbody>
      {sortedDrivers.map((driver) => {
        const cooldowns = driver.cooldowns || [];
        return (
          <tr key={driver.id}>
          <Td>{driver.driver_number || '—'}</Td>
          <Td>
          <span style={{ fontWeight: 600 }}>{driver.full_name?.split('_')[0] || '—'}</span>
          </Td>
          <Td>
          {driver.is_available ? (
            <span style={{ color: 'var(--success)', fontWeight: 700, fontSize: '0.75rem' }}>● Sí</span>
          ) : (
            <span style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>○ No</span>
          )}
          </Td>
          <Td>
          {driver.active_orders > 0 ? (
            <Badge status="on_the_way" label={`${driver.active_orders} en entrega`} />
          ) : (
            <span style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>0</span>
          )}
          </Td>
          <Td>
          {driver.pending_offer_order_id ? (
            <div>
            <span style={{ fontSize: '0.75rem', color: '#60a5fa', fontWeight: 600 }}>
            {driver.pending_offer_order_id.slice(0, 8)}
            </span>
            {driver.pending_offer_started_at && (
              <div style={{ marginTop: 2 }}>
              <OfferBar startedAt={driver.pending_offer_started_at} total={60} tick={tick} />
              </div>
            )}
            </div>
          ) : (
            <span style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>—</span>
          )}
          </Td>
          <Td>
          {driver.last_lat && driver.last_lng ? (
            <span style={{ color: 'var(--success)', fontSize: '0.75rem', fontWeight: 600 }}>
            ✓ {Number(driver.last_lat).toFixed(3)},{Number(driver.last_lng).toFixed(3)}
            </span>
          ) : (
            <span style={{ color: 'var(--text-tertiary)', fontSize: '0.72rem' }}>Sin GPS</span>
          )}
          </Td>
          <Td>
          {cooldowns.length === 0 ? (
            <span style={{ color: 'var(--text-tertiary)', fontSize: '0.72rem' }}>—</span>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {cooldowns.map((cooldown, index) => (
              <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
              {cooldown.order_id.slice(0, 6)}
              </span>
              <CooldownBadge waitUntil={cooldown.wait_until} tick={tick} />
              </div>
            ))}
            </div>
          )}
          </Td>
          </tr>
        );
      })}
      </tbody>
      </table>
      </div>
    )}
    </div>
    </div>
  );
}
