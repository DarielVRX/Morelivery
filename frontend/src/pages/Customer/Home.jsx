import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { cancelPendingOrderExpiry, savePendingOrder, schedulePendingOrderExpiry } from '../../utils/pendingOrder';
import { getErrorMessage } from '../../utils/errorMessage';
import AddressSearchBar from '../../features/customer/home/AddressSearchBar.jsx';
import { IconPin, IconSearch } from '../../features/customer/home/icons.jsx';
import RestaurantCard from '../../features/customer/home/RestaurantCard.jsx';
import SuggestionBanner from '../../features/customer/home/SuggestionBanner.jsx';
import { fmt, haversineKm, toDraft } from '../../features/customer/home/utils.js';

export default function CustomerHome() {
  const { auth } = useAuth();
  const navigate = useNavigate();

  const [restaurants, setRestaurants] = useState([]);
  const [menuCache, setMenuCache] = useState({});
  const [loading, setLoading] = useState(true);
  const [userPos, setUserPos] = useState(null);
  const [deliveryPos, setDeliveryPos] = useState(null);
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState('default');
  const [pendingSugg, setPendingSugg] = useState([]);
  const [suggFor, setSuggFor] = useState('');
  const [suggDrafts, setSuggDrafts] = useState({});
  const [dismissedSugg, setDismissedSugg] = useState(new Set());
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { timeout: 5000, maximumAge: 60000 }
    );
  }, []);

  useEffect(() => {
    function onHide() { schedulePendingOrderExpiry(); }
    function onShow() { if (document.visibilityState === 'visible') cancelPendingOrderExpiry(); }
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('pagehide', onHide);
    };
  }, []);

  async function loadSuggestions() {
    if (!auth.token) return;
    try {
      const data = await apiFetch('/orders/my', {}, auth.token);
      const pending = (data.orders || []).filter((order) =>
        order.suggestion_status === 'pending_customer' && (order.suggestion_items || []).length > 0
      );
      setPendingSugg(pending);
    } catch (_) {}
  }


  useEffect(() => {
    apiFetch('/restaurants')
      .then((data) => setRestaurants(data.restaurants || []))
      .catch(() => {})
      .finally(() => setLoading(false));

    if (auth.token) loadSuggestions();
  }, [auth.token]);

  async function ensureMenu(restaurantId) {
    if (menuCache[restaurantId]) return;
    try {
      const data = await apiFetch(`/restaurants/${restaurantId}/menu`, {}, auth.token);
      setMenuCache((prev) => ({ ...prev, [restaurantId]: data.menu || [] }));
    } catch (_) {}
  }

  useEffect(() => {
    if (!query.trim()) return;
    restaurants.forEach((restaurant) => ensureMenu(restaurant.id));
  }, [query, restaurants]);

  function openSugg(order) {
    setSuggFor(order.id);
    setSuggDrafts((prev) => ({ ...prev, [order.id]: prev[order.id] || toDraft(order.suggestion_items || []) }));
    if (order.restaurant_id) ensureMenu(order.restaurant_id);
  }

  function adjustSugg(orderId, menuItemId, delta) {
    setSuggDrafts((prev) => {
      const current = prev[orderId] || {};
      return {
        ...prev,
        [orderId]: {
          ...current,
          [menuItemId]: Math.max(0, (current[menuItemId] || 0) + delta),
        },
      };
    });
  }

  async function respondSugg(orderId, accepted) {
    try {
      const body = { accepted };
      if (accepted) {
        const draft = suggDrafts[orderId] || {};
        const items = Object.entries(draft)
          .filter(([, quantity]) => Number(quantity) > 0)
          .map(([menuItemId, quantity]) => ({ menuItemId, quantity: Number(quantity) }));
        if (items.length > 0) body.items = items;
      }
      await apiFetch(`/orders/${orderId}/suggestion-response`, { method: 'PATCH', body: JSON.stringify(body) }, auth.token);
      setSuggFor('');
      loadSuggestions();
    } catch (error) {
      setMsg(getErrorMessage(error, 'No se pudo responder la propuesta'));
    }
  }

  function toggleRating() {
    setSortBy((current) => current === 'rating_desc' ? 'rating_asc' : 'rating_desc');
  }

  function toggleDistance() {
    setSortBy((current) => current === 'distance_asc' ? 'distance_desc' : 'distance_asc');
  }

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();

    let list = restaurants.filter((restaurant) => {
      if (!q) return true;
      if (restaurant.name?.toLowerCase().includes(q)) return true;
      if (restaurant.category?.toLowerCase().includes(q)) return true;
      const menu = menuCache[restaurant.id] || [];
      return menu.some((item) => item.name?.toLowerCase().includes(q));
    });

    if (sortBy === 'rating_desc') {
      list = [...list].sort((a, b) => (Number(b.rating_avg) || 0) - (Number(a.rating_avg) || 0));
    } else if (sortBy === 'rating_asc') {
      list = [...list].sort((a, b) => (Number(a.rating_avg) || 0) - (Number(b.rating_avg) || 0));
    } else if (sortBy === 'distance_asc' && userPos) {
      list = [...list].sort((a, b) => {
        const da = a.lat ? haversineKm(userPos.lat, userPos.lng, Number(a.lat), Number(a.lng)) : 999;
        const db = b.lat ? haversineKm(userPos.lat, userPos.lng, Number(b.lat), Number(b.lng)) : 999;
        return da - db;
      });
    } else if (sortBy === 'distance_desc' && userPos) {
      list = [...list].sort((a, b) => {
        const da = a.lat ? haversineKm(userPos.lat, userPos.lng, Number(a.lat), Number(a.lng)) : 999;
        const db = b.lat ? haversineKm(userPos.lat, userPos.lng, Number(b.lat), Number(b.lng)) : 999;
        return db - da;
      });
    } else {
      list = [...list].sort((a, b) => {
        if (a.is_open !== b.is_open) return a.is_open ? -1 : 1;
        return (a.name || '').localeCompare(b.name || '');
      });
    }

    return list;
  }, [restaurants, query, sortBy, userPos, menuCache]);

  const visibleSugg = pendingSugg.filter((order) => !dismissedSugg.has(order.id));

  function getDistKm(restaurant) {
    if (!userPos || !restaurant.lat || !restaurant.lng) return null;
    return haversineKm(userPos.lat, userPos.lng, Number(restaurant.lat), Number(restaurant.lng));
  }

  const heroRest = filtered[0] || null;
  const restOfList = filtered.slice(1);
  const homeAddress = auth.user?.address || null;
  const ratingActive = sortBy === 'rating_desc' || sortBy === 'rating_asc';
  const distanceActive = sortBy === 'distance_asc' || sortBy === 'distance_desc';
  const ratingIcon = sortBy === 'rating_asc' ? '↑' : '↓';
  const distanceIcon = sortBy === 'distance_desc' ? '↑' : '↓';

  if (loading) {
    return <div style={{ padding:'2rem', textAlign:'center', color:'var(--text-tertiary)' }}>Cargando…</div>;
  }

  return (
    <div style={{ backgroundColor:'var(--bg-base)', minHeight:'100vh', padding:'1rem' }}>
      {visibleSugg.map((order) => {
        if (suggFor === order.id) {
          return (
            <div key={`sug-${order.id}`} style={{ background:'var(--warn-bg)', border:'2px solid var(--warn-border)', borderRadius:'var(--radius-lg)', padding:'0.875rem', marginBottom:'0.75rem' }}>
              <p style={{ fontWeight:700, fontSize:'0.875rem', color:'var(--warn)', marginBottom:'0.5rem' }}>
                Ajusta las cantidades o acepta la propuesta:
              </p>
              <div style={{ display:'flex', flexDirection:'column', gap:'0.3rem', marginBottom:'0.65rem' }}>
                {(menuCache[order.restaurant_id] || order.suggestion_items || []).map((item) => {
                  const id = item.id || item.menuItemId;
                  const qty = (suggDrafts[order.id] || {})[id] ?? (order.suggestion_items || []).find((suggested) => suggested.menuItemId === id)?.quantity ?? 0;
                  return (
                    <div key={id} style={{ display:'flex', alignItems:'center', gap:'0.5rem', background: qty > 0 ? 'var(--brand-light)' : 'var(--bg-card)', border:`1px solid ${qty > 0 ? 'var(--brand)' : 'var(--border)'}`, borderRadius:6, padding:'0.4rem 0.75rem' }}>
                      <span style={{ flex:1, fontSize:'0.875rem', fontWeight:qty > 0 ? 600 : 400, color:'var(--text-primary)' }}>{item.name}</span>
                      <span style={{ fontSize:'0.75rem', color:'var(--text-tertiary)' }}>{fmt(item.price_cents || item.unitPriceCents || 0)}</span>
                      <div className="qty-control">
                        <button className="qty-btn" disabled={qty === 0} onClick={() => adjustSugg(order.id, id, -1)}>−</button>
                        <span className="qty-num">{qty}</span>
                        <button className="qty-btn add" onClick={() => adjustSugg(order.id, id, 1)}>+</button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ display:'flex', gap:'0.4rem', flexWrap:'wrap' }}>
                <button className="btn-primary btn-sm" onClick={() => respondSugg(order.id, true)}>Aceptar</button>
                <button className="btn-sm btn-danger" onClick={() => respondSugg(order.id, false)}>Rechazar</button>
                <button
                  className="btn-sm"
                  style={{ color:'var(--danger)', borderColor:'var(--danger-border)' }}
                  onClick={async () => {
                    const note = window.prompt('Motivo de cancelación (obligatorio):');
                    if (!note?.trim()) return;
                    try {
                      await apiFetch(`/orders/${order.id}/cancel`, { method:'PATCH', body: JSON.stringify({ note }) }, auth.token);
                      setSuggFor('');
                      loadSuggestions();
                    } catch (error) {
                      setMsg(getErrorMessage(error, 'No se pudo cancelar el pedido'));
                    }
                  }}
                >
                  Cancelar pedido
                </button>
                <button className="btn-sm" onClick={() => setSuggFor('')}>← Volver</button>
              </div>
            </div>
          );
        }

        return (
          <SuggestionBanner
            key={`sug-${order.id}`}
            order={order}
            onOpen={() => openSugg(order)}
            onDismiss={() => setDismissedSugg((current) => new Set([...current, order.id]))}
          />
        );
      })}

      {msg && <p className="flash flash-error" style={{ marginBottom:'0.5rem' }}>{msg}</p>}

      <div style={{ margin:'-1rem -1rem 0', padding:'1rem 1rem 0.75rem', background:'linear-gradient(135deg, #c97b7b 0%, #b56060 60%, #9e4f4f 100%)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'14px' }}>
          <div>
            <div style={{ fontSize:'12px', color:'rgba(255,255,255,0.75)', fontWeight:600 }}>
              {auth.user?.alias ? `Hola, ${auth.user.alias.split(' ')[0] || auth.user.alias} 👋` : 'Bienvenido 👋'}
            </div>
            <div style={{ fontSize:'22px', fontWeight:900, color:'#fff', lineHeight:1.1, marginTop:2 }}>
              ¿Qué se te antoja?
            </div>
          </div>
          <AddressSearchBar
            userPos={userPos}
            homeAddress={homeAddress}
            onError={setMsg}
            onSelectPos={(pos) => {
              setDeliveryPos(pos);
              if (pos?.lat && pos?.lng) {
                savePendingOrder({ delivery_lat: pos.lat, delivery_lng: pos.lng, delivery_address: pos.label });
              }
            }}
          />
        </div>

        {deliveryPos && (
          <div style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'11px', color:'rgba(255,255,255,0.8)', marginBottom:'8px' }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>
            <span style={{ opacity:0.9 }}>{deliveryPos.label}</span>
            <button onClick={() => setDeliveryPos(null)} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.6)', fontSize:'11px', cursor:'pointer', minHeight:'unset', padding:'0 2px' }}>✕</button>
          </div>
        )}

        <div className="search-bar" style={{ background:'rgba(255,255,255,0.15)', border:'1px solid rgba(255,255,255,0.25)' }}>
          <span className="search-bar-icon" style={{ color:'rgba(255,255,255,0.7)', display:'flex' }}><IconSearch /></span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar tienda o producto…" style={{ color:'#fff', fontSize:'14px' }} />
          {query && <button className="search-bar-clear" style={{ color:'rgba(255,255,255,0.7)' }} onClick={() => setQuery('')}>✕</button>}
        </div>

        <div className="filter-chips" style={{ marginTop:'10px', paddingBottom:'12px' }}>
          <button className={`chip${ratingActive ? ' active' : ''}`} onClick={toggleRating} style={!ratingActive ? { background:'rgba(255,255,255,0.12)', borderColor:'rgba(255,255,255,0.2)', color:'rgba(255,255,255,0.85)' } : {}}>
            ★ Rating {ratingActive && ratingIcon}
          </button>
          <button className={`chip${distanceActive ? ' active' : ''}`} onClick={toggleDistance} disabled={!userPos} style={!distanceActive ? { background:'rgba(255,255,255,0.12)', borderColor:'rgba(255,255,255,0.2)', color:'rgba(255,255,255,0.85)', opacity: userPos ? 1 : 0.45 } : { opacity: userPos ? 1 : 0.45 }}>
            <span style={{display:'inline-flex',alignItems:'center',gap:'0.25rem'}}><IconPin />Distancia {distanceActive && distanceIcon}</span>
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign:'center', padding:'2rem', color:'var(--text-tertiary)' }}>
          <div style={{ marginBottom:'0.5rem', display:'flex', justifyContent:'center', color:'var(--text-tertiary)', fontSize:'2.5rem' }}><svg width='40' height='40' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round'><circle cx='11' cy='11' r='8'/><line x1='21' y1='21' x2='16.65' y2='16.65'/></svg></div>
          <div style={{ fontWeight:600 }}>Sin resultados</div>
          <div style={{ fontSize:'0.85rem', marginTop:'0.25rem' }}>{query ? `No encontramos "${query}"` : 'No hay tiendas disponibles'}</div>
        </div>
      ) : (
        <div style={{ marginTop:'16px' }}>
          <div className="section-row">
            <div className="section-row-title">{query ? `Resultados (${filtered.length})` : 'Tiendas cerca de ti'}</div>
          </div>

          {heroRest && (
            <RestaurantCard
              restaurant={heroRest}
              isHero
              distKm={getDistKm(heroRest)}
              onClick={() => navigate(`/customer/r/${heroRest.id}`)}
            />
          )}

          <div className="restaurants-grid">
            {restOfList.map((restaurant) => (
              <RestaurantCard
                key={restaurant.id}
                restaurant={restaurant}
                isHero={false}
                distKm={getDistKm(restaurant)}
                onClick={() => navigate(`/customer/r/${restaurant.id}`)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
