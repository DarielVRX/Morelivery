import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../api/client';

export default function CustomerHome() {
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading]         = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    apiFetch('/restaurants')
      .then(d => setRestaurants(d.restaurants || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div style={{ padding:'2rem', textAlign:'center', color:'var(--gray-400)' }}>Cargando restaurantes…</div>
  );

  return (
    <div>
      <h2 style={{ fontSize:'1.1rem', fontWeight:800, marginBottom:'1rem' }}>Restaurantes</h2>

      {restaurants.length === 0 ? (
        <p style={{ color:'var(--gray-600)' }}>No hay restaurantes disponibles.</p>
      ) : (
        <ul style={{ listStyle:'none', padding:0 }}>
          {restaurants.map(r => (
            <li
              key={r.id}
              onClick={() => navigate(`/restaurant/${r.id}`)}
              style={{
                display:'flex', justifyContent:'space-between', alignItems:'center',
                gap:'0.75rem', padding:'0.875rem 1rem',
                border:'1px solid var(--gray-200)', borderRadius:'var(--radius)',
                marginBottom:'0.5rem', background:'#fff', cursor:'pointer',
                opacity: r.is_open ? 1 : 0.7,
                transition:'box-shadow 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.boxShadow='0 2px 10px rgba(0,0,0,0.07)'}
              onMouseLeave={e => e.currentTarget.style.boxShadow='none'}
            >
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontWeight:700, fontSize:'0.975rem' }}>{r.name}</div>
                {r.address && (
                  <div style={{ fontSize:'0.8rem', color:'var(--gray-600)', marginTop:'0.1rem', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {r.address}
                  </div>
                )}
              </div>
              <span style={{
                fontSize:'0.72rem', fontWeight:700, flexShrink:0,
                color: r.is_open ? 'var(--success)' : 'var(--gray-400)',
                background: r.is_open ? '#f0fdf4' : 'var(--gray-100)',
                border: `1px solid ${r.is_open ? '#bbf7d0' : 'var(--gray-200)'}`,
                borderRadius:10, padding:'0.15rem 0.55rem',
              }}>
                {r.is_open ? 'Abierto' : 'Cerrado'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
