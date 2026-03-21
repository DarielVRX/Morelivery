import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';

function fmt(cents) { return `$${((cents ?? 0) / 100).toFixed(2)}`; }

// ── VolumeHelper ──────────────────────────────────────────────────────────────
// Regla métrica real: muestra una regla en pantalla con marcas de centímetro.
// El restaurantero puede poner el empaque junto al teléfono y medir directamente.
//
// CSS px ≠ píxeles físicos. Para cm reales:
//   1 pulgada física = 96 CSS px (definición W3C baseline para 96 DPI)
//   1 cm = 96/2.54 ≈ 37.795 CSS px
//   Con zoom del navegador estos px se escalan — por eso usamos:
//     window.devicePixelRatio para compensar en pantallas retina
//     zoom:1 + transform en el contenedor para aislar del zoom del navegador
//
// La regla mide 10 cm (ancho mínimo de una charola estándar).
// Marcas cada 1 cm, números cada 2 cm.

var PRESETS = [
  { label: 'Salsa / aderezo',     vol: 0.05,  emoji: '🫙',  example: 'Sobre, mini cup'            },
  { label: 'Charola (8 tacos)',   vol: 0.45,  emoji: '🫱',  example: 'Charola desechable estándar' },
  { label: 'Torta / burger',      vol: 0.6,   emoji: '🍔',  example: 'Caja mediana'                },
  { label: 'Pizza personal',      vol: 1.2,   emoji: '🍕',  example: 'Caja 20×20 cm'              },
  { label: 'Pizza mediana',       vol: 2.5,   emoji: '🍕',  example: 'Caja 30×30 cm'              },
  { label: 'Pizza grande',        vol: 4.0,   emoji: '🍕',  example: 'Caja 40×40 cm'              },
  { label: 'Combo familiar',      vol: 6.0,   emoji: '🛍',  example: 'Bolsa grande + bebida'       },
];

// Mochila referencia = 25L (para guías)
var BAG_LITERS = 25;


