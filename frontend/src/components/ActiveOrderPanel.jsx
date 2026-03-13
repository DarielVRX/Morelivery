// components/ActiveOrderPanel.jsx — panel inferior del pedido activo
import { fmt } from '../utils/format';
import FeeBreakdown from './FeeBreakdown';

const DST = {
  assigned:   'Asignado — ve a recoger',
  on_the_way: 'En camino al cliente',
  preparing:  'Esperando en tienda',
  ready:      'Listo para retiro',
  accepted:   'Aceptado',
  created:    'Nuevo pedido',
};

export default function ActiveOrderPanel({
  order,
  expanded,
  loadingStatus,
  showRelease,
  releaseNote,
  onToggleExpand,
  onChangeStatus,
  onToggleRelease,
  onReleaseNoteChange,
  onConfirmRelease,
  onRoute,
}) {
  if (!order) return null;

  const isOTW  = order.status === 'on_the_way';
  const isCash = (order.payment_method || 'cash') === 'cash';
  const total  = (order.total_cents || 0) + (order.service_fee_cents || 0)
               + (order.delivery_fee_cents || 0) + (order.tip_cents || 0);
  const earn   = (order.delivery_fee_cents || 0)
               + Math.round((order.service_fee_cents || 0) * 0.5)
               + (order.tip_cents || 0);

  const expandStyle = {
    display:           'grid',
    gridTemplateRows:  expanded ? '1fr' : '0fr',
    transition:        'grid-template-rows 0.22s ease',
    overflow:          'hidden',
  };

  return (
    <div style={{ flexShrink:0, background:'#fff',
      borderTop:'2px solid var(--success)', zIndex:10,
      position:'absolute', bottom:0, left:0, right:0, width:'100%',
      display:'flex', flexDirection:'column' }}>

      {/* Cabecera colapsable */}
      <div onClick={onToggleExpand}
        style={{ padding:'0.55rem 1rem 0.6rem', flexShrink:0, cursor:'pointer', userSelect:'none' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontSize:'0.7rem', fontWeight:800, textTransform:'uppercase',
            letterSpacing:'0.5px', color:'var(--success)' }}>
            {DST[order.status] || order.status}
          </span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="var(--gray-400)" strokeWidth="2.5" strokeLinecap="round"
            style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition:'transform 0.2s' }}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>

        {!isOTW ? (
          <div style={{ fontSize:'0.82rem', marginTop:'0.15rem' }}>
            <strong>{order.restaurant_name}</strong>
            {order.restaurant_address && (
              <div style={{ color:'var(--gray-500)', fontSize:'0.77rem' }}>{order.restaurant_address}</div>
            )}
            {isCash
              ? <div style={{ fontWeight:700, color:'var(--brand)', fontSize:'0.8rem', marginTop:'0.1rem' }}>
                  Pagar a tienda: {fmt(order.total_cents || 0)}
                </div>
              : <div style={{ fontSize:'0.77rem', color:'var(--gray-400)', marginTop:'0.1rem' }}>
                  {order.payment_method === 'card' ? '💳 Pago con tarjeta — no cobrar' : '🏦 Pago SPEI — no cobrar'}
                </div>
            }
          </div>
        ) : (
          <div style={{ fontSize:'0.82rem', marginTop:'0.15rem' }}>
            <strong>{order.customer_name || 'Cliente'}</strong>
            {(order.customer_address || order.delivery_address) && (
              <div style={{ color:'var(--gray-500)', fontSize:'0.77rem' }}>
                {order.customer_address || order.delivery_address}
              </div>
            )}
            {isCash
              ? <div style={{ fontWeight:700, color:'var(--success)', fontSize:'0.8rem', marginTop:'0.1rem' }}>
                  Cobrar a cliente: {fmt(total)}
                </div>
              : <div style={{ fontSize:'0.77rem', color:'var(--gray-400)', marginTop:'0.1rem' }}>
                  {order.payment_method === 'card' ? '💳 Ya pagó con tarjeta' : '🏦 Ya pagó SPEI'}
                </div>
            }
          </div>
        )}

        <div style={{ display:'flex', gap:'0.35rem', marginTop:'0.45rem' }}
          onClick={e => e.stopPropagation()}>
          <button className="btn-sm" onClick={onRoute}>🗺 Ruta</button>
        </div>
      </div>

      {/* Sección expandible — OPT-11: grid-template-rows, no max-height */}
      <div style={expandStyle}>
        <div style={{ overflow:'hidden' }}>
          <div style={{ padding:'0.4rem 1rem 0.6rem', borderTop:'1px solid var(--gray-100)' }}>

            {(order.items || []).length > 0 && (
              <ul style={{ fontSize:'0.8rem', margin:'0 0 0.3rem 1rem', color:'var(--gray-700)' }}>
                {order.items.map(i => <li key={i.menuItemId}>{i.name} × {i.quantity}</li>)}
              </ul>
            )}

            <FeeBreakdown order={order} />

            <div style={{ fontSize:'0.78rem', color:'var(--gray-500)', marginBottom:'0.3rem', marginTop:'0.3rem' }}>
              Ganancia estimada:{' '}
              <strong style={{ color:'var(--success)' }}>{fmt(earn)}</strong>
            </div>

            <div style={{ display:'flex', gap:'0.4rem', flexWrap:'wrap', marginBottom:'0.4rem' }}>
              <button className="btn-sm"
                style={{ background: order.status === 'ready' ? 'var(--brand)' : '',
                         color:      order.status === 'ready' ? '#fff'         : '' }}
                disabled={loadingStatus === 'on_the_way' || order.status !== 'ready'}
                onClick={() => onChangeStatus(order.id, 'on_the_way')}>
                En camino
              </button>
              <button className="btn-sm"
                style={{ background: order.status === 'on_the_way' ? 'var(--success)' : '',
                         color:      order.status === 'on_the_way' ? '#fff'           : '' }}
                disabled={loadingStatus === 'delivered' || order.status !== 'on_the_way'}
                onClick={() => onChangeStatus(order.id, 'delivered')}>
                Entregado
              </button>
              {!['on_the_way', 'delivered', 'cancelled'].includes(order.status) && (
                <button className="btn-sm btn-danger" onClick={onToggleRelease}>Liberar</button>
              )}
            </div>

            {showRelease && (
              <div>
                <textarea value={releaseNote} onChange={e => onReleaseNoteChange(e.target.value)}
                  placeholder="Motivo (obligatorio)" rows={2}
                  style={{ width:'100%', boxSizing:'border-box', marginBottom:'0.3rem', fontSize:'0.82rem' }} />
                <div style={{ display:'flex', gap:'0.3rem' }}>
                  <button className="btn-sm btn-danger" onClick={onConfirmRelease}>Confirmar</button>
                  <button className="btn-sm" onClick={() => { onToggleRelease(); onReleaseNoteChange(''); }}>Cancelar</button>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>

    </div>
  );
}
