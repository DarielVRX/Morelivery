// frontend/src/pages/Restaurant/Menu.jsx
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';

const RESTAURANT_FEE_PCT = 0.10; // 10% — debe coincidir con backend

function fmt(cents) { return `$${((cents ?? 0) / 100).toFixed(2)}`; }

// ── SVG Icons ─────────────────────────────────────────────────────────────────
function IconMenu()    { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{display:'block',flexShrink:0}}><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>; }
function IconImage()   { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>; }
function IconEdit()    { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>; }
function IconTrash()   { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>; }
function IconChevron({ open }) { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: open ? 'rotate(180deg)':'rotate(0)', transition:'transform 0.2s' }}><path d="M6 9l6 6 6-6"/></svg>; }
function IconWarning() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>; }
function IconCalc()    { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 10h8M8 14h4"/></svg>; }
function IconUser()    { return <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#e3aaaa" strokeWidth="1.5"><circle cx="12" cy="10" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>; }
function IconVolume()  { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>; }

// ── Calculador de precio ──────────────────────────────────────────────────────
function PriceCalculator({ onApply }) {
  const [open,        setOpen]        = useState(false);
  const [costPrice,   setCostPrice]   = useState('');
  const [profitPct,   setProfitPct]   = useState('100');

  const cost    = parseFloat(costPrice)  || 0;
  const profit  = parseFloat(profitPct)  || 0;
  const fee     = RESTAURANT_FEE_PCT;

  // Precio sugerido: costo * (1 + profit/100) / (1 - fee)
  const suggested    = cost > 0 ? Math.ceil(cost * (profit / 100) / (1 - fee)) : 0;
  const finalEarning = suggested > 0 ? Math.round(suggested * (1 - fee)) : 0;

  if (!open) return (
    <button type="button" onClick={() => setOpen(true)}
      style={{ display:'inline-flex', alignItems:'center', gap:4, background:'none', border:'none',
        padding:0, fontSize:'0.75rem', color:'var(--brand)', cursor:'pointer', fontWeight:600,
        minHeight:'unset', textDecoration:'underline', textUnderlineOffset:2 }}>
      <IconCalc /> Calcular precio sugerido
    </button>
  );

  return (
    <div style={{ background:'var(--bg-raised)', border:'1px solid var(--border)',
      borderRadius:10, padding:'0.75rem', marginTop:4 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.5rem' }}>
        <span style={{ fontSize:'0.8rem', fontWeight:700, color:'var(--text-primary)' }}>Calculador de precio</span>
        <button type="button" onClick={() => setOpen(false)}
          style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-tertiary)',
            fontSize:'1rem', lineHeight:1, minHeight:'unset', padding:'0 2px' }}>✕</button>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.4rem', marginBottom:'0.5rem' }}>
        <label style={{ fontSize:'0.75rem', fontWeight:600 }}>
          Costo del platillo ($)
          <input type="number" min="0" step="1" value={costPrice}
            onChange={e => setCostPrice(e.target.value)}
            placeholder="Ej: 50" style={{ marginTop:2 }} />
        </label>
        <label style={{ fontSize:'0.75rem', fontWeight:600 }}>
          Ganancia deseada (%)
          <input type="number" min="0" step="5" value={profitPct}
            onChange={e => setProfitPct(e.target.value)}
            placeholder="Ej: 100" style={{ marginTop:2 }} />
        </label>
      </div>
      {cost > 0 && (
        <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)',
          borderRadius:8, padding:'0.6rem 0.75rem', marginBottom:'0.5rem', fontSize:'0.8rem' }}>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
            <span style={{ color:'var(--text-secondary)' }}>Precio sugerido</span>
            <span style={{ fontWeight:800, color:'var(--brand)', fontSize:'1rem' }}>${suggested}.00</span>
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
            <span style={{ color:'var(--text-tertiary)', fontSize:'0.72rem' }}>Tarifa de la plataforma ({Math.round(fee*100)}%)</span>
            <span style={{ color:'var(--text-tertiary)', fontSize:'0.72rem' }}>−${Math.round(suggested * fee)}</span>
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', paddingTop:3, borderTop:'1px solid var(--border-light)' }}>
            <span style={{ color:'var(--text-secondary)' }}>Tu ganancia neta</span>
            <span style={{ fontWeight:700, color: finalEarning >= 0 ? 'var(--success)' : 'var(--danger)' }}>
              ${finalEarning} ({finalEarning > 0 && cost > 0 ? Math.round(finalEarning/cost*100) : 0}%)
            </span>
          </div>
        </div>
      )}
      {suggested > 0 && (
        <button type="button" className="btn-primary btn-sm" onClick={() => { onApply(suggested); setOpen(false); }}>
          Usar ${suggested}.00
        </button>
      )}
    </div>
  );
}

