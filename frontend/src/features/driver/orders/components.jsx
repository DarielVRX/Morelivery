import { IconChat, OrderChat } from '../../customer/orders/components';
import { getDriverEarningCents, getOrderGrandTotalCents, isCashPayment } from '../shared/orderUtils';
import { fmt, formatShortDateTime } from '../../../utils/format';

export function DriverOrdersFeeBreakdown({ order }) {
  const sub = order.total_cents || 0;
  const svc = order.service_fee_cents || 0;
  const delFee = order.delivery_fee_cents || 0;
  const tip = order.tip_cents || 0;
  const isCash = isCashPayment(order);
  const driverEarning = getDriverEarningCents(order);
  const grandTotal = getOrderGrandTotalCents(order);

  if (!svc && !delFee) return null;

  return (
    <div style={{ fontSize:'0.78rem', color:'var(--text-tertiary)', borderTop:'1px solid var(--border-light)', paddingTop:'0.35rem', marginTop:'0.35rem' }}>
      {isCash && (
        <>
          <div style={{ display:'flex', justifyContent:'space-between', color:'var(--gray-700)' }}>
            <span>A pagar a tienda</span><span>{fmt(sub)}</span>
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', fontWeight:700, color:'var(--brand)', marginBottom:'0.15rem' }}>
            <span>Cobrar a cliente</span><span>{fmt(grandTotal)}</span>
          </div>
        </>
      )}
      <div style={{ display:'flex', justifyContent:'space-between', fontWeight:700, color:'var(--success)', marginTop:'0.1rem' }}>
        <span>Tu ganancia</span><span>{fmt(driverEarning)}</span>
      </div>
      {tip > 0 && (
        <div style={{ fontSize:'0.72rem', color:'var(--success)', textAlign:'right' }}>incl. agradecimiento {fmt(tip)}</div>
      )}
    </div>
  );
}

