// Página de Pagos — formulario de tarjeta skeleton (sin procesador real)
// TODO: integrar con Stripe Elements o Conekta.js cuando se active el módulo de pagos
import { useState } from 'react';

function CardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      style={{ width:20, height:20, verticalAlign:'middle' }}>
      <rect x="2" y="5" width="20" height="14" rx="2"/>
      <path d="M2 10h20"/>
    </svg>
  );
}

export default function CustomerPayments() {
  const [method, setMethod] = useState('cash');
  const [cardNum, setCardNum] = useState('');
  const [expiry, setExpiry]   = useState('');
  const [cvv, setCvv]         = useState('');
  const [name, setName]       = useState('');
  const [msg, setMsg]         = useState('');

  const methods = [
    { id:'cash', label:'Efectivo al entregar', icon:'💵', available:true },
    { id:'card', label:'Tarjeta de crédito/débito', icon:'💳', available:false },
    { id:'spei', label:'SPEI / Transferencia', icon:'🏦', available:false },
  ];

  function formatCard(v) {
    return v.replace(/\D/g,'').slice(0,16).replace(/(\d{4})(?=\d)/g,'$1 ');
  }
  function formatExpiry(v) {
    return v.replace(/\D/g,'').slice(0,4).replace(/(\d{2})(\d)/,'$1/$2');
  }

  function handleSave() {
    if (method !== 'cash') {
      setMsg('Los pagos en línea estarán disponibles próximamente.');
      return;
    }
    setMsg('Configuración guardada: pago en efectivo al entregar.');
    setTimeout(() => setMsg(''), 3000);
  }

  return (
    <div style={{ padding:'1rem', maxWidth:480, margin:'0 auto' }}>
      <h2 style={{ fontSize:'1.05rem', fontWeight:800, marginBottom:'0.25rem' }}>💳 Métodos de pago</h2>
      <p style={{ fontSize:'0.82rem', color:'var(--gray-500)', marginBottom:'1.25rem' }}>
        Elige cómo quieres pagar tus pedidos.
      </p>

      {/* Selector de método */}
      <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem', marginBottom:'1.5rem' }}>
        {methods.map(m => (
          <label key={m.id}
            style={{
              display:'flex', alignItems:'center', gap:'0.75rem',
              padding:'0.875rem', borderRadius:10, cursor: m.available ? 'pointer' : 'default',
              border:`2px solid ${method===m.id ? 'var(--brand)' : 'var(--gray-200)'}`,
              background: method===m.id ? 'var(--brand-light)' : '#fff',
              opacity: m.available ? 1 : 0.55,
            }}>
            <input type="radio" name="method" value={m.id}
              checked={method===m.id}
              disabled={!m.available}
              onChange={() => m.available && setMethod(m.id)}
              style={{ accentColor:'var(--brand)' }} />
            <span style={{ fontSize:'1.1rem' }}>{m.icon}</span>
            <div>
              <div style={{ fontWeight:700, fontSize:'0.875rem' }}>{m.label}</div>
              {!m.available && (
                <div style={{ fontSize:'0.72rem', color:'var(--gray-400)', marginTop:'0.1rem' }}>
                  Próximamente disponible
                </div>
              )}
            </div>
          </label>
        ))}
      </div>

      {/* Formulario de tarjeta (skeleton — visible pero deshabilitado) */}
      {method === 'card' && (
        <div style={{ background:'var(--gray-50)', border:'1px solid var(--gray-200)',
          borderRadius:10, padding:'1rem', marginBottom:'1rem' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'0.4rem', marginBottom:'0.875rem',
            fontSize:'0.875rem', fontWeight:700, color:'var(--gray-600)' }}>
            <CardIcon /> Datos de tarjeta
          </div>

          <label style={{ display:'block', marginBottom:'0.6rem' }}>
            Nombre en la tarjeta
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="Como aparece en la tarjeta" disabled
              style={{ display:'block', width:'100%', marginTop:4 }} />
          </label>

          <label style={{ display:'block', marginBottom:'0.6rem' }}>
            Número de tarjeta
            <input type="text" inputMode="numeric" value={cardNum}
              onChange={e => setCardNum(formatCard(e.target.value))}
              placeholder="1234 5678 9012 3456" maxLength={19} disabled
              style={{ display:'block', width:'100%', marginTop:4, fontFamily:'monospace' }} />
          </label>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.6rem' }}>
            <label>
              Vencimiento
              <input type="text" inputMode="numeric" value={expiry}
                onChange={e => setExpiry(formatExpiry(e.target.value))}
                placeholder="MM/AA" maxLength={5} disabled
                style={{ display:'block', width:'100%', marginTop:4 }} />
            </label>
            <label>
              CVV
              <input type="text" inputMode="numeric" value={cvv}
                onChange={e => setCvv(e.target.value.replace(/\D/g,'').slice(0,4))}
                placeholder="123" maxLength={4} disabled
                style={{ display:'block', width:'100%', marginTop:4 }} />
            </label>
          </div>

          <div style={{ marginTop:'0.75rem', padding:'0.5rem 0.75rem',
            background:'#fffbeb', border:'1px solid #fde68a', borderRadius:8,
            fontSize:'0.78rem', color:'#92400e' }}>
            🔒 El procesador de pagos será integrado próximamente. Por ahora usa efectivo al entregar.
          </div>
        </div>
      )}

      {method === 'spei' && (
        <div style={{ background:'#eff6ff', border:'1px solid #bfdbfe',
          borderRadius:10, padding:'0.875rem', marginBottom:'1rem',
          fontSize:'0.82rem', color:'#1e40af' }}>
          🏦 La opción de SPEI / transferencia estará disponible próximamente.
        </div>
      )}

      <button className="btn-primary" style={{ width:'100%', padding:'0.75rem', fontSize:'0.95rem' }}
        onClick={handleSave}>
        Guardar método de pago
      </button>

      {msg && (
        <div className={`flash ${msg.includes('Próximamente') || msg.includes('próximamente') ? 'flash-error' : 'flash-ok'}`}
          style={{ marginTop:'0.75rem' }}>
          {msg}
        </div>
      )}
    </div>
  );
}
