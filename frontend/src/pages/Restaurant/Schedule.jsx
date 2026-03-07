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
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1.25rem', flexWrap:'wrap', gap:'0.5rem' }}>
        <h2 style={{ fontSize:'1.1rem', fontWeight:800 }}>Horario de atención</h2>
      </div>

      {isOpen !== null && (
        <div style={{ marginBottom:'1rem' }}>
          <span style={{ fontWeight:700, color: isOpen ? 'var(--success)' : 'var(--danger)', fontSize:'0.9rem' }}>
            {isOpen ? 'Abierto ahora' : 'Cerrado ahora'}
          </span>
        </div>
      )}

      <ScheduleEditor
        token={auth.token}
        isOpen={isOpen}
        onIsOpenChange={setIsOpen}
      />
    </div>
  );
}
