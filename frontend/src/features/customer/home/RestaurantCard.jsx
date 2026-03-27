// frontend/src/features/customer/home/RestaurantCard.jsx
import { IconRestaurant } from '../../../App';

// Restaurante sin coordenadas = no puede recibir pedidos aún
function hasCoords(restaurant) {
  return restaurant.lat != null && restaurant.lng != null &&
    Number(restaurant.lat) !== 0 && Number(restaurant.lng) !== 0;
}

export default function RestaurantCard({ restaurant, isHero, distKm, onClick }) {
  const stars    = restaurant.rating_avg != null && restaurant.rating_count > 0;
  const disabled = !hasCoords(restaurant);

  if (isHero) {
    return (
      <div
        onClick={disabled ? undefined : onClick}
        style={{
          borderRadius: 14, overflow: 'hidden', position: 'relative',
          marginBottom: 12, boxShadow: disabled ? 'none' : '0 4px 20px rgba(185,80,80,0.22)',
          border: `2px solid ${disabled ? 'var(--border)' : '#c97b7b'}`,
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.6 : 1,
        }}>
        <div className="restaurant-hero-bg" style={{ position: 'relative' }}>
          {restaurant.profile_photo
            ? <img src={restaurant.profile_photo} alt={restaurant.name} style={{ width: '100%', height: 180, objectFit: 'cover', display: 'block', filter: disabled ? 'grayscale(0.5)' : 'none' }} />
            : <div style={{ width: '100%', height: 180, background: disabled ? 'linear-gradient(135deg,#ddd,#bbb)' : 'linear-gradient(135deg,#c97b7b,#9e4f4f)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ color: 'rgba(255,255,255,0.5)' }}><IconRestaurant width={144} height={144} /></span>
              </div>
          }
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(120,30,30,0.82) 0%, rgba(80,20,20,0.2) 60%, transparent 100%)' }} />
        </div>
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '0.75rem 1rem' }}>
          <div style={{ fontWeight: 900, fontSize: '1.1rem', color: '#fff', lineHeight: 1.2, marginBottom: '0.2rem', textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>{restaurant.name}</div>
          <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.85)' }}>
            {stars && `★ ${Number(restaurant.rating_avg).toFixed(1)} · `}
            {restaurant.category && `${restaurant.category} · `}
            {disabled ? 'Próximamente' : (restaurant.is_open ? 'Abierto ahora' : 'Cerrado')}
            {!disabled && distKm != null && ` · ${distKm < 1 ? `${Math.round(distKm * 1000)}m` : `${distKm.toFixed(1)}km`}`}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={disabled ? undefined : onClick}
      className="restaurant-card"
      style={{
        borderRadius: 10, overflow: 'hidden',
        cursor: disabled ? 'default' : 'pointer',
        border: '1px solid var(--border)', background: 'var(--bg-card)',
        boxShadow: disabled ? 'none' : '0 1px 6px rgba(0,0,0,0.06)',
        transition: 'transform 0.15s, box-shadow 0.15s',
        opacity: disabled ? 0.65 : 1,
        position: 'relative',
      }}>
      <div style={{ position: 'relative' }}>
        {restaurant.profile_photo
          ? <img src={restaurant.profile_photo} alt={restaurant.name} style={{ width: '100%', height: 100, objectFit: 'cover', display: 'block', opacity: (restaurant.is_open && !disabled) ? 1 : 0.55, filter: disabled ? 'grayscale(0.4)' : 'none' }} />
          : <div style={{ width: '100%', height: 100, background: disabled ? 'linear-gradient(135deg,#e5e7eb,#d1d5db)' : 'linear-gradient(135deg,#e3aaaa33,#c97b7b22)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: (restaurant.is_open && !disabled) ? 1 : 0.55 }}>
              <span style={{ color: 'rgba(255,255,255,0.7)' }}><IconRestaurant width={72} height={72} /></span>
            </div>
        }
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.35) 0%, transparent 60%)' }} />

        {/* Overlay "Próximamente" para restaurantes sin dirección */}
        {disabled && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.18)',
          }}>
            <span style={{
              fontSize: '0.72rem', fontWeight: 700, color: '#fff',
              background: 'rgba(0,0,0,0.45)', borderRadius: 6,
              padding: '0.2rem 0.55rem', letterSpacing: '0.04em',
            }}>
              Próximamente
            </span>
          </div>
        )}
      </div>

      <div style={{ padding: '0.5rem 0.65rem 0.6rem' }}>
        <div style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--text-primary)', opacity: (restaurant.is_open && !disabled) ? 1 : 0.55, marginBottom: '0.15rem' }}>
          {restaurant.name}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', color: 'var(--text-tertiary)', flexWrap: 'wrap' }}>
          {stars && <span style={{ color: '#c97b7b', fontWeight: 700 }}>★ {Number(restaurant.rating_avg).toFixed(1)}</span>}
          {stars && restaurant.category && <span>·</span>}
          {restaurant.category && <span>{restaurant.category}</span>}
          {!disabled && distKm != null && <><span>·</span><span>{distKm < 1 ? `${Math.round(distKm * 1000)}m` : `${distKm.toFixed(1)}km`}</span></>}
        </div>
        <div style={{ marginTop: '0.3rem' }}>
          {disabled
            ? <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)' }}>Configurando ubicación</span>
            : restaurant.is_open
              ? <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#16a34a' }}>● Abierto</span>
              : <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)' }}>Cerrado</span>
          }
        </div>
      </div>
    </div>
  );
}
