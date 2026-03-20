// frontend/src/pages/Customer/Payments.jsx
// Estructura lista para producción.
// Para activar pagos reales: conectar handleCardSubmit a /payments/intent + /payments/confirm
// y handleSpeiSubmit a /payments/intent con method='spei'.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { readPendingOrder, clearPendingOrder } from '../../utils/pendingOrder';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';

function CardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      style={{ width:20, height:20, verticalAlign:'middle' }}>
      <rect x="2" y="5" width="20" height="14" rx="2"/>
      <path d="M2 10h20"/>
    </svg>
  );
}

function formatCard(v)   { return v.replace(/\D/g,'').slice(0,16).replace(/(\d{4})(?=\d)/g,'$1 '); }
function formatExpiry(v) { return v.replace(/\D/g,'').slice(0,4).replace(/(\d{2})(\d)/,'$1/$2'); }

export default function CustomerPayments() {
  const { auth }  = useAuth();
  const navigate  = useNavigate();
  const [draft,    setDraft]    = useState(null); // pending order draft from sessionStorage
  const [sending,  setSending]  = useState(false);
  const [methods,  setMethods]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [method,   setMethod]   = useState('cash');
  const [msg,      setMsg]      = useState('');
  const [msgType,  setMsgType]  = useState('ok');

  // Card fields
  const [cardNum,  setCardNum]  = useState('');
  const [expiry,   setExpiry]   = useState('');
  const [cvv,      setCvv]      = useState('');
  const [name,     setName]     = useState('');

  // SPEI fields
  const [speiRef,  setSpeiRef]  = useState('');

  // Leer draft de pedido pendiente
  useEffect(() => {
    const d = readPendingOrder();
    if (d) setDraft(d);
  }, []);

  useEffect(() => {
    apiFetch('/payments/methods', {}, auth.token)
      .then(d => {
        // Forzar todos como disponibles — validación real se conecta al activar procesador
        const list = (d.methods || []).map(m => ({ ...m, available: true, coming_soon: false }));
        setMethods(list);
      })
      .catch(() => setMethods([
        { id:'cash', label:'Efectivo al entregar',      available:true },
        { id:'card', label:'Tarjeta de crédito/débito', available:true },
        { id:'spei', label:'SPEI / Transferencia',      available:true },
      ]))
      .finally(() => setLoading(false));
  }, [auth.token]);

  function flash(text, type = 'ok') {
    setMsg(text); setMsgType(type === 'error' ? 'error' : 'ok');
    setTimeout(() => setMsg(''), 5000);
  }

  // ── Confirmar pago — crea el pedido real en BD ──────────────────────────────
  // Sin validación por ahora; datos se envían tal cual al confirmar.
  async function handleSave() {
    if (!draft) {
      flash('No hay un pedido pendiente. Vuelve a la tienda y selecciona productos.', 'error');
      return;
    }
    setSending(true);
    try {
      const body = {
        restaurantId:     draft.restaurantId,
        items:            draft.items || [],
        payment_method:   method,
        tip_cents:        draft.tip_cents || 0,
        delivery_address: draft.delivery_address || '',
        delivery_lat:     draft.delivery_lat,
        delivery_lng:     draft.delivery_lng,
        // Datos de tarjeta/SPEI — solo referencia visual por ahora, no procesados
        ...(method === 'card' ? { card_name: name, card_last4: cardNum.replace(/\s/g,'').slice(-4) } : {}),
        ...(method === 'spei' ? { spei_ref: speiRef } : {}),
      };
      await apiFetch('/orders', { method: 'POST', body: JSON.stringify(body) }, auth.token);
      clearPendingOrder();
      flash('¡Pedido confirmado! Puedes seguirlo en Mis Pedidos.');
      setTimeout(() => navigate('/customer'), 1800);
    } catch (e) {
      flash(e.message || 'Error al crear el pedido.', 'error');
    } finally {
      setSending(false);
    }
  }

  if (loading) return (
    <div style={{ padding:'2rem', textAlign:'center', color:'var(--text-tertiary)' }}>Cargando…</div>
  );

  return (
    <div style={{ padding:'1rem', maxWidth:480, margin:'0 auto' }}>
      {draft && (
        <div style={{ background:'var(--bg-sunken)', border:'1px solid var(--border)',
          borderRadius:10, padding:'0.75rem', marginBottom:'1.25rem',
          fontSize:'0.82rem', color:'var(--text-secondary)' }}>
          <div style={{ fontWeight:700, color:'var(--text-primary)', marginBottom:'0.25rem' }}>
            📦 Pedido pendiente
          </div>
          {draft.delivery_address && (
            <div>📍 {draft.delivery_address}</div>
          )}
          {draft.items?.length > 0 && (
            <div>{draft.items.length} producto{draft.items.length !== 1 ? 's' : ''}</div>
          )}
        </div>
      )}

      <h2 style={{ fontSize:'1.05rem', fontWeight:800, marginBottom:'0.25rem' }}>💳 Método de pago</h2>
      <p style={{ fontSize:'0.82rem', color:'var(--gray-500)', marginBottom:'1.25rem' }}>
        Elige cómo quieres pagar tus pedidos.
      </p>

      {/* Selector de método */}
      <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem', marginBottom:'1.5rem' }}>
        {methods.map(m => (
          <label key={m.id} style={{
            display:'flex', alignItems:'center', gap:'0.75rem',
            padding:'0.875rem', borderRadius:10, cursor:'pointer',
            border:`2px solid ${method===m.id ? 'var(--brand)' : 'var(--gray-200)'}`,
            background: method===m.id ? 'var(--brand-light)' : 'var(--bg-card)',
          }}>
            <input type="radio" name="method" value={m.id}
              checked={method===m.id}
              onChange={() => setMethod(m.id)}
              style={{ accentColor:'var(--brand)' }} />
            <span style={{ fontSize:'1.1rem' }}>
              {m.id==='cash' ? '💵' : m.id==='card' ? '💳' : '🏦'}
            </span>
            <div style={{ fontWeight:700, fontSize:'0.875rem' }}>{m.label}</div>
          </label>
        ))}
      </div>

      {/* ── Formulario tarjeta ── */}
      {method === 'card' && (
        <div style={{ background:'var(--bg-sunken)', border:'1px solid var(--gray-200)',
          borderRadius:10, padding:'1rem', marginBottom:'1rem' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'0.4rem', marginBottom:'0.875rem',
            fontSize:'0.875rem', fontWeight:700, color:'var(--text-secondary)' }}>
            <CardIcon /> Datos de tarjeta
          </div>

          <label style={{ display:'block', marginBottom:'0.6rem', fontSize:'0.82rem', fontWeight:600 }}>
            Nombre en la tarjeta
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="Como aparece en la tarjeta"
              style={{ display:'block', width:'100%', marginTop:4, boxSizing:'border-box' }} />
          </label>

          <label style={{ display:'block', marginBottom:'0.6rem', fontSize:'0.82rem', fontWeight:600 }}>
            Número de tarjeta
            <input type="text" inputMode="numeric" value={cardNum}
              onChange={e => setCardNum(formatCard(e.target.value))}
              placeholder="1234 5678 9012 3456" maxLength={19}
              style={{ display:'block', width:'100%', marginTop:4, fontFamily:'monospace', boxSizing:'border-box' }} />
          </label>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.6rem', marginBottom:'0.75rem' }}>
            <label style={{ fontSize:'0.82rem', fontWeight:600 }}>
              Vencimiento
              <input type="text" inputMode="numeric" value={expiry}
                onChange={e => setExpiry(formatExpiry(e.target.value))}
                placeholder="MM/AA" maxLength={5}
                style={{ display:'block', width:'100%', marginTop:4, boxSizing:'border-box' }} />
            </label>
            <label style={{ fontSize:'0.82rem', fontWeight:600 }}>
              CVV
              <input type="text" inputMode="numeric" value={cvv}
                onChange={e => setCvv(e.target.value.replace(/\D/g,'').slice(0,4))}
                placeholder="123" maxLength={4}
                style={{ display:'block', width:'100%', marginTop:4, boxSizing:'border-box' }} />
            </label>
          </div>

          <div style={{ padding:'0.5rem 0.75rem', background:'#fffbeb',
            border:'1px solid #fde68a', borderRadius:8, fontSize:'0.78rem', color:'#92400e' }}>
            🔒 Procesador pendiente de integración. Los datos no se envían a ningún servidor.
          </div>
        </div>
      )}

      {/* ── Formulario SPEI ── */}
      {method === 'spei' && (
        <div style={{ background:'var(--bg-sunken)', border:'1px solid #bfdbfe',
          borderRadius:10, padding:'1rem', marginBottom:'1rem' }}>
          <div style={{ fontSize:'0.875rem', fontWeight:700, color:'var(--text-secondary)', marginBottom:'0.75rem' }}>
            🏦 Transferencia SPEI
          </div>

          <label style={{ display:'block', marginBottom:'0.6rem', fontSize:'0.82rem', fontWeight:600 }}>
            Referencia (opcional)
            <input type="text" value={speiRef} onChange={e => setSpeiRef(e.target.value)}
              placeholder="Número de referencia o concepto"
              style={{ display:'block', width:'100%', marginTop:4, boxSizing:'border-box' }} />
          </label>

          <div style={{ padding:'0.5rem 0.75rem', background:'#eff6ff',
            border:'1px solid #bfdbfe', borderRadius:8, fontSize:'0.78rem', color:'#1e40af' }}>
            ℹ️ Al confirmar recibirás la CLABE destino y el monto a transferir.
            Procesador pendiente de integración.
          </div>
        </div>
      )}

      <button className="btn-primary"
        style={{ width:'100%', padding:'0.75rem', fontSize:'0.95rem' }}
        disabled={sending || !draft}
        onClick={handleSave}>
        {sending ? 'Procesando…'
          : !draft ? 'Sin pedido pendiente'
          : method === 'cash' ? 'Confirmar pedido — Efectivo'
          : method === 'card' ? 'Confirmar pedido — Tarjeta'
          : 'Confirmar pedido — SPEI'}
      </button>

      {!draft && (
        <p style={{ fontSize:'0.8rem', color:'var(--text-tertiary)', marginTop:'0.5rem', textAlign:'center' }}>
          Selecciona productos en una tienda antes de pagar.
        </p>
      )}

      {msg && (
        <div className={`flash ${msgType === 'error' ? 'flash-error' : 'flash-ok'}`}
          style={{ marginTop:'0.75rem' }}>
          {msg}
        </div>
      )}
    </div>
  );
}
