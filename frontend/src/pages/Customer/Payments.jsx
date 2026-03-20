// frontend/src/pages/Customer/Payments.jsx
// Estructura lista para producción.
// Para activar pagos reales: conectar handleCardSubmit a /payments/intent + /payments/confirm
// y handleSpeiSubmit a /payments/intent con method='spei'.
import { useEffect, useState } from 'react';
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
  const { auth } = useAuth();
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

  useEffect(() => {
    apiFetch('/payments/methods', {}, auth.token)
    .then(d => {
      const list = d.methods || [];
      setMethods(list);
      const first = list.find(m => m.available);
      if (first) setMethod(first.id);
    })
    .catch(() => setMethods([
      { id:'cash', label:'Efectivo al entregar',      available:true  },
      { id:'card', label:'Tarjeta de crédito/débito', available:false, coming_soon:true },
      { id:'spei', label:'SPEI / Transferencia',      available:false, coming_soon:true },
    ]))
    .finally(() => setLoading(false));
  }, [auth.token]);

  function flash(text, type = 'ok') {
    setMsg(text); setMsgType(type);
    setTimeout(() => setMsg(''), 4000);
  }

  // ── Handlers listos para conectar al procesador ───────────────────────────
  async function handleCashSave() {
    // TODO: persistir preferencia en backend si se requiere
    flash('Configuración guardada: pago en efectivo al entregar.');
  }

  async function handleCardSubmit() {
    // TODO: conectar a /payments/intent + procesador (Stripe / Conekta)
    // const intent = await apiFetch('/payments/intent', {
    //   method:'POST', body: JSON.stringify({ method:'card', amount_cents: ... })
    // }, auth.token);
    // await stripe.confirmCardPayment(intent.client_secret, { ... });
    flash('Tarjeta guardada (modo prueba — procesador no activo).');
  }

  async function handleSpeiSubmit() {
    // TODO: conectar a /payments/intent con method='spei'
    // La respuesta incluirá CLABE destino, monto y referencia para el usuario
    flash('SPEI registrado (modo prueba — procesador no activo).');
  }

  function handleSave() {
    if (method === 'cash') return handleCashSave();
    if (method === 'card') return handleCardSubmit();
    if (method === 'spei') return handleSpeiSubmit();
  }

  if (loading) return (
    <div style={{ padding:'2rem', textAlign:'center', color:'var(--text-tertiary)' }}>Cargando…</div>
  );

  return (
    <div style={{ padding:'1rem', maxWidth:480, margin:'0 auto' }}>
    <h2 style={{ fontSize:'1.05rem', fontWeight:800, marginBottom:'0.25rem' }}>💳 Métodos de pago</h2>
    <p style={{ fontSize:'0.82rem', color:'var(--gray-500)', marginBottom:'1.25rem' }}>
    Elige cómo quieres pagar tus pedidos.
    </p>

    {/* Selector de método */}
    <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem', marginBottom:'1.5rem' }}>
    {methods.map(m => (
      <label key={m.id} style={{
        display:'flex', alignItems:'center', gap:'0.75rem',
        padding:'0.875rem', borderRadius:10,
        cursor: m.available ? 'pointer' : 'default',
        border:`2px solid ${method===m.id ? 'var(--brand)' : 'var(--gray-200)'}`,
                       background: method===m.id ? 'var(--brand-light)' : 'var(--bg-card)',
                       opacity: m.available ? 1 : 0.55,
      }}>
      <input type="radio" name="method" value={m.id}
      checked={method===m.id}
      disabled={!m.available}
      onChange={() => m.available && setMethod(m.id)}
      style={{ accentColor:'var(--brand)' }} />
      <span style={{ fontSize:'1.1rem' }}>
      {m.id==='cash' ? '💵' : m.id==='card' ? '💳' : '🏦'}
      </span>
      <div>
      <div style={{ fontWeight:700, fontSize:'0.875rem' }}>{m.label}</div>
      {(m.coming_soon || !m.available) && (
        <div style={{ fontSize:'0.72rem', color:'var(--gray-400)', marginTop:'0.1rem' }}>
        Próximamente disponible
        </div>
      )}
      </div>
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
    onClick={handleSave}>
    {method === 'cash' ? 'Guardar método de pago'
      : method === 'card' ? 'Guardar tarjeta'
  : 'Confirmar SPEI'}
  </button>

  {msg && (
    <div className={`flash ${msgType === 'error' ? 'flash-error' : 'flash-ok'}`}
    style={{ marginTop:'0.75rem' }}>
    {msg}
    </div>
  )}
  </div>
  );
}
