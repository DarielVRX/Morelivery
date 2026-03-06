export default function DriverEarnings() {
  return (
    <div>
      <h2 style={{ fontSize:'1.1rem', fontWeight:800, marginBottom:'1.5rem' }}>Ganancias</h2>
      <div className="card" style={{ textAlign:'center', padding:'3rem 1.5rem', color:'var(--gray-400)' }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ marginBottom:'1rem' }}>
          <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>
        </svg>
        <p style={{ fontWeight:700, color:'var(--gray-600)', fontSize:'1rem', marginBottom:'0.4rem' }}>Próximamente</p>
        <p style={{ fontSize:'0.875rem' }}>Aquí verás el resumen de tus ganancias por semana, historial de entregas y métricas de desempeño.</p>
      </div>
    </div>
  );
}