function VolumeHelper({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [open]);

  const vol = parseFloat(String(value).replace(',', '.')) || 0;

  return (
    <div ref={ref} style={{ marginTop: 6 }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          background: 'none', border: 'none', padding: 0,
          fontSize: 12, color: 'var(--brand)', cursor: 'pointer',
          fontWeight: 600, minHeight: 'unset', textDecoration: 'underline',
          textUnderlineOffset: 2,
        }}>
        📐 {open ? 'Ocultar guías' : 'Ver guías de volumen'}
      </button>

      {open && (
        <div style={{
          marginTop: 8, padding: '10px 12px',
          background: 'var(--bg-raised)',
          border: '1px solid var(--border)',
          borderRadius: 10,
        }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5,
          }}>
            Referencias de volumen
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {PRESETS.map(p => {
              const isActive = Math.abs(vol - p.vol) < 0.001;
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => { onChange(String(p.vol)); setOpen(false); }}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: 8,
                    background: isActive ? 'var(--brand-light)' : 'transparent',
                    border: `1px solid ${isActive ? 'var(--brand)' : 'transparent'}`,
                    borderRadius: 5, padding: '4px 7px', cursor: 'pointer',
                    textAlign: 'left', width: '100%', minHeight: 'unset',
                  }}>
                  <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>
                    {p.emoji} {p.label}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)', flexShrink: 0 }}>
                    {p.vol}L — {p.example}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ProductImagePlaceholder({ size = 68 }) {
  return (
    <div style={{ width:size, height:size, borderRadius:6, background:'var(--gray-100)', border:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
      <svg width={size*0.5} height={size*0.5} viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="1.5">
        <circle cx="12" cy="12" r="9"/>
        <path d="M7 16c0-2.8 2.2-5 5-5s5 2.2 5 5"/>
        <circle cx="12" cy="10" r="2"/>
      </svg>
    </div>
  );
}

function ProductImage({ src, size = 68 }) {
  const [err, setErr] = useState(false);
  if (!src || err) return <ProductImagePlaceholder size={size} />;
  return (
    <img src={src} alt="" width={size} height={size} onError={() => setErr(true)}
      style={{ width:size, height:size, borderRadius:6, objectFit:'cover', border:'1px solid var(--border)', flexShrink:0 }} />
  );
}

// Convierte archivo local a data-URL base64
function useLocalImage() {
  const [preview, setPreview] = useState(null);
  const [dataUrl, setDataUrl]  = useState(null);
  function pick(file) {
    if (!file) { setPreview(null); setDataUrl(null); return; }
    const reader = new FileReader();
    reader.onload = e => { setPreview(e.target.result); setDataUrl(e.target.result); };
    reader.readAsDataURL(file);
  }
  function clear() { setPreview(null); setDataUrl(null); }
  return { preview, dataUrl, pick, clear };
}

export default function RestaurantMenu() {
  const { auth } = useAuth();
  const [products, setProducts] = useState([]);
  const [name, setName]         = useState('');
  const [description, setDesc]  = useState('');
  const [price, setPrice]       = useState('');
  const [pkgUnits, setPkgUnits]           = useState('1');
  const [pkgVolume, setPkgVolume]         = useState('0');
  const [msg, setMsg]           = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingIsAvailable, setEditingIsAvailable] = useState(true);
  const [formOpen, setFormOpen]   = useState(false); // colapsado por defecto
  // Imagen
  const [editingImg, setEditingImg] = useState(null);
  const [imgUrl, setImgUrl]         = useState('');
  const [savingImg, setSavingImg]   = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [restaurantData, setRestaurantData] = useState(null);
  const { preview, dataUrl, pick, clear } = useLocalImage();
  const fileRef = useRef(null);

  // ─── Foto de perfil de la tienda ─────────────────────────────────────────
  const [profilePhoto, setProfilePhoto]     = useState(null);
  const [editingProfilePhoto, setEditingPP] = useState(false);
  const [savingPP, setSavingPP]             = useState(false);
  const {
    preview: ppPreview, dataUrl: ppDataUrl, pick: ppPick, clear: ppClear
  } = useLocalImage();
  const ppFileRef = useRef(null);

  async function saveProfilePhoto() {
    if (!ppDataUrl) return;
    setSavingPP(true);
    try {
      await apiFetch('/restaurants/my/profile-photo', {
        method: 'PATCH', body: JSON.stringify({ photoUrl: ppDataUrl })
      }, auth.token);
      setProfilePhoto(ppDataUrl);
      setEditingPP(false); ppClear();
    } catch (e) { setMsg(e.message); }
    finally { setSavingPP(false); }
  }

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

  async function handleSubmit() {
    if (!name.trim()) return setMsg('El nombre es requerido');
    const cents = Math.round(parseFloat(price.toString().replace(',', '.')) * 100);
    if (isNaN(cents) || cents <= 0) return setMsg('Precio inválido');
    try {
      const payload = {
        name: name.trim(),
        description: description.trim(),
        priceCents: cents,
        pkgUnits:        Math.max(1, parseInt(pkgUnits,  10) || 1),
        pkgVolumeLiters: Math.max(0, parseFloat(pkgVolume.toString().replace(',', '.')) || 0),
      };
      if (editingId) {
        payload.isAvailable = editingIsAvailable;
        await apiFetch(`/restaurants/menu-items/${editingId}`, { method:'PATCH', body: JSON.stringify(payload) }, auth.token);
      } else {
        await apiFetch('/restaurants/menu-items', { method:'POST', body: JSON.stringify(payload) }, auth.token);
      }
      resetForm();
      load();
    } catch (e) { setMsg(e.message); }
  }

  function startEdit(product) {
    setEditingId(product.id);
    setEditingIsAvailable(product.is_available ?? true);
    setName(product.name);
    setDesc(product.description || '');
    setPrice((product.price_cents / 100).toFixed(2));
    setPkgUnits(String(product.pkg_units ?? 1));
    setPkgVolume(String(product.pkg_volume_liters ?? 0));
    setMsg('');
  }

  function resetForm() {
    setEditingId(null); setEditingIsAvailable(true);
    setName(''); setDesc(''); setPrice('');
    setPkgUnits('1'); setPkgVolume('0');
    setMsg(''); setFormOpen(false);
  }

  async function toggleAvailable(product) {
    try {
      await apiFetch(`/restaurants/menu-items/${product.id}`, {
        method:'PATCH',
        body: JSON.stringify({ name: product.name, description: product.description, priceCents: product.price_cents, isAvailable: !product.is_available })
      }, auth.token);
      load();
    } catch (e) { setMsg(e.message); }
  }

  async function saveImage(productId) {
    setSavingImg(true);
    try {
      // Solo imagen local (base64)
      const imageToSave = dataUrl || null;
      await apiFetch(`/restaurants/menu-items/${productId}`, {
        method:'PATCH', body: JSON.stringify({ imageUrl: imageToSave })
      }, auth.token);
      setEditingImg(null); setImgUrl(''); clear();
      load();
    } catch (e) { setMsg(e.message); }
    finally { setSavingImg(false); }
  }

  async function deleteProduct(productId) {
    try {
      await apiFetch(`/restaurants/menu-items/${productId}`, { method:'DELETE' }, auth.token);
      setMsg('');
      setConfirmDelete(null);
      load();
    } catch (e) { setMsg(e.message); }
  }

  return (
    <div style={{ backgroundColor: 'var(--bg-base)', minHeight:'100vh', padding:'1rem' }}>
      {/* ── Encabezado Gestión de menú ─────────────────────────────────── */}
      <div style={{ margin:'-1rem -1rem 1.25rem', padding:'0.75rem 1rem 0.65rem', background:'var(--promo-gradient)', color:'#fff' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', fontWeight:800, fontSize:'1.05rem', letterSpacing:'-0.01em' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{display:'block',flexShrink:0}}>
            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
            <rect x="9" y="3" width="6" height="4" rx="1"/>
            <path d="M9 12h6M9 16h4"/>
          </svg>
          Gestión de menú
        </div>
        <div style={{ fontSize:'0.75rem', opacity:0.85, marginTop:'0.1rem' }}>Productos, precios e imagen de tu tienda</div>
      </div>

      {/* ── Alerta coordenadas faltantes ─────────────────────────────────── */}
      {restaurantData && !Number.isFinite(Number(restaurantData.lat)) && (
        <div style={{
          display:'flex', alignItems:'flex-start', gap:'0.6rem',
          background:'#fffbeb', border:'1px solid #fde68a',
          borderRadius:8, padding:'0.7rem 0.875rem', marginBottom:'1rem',
        }}>
          <span style={{ fontSize:'1.1rem', flexShrink:0 }}>⚠️</span>
          <div style={{ flex:1, fontSize:'0.82rem', color:'#92400e' }}>
            <strong>Tu tienda no tiene ubicación configurada.</strong>
            <span> Los clientes a más de 5 km no podrán hacerte pedidos.</span>
            <br />
            <a href="/profile" style={{ color:'#b45309', fontWeight:700, textDecoration:'underline' }}>
              Ir a Perfil → configurar ubicación
            </a>
          </div>
        </div>
      )}

      {/* ── Foto de perfil + nombre + portada ── */}
      <div style={{ display:'flex', alignItems:'center', gap:'0.875rem', marginBottom:'1.25rem',
        padding:'0.875rem 1rem', background:'var(--bg-card)', borderRadius:10, border:'1px solid var(--border)' }}>
        {/* Avatar con botón de edición */}
        <div style={{ position:'relative', flexShrink:0 }}>
          {profilePhoto
            ? <img src={profilePhoto} alt="Foto de tienda"
                style={{ width:64, height:64, borderRadius:'50%', objectFit:'cover', border:'2px solid #e3aaaa' }} />
            : <div style={{ width:64, height:64, borderRadius:'50%', background:'var(--gray-100)',
                border:'2px solid #e3aaaa', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#e3aaaa" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="9"/><path d="M7 16c0-2.8 2.2-5 5-5s5 2.2 5 5"/>
                  <circle cx="12" cy="10" r="2"/>
                </svg>
              </div>
          }
          <button onClick={() => { setEditingPP(e => !e); ppClear(); }}
            style={{ position:'absolute', bottom:-4, right:-4, width:24, height:24, borderRadius:'50%',
              background:'var(--brand)', border:'2px solid #fff', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:0 }}>
            <span style={{ color:'#fff', fontSize:'1rem', lineHeight:1, fontWeight:300, marginTop:'-1px' }}>+</span>
          </button>
        </div>
        {/* Nombre */}
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontWeight:800, fontSize:'1.15rem', color:'var(--text-primary)', letterSpacing:'-0.01em', lineHeight:1.2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {auth.user?.restaurant?.name || restaurantData?.name || 'Mi tienda'}
          </div>
          <div style={{ fontSize:'0.75rem', color:'var(--text-tertiary)', marginTop:'0.15rem' }}>Perfil de tienda</div>
        </div>
        {/* Portada */}
        <button
          onClick={() => { setEditingPP(e => !e); ppClear(); }}
          title="Subir foto de portada o fachada"
          style={{
            flexShrink:0, display:'flex', flexDirection:'column', alignItems:'center', gap:'0.2rem',
            background:'var(--bg-raised)', border:'1px dashed var(--border)', borderRadius:8,
            padding:'0.5rem 0.65rem', cursor:'pointer', minHeight:'unset',
            color:'var(--text-secondary)',
          }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          <span style={{ fontSize:'0.65rem', fontWeight:600, textAlign:'center', lineHeight:1.2 }}>Foto de{'
'}fachada</span>
        </button>
      </div>

      {/* Editor de foto de tienda */}
      {editingProfilePhoto && (
        <div style={{ marginBottom:'1rem', padding:'0.875rem 1rem', background:'var(--bg-card)',
          borderRadius:10, border:'1px solid #e3aaaa' }}>
          <p style={{ fontWeight:700, fontSize:'0.85rem', color:'#8a5e5e', marginBottom:'0.5rem' }}>
            Cambiar foto de perfil
          </p>
          <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', flexWrap:'wrap' }}>
            <button className="btn-sm" style={{ borderColor:'#e3aaaa', color:'#8a5e5e' }}
              onClick={() => ppFileRef.current?.click()}>
              Seleccionar archivo
            </button>
            <input ref={ppFileRef} type="file" accept="image/*" style={{ display:'none' }}
              onChange={e => ppPick(e.target.files?.[0])} />
            {ppPreview && (
              <img src={ppPreview} alt="Preview"
                style={{ width:44, height:44, borderRadius:'50%', objectFit:'cover', border:'2px solid #e3aaaa' }} />
            )}
            <button className="btn-primary btn-sm"
              style={{ backgroundColor:'#e3aaaa', borderColor:'#e3aaaa' }}
              disabled={savingPP || !ppPreview}
              onClick={saveProfilePhoto}>
              {savingPP ? 'Guardando…' : 'Guardar foto'}
            </button>
            <button className="btn-sm"
              onClick={() => { setEditingPP(false); ppClear(); }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Lista de productos */}
      {products.length === 0
        ? <p style={{ color:'var(--text-secondary)', fontSize:'0.9rem' }}>Sin productos en el menú.</p>
        : (
          <ul style={{ listStyle:'none', padding:0, marginBottom:'1rem' }}>
            {products.map(product => (
              <li key={product.id} className="card" style={{ marginBottom:'0.5rem', padding:'0.75rem',
                border: editingId===product.id ? '2px solid #e3aaaa' : '1px solid var(--gray-200)' }}>
                {/* ── Modo edición inline ── */}
                {editingId === product.id ? (
                  <div>
                    <div style={{ fontWeight:700, fontSize:'0.82rem', color:'var(--brand)', marginBottom:'0.6rem' }}>
                      ✏️ Editando: <span style={{ color:'var(--gray-700)' }}>{product.name}</span>
                    </div>
                    <div className="row">
                      <label>Nombre<input value={name} onChange={e=>setName(e.target.value)} placeholder="Nombre del producto" /></label>
                      <label>Descripción<input value={description} onChange={e=>setDesc(e.target.value)} placeholder="Descripción (opcional)" /></label>
                      <label>Precio (MXN)<input type="number" value={price} onChange={e=>setPrice(e.target.value)} step="0.01" min="0" placeholder="0.00" /></label>
                    </div>
                    <div style={{ display:'flex', gap:'0.5rem', marginTop:'0.4rem' }}>
                      <label style={{ flex:1 }}>
                        Unidades por empaque
                        <input type="text" inputMode="numeric" value={pkgUnits} onChange={e=>setPkgUnits(e.target.value)}
                          placeholder="1"
                          title="Cuántas unidades incluye un empaque (ej: 6 nuggets = 6)" />
                      </label>
                      <label style={{ flex:1 }}>
                        Volumen empaque (L)
                        <input type="text" inputMode="decimal" value={pkgVolume} onChange={e=>setPkgVolume(e.target.value)}
                          placeholder="0.00"
                          title="Litros que ocupa un empaque en la mochila (ej: 0.5 = medio litro)" />
                      </label>
                    </div>
                    <VolumeHelper value={pkgVolume} onChange={setPkgVolume} />
                    <div style={{ display:'flex', gap:'0.4rem', marginTop:'0.5rem', flexWrap:'wrap' }}>
                      <button className="btn-primary btn-sm" onClick={handleSubmit} disabled={!name.trim()||!price}>
                        Guardar cambios
                      </button>
                      <button className="btn-sm" onClick={resetForm}>Cancelar</button>
                    </div>
                    {msg && <p className="flash flash-error" style={{ marginTop:'0.4rem' }}>{msg}</p>}
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
                      <p style={{ fontSize:'0.82rem', color:'var(--text-secondary)', margin:'0.15rem 0 0' }}>{product.description}</p>
                    )}
                    <div style={{ display:'flex', gap:'0.4rem', marginTop:'0.5rem', flexWrap:'wrap' }}>
                      <button className="btn-sm" onClick={() => startEdit(product)}>Editar</button>
                      <button className="btn-sm" onClick={() => toggleAvailable(product)}>
                        {product.is_available ? 'Desactivar' : 'Activar'}
                      </button>
                      <button className="btn-sm" onClick={() => {
                        setEditingImg(product.id);
                        setImgUrl(product.image_url && !product.image_url.startsWith('data:') ? product.image_url : '');
                        clear();
                      }}>
                        {product.image_url ? 'Cambiar imagen' : 'Agregar imagen'}
                      </button>
                      {confirmDelete === product.id ? (
                        <div style={{ display:'flex', gap:'0.3rem', alignItems:'center' }}>
                          <span style={{ fontSize:'0.72rem', color:'var(--danger)', fontWeight:700 }}>¿Eliminar?</span>
                          <button className="btn-sm" onClick={() => deleteProduct(product.id)}
                            style={{ background:'var(--danger)', color:'#fff', borderColor:'var(--danger)', fontSize:'0.72rem' }}>
                            Sí
                          </button>
                          <button className="btn-sm" onClick={() => setConfirmDelete(null)}
                            style={{ fontSize:'0.72rem' }}>No</button>
                        </div>
                      ) : (
                        <button className="btn-sm" onClick={() => setConfirmDelete(product.id)}
                          style={{ color:'var(--danger)', borderColor:'var(--danger)' }}>
                          Eliminar
                        </button>
                      )}
                    </div>

                    {/* Editor de imagen */}
                    {editingImg === product.id && (
                      <div style={{ marginTop:'0.5rem', display:'flex', flexDirection:'column', gap:'0.4rem' }}>
                        {/* Opción 1: desde local */}
                        <div style={{ display:'flex', alignItems:'center', gap:'0.4rem' }}>
                          <button className="btn-sm" onClick={() => fileRef.current?.click()}>
                            Seleccionar archivo
                          </button>
                          <input
                            ref={fileRef} type="file" accept="image/*"
                            style={{ display:'none' }}
                            onChange={e => pick(e.target.files?.[0])}
                          />
                          {preview && (
                            <img src={preview} alt="Preview"
                              style={{ width:40, height:40, borderRadius:4, objectFit:'cover', border:'1px solid var(--border)' }} />
                          )}
                        </div>
                        <div style={{ display:'flex', gap:'0.4rem' }}>
                          <button className="btn-primary btn-sm" disabled={savingImg || !preview}
                            onClick={() => saveImage(product.id)}
                            style={{ backgroundColor:'#e3aaaa', borderColor:'#e3aaaa' }}>
                            {savingImg ? '...' : 'Guardar'}
                          </button>
                          <button className="btn-sm" onClick={() => { setEditingImg(null); setImgUrl(''); clear(); }}>
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize:'0.72rem', fontWeight:700, color: product.is_available ? 'var(--success)':'var(--gray-400)', flexShrink:0 }}>
                    {product.is_available ? 'Activo':'Inactivo'}
                  </span>
                </div>
                )}{/* fin ternario edición */}
              </li>
            ))}
          </ul>
        )
      }

      {/* Formulario colapsable al fondo */}
      <div className="card" style={{ border: formOpen ? '2px solid #e3aaaa' : '1px solid var(--gray-200)', padding:0, overflow:'hidden' }}>
        <button
          onClick={() => { setFormOpen(o => !o); if (editingId) resetForm(); }}
          style={{ width:'100%', display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0.85rem 1rem', background:'none', border:'none', cursor:'pointer', fontWeight:700, fontSize:'0.88rem', borderBottom: formOpen ? '1px solid var(--gray-200)':'none' }}
        >
          <span>{editingId ? 'Modo Edición' : '+ Agregar producto'}</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            style={{ transform: formOpen ? 'rotate(180deg)':'rotate(0)', transition:'transform 0.2s' }}>
            <path d="M6 9l6 6 6-6"/>
          </svg>
        </button>
        {formOpen && (
          <div style={{ padding:'1rem' }}>
            <div style={{ display:'flex', flexDirection:'column', gap:'0.55rem', marginBottom:'0.65rem' }}>
              <label>Nombre del producto<input value={name} onChange={e => setName(e.target.value)} placeholder="Ej: Taco de pastor" /></label>
              <label>Descripción (opcional)<input value={description} onChange={e => setDesc(e.target.value)} placeholder="Ej: Con cebolla y cilantro" /></label>
              <label>Precio (pesos)<input value={price} onChange={e => setPrice(e.target.value)} placeholder="Ej: 35.00" inputMode="decimal" /></label>
              <div style={{ display:'flex', gap:'0.5rem' }}>
                <label style={{ flex:1 }}>
                  Unidades por empaque
                  <input type="text" inputMode="numeric" value={pkgUnits} onChange={e => setPkgUnits(e.target.value)}
                    placeholder="1"
                    title="Cuántas unidades incluye un empaque" />
                </label>
                <label style={{ flex:1 }}>
                  Volumen empaque (L)
                  <input type="text" inputMode="decimal" value={pkgVolume} onChange={e => setPkgVolume(e.target.value)}
                    placeholder="0.00"
                    title="Litros que ocupa un empaque en la mochila" />
                </label>
              </div>
              <VolumeHelper value={pkgVolume} onChange={setPkgVolume} />
            </div>
            {msg && <p className="flash flash-error" style={{ marginBottom:'0.5rem' }}>{msg}</p>}
            <div style={{ display:'flex', gap:'0.5rem' }}>
              <button className="btn-primary btn-sm" onClick={handleSubmit}
                style={{ backgroundColor:'#e3aaaa', borderColor:'#e3aaaa' }}>
                {editingId ? 'Guardar cambios' : 'Agregar'}
              </button>
              {editingId && <button className="btn-sm" onClick={resetForm}>Cancelar</button>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
