import { useAuth } from '../../contexts/AuthContext';
import ScheduleEditor from '../../components/ScheduleEditor';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../api/client';

export default function RestaurantSchedule() {
  const { auth } = useAuth();
  const [isOpen, setIsOpen] = useState(null);

  useEffect(() => {
    if (!auth.token) return;
    apiFetch('/restaurants/my', {}, auth.token)
      .then(d => { if (d.restaurant) setIsOpen(d.restaurant.is_open); })
      .catch(() => {});
  }, [auth.token]);

  return (
    <div style={{ backgroundColor:'var(--bg-base)', minHeight:'100vh', padding:'1rem' }}>
      {/* ── Encabezado Horario ─────────────────────────────────────────── */}
      <div style={{ margin:'-1rem -1rem 1.25rem', padding:'0.75rem 1rem 0.65rem', background:'var(--promo-gradient)', color:'#fff' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ fontWeight:800, fontSize:'1.05rem', letterSpacing:'-0.01em' }}>🕐 Horario de atención</div>
            <div style={{ fontSize:'0.75rem', opacity:0.85, marginTop:'0.1rem' }}>Configura cuándo recibes pedidos</div>
          </div>
          {isOpen !== null && (
            <span style={{ fontWeight:700, fontSize:'0.82rem', padding:'0.2rem 0.65rem',
              background: isOpen ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)',
              borderRadius:20, border:'1px solid rgba(255,255,255,0.3)' }}>
              {isOpen ? '● Abierto' : '● Cerrado'}
            </span>
          )}
        </div>
      </div>

      <ScheduleEditor
        token={auth.token}
        isOpen={isOpen}
        onIsOpenChange={setIsOpen}
      />
    </div>
  );
}
