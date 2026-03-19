import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useRealtimeOrders } from '../../hooks/useRealtimeOrders';

function fmt(cents) { return `$${((cents ?? 0) / 100).toFixed(2)}`; }
function toDraft(items=[]) { const d={}; items.forEach(i=>{ d[i.menuItemId]=i.quantity; }); return d; }

function haversineKm(lat1,lng1,lat2,lng2) {
  const R=6371,toRad=x=>x*Math.PI/180;
  const dLat=toRad(lat2-lat1),dLng=toRad(lng2-lng1);
  const a=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

// ── Suggestion banner ────────────────────────────────────────────────────────
function SuggestionBanner({ order, onOpen, onDismiss }) {
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

// ── Restaurant card ──────────────────────────────────────────────────────────
function RestaurantCard({ r, isHero, distKm, onClick }) {
  const stars = r.rating_avg != null && r.rating_count > 0;

  if (isHero) {
    return (
      <div className="restaurant-hero-card" onClick={onClick}>
      <div className="restaurant-hero-bg">
      {r.profile_photo
        ? <img src={r.profile_photo} alt={r.name} />
        : <span>🏪</span>
      }
      </div>
      <div className="restaurant-hero-overlay">
      <span className="restaurant-hero-tag">⭐ Destacado</span>
      <div className="restaurant-hero-name">{r.name}</div>
      <div className="restaurant-hero-sub">
      {stars && `★ ${Number(r.rating_avg).toFixed(1)} · `}
      {r.category && `${r.category} · `}
      {r.is_open ? 'Abierto ahora' : 'Cerrado'}
      {distKm != null && ` · ${distKm < 1 ? `${Math.round(distKm*1000)}m` : `${distKm.toFixed(1)}km`}`}
      </div>
      </div>
      </div>
    );
  }

  return (
    <div className="restaurant-card" onClick={onClick}>
    <div className="restaurant-card-bg">
    {r.profile_photo
      ? <img src={r.profile_photo} alt={r.name} />
      : <span>🏪</span>
    }
    <div className="restaurant-card-overlay" />
    </div>
    <div className="restaurant-card-body">
    <div className="restaurant-card-name" style={{ opacity: r.is_open ? 1 : 0.55 }}>{r.name}</div>
    <div className="restaurant-card-meta">
    {stars && <><span className="restaurant-card-stars">★ {Number(r.rating_avg).toFixed(1)}</span><span>·</span></>}
    {r.category && <span>{r.category}</span>}
    {distKm != null && <><span>·</span><span>{distKm < 1 ? `${Math.round(distKm*1000)}m` : `${distKm.toFixed(1)}km`}</span></>}
    </div>
    <div style={{ marginTop:4 }}>
    {r.is_open
      ? <span className="badge-open">● Abierto</span>
      : <span className="badge-closed">Cerrado</span>
    }
    </div>
    </div>
    </div>
  );
}

export default function CustomerHome() {
  const { auth } = useAuth();
  const navigate  = useNavigate();

  const [restaurants, setRestaurants]   = useState([]);
  const [menuCache,   setMenuCache]     = useState({}); // restaurantId → [{name,...}]
  const [loading,     setLoading]       = useState(true);
  const [userPos,     setUserPos]       = useState(null); // {lat,lng}

  // Search & filters
  const [query,        setQuery]        = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all'|'open'|'closed'
  const [showFilters,  setShowFilters]  = useState(false);
  const [minRating,    setMinRating]    = useState(0);
  const [maxDist,      setMaxDist]      = useState(20); // km
  const [sortBy,       setSortBy]       = useState('default'); // 'default'|'rating'|'distance'

  // Suggestions
  const [pendingSugg,    setPendingSugg]    = useState([]);
  const [suggFor,        setSuggFor]        = useState('');
  const [suggDrafts,     setSuggDrafts]     = useState({});
  const [dismissedSugg,  setDismissedSugg]  = useState(new Set());
  const [msg,            setMsg]            = useState('');
  const loadSuggRef = useRef(null);

  // Get user position for distance calc
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      pos => setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
                                             () => {},
                                             { timeout: 5000, maximumAge: 60000 }
    );
  }, []);

  async function loadSuggestions() {
    if (!auth.token) return;
    try {
      const d = await apiFetch('/orders/my', {}, auth.token);
      const pending = (d.orders||[]).filter(o =>
      o.suggestion_status==='pending_customer' && (o.suggestion_items||[]).length>0
      );
      setPendingSugg(pending);
    } catch (_) {}
  }

  useEffect(() => { loadSuggRef.current = loadSuggestions; });

  useEffect(() => {
    apiFetch('/restaurants')
    .then(d => setRestaurants(d.restaurants||[]))
    .catch(()=>{})
    .finally(()=>setLoading(false));
    if (auth.token) loadSuggestions();
  }, [auth.token]);

    useRealtimeOrders(
      auth.token,
      (data) => { if (data?.action === 'suggestion_received') loadSuggRef.current?.(); },
                      ()=>{},
    );

    // Preload menu for search
    async function ensureMenu(restaurantId) {
      if (menuCache[restaurantId]) return;
      try {
        const d = await apiFetch(`/restaurants/${restaurantId}/menu`, {}, auth.token);
        setMenuCache(prev => ({ ...prev, [restaurantId]: d.menu || [] }));
      } catch (_) {}
    }

    // When query changes, load menus for all restaurants (lazy, only first time)
    useEffect(() => {
      if (!query.trim()) return;
      restaurants.forEach(r => ensureMenu(r.id));
    }, [query, restaurants]);

    function openSugg(order) {
      setSuggFor(order.id);
      setSuggDrafts(prev => ({ ...prev, [order.id]: prev[order.id]||toDraft(order.suggestion_items||[]) }));
      if (order.restaurant_id) ensureMenu(order.restaurant_id);
    }

    function adjustSugg(orderId, menuItemId, delta) {
      setSuggDrafts(prev => {
        const cur = prev[orderId]||{};
        return { ...prev, [orderId]: { ...cur, [menuItemId]: Math.max(0,(cur[menuItemId]||0)+delta) } };
      });
    }

    async function respondSugg(orderId, accepted) {
      try {
        const body = { accepted };
        if (accepted) {
          const draft = suggDrafts[orderId] || {};
          const items = Object.entries(draft).filter(([,q])=>Number(q)>0).map(([menuItemId,qty])=>({ menuItemId, quantity:Number(qty) }));
          if (items.length>0) body.items = items;
        }
        await apiFetch(`/orders/${orderId}/suggestion-response`, { method:'PATCH', body: JSON.stringify(body) }, auth.token);
        setSuggFor(''); loadSuggestions();
      } catch (e) { setMsg(e.message); }
    }

    async function cancelOrder(orderId) {
      const note = window.prompt('Motivo de cancelación (obligatorio):');
      if (!note?.trim()) return;
      try {
        await apiFetch(`/orders/${orderId}/cancel`, { method:'PATCH', body: JSON.stringify({ note }) }, auth.token);
        loadSuggestions();
      } catch (e) { setMsg(e.message); }
    }

    // ── Filtered + sorted restaurants ──────────────────────────────────────────
    const filtered = useMemo(() => {
      const q = query.toLowerCase().trim();

      let list = restaurants.filter(r => {
        // Status filter
        if (statusFilter === 'open'   && !r.is_open) return false;
        if (statusFilter === 'closed' &&  r.is_open) return false;
        // Rating filter
        if (minRating > 0 && (r.rating_avg == null || Number(r.rating_avg) < minRating)) return false;
        // Distance filter
        if (userPos && r.lat && r.lng) {
          const d = haversineKm(userPos.lat, userPos.lng, Number(r.lat), Number(r.lng));
          if (d > maxDist) return false;
        }
        // Text search: name + menu items
        if (!q) return true;
        if (r.name?.toLowerCase().includes(q)) return true;
        if (r.category?.toLowerCase().includes(q)) return true;
        const menu = menuCache[r.id] || [];
        return menu.some(item => item.name?.toLowerCase().includes(q));
      });

      // Sort
      if (sortBy === 'rating') {
        list = [...list].sort((a,b) => (Number(b.rating_avg)||0) - (Number(a.rating_avg)||0));
      } else if (sortBy === 'distance' && userPos) {
        list = [...list].sort((a,b) => {
          const da = a.lat ? haversineKm(userPos.lat,userPos.lng,Number(a.lat),Number(a.lng)) : 999;
          const db = b.lat ? haversineKm(userPos.lat,userPos.lng,Number(b.lat),Number(b.lng)) : 999;
          return da - db;
        });
      } else {
        // Default: open first, then by name
        list = [...list].sort((a,b) => {
          if (a.is_open !== b.is_open) return a.is_open ? -1 : 1;
          return (a.name || '').localeCompare(b.name || '');
        });
      }

      return list;
    }, [restaurants, query, statusFilter, minRating, maxDist, sortBy, userPos, menuCache]);

    const visibleSugg = pendingSugg.filter(o => !dismissedSugg.has(o.id));

    function getDistKm(r) {
      if (!userPos || !r.lat || !r.lng) return null;
      return haversineKm(userPos.lat, userPos.lng, Number(r.lat), Number(r.lng));
    }

    const heroRest  = filtered[0] || null;
    const restOfList = filtered.slice(1);

    if (loading) return (
      <div style={{ padding:'2rem', textAlign:'center', color:'var(--text-tertiary)' }}>Cargando…</div>
    );

    return (
      <div style={{ backgroundColor:'var(--bg-base)', minHeight:'100vh', padding:'1rem' }}>

      {/* ── Sugerencias ─────────────────────────────────────────────── */}
      {visibleSugg.map(order => {
        if (suggFor === order.id) return (
          <div key={`sug-${order.id}`} style={{
            background:'var(--warn-bg)', border:'2px solid var(--warn-border)',
                                          borderRadius:'var(--radius-lg)', padding:'0.875rem', marginBottom:'0.75rem',
          }}>
          <p style={{ fontWeight:700, fontSize:'0.875rem', color:'var(--warn)', marginBottom:'0.5rem' }}>
          Ajusta las cantidades o acepta la propuesta:
          </p>
          <div style={{ display:'flex', flexDirection:'column', gap:'0.3rem', marginBottom:'0.65rem' }}>
          {(menuCache[order.restaurant_id] || order.suggestion_items || []).map(item => {
            const id  = item.id || item.menuItemId;
            const qty = (suggDrafts[order.id]||{})[id] ?? (order.suggestion_items||[]).find(s=>s.menuItemId===id)?.quantity ?? 0;
            return (
              <div key={id} style={{
                display:'flex', alignItems:'center', gap:'0.5rem',
                background: qty>0 ? 'var(--brand-light)':'var(--bg-card)',
                    border:`1px solid ${qty>0?'var(--brand)':'var(--border)'}`,
                    borderRadius:6, padding:'0.4rem 0.75rem',
              }}>
              <span style={{ flex:1, fontSize:'0.875rem', fontWeight:qty>0?600:400, color:'var(--text-primary)' }}>{item.name}</span>
              <span style={{ fontSize:'0.75rem', color:'var(--text-tertiary)' }}>{fmt(item.price_cents||item.unitPriceCents||0)}</span>
              <div className="qty-control">
              <button className="qty-btn" disabled={qty===0} onClick={()=>adjustSugg(order.id,id,-1)}>−</button>
              <span className="qty-num">{qty}</span>
              <button className="qty-btn add" onClick={()=>adjustSugg(order.id,id,1)}>+</button>
              </div>
              </div>
            );
          })}
          </div>
          <div style={{ display:'flex', gap:'0.4rem', flexWrap:'wrap' }}>
          <button className="btn-primary btn-sm" onClick={()=>respondSugg(order.id,true)}>Aceptar</button>
          <button className="btn-sm btn-danger" onClick={()=>respondSugg(order.id,false)}>Rechazar</button>
          <button className="btn-sm" onClick={()=>cancelOrder(order.id)}>Cancelar pedido</button>
          <button className="btn-sm" onClick={()=>setSuggFor('')}>← Volver</button>
          </div>
          </div>
        );
        return (
          <SuggestionBanner
          key={`sug-${order.id}`}
          order={order}
          onOpen={() => openSugg(order)}
          onDismiss={() => setDismissedSugg(s => new Set([...s, order.id]))}
          />
        );
      })}

      {msg && <p className="flash flash-error" style={{ marginBottom:'0.5rem' }}>{msg}</p>}

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div style={{ margin:'-1rem -1rem 0', padding:'1rem 1rem 0.75rem', background:'var(--hero-gradient)' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'14px' }}>
      <div>
      <div style={{ fontSize:'12px', color:'rgba(255,255,255,0.7)', fontWeight:600 }}>
      {auth.user?.alias ? `Hola, ${auth.user.alias.split(' ')[0] || auth.user.alias} 👋` : 'Bienvenido 👋'}
      </div>
      <div style={{ fontSize:'22px', fontWeight:900, color:'#fff', lineHeight:1.1, marginTop:2 }}>
      ¿Qué se te antoja?
      </div>
      </div>
      </div>

      {/* Search bar */}
      <div className="search-bar" style={{ background:'rgba(255,255,255,0.15)', border:'1px solid rgba(255,255,255,0.25)' }}>
      <span className="search-bar-icon" style={{ color:'rgba(255,255,255,0.7)' }}>🔍</span>
      <input
      value={query}
      onChange={e => setQuery(e.target.value)}
      placeholder="Buscar tienda o producto…"
      style={{ color:'#fff', fontSize:'14px' }}
      />
      {query && (
        <button className="search-bar-clear" style={{ color:'rgba(255,255,255,0.7)' }} onClick={() => setQuery('')}>✕</button>
      )}
      <button
      onClick={() => setShowFilters(v => !v)}
      style={{
        background: showFilters ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.15)',
            border:'1px solid rgba(255,255,255,0.3)', color:'#fff',
            borderRadius:8, padding:'3px 8px', fontSize:'11px', fontWeight:700,
            minHeight:'unset', flexShrink:0,
      }}
      >
      ⚙ Filtros
      </button>
      </div>

      {/* Status chips */}
      <div className="filter-chips" style={{ marginTop:'10px', paddingBottom:'12px' }}>
      {[['all','Todos'],['open','Abiertos'],['closed','Cerrados']].map(([val,label]) => (
        <button key={val}
        className={`chip${statusFilter===val?' active':''}`}
        onClick={() => setStatusFilter(val)}
        style={statusFilter!==val ? { background:'rgba(255,255,255,0.12)', borderColor:'rgba(255,255,255,0.2)', color:'rgba(255,255,255,0.85)' } : {}}
        >
        {label}
        </button>
      ))}
      </div>
      </div>

      {/* ── Filter panel ─────────────────────────────────────────────── */}
      {showFilters && (
        <div className="filter-panel" style={{ margin:'8px 0' }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1rem' }}>
        <div>
        <label>Rating mínimo: <strong style={{ color:'var(--brand)' }}>
        {minRating === 0 ? 'Todos' : `★ ${minRating.toFixed(1)}+`}
        </strong></label>
        <input type="range" min="0" max="5" step="0.5" value={minRating}
        onChange={e => setMinRating(Number(e.target.value))} />
        </div>
        <div>
        <label>Distancia máx: <strong style={{ color:'var(--brand)' }}>
        {maxDist >= 20 ? 'Sin límite' : `${maxDist} km`}
        </strong></label>
        <input type="range" min="1" max="20" step="1" value={maxDist}
        onChange={e => setMaxDist(Number(e.target.value))} />
        </div>
        </div>
        <div style={{ marginTop:'10px' }}>
        <label>Ordenar por</label>
        <div style={{ display:'flex', gap:'6px', marginTop:4 }}>
        {[['default','Por defecto'],['rating','Rating'],['distance','Distancia']].map(([val,label]) => (
          <button key={val}
          className={`chip${sortBy===val?' active':''}`}
          onClick={() => setSortBy(val)}
          style={{ fontSize:'11px', padding:'4px 10px' }}
          >
          {label}
          </button>
        ))}
        </div>
        </div>
        </div>
      )}

      {/* ── Restaurant list ───────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div style={{ textAlign:'center', padding:'2rem', color:'var(--text-tertiary)' }}>
        <div style={{ fontSize:'2.5rem', marginBottom:'0.5rem' }}>🔍</div>
        <div style={{ fontWeight:600 }}>Sin resultados</div>
        <div style={{ fontSize:'0.85rem', marginTop:'0.25rem' }}>
        {query ? `No encontramos "${query}"` : 'No hay tiendas disponibles'}
        </div>
        </div>
      ) : (
        <div style={{ marginTop:'16px' }}>
        {/* Section header */}
        <div className="section-row">
        <div className="section-row-title">
        {query ? `Resultados (${filtered.length})` : 'Tiendas cerca de ti'}
        </div>
        </div>

        {/* Hero card — first result */}
        {heroRest && (
          <RestaurantCard
          r={heroRest}
          isHero={true}
          distKm={getDistKm(heroRest)}
          onClick={() => navigate(`/restaurant/${heroRest.id}`)}
          />
        )}

        {/* Rest of list */}
        <div className="restaurants-grid">
        {restOfList.map(r => (
          <RestaurantCard
          key={r.id}
          r={r}
          isHero={false}
          distKm={getDistKm(r)}
          onClick={() => navigate(`/restaurant/${r.id}`)}
          />
        ))}
        </div>
        </div>
      )}
      </div>
    );
}