// ── Volume Helper ─────────────────────────────────────────────────────────────
const PRESETS = [
  { label:'Salsa / aderezo',   vol:0.05, example:'Sobre, mini cup' },
  { label:'Charola (8 tacos)', vol:0.45, example:'Charola desechable' },
  { label:'Torta / burger',    vol:0.6,  example:'Caja mediana' },
  { label:'Pizza personal',    vol:1.2,  example:'Caja 20×20 cm' },
  { label:'Pizza mediana',     vol:2.5,  example:'Caja 30×30 cm' },
  { label:'Pizza grande',      vol:4.0,  example:'Caja 40×40 cm' },
  { label:'Combo familiar',    vol:6.0,  example:'Bolsa grande + bebida' },
];

function VolumeHelper({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    function h(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', h);
    document.addEventListener('touchstart', h, { passive: true });
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('touchstart', h); };
  }, [open]);
  return (
    <div ref={ref} style={{ marginTop:4 }}>
      <button type="button" onClick={() => setOpen(v => !v)}
        style={{ display:'inline-flex', alignItems:'center', gap:4, background:'none', border:'none',
          padding:0, fontSize:'0.75rem', color:'var(--brand)', cursor:'pointer', fontWeight:600,
          minHeight:'unset', textDecoration:'underline', textUnderlineOffset:2 }}>
        <IconVolume /> {open ? 'Ocultar guías' : 'Ver guías de volumen'}
      </button>
      {open && (
        <div style={{ marginTop:6, padding:'8px 10px', background:'var(--bg-raised)',
          border:'1px solid var(--border)', borderRadius:8 }}>
          <div style={{ fontSize:11, fontWeight:700, color:'var(--text-tertiary)',
            textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:4 }}>
            Referencias
          </div>
          {PRESETS.map(p => {
            const isActive = Math.abs((parseFloat(String(value).replace(',','.')) || 0) - p.vol) < 0.001;
            return (
              <button key={p.label} type="button" onClick={() => { onChange(String(p.vol)); setOpen(false); }}
                style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8,
                  background: isActive ? 'var(--brand-light)' : 'transparent',
                  border:`1px solid ${isActive ? 'var(--brand)' : 'transparent'}`,
                  borderRadius:4, padding:'3px 6px', cursor:'pointer', width:'100%', minHeight:'unset', textAlign:'left' }}>
                <span style={{ fontSize:12, color:'var(--text-primary)' }}>{p.label}</span>
                <span style={{ fontSize:11, color:'var(--text-tertiary)', flexShrink:0 }}>{p.vol}L — {p.example}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Product image ─────────────────────────────────────────────────────────────
function ProductImage({ src, size = 68 }) {
  const [err, setErr] = useState(false);
  if (!src || err) return (
    <div style={{ width:size, height:size, borderRadius:6, background:'var(--gray-100)',
      border:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
      <IconImage />
    </div>
  );
  return <img src={src} alt="" width={size} height={size} onError={() => setErr(true)}
    style={{ width:size, height:size, borderRadius:6, objectFit:'cover', border:'1px solid var(--border)', flexShrink:0 }} />;
}

function useLocalImage() {
  const [preview, setPreview] = useState(null);
  const [dataUrl, setDataUrl] = useState(null);
  function pick(file) {
    if (!file) { setPreview(null); setDataUrl(null); return; }
    const reader = new FileReader();
    reader.onload = e => { setPreview(e.target.result); setDataUrl(e.target.result); };
    reader.readAsDataURL(file);
  }
  function clear() { setPreview(null); setDataUrl(null); }
  return { preview, dataUrl, pick, clear };
}

// ── ProductForm ───────────────────────────────────────────────────────────────
function ProductForm({ editingId, initialValues, onSubmit, onCancel, msg }) {
  const [name,      setName]      = useState(initialValues?.name      || '');
  const [description, setDesc]    = useState(initialValues?.description || '');
  const [price,     setPrice]     = useState(initialValues?.price      || '');
  const [pkgUnits,  setPkgUnits]  = useState(initialValues?.pkgUnits   || '1');
  const [pkgVolume, setPkgVolume] = useState(initialValues?.pkgVolume  || '0');

  function applyPrice(pesos) { setPrice(String(pesos)); }

  function submit() {
    const cents = Math.round(parseFloat(price.toString().replace(',', '.')) * 100);
    onSubmit({ name: name.trim(), description: description.trim(), price_cents: cents,
      pkg_units: Math.max(1, parseInt(pkgUnits, 10) || 1),
      pkg_volume_liters: Math.max(0, parseFloat(pkgVolume.toString().replace(',', '.')) || 0) });
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'0.55rem' }}>
      <label>Nombre del producto <span style={{ color:'var(--danger)' }}>*</span>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Ej: Taco de pastor" />
      </label>
      <label>Descripción (opcional)
        <input value={description} onChange={e => setDesc(e.target.value)} placeholder="Ej: Con cebolla y cilantro" />
      </label>
      <label>Precio (pesos) <span style={{ color:'var(--danger)' }}>*</span>
        <input value={price} onChange={e => setPrice(e.target.value)} placeholder="Ej: 35.00" inputMode="decimal" />
      </label>
      <PriceCalculator onApply={applyPrice} />
      <div style={{ display:'flex', gap:'0.5rem' }}>
        <label style={{ flex:1 }}>
          Unidades por empaque
          <input type="text" inputMode="numeric" value={pkgUnits} onChange={e => setPkgUnits(e.target.value)} placeholder="1" />
        </label>
        <label style={{ flex:1 }}>
          Volumen empaque (L)
          <input type="text" inputMode="decimal" value={pkgVolume} onChange={e => setPkgVolume(e.target.value)} placeholder="0.00" />
        </label>
      </div>
      <VolumeHelper value={pkgVolume} onChange={setPkgVolume} />
      {msg && <p className="flash flash-error" style={{ marginTop:'0.25rem' }}>{msg}</p>}
      <div style={{ display:'flex', gap:'0.5rem', marginTop:'0.25rem' }}>
        <button className="btn-primary btn-sm" onClick={submit} disabled={!name.trim() || !price}
          style={{ backgroundColor:'#e3aaaa', borderColor:'#e3aaaa' }}>
          {editingId ? 'Guardar cambios' : 'Agregar producto'}
        </button>
        {onCancel && <button className="btn-sm" onClick={onCancel}>Cancelar</button>}
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function RestaurantMenu() {
  const { auth } = useAuth();
  const [products,       setProducts]       = useState([]);
  const [msg,            setMsg]            = useState('');
  const [editingId,      setEditingId]      = useState(null);
  const [formOpen,       setFormOpen]       = useState(false);
  const [confirmDelete,  setConfirmDelete]  = useState(null);
  const [editingImg,     setEditingImg]     = useState(null);
  const [savingImg,      setSavingImg]      = useState(false);
  const [restaurantData, setRestaurantData] = useState(null);

  // Fotos
  const [profilePhoto,    setProfilePhoto]  = useState(null);
  const [editingPP,       setEditingPP]     = useState(false);
  const [savingPP,        setSavingPP]      = useState(false);
  const [editingCover,    setEditingCover]  = useState(false);
  const [savingCover,     setSavingCover]   = useState(false);
  const [coverSaved,      setCoverSaved]    = useState(false);

  const { preview, dataUrl, pick, clear }              = useLocalImage();
  const { preview: ppPrev, dataUrl: ppData, pick: ppPick, clear: ppClear } = useLocalImage();
  const { preview: cvPrev, dataUrl: cvData, pick: cvPick, clear: cvClear } = useLocalImage();
  const fileRef   = useRef(null);
  const ppFileRef = useRef(null);
  const cvFileRef = useRef(null);

  async function load() {
    try {
      const [menuData, myData] = await Promise.all([
        apiFetch('/restaurants/my/menu', {}, auth.token),
        apiFetch('/restaurants/my', {}, auth.token),
      ]);
      setProducts(menuData.menu || []);
      if (myData?.restaurant?.profile_photo) setProfilePhoto(myData.restaurant.profile_photo);
      if (myData?.restaurant) setRestaurantData(myData.restaurant);
    } catch (_) {}
  }

  useEffect(() => { load(); }, [auth.token]);

  async function handleSubmit(payload) {
    setMsg('');
    try {
      if (editingId) {
        await apiFetch(`/restaurants/menu-items/${editingId}`, {
          method: 'PATCH', body: JSON.stringify(payload),
        }, auth.token);
      } else {
        await apiFetch('/restaurants/menu-items', {
          method: 'POST', body: JSON.stringify(payload),
        }, auth.token);
      }
      setEditingId(null);
      setFormOpen(false);
      load();
    } catch (e) { setMsg(e.message); }
  }

  async function toggleAvailable(product) {
    try {
      await apiFetch(`/restaurants/menu-items/${product.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_available: !product.is_available }),
      }, auth.token);
      load();
    } catch (e) { setMsg(e.message); }
  }

  async function deleteProduct(id) {
    try {
      await apiFetch(`/restaurants/menu-items/${id}`, { method:'DELETE' }, auth.token);
      setConfirmDelete(null);
      load();
    } catch (e) { setMsg(e.message); }
  }

  async function saveImage(productId) {
    setSavingImg(true);
    try {
      await apiFetch(`/restaurants/menu-items/${productId}`, {
        method: 'PATCH', body: JSON.stringify({ image_url: dataUrl }),
      }, auth.token);
      setEditingImg(null); clear(); load();
    } catch (e) { setMsg(e.message); }
    finally { setSavingImg(false); }
  }

  async function saveProfilePhoto() {
    if (!ppData) return;
    setSavingPP(true);
    try {
      await apiFetch('/restaurants/my/profile-photo', {
        method: 'PATCH', body: JSON.stringify({ url: ppData }),
      }, auth.token);
      setProfilePhoto(ppData); setEditingPP(false); ppClear();
    } catch (e) { setMsg(e.message); }
    finally { setSavingPP(false); }
  }

  async function saveCoverPhoto() {
    if (!cvData) return;
    setSavingCover(true);
    try {
      await apiFetch('/restaurants/my/cover-photo', {
        method: 'PATCH', body: JSON.stringify({ url: cvData }),
      }, auth.token);
      setCoverSaved(true);
      setTimeout(() => setCoverSaved(false), 2500);
      setEditingCover(false); cvClear();
    } catch (e) { setMsg(e.message); }
    finally { setSavingCover(false); }
  }

  const hasCoords = restaurantData && Number.isFinite(Number(restaurantData.lat)) &&
    Number(restaurantData.lat) !== 0;

  return (
    <div style={{ backgroundColor:'var(--bg-base)', minHeight:'100vh', padding:'1rem' }}>

      {/* Header */}
      <div style={{ margin:'-1rem -1rem 1.25rem', padding:'0.75rem 1rem 0.65rem',
        background:'linear-gradient(135deg, #c97b7b 0%, #b56060 60%, #9e4f4f 100%)', color:'#fff' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'0.5rem',
          fontWeight:800, fontSize:'1.05rem', letterSpacing:'-0.01em' }}>
          <IconMenu /> Gestión de menú
        </div>
        <div style={{ fontSize:'0.75rem', opacity:0.85, marginTop:'0.1rem' }}>
          Productos, precios e imagen de tu tienda
        </div>
      </div>

      {/* Alerta sin ubicación */}
      {restaurantData && !hasCoords && (
        <div style={{ display:'flex', alignItems:'flex-start', gap:'0.6rem',
          background:'var(--warn-bg)', border:'1px solid var(--warn-border)',
          borderRadius:8, padding:'0.7rem 0.875rem', marginBottom:'1rem' }}>
          <span style={{ color:'var(--warn)', flexShrink:0, marginTop:1 }}><IconWarning /></span>
          <div style={{ flex:1, fontSize:'0.82rem', color:'var(--warn)' }}>
            <strong>Tu tienda no tiene ubicación configurada.</strong>
            {' '}Los clientes no podrán hacerte pedidos hasta que la configures.{' '}
            <a href="/profile" style={{ color:'var(--warn)', fontWeight:700 }}>
              Ir a Perfil
            </a>
          </div>
        </div>
      )}

      {/* Perfil de tienda */}
      <div style={{ display:'flex', alignItems:'center', gap:'0.875rem', marginBottom:'1.25rem',
        padding:'0.875rem 1rem', background:'var(--bg-card)', borderRadius:10, border:'1px solid var(--border)' }}>
        <div style={{ position:'relative', flexShrink:0 }}>
          {profilePhoto
            ? <img src={profilePhoto} alt="Foto de tienda"
                style={{ width:64, height:64, borderRadius:'50%', objectFit:'cover', border:'2px solid #e3aaaa' }} />
            : <div style={{ width:64, height:64, borderRadius:'50%', background:'var(--gray-100)',
                border:'2px solid #e3aaaa', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <IconUser />
              </div>
          }
          <button onClick={() => { setEditingPP(e => !e); ppClear(); }}
            style={{ position:'absolute', bottom:-4, right:-4, width:24, height:24, borderRadius:'50%',
              background:'var(--brand)', border:'2px solid var(--bg-card)', cursor:'pointer',
              display:'flex', alignItems:'center', justifyContent:'center' }}>
            <span style={{ color:'#fff', fontSize:'1rem', lineHeight:1, fontWeight:300 }}>+</span>
          </button>
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontWeight:800, fontSize:'1.1rem', color:'var(--text-primary)',
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {restaurantData?.name || 'Mi tienda'}
          </div>
          <div style={{ fontSize:'0.75rem', color:'var(--text-tertiary)', marginTop:2 }}>Perfil de tienda</div>
        </div>
        <button onClick={() => { setEditingCover(e => !e); cvClear(); }}
          style={{ flexShrink:0, display:'flex', flexDirection:'column', alignItems:'center', gap:3,
            background:'var(--bg-raised)', border:'1px dashed var(--border)', borderRadius:8,
            padding:'0.5rem 0.65rem', cursor:'pointer', minHeight:'unset', color:'var(--text-secondary)' }}>
          <IconImage />
          <span style={{ fontSize:'0.65rem', fontWeight:600 }}>Fachada</span>
        </button>
      </div>

      {/* Editor foto de perfil */}
      {editingPP && (
        <div style={{ marginBottom:'1rem', padding:'0.875rem 1rem', background:'var(--bg-card)',
          borderRadius:10, border:'1px solid #e3aaaa' }}>
          <p style={{ fontWeight:700, fontSize:'0.85rem', color:'var(--text-primary)', marginBottom:'0.5rem' }}>
            Cambiar foto de perfil
          </p>
          <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', flexWrap:'wrap' }}>
            <button className="btn-sm" onClick={() => ppFileRef.current?.click()}>
              Seleccionar archivo
            </button>
            <input ref={ppFileRef} type="file" accept="image/*" style={{ display:'none' }}
              onChange={e => ppPick(e.target.files?.[0])} />
            {ppPrev && <img src={ppPrev} alt="Preview"
              style={{ width:44, height:44, borderRadius:'50%', objectFit:'cover', border:'2px solid #e3aaaa' }} />}
            <button className="btn-primary btn-sm" disabled={savingPP || !ppPrev} onClick={saveProfilePhoto}
              style={{ backgroundColor:'#e3aaaa', borderColor:'#e3aaaa' }}>
              {savingPP ? 'Guardando…' : 'Guardar'}
            </button>
            <button className="btn-sm" onClick={() => { setEditingPP(false); ppClear(); }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Editor foto de fachada */}
      {editingCover && (
        <div style={{ marginBottom:'1rem', padding:'0.875rem 1rem', background:'var(--bg-card)',
          borderRadius:10, border:'1px solid var(--border)' }}>
          <p style={{ fontWeight:700, fontSize:'0.85rem', marginBottom:'0.25rem' }}>Foto de fachada</p>
          <p style={{ fontSize:'0.78rem', color:'var(--text-secondary)', marginBottom:'0.5rem', lineHeight:1.4 }}>
            Ayuda a los clientes a identificar tu local físicamente.
            {coverSaved && <span style={{ color:'var(--success)', fontWeight:700, marginLeft:'0.5rem' }}>✓ Guardada</span>}
          </p>
          <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', flexWrap:'wrap' }}>
            <button className="btn-sm" onClick={() => cvFileRef.current?.click()}>Seleccionar archivo</button>
            <input ref={cvFileRef} type="file" accept="image/*" style={{ display:'none' }}
              onChange={e => cvPick(e.target.files?.[0])} />
            {cvPrev && <img src={cvPrev} alt="Preview"
              style={{ width:60, height:48, borderRadius:6, objectFit:'cover', border:'1px solid var(--border)' }} />}
            <button className="btn-primary btn-sm" disabled={savingCover || !cvPrev} onClick={saveCoverPhoto}>
              {savingCover ? 'Guardando…' : 'Guardar'}
            </button>
            <button className="btn-sm" onClick={() => { setEditingCover(false); cvClear(); }}>Cancelar</button>
          </div>
        </div>
      )}

      {msg && <p className="flash flash-error" style={{ marginBottom:'0.75rem' }}>{msg}</p>}

      {/* Lista de productos */}
      {products.length === 0
        ? <p style={{ color:'var(--text-secondary)', fontSize:'0.9rem', marginBottom:'1rem' }}>
            Sin productos en el menú.
          </p>
        : (
          <ul style={{ listStyle:'none', padding:0, marginBottom:'1rem' }}>
            {products.map(product => (
              <li key={product.id} className="card" style={{ marginBottom:'0.5rem', padding:'0.75rem',
                border: editingId === product.id ? '2px solid #e3aaaa' : '1px solid var(--border)' }}>

                {editingId === product.id ? (
                  <div>
                    <div style={{ fontWeight:700, fontSize:'0.82rem', color:'var(--brand)', marginBottom:'0.6rem' }}>
                      Editando: <span style={{ color:'var(--text-primary)' }}>{product.name}</span>
                    </div>
                    <ProductForm
                      editingId={product.id}
                      initialValues={{
                        name: product.name, description: product.description || '',
                        price: (product.price_cents / 100).toFixed(2),
                        pkgUnits: String(product.pkg_units ?? 1),
                        pkgVolume: String(product.pkg_volume_liters ?? 0),
                      }}
                      onSubmit={handleSubmit}
                      onCancel={() => setEditingId(null)}
                      msg={msg}
                    />
                  </div>
                ) : (
                  <div style={{ display:'flex', gap:'0.75rem', alignItems:'flex-start' }}>
                    <ProductImage src={product.image_url} size={68} />
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:'0.5rem', flexWrap:'wrap' }}>
                        <span style={{ fontWeight:700, fontSize:'0.95rem' }}>{product.name}</span>
                        <span style={{ fontWeight:700, color:'#8a5e5e', flexShrink:0 }}>{fmt(product.price_cents)}</span>
                      </div>
                      {product.description && (
                        <p style={{ fontSize:'0.82rem', color:'var(--text-secondary)', margin:'0.15rem 0 0' }}>
                          {product.description}
                        </p>
                      )}
                      <div style={{ display:'flex', gap:'0.4rem', marginTop:'0.5rem', flexWrap:'wrap', alignItems:'center' }}>
                        <button className="btn-sm" onClick={() => setEditingId(product.id)}
                          style={{ display:'flex', alignItems:'center', gap:4 }}>
                          <IconEdit /> Editar
                        </button>
                        <button className="btn-sm" onClick={() => { setEditingImg(product.id); clear(); }}>
                          {product.image_url ? 'Cambiar imagen' : 'Agregar imagen'}
                        </button>
                        <button className="btn-sm" onClick={() => toggleAvailable(product)}
                          style={product.is_available
                            ? { borderColor:'var(--success-border)', color:'var(--success)' }
                            : { borderColor:'var(--border)', color:'var(--text-tertiary)' }}>
                          {product.is_available ? 'Activo' : 'Inactivo'}
                        </button>
                        {confirmDelete === product.id ? (
                          <span style={{ display:'flex', gap:'0.3rem', alignItems:'center' }}>
                            <span style={{ fontSize:'0.72rem', color:'var(--danger)', fontWeight:700 }}>¿Eliminar?</span>
                            <button className="btn-sm btn-danger" onClick={() => deleteProduct(product.id)}
                              style={{ fontSize:'0.72rem' }}>Sí</button>
                            <button className="btn-sm" onClick={() => setConfirmDelete(null)}
                              style={{ fontSize:'0.72rem' }}>No</button>
                          </span>
                        ) : (
                          <button className="btn-sm" onClick={() => setConfirmDelete(product.id)}
                            style={{ color:'var(--danger)', borderColor:'var(--danger-border)',
                              display:'flex', alignItems:'center', gap:4 }}>
                            <IconTrash /> Eliminar
                          </button>
                        )}
                      </div>

                      {editingImg === product.id && (
                        <div style={{ marginTop:'0.5rem', display:'flex', flexDirection:'column', gap:'0.4rem' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:'0.4rem' }}>
                            <button className="btn-sm" onClick={() => fileRef.current?.click()}>
                              Seleccionar archivo
                            </button>
                            <input ref={fileRef} type="file" accept="image/*" style={{ display:'none' }}
                              onChange={e => pick(e.target.files?.[0])} />
                            {preview && <img src={preview} alt="Preview"
                              style={{ width:40, height:40, borderRadius:4, objectFit:'cover' }} />}
                          </div>
                          <div style={{ display:'flex', gap:'0.4rem' }}>
                            <button className="btn-primary btn-sm" disabled={savingImg || !preview}
                              onClick={() => saveImage(product.id)}
                              style={{ backgroundColor:'#e3aaaa', borderColor:'#e3aaaa' }}>
                              {savingImg ? 'Guardando…' : 'Guardar imagen'}
                            </button>
                            <button className="btn-sm" onClick={() => { setEditingImg(null); clear(); }}>
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )
      }

      {/* Formulario nuevo producto */}
      <div className="card" style={{ border: formOpen ? '2px solid #e3aaaa' : '1px solid var(--border)', padding:0, overflow:'hidden' }}>
        <button onClick={() => { setFormOpen(o => !o); if (editingId) setEditingId(null); }}
          style={{ width:'100%', display:'flex', justifyContent:'space-between', alignItems:'center',
            padding:'0.85rem 1rem', background:'none', border:'none', cursor:'pointer',
            fontWeight:700, fontSize:'0.88rem',
            borderBottom: formOpen ? '1px solid var(--border)' : 'none' }}>
          <span>+ Agregar producto</span>
          <IconChevron open={formOpen} />
        </button>
        {formOpen && (
          <div style={{ padding:'1rem' }}>
            <ProductForm
              editingId={null}
              initialValues={null}
              onSubmit={handleSubmit}
              msg={msg}
            />
          </div>
        )}
      </div>
    </div>
  );
}
