import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { DriverActiveOrderCard, DriverAvailableOrderCard, DriverPastOrderCard } from '../../features/driver/orders/components';
import { useDriverOrders } from '../../hooks/useDriverOrders';

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

export default function DriverOrders() {
  const { auth } = useAuth();
  const orderState = useDriverOrders(auth.token);
  const [tab, setTab] = useState('active');
  const [reportingId, setReportingId] = useState(null);
  const [reportText, setReportText] = useState('');
  const [reportMsg, setReportMsg] = useState('');
  const [releaseNote, setReleaseNote] = useState('');
  const [releasingId, setReleasingId] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [chatOpen, setChatOpenState] = useState(null);

  function setChatOpen(valueOrUpdater) {
    setChatOpenState((current) => {
      const nextValue = typeof valueOrUpdater === 'function' ? valueOrUpdater(current) : valueOrUpdater;
      orderState.setChatOpen(nextValue);
      return nextValue;
    });
  }

  async function sendReport(orderId) {
    if (!reportText.trim()) return;
    await orderState.sendReport(orderId, reportText, () => {
      setReportingId(null);
      setReportText('');
      setReportMsg('Reporte enviado');
      setTimeout(() => setReportMsg(''), 3000);
    });
  }


  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      {/* ── Encabezado fijo ─────────────────────────────────────────── */}
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
            ['waiting', orderState.unoffered.length > 0 ? `En espera (${orderState.unoffered.length})` : 'En espera'],
            ['past',   'Historial'],
          ].map(([val, label]) => (
            <button key={val} onClick={() => setTab(val)}
              style={{
                flex:1, background:'none', border:'none', cursor:'pointer',
                padding:'0.4rem 0.3rem', fontSize:'0.72rem', fontWeight: tab===val ? 800 : 500,
                color: tab===val ? 'var(--brand)' : 'var(--gray-500)',
                borderBottom: tab===val ? '2px solid var(--brand)' : '2px solid transparent',
                marginBottom:'-1px', transition:'color 0.15s'
              }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Contenido scrolleable ─────────────────────────────────── */}
      <div style={{ flex:1, overflowY:'auto', padding:'0.75rem 1rem', paddingBottom:'calc(var(--nav-h-mobile) + 2.5rem)' }}>

      {reportMsg  && <p className="flash flash-ok"    style={{ marginBottom:'0.5rem' }}>{reportMsg}</p>}
      {orderState.actionMsg  && <p className="flash flash-ok"    style={{ marginBottom:'0.5rem' }}>{orderState.actionMsg}</p>}
      {/* ── En espera (sin oferta activa) ─────────────────────────────── */}
      {tab === 'waiting' && (
        <div style={{ marginBottom:'1.25rem' }}>
          <p style={{ fontSize:'0.8rem', fontWeight:700, color:'var(--text-tertiary)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'0.5rem' }}>
            Buscando conductor ({orderState.unoffered.length})
          </p>
          <ul style={{ listStyle:'none', padding:0 }}>
            {orderState.unoffered.map(order => (
              <DriverAvailableOrderCard
                key={order.id}
                order={order}
                actionLoading={orderState.actionLoading}
                onAccept={() => orderState.acceptDirectly(order.id)}
              />
            ))}
          </ul>
        </div>
      )}

      <div style={{ display:'flex', gap:'0.4rem', marginBottom:'1rem' }}>
      </div>

      {tab === 'active' && (
        orderState.active.length === 0
          ? <p style={{ color:'var(--text-secondary)', fontSize:'0.9rem' }}>Sin pedidos activos.</p>
          : (
            <ul className="orders-tab-panel" style={{ listStyle:'none', padding:0 }}>
              {orderState.active.map(order => {
                const color = STATUS_COLOR[order.status] || '#9ca3af';
                const isActive = order.id === orderState.activeOrderId;
                const DRIVER_ST = { assigned:'Asignado', on_the_way:'En camino', preparing:'En tienda', ready:'Listo retiro' };
                return (
                  <DriverActiveOrderCard
                    key={order.id}
                    order={order}
                    color={color}
                    isActive={isActive}
                    isExpanded={expanded === order.id}
                    statusLabel={DRIVER_ST[order.status] || STATUS_LABELS[order.status]}
                    actionLoading={orderState.actionLoading}
                    rebalancingId={orderState.rebalancingId}
                    releasingId={releasingId}
                    releaseNote={releaseNote}
                    onToggleExpand={() => setExpanded(expanded === order.id ? null : order.id)}
                    onChangeStatus={(status) => orderState.changeStatusWithGps(order.id, status, order)}
                    onRebalance={() => orderState.doRebalance(order.id)}
                    onStartRelease={() => setReleasingId(order.id)}
                    onReleaseNoteChange={setReleaseNote}
                    onConfirmRelease={() => orderState.releaseOrder(order.id, releaseNote, () => { setReleasingId(null); setReleaseNote(''); })}
                    onCancelRelease={() => { setReleasingId(null); setReleaseNote(''); }}
                    chatOpen={chatOpen}
                    onToggleChat={() => setChatOpen(chatOpen === order.id ? null : order.id)}
                    authToken={auth.token}
                    chatTick={orderState.chatTick}
                  />
                );
              })}
            </ul>
          )
      )}

      {tab === 'past' && (
        orderState.past.length === 0
          ? <p style={{ color:'var(--text-secondary)', fontSize:'0.9rem' }}>Sin pedidos anteriores.</p>
          : (
            <ul className="orders-tab-panel reverse" style={{ listStyle:'none', padding:0 }}>
              {orderState.past.slice(0, 50).map(order => {
                const color = STATUS_COLOR[order.status] || '#9ca3af';
                const historyKey = 'h_' + order.id;
                return (
                  <DriverPastOrderCard
                    key={order.id}
                    order={order}
                    color={color}
                    isExpanded={expanded === historyKey}
                    isChatOpen={chatOpen === historyKey}
                    statusLabel={STATUS_LABELS[order.status]}
                    reportingId={reportingId}
                    reportText={reportText}
                    onToggleExpand={() => setExpanded(expanded === historyKey ? null : historyKey)}
                    onToggleChat={() => setChatOpen(chatOpen === historyKey ? null : historyKey)}
                    authToken={auth.token}
                    chatTick={orderState.chatTick}
                    onStartReport={() => setReportingId(order.id)}
                    onReportTextChange={setReportText}
                    onSendReport={() => sendReport(order.id)}
                    onCancelReport={() => { setReportingId(null); setReportText(''); }}
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