export function DriverAvailableOrderCard({ order, actionLoading, onAccept }) {
  const earn = getDriverEarningCents(order);

  return (
    <li className="card" style={{ borderLeft:'3px solid var(--brand)', marginBottom:'0.5rem', padding:'0.6rem 0.75rem 0.75rem', overflow:'hidden' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.25rem' }}>
        <div style={{ fontSize:'0.7rem', fontWeight:800, textTransform:'uppercase', letterSpacing:'0.5px', color:'var(--brand)' }}>
          Pedido disponible
        </div>
        <div style={{ display:'flex', gap:'0.3rem' }}>
          {order.has_pending_offer && (
            <span style={{ fontSize:'0.65rem', background:'#fef3c7', color:'#92400e', border:'1px solid #fde68a', borderRadius:8, padding:'0.1rem 0.4rem', fontWeight:600 }}>
              Ofertado
            </span>
          )}
          {order.cooldown_secs > 0 && (
            <span style={{ fontSize:'0.65rem', background:'#f1f5f9', color:'var(--text-tertiary)', border:'1px solid var(--border)', borderRadius:8, padding:'0.1rem 0.4rem' }}>
              CD {order.cooldown_secs}s
            </span>
          )}
        </div>
      </div>
      <div style={{ fontSize:'0.82rem', color:'var(--gray-700)', marginBottom:'0.3rem' }}>
        {order.restaurant_address && (
          <div><span style={{ color:'var(--text-tertiary)', fontSize:'0.72rem' }}>Tienda: </span><strong>{order.restaurant_address}</strong></div>
        )}
        {(order.customer_address || order.delivery_address) && (
          <div><span style={{ color:'var(--text-tertiary)', fontSize:'0.72rem' }}>Cliente: </span><strong>{order.customer_address || order.delivery_address}</strong></div>
        )}
      </div>
      {earn > 0 && (
        <div style={{ fontSize:'0.85rem', fontWeight:800, color:'var(--success)', marginBottom:'0.3rem' }}>
          Tu ganancia: {fmt(earn)}
        </div>
      )}
      <button className="btn-primary btn-sm" style={{ width:'100%' }} disabled={actionLoading === order.id} onClick={onAccept}>
        {actionLoading === order.id ? 'Aceptando…' : 'Aceptar pedido'}
      </button>
    </li>
  );
}

export function DriverActiveOrderCard({
  order,
  color,
  isActive,
  isExpanded,
  statusLabel,
  actionLoading,
  rebalancingId,
  releasingId,
  releaseNote,
  onToggleExpand,
  onChangeStatus,
  onRebalance,
  onStartRelease,
  onReleaseNoteChange,
  onConfirmRelease,
  onCancelRelease,
  chatOpen,
  onToggleChat,
  authToken,
  chatTick,
  onCancelDispute,
}) {
  const isOnTheWay = order.status === 'on_the_way';
  const isCash = isCashPayment(order);
  const grandTotal = getOrderGrandTotalCents(order);

  return (
    <li className="card" style={{ borderLeft:`3px solid ${isActive ? 'var(--success)' : color}`, marginBottom:'0.6rem', padding:0, overflow:'hidden', opacity: isActive ? 1 : 0.6 }}>
      <div onClick={onToggleExpand} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0.6rem 0.75rem', cursor:'pointer', gap:'0.5rem' }}>
        <div style={{ minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:'0.35rem', flexWrap:'wrap' }}>
            <span style={{ fontSize:'0.7rem', fontWeight:800, textTransform:'uppercase', color: isActive ? 'var(--success)' : color }}>
              {statusLabel}
            </span>
            {order.is_disputed && (
              <span style={{ fontSize:'0.65rem', fontWeight:700, background:'#fef9c3', color:'#854d0e', border:'1px solid #fde047', borderRadius:8, padding:'0.1rem 0.45rem' }}>
                🔄 En disputa
              </span>
            )}
            {!isActive && <span style={{ fontSize:'0.68rem', color:'var(--text-tertiary)' }}>no activo en home</span>}
          </div>
          {!isOnTheWay
            ? <div style={{ fontSize:'0.8rem', fontWeight:600 }}>{order.restaurant_name}</div>
            : <div style={{ fontSize:'0.8rem', fontWeight:600 }}>{order.customer_name || 'Cliente'}</div>}
        </div>
        <span style={{ color:'var(--text-tertiary)', fontSize:'0.8rem', flexShrink:0 }}>
          {isExpanded ? '▲' : '▼'}
        </span>
      </div>

      {isExpanded && (
        <div style={{ padding:'0 0.75rem 0.65rem', borderTop:`1px solid ${color}22`, maxHeight:260, overflowY:'auto' }}>
          {!isOnTheWay ? (
            <>
              {order.restaurant_address && <div style={{ fontSize:'0.78rem', color:'var(--text-tertiary)' }}>{order.restaurant_address}</div>}
              {isCash
                ? <div style={{ fontSize:'0.8rem', fontWeight:700, color:'var(--brand)', marginTop:'0.2rem' }}>Cobrar al llegar: {fmt(grandTotal)}</div>
                : <div style={{ fontSize:'0.77rem', color:'var(--text-tertiary)', marginTop:'0.2rem' }}>{order.payment_method === 'card' ? '💳 Pago con tarjeta — no cobrar' : '🏦 SPEI — no cobrar'}</div>}
            </>
          ) : (
            <>
              {(order.customer_address || order.delivery_address) && <div style={{ fontSize:'0.78rem', color:'var(--text-tertiary)' }}>{order.customer_address || order.delivery_address}</div>}
              {isCash
                ? <div style={{ fontSize:'0.8rem', fontWeight:700, color:'var(--brand)', marginTop:'0.2rem' }}>Cobrar: {fmt(grandTotal)}</div>
                : <div style={{ fontSize:'0.77rem', color:'var(--text-tertiary)', marginTop:'0.2rem' }}>{order.payment_method === 'card' ? '💳 Ya pagó con tarjeta' : '🏦 Ya pagó SPEI'}</div>}
            </>
          )}
          {(order.items || []).length > 0 && (
            <ul style={{ fontSize:'0.78rem', margin:'0.25rem 0 0 1rem', color:'var(--gray-700)' }}>
              {order.items.map(item => <li key={item.menuItemId}>{item.name} × {item.quantity}</li>)}
            </ul>
          )}
          <DriverOrdersFeeBreakdown order={order} />
          {isActive && (
            <div style={{ marginTop:'0.5rem' }}>
              <div style={{ display:'flex', gap:'0.35rem', flexWrap:'wrap', marginBottom:'0.3rem' }}>
                <button className="btn-sm" style={{ background:order.status === 'ready' ? 'var(--brand)' : '', color:order.status === 'ready' ? '#fff' : '' }} disabled={actionLoading === order.id || order.status !== 'ready'} onClick={() => onChangeStatus('on_the_way')}>
                  En camino
                </button>
                <button className="btn-sm" style={{ background:order.status === 'on_the_way' ? 'var(--success)' : '', color:order.status === 'on_the_way' ? '#fff' : '' }} disabled={actionLoading === order.id || order.status !== 'on_the_way'} onClick={() => onChangeStatus('delivered')}>
                  Entregado
                </button>
              </div>
              {!['on_the_way','delivered','cancelled'].includes(order.status) && (
                <>
                  {releasingId === order.id ? (
                    <div style={{ display:'flex', gap:'0.3rem', alignItems:'center', flexWrap:'wrap' }}>
                      <input value={releaseNote} onChange={e => onReleaseNoteChange(e.target.value)} placeholder="Motivo…" style={{ flex:1, fontSize:'0.78rem', minWidth:100 }} />
                      <button className="btn-sm" style={{ background:'var(--danger)', color:'#fff', borderColor:'var(--danger)', fontSize:'0.75rem' }} disabled={actionLoading === order.id} onClick={onConfirmRelease}>
                        {actionLoading === order.id ? '…' : 'Confirmar'}
                      </button>
                      <button className="btn-sm" style={{ fontSize:'0.75rem' }} onClick={onCancelRelease}>Cancelar</button>
                    </div>
                  ) : (
                    <div style={{ display:'flex', gap:'0.35rem', flexWrap:'wrap' }}>
                      {!order.is_disputed ? (
                        <button className="btn-sm" style={{ fontSize:'0.75rem', color:'#854d0e', borderColor:'#fde047', background:'#fef9c3' }} disabled={rebalancingId === order.id} onClick={onRebalance}>
                          {rebalancingId === order.id ? '…' : '🔄 Rebalancear'}
                        </button>
                      ) : (
                        <div style={{ display:'flex', gap:'0.35rem', alignItems:'center', flexWrap:'wrap' }}>
                          <span style={{ fontSize:'0.72rem', color:'#854d0e', fontStyle:'italic' }}>
                            En disputa — buscando conductor…
                          </span>
                          <button className="btn-sm" style={{ fontSize:'0.72rem', color:'var(--text-secondary)', borderColor:'var(--border)' }} disabled={rebalancingId === order.id} onClick={onCancelDispute}>
                            {rebalancingId === order.id ? '…' : '✕ Cancelar'}
                          </button>
                        </div>
                      )}
                      <button className="btn-sm" style={{ fontSize:'0.75rem', color:'var(--danger)', borderColor:'var(--danger)' }} onClick={onStartRelease}>
                        Liberar
                      </button>
                    </div>
                  )}
                </>
              )}
              <button onClick={onToggleChat} style={{ marginTop:'0.5rem', display:'flex', alignItems:'center', gap:'0.35rem', background:'none', border:'1px solid var(--border)', borderRadius:6, padding:'0.25rem 0.65rem', fontSize:'0.78rem', cursor:'pointer', color:'var(--text-secondary)', fontWeight:600 }}>
                <IconChat /> {chatOpen === order.id ? 'Cerrar chat' : 'Chat del pedido'}
              </button>
              {chatOpen === order.id && <OrderChat orderId={order.id} token={authToken} refreshTick={chatTick} />}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function DriverPastOrderCard({
  order,
  color,
  isExpanded,
  isChatOpen,
  statusLabel,
  reportingId,
  reportText,
  onToggleExpand,
  onToggleChat,
  authToken,
  chatTick,
  onStartReport,
  onReportTextChange,
  onSendReport,
  onCancelReport,
}) {
  const grandTotal = getOrderGrandTotalCents(order);

  return (
    <li className="card" style={{ borderLeft:`3px solid ${color}`, marginBottom:'0.6rem', padding:0, overflow:'hidden' }}>
      <div onClick={onToggleExpand} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0.75rem', cursor:'pointer', gap:'0.5rem' }}>
        <div>
          <span className="badge" style={{ color, borderColor:`${color}55`, background:`${color}15`, marginRight:'0.5rem', fontSize:'0.7rem' }}>
            {statusLabel}
          </span>
          <span style={{ fontWeight:600, fontSize:'0.875rem' }}>{order.restaurant_name}</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', flexShrink:0 }}>
          <span style={{ fontWeight:700 }}>{fmt(grandTotal)}</span>
          <span style={{ color:'var(--text-tertiary)', fontSize:'0.8rem' }}>{isExpanded ? '▲' : '▼'}</span>
        </div>
      </div>
      {isExpanded && (
        <div style={{ padding:'0 0.75rem 0.75rem', borderTop:`1px solid ${color}22` }}>
          <div style={{ fontSize:'0.82rem', color:'var(--text-secondary)', marginBottom:'0.3rem' }}>{formatShortDateTime(order.created_at)}</div>
          {(order.items || []).length > 0 && (
            <ul style={{ fontSize:'0.82rem', margin:'0.2rem 0 0.35rem 1rem' }}>
              {order.items.map(item => <li key={item.menuItemId}>{item.name} × {item.quantity}</li>)}
            </ul>
          )}
          <DriverOrdersFeeBreakdown order={order} />

          <button onClick={onToggleChat} style={{ marginTop:'0.4rem', display:'flex', alignItems:'center', gap:'0.35rem', background:'none', border:'1px solid var(--border)', borderRadius:6, padding:'0.25rem 0.65rem', fontSize:'0.78rem', cursor:'pointer', color:'var(--text-secondary)', fontWeight:600 }}>
            <IconChat /> {isChatOpen ? 'Cerrar chat' : 'Ver chat'}
          </button>
          {isChatOpen && <OrderChat orderId={order.id} token={authToken} refreshTick={chatTick} />}

          {reportingId === order.id ? (
            <div style={{ display:'flex', flexDirection:'column', gap:'0.3rem', marginTop:'0.3rem' }}>
              <textarea value={reportText} onChange={e => onReportTextChange(e.target.value)} placeholder="Describe el problema…" rows={2} style={{ fontSize:'0.78rem', width:'100%', boxSizing:'border-box' }} />
              <div style={{ display:'flex', gap:'0.3rem' }}>
                <button className="btn-sm" style={{ fontSize:'0.75rem', background:'var(--danger)', color:'#fff', borderColor:'var(--danger)' }} onClick={onSendReport}>Enviar</button>
                <button className="btn-sm" style={{ fontSize:'0.75rem' }} onClick={onCancelReport}>Cancelar</button>
              </div>
            </div>
          ) : (
            <button className="btn-sm" style={{ fontSize:'0.72rem', marginTop:'0.2rem' }} onClick={onStartReport}>Reportar</button>
          )}
        </div>
      )}
    </li>
  );
}

