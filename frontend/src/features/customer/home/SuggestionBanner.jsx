export default function SuggestionBanner({ order, onOpen, onDismiss }) {
  return (
    <div style={{
      background:'var(--warn-bg)', border:'2px solid var(--warn-border)',
      borderRadius:'var(--radius-lg)', padding:'0.875rem',
      marginBottom:'0.75rem', position:'relative',
    }}>
      <button onClick={onDismiss} style={{
        position:'absolute', top:8, right:8, width:32, height:32,
        borderRadius:'50%', border:'none', background:'var(--bg-raised)',
        cursor:'pointer', fontSize:'1rem', display:'flex', alignItems:'center',
        justifyContent:'center', color:'var(--text-tertiary)', minHeight:'unset',
      }}>✕</button>
      <p style={{ fontWeight:700, fontSize:'0.875rem', color:'var(--warn)', marginBottom:'0.5rem', paddingRight:'2.5rem' }}>
        {order.restaurant_name} propone un cambio
      </p>
      <button className="btn-primary btn-sm" onClick={onOpen}>Ver propuesta →</button>
    </div>
  );
}
