import { useAuth } from '../../contexts/AuthContext';
import { DriverActiveOrderCard, DriverAvailableOrderCard, DriverPastOrderCard } from '../../features/driver/orders/components';
import { useDriverOrdersPageState } from '../../features/driver/orders/useDriverOrdersPageState';

var STATUS_LABELS = {
  created:'Recibido', assigned:'Asignado', accepted:'Aceptado',
  preparing:'En preparación', ready:'Listo para retiro',
  on_the_way:'En camino', delivered:'Entregado',
  cancelled:'Cancelado', pending_driver:'Sin conductor',
};
var STATUS_COLOR = {
  created:'#f59e0b', assigned:'#3b82f6', accepted:'#8b5cf6',
  preparing:'#f97316', ready:'#16a34a', on_the_way:'#0891b2',
  delivered:'#16a34a', cancelled:'#dc2626', pending_driver:'#ef4444',
};

export default function DriverOrders({ registerRef }) {
  const { auth } = useAuth();
  const availability = registerRef?.current?.availability ?? false;
  const view = useDriverOrdersPageState(auth.token, registerRef, availability);

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <div style={{
        flexShrink:0, background:'var(--bg-card)', borderBottom:'2px solid var(--border)',
        padding:'0.65rem 1rem 0', zIndex:30,
        boxShadow:'0 1px 4px rgba(0,0,0,0.04)'
      }}>
        <div style={{ fontWeight:800, fontSize:'1rem', color:'var(--brand)', letterSpacing:'-0.01em', marginBottom:'0.4rem' }}>
          Mis pedidos
        </div>
        <div style={{ display:'flex', gap:0, borderTop:'1px solid var(--border-light)' }}>
          {[
            ['active', 'Activos'],
            ['waiting', view.waitingTabLabel],
            ['past', 'Historial'],
          ].map(([val, label]) => (
            <button key={val} onClick={() => view.setTab(val)}
              style={{
                flex:1, background:'none', border:'none', cursor:'pointer',
                padding:'0.4rem 0.3rem', fontSize:'0.72rem', fontWeight: view.tab===val ? 800 : 500,
                color: view.tab===val ? 'var(--brand)' : 'var(--gray-500)',
                borderBottom: view.tab===val ? '2px solid var(--brand)' : '2px solid transparent',
                marginBottom:'-1px', transition:'color 0.15s'
              }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'0.75rem 1rem', paddingBottom:'calc(var(--nav-h-mobile) + 2.5rem)' }}>
        {view.reportMsg && <p className="flash flash-ok" style={{ marginBottom:'0.5rem' }}>{view.reportMsg}</p>}
        {view.actionMsg && <p className="flash flash-ok" style={{ marginBottom:'0.5rem' }}>{view.actionMsg}</p>}

        {view.tab === 'waiting' && (
          <div style={{ marginBottom:'1.25rem' }}>
            <p style={{ fontSize:'0.8rem', fontWeight:700, color:'var(--text-tertiary)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'0.5rem' }}>
              Buscando conductor ({view.unoffered.length})
            </p>
            <ul style={{ listStyle:'none', padding:0 }}>
              {view.unoffered.map((order) => (
                <DriverAvailableOrderCard
                  key={order.id}
                  order={order}
                  actionLoading={view.actionLoading}
                  onAccept={() => view.acceptDirectly(order.id)}
                />
              ))}
            </ul>
          </div>
        )}

        <div style={{ display:'flex', gap:'0.4rem', marginBottom:'1rem' }} />

        {view.tab === 'active' && (
          view.active.length === 0
            ? <p style={{ color:'var(--text-secondary)', fontSize:'0.9rem' }}>Sin pedidos activos.</p>
            : (
              <ul className="orders-tab-panel" style={{ listStyle:'none', padding:0 }}>
                {view.active.map((order) => {
                  const color = STATUS_COLOR[order.status] || '#9ca3af';
                  const isActive = order.id === view.activeOrderId;
                  const DRIVER_ST = { assigned:'Asignado', on_the_way:'En camino', preparing:'En tienda', ready:'Listo retiro' };
                  return (
                    <DriverActiveOrderCard
                      key={order.id}
                      order={order}
                      color={color}
                      isActive={isActive}
                      isExpanded={view.expanded === order.id}
                      statusLabel={DRIVER_ST[order.status] || STATUS_LABELS[order.status]}
                      actionLoading={view.actionLoading}
                      rebalancingId={view.rebalancingId}
                      releasingId={view.releasingId}
                      releaseNote={view.releaseNote}
                      onToggleExpand={() => view.setExpanded(view.expanded === order.id ? null : order.id)}
                      onChangeStatus={(status) => view.changeStatusWithGps(order.id, status, order)}
                      onRebalance={() => view.doRebalance(order.id)}
                      onCancelDispute={() => view.doCancelDispute(order.id)}
                      onStartRelease={() => view.setReleasingId(order.id)}
                      onReleaseNoteChange={view.setReleaseNote}
                      onConfirmRelease={() => view.confirmRelease(order.id)}
                      onCancelRelease={view.closeReleaseEditor}
                      chatOpen={view.chatOpen}
                      onToggleChat={() => view.toggleChat(order.id)}
                      authToken={auth.token}
                      chatTick={view.chatTick}
                    />
                  );
                })}
              </ul>
            )
        )}

        {view.tab === 'past' && (
          view.past.length === 0
            ? <p style={{ color:'var(--text-secondary)', fontSize:'0.9rem' }}>Sin pedidos anteriores.</p>
            : (
              <ul className="orders-tab-panel reverse" style={{ listStyle:'none', padding:0 }}>
                {view.past.slice(0, 50).map((order) => {
                  const color = STATUS_COLOR[order.status] || '#9ca3af';
                  const historyKey = `h_${order.id}`;
                  return (
                    <DriverPastOrderCard
                      key={order.id}
                      order={order}
                      color={color}
                      isExpanded={view.expanded === historyKey}
                      isChatOpen={view.chatOpen === historyKey}
                      statusLabel={STATUS_LABELS[order.status]}
                      reportingId={view.reportingId}
                      reportText={view.reportText}
                      onToggleExpand={() => view.setExpanded(view.expanded === historyKey ? null : historyKey)}
                      onToggleChat={() => view.toggleChat(historyKey)}
                      authToken={auth.token}
                      chatTick={view.chatTick}
                      onStartReport={() => view.setReportingId(order.id)}
                      onReportTextChange={view.setReportText}
                      onSendReport={() => view.sendReport(order.id)}
                      onCancelReport={() => { view.setReportingId(null); view.setReportText(''); }}
                    />
                  );
                })}
              </ul>
            )
        )}
      </div>
    </div>
  );
}

