import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';

function fmt(cents) { return `$${((cents ?? 0) / 100).toFixed(2)}`; }

function ProductImagePlaceholder({ size = 68 }) {
  return (
    <div style={{ width:size, height:size, borderRadius:6, background:'var(--gray-100)', border:'1px solid var(--gray-200)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
      <svg width={size*0.45} height={size*0.45} viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="1.5">
        <rect x="3" y="3" width="18" height="18" rx="3"/>
        <circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
      </svg>
    </div>
  );
}

function ProductImage({ src, size = 68 }) {
  const [err, setErr] = useState(false);
  if (!src || err) return <ProductImagePlaceholder size={size} />;
  return <img src={src} alt="" width={size} height={size} onError={() => setErr(true)}
    style={{ width:size, height:size, borderRadius:6, objectFit:'cover', border:'1px solid var(--gray-200)', flexShrink:0 }} />;
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

export default function RestaurantMenu() {
  const { auth } = useAuth();
  const [products, setProducts] = useState([]);
  const [msg, setMsg]           = useState('');

  // Estado del editor — null = cerrado, 'new' = nuevo, id = editando ese producto
  const [editorState, setEditorState] = useState(null); // null | 'new' | productId
  const [editorName, setEditorName]   = useState('');
  const [editorDesc, setEditorDesc]   = useState('');
  const [editorPrice, setEditorPrice] = useState('');

  // Estado del editor de imagen — separado
  const [imgEditId, setImgEditId] = useState(null);
  const [imgUrl, setImgUrl]       = useState('');
  const [savingImg, setSavingImg] = useState(false);
  const { preview, dataUrl, pick, clear } = useLocalImage();
  const fileRef = useRef(null);

  async function load() {
    try {
      const d = await apiFetch('/restaurants/my/menu', {}, auth.token);
      setProducts(d.menu || []);
    } catch (_) {}
  }
  useEffect(() => { load(); }, [auth.token]);

  function openEditor(product = null) {
    setMsg('');
    setEditorState(product ? product.id : 'new');
    setEditorName(product?.name || '');
    setEditorDesc(product?.description || '');
    setEditorPrice(product ? (product.price_cents / 100).toFixed(2) : '');
  }

  function closeEditor() {
    setEditorState(null);
    setEditorName(''); setEditorDesc(''); setEditorPrice(''); setMsg('');
  }

  async function handleSubmit() {
    if (!editorName.trim()) return setMsg('El nombre es requerido');
    const cents = Math.round(parseFloat(editorPrice.toString().replace(',', '.')) * 100);
    if (isNaN(cents) || cents <= 0) return setMsg('Precio inválido');
    try {
      const payload = { name: editorName.trim(), description: editorDesc.trim(), priceCents: cents };
      if (editorState === 'new') {
        await apiFetch('/restaurants/menu-items', { method:'POST', body: JSON.stringify(payload) }, auth.token);
      } else {
        await apiFetch(`/restaurants/menu-items/${editorState}`, { method:'PATCH', body: JSON.stringify(payload) }, auth.token);
      }
      closeEditor(); load();
    } catch (e) { setMsg(e.message); }
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

  function openImgEditor(product) {
    setImgEditId(product.id);
    setImgUrl(product.image_url && !product.image_url.startsWith('data:') ? product.image_url : '');
    clear();
    setMsg('');
  }

  async function saveImage() {
    if (!imgEditId) return;
    setSavingImg(true);
    try {
      const imageToSave = dataUrl || imgUrl.trim() || null;
      await apiFetch(`/restaurants/menu-items/${imgEditId}`, {
        method:'PATCH', body: JSON.stringify({ imageUrl: imageToSave })
      }, auth.token);
      setImgEditId(null); setImgUrl(''); clear(); load();
    } catch (e) { setMsg(e.message); }
    finally { setSavingImg(false); }
  }

  return (
    <div style={{ backgroundColor:'#fff9f8', minHeight:'100vh', padding:'1rem' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1.25rem' }}>
        <h2 style={{ fontSize:'1.1rem', fontWeight:800, color:'#8a5e5e', margin:0 }}>Gestión de menú</h2>
        {editorState === null && (
          <button className="btn-primary btn-sm" onClick={() => openEditor()}
            style={{ backgroundColor:'#e3aaaa', borderColor:'#e3aaaa' }}>
            Agregar producto
          </button>
        )}
      </div>

      {/* Editor nuevo — aparece arriba cuando no hay producto seleccionado */}
      {editorState === 'new' && (
        <EditorPanel
          title="Nuevo producto"
          name={editorName} setName={setEditorName}
          desc={editorDesc} setDesc={setEditorDesc}
          price={editorPrice} setPrice={setEditorPrice}
          msg={msg} onSave={handleSubmit} onCancel={closeEditor}
        />
      )}

      {msg && editorState === null && <p className="flash flash-error" style={{ marginBottom:'0.5rem' }}>{msg}</p>}

      {products.length === 0
        ? <p style={{ color:'var(--gray-600)', fontSize:'0.9rem' }}>Sin productos en el menú.</p>
        : (
          <ul style={{ listStyle:'none', padding:0, marginBottom:'1rem' }}>
            {products.map(product => {
              const isEditing = editorState === product.id;
              const isImgEdit = imgEditId === product.id;

              // Si este producto está en modo edición, reemplazarlo con el editor
              if (isEditing) {
                return (
                  <li key={product.id} style={{ marginBottom:'0.5rem' }}>
                    <EditorPanel
                      title={`Editando: ${product.name}`}
                      name={editorName} setName={setEditorName}
                      desc={editorDesc} setDesc={setEditorDesc}
                      price={editorPrice} setPrice={setEditorPrice}
                      msg={msg} onSave={handleSubmit} onCancel={closeEditor}
                    />
                  </li>
                );
              }

              return (
                <li key={product.id} className="card" style={{ marginBottom:'0.5rem', padding:'0.75rem' }}>
                  <div style={{ display:'flex', gap:'0.75rem', alignItems:'flex-start' }}>
                    <ProductImage src={product.image_url} size={68} />
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:'0.5rem', flexWrap:'wrap' }}>
                        <span style={{ fontWeight:700, fontSize:'0.95rem' }}>{product.name}</span>
                        <span style={{ fontWeight:700, color:'#8a5e5e', flexShrink:0 }}>{fmt(product.price_cents)}</span>
                      </div>
                      {product.description && (
                        <p style={{ fontSize:'0.82rem', color:'var(--gray-600)', margin:'0.15rem 0 0' }}>{product.description}</p>
                      )}
                      <div style={{ display:'flex', gap:'0.4rem', marginTop:'0.5rem', flexWrap:'wrap' }}>
                        <button className="btn-sm" onClick={() => openEditor(product)}>Editar</button>
                        <button className="btn-sm" onClick={() => toggleAvailable(product)}>
                          {product.is_available ? 'Desactivar' : 'Activar'}
                        </button>
                        <button className="btn-sm" onClick={() => isImgEdit ? (setImgEditId(null), clear()) : openImgEditor(product)}>
                          {product.image_url ? 'Cambiar imagen' : 'Agregar imagen'}
                        </button>
                      </div>

                      {/* Editor de imagen — inline debajo de los botones */}
                      {isImgEdit && (
                        <div style={{ marginTop:'0.65rem', background:'var(--gray-50)', border:'1px solid var(--gray-200)', borderRadius:8, padding:'0.75rem', display:'flex', flexDirection:'column', gap:'0.4rem' }}>
                          <p style={{ fontWeight:600, fontSize:'0.82rem', margin:0 }}>Imagen del producto</p>
                          <div style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
                            <button className="btn-sm" onClick={() => fileRef.current?.click()}>
                              Seleccionar archivo
                            </button>
                            <input ref={fileRef} type="file" accept="image/*" style={{ display:'none' }}
                              onChange={e => pick(e.target.files?.[0])} />
                            {preview && (
                              <img src={preview} alt="Vista previa"
                                style={{ width:48, height:48, borderRadius:4, objectFit:'cover', border:'1px solid var(--gray-200)' }} />
                            )}
                          </div>
                          {!preview && (
                            <input value={imgUrl} onChange={e => setImgUrl(e.target.value)}
                              placeholder="O pega una URL (https://...)"
                              style={{ fontSize:'0.82rem' }} />
                          )}
                          {msg && <p className="flash flash-error" style={{ margin:0, padding:'0.3rem 0.5rem' }}>{msg}</p>}
                          <div style={{ display:'flex', gap:'0.4rem' }}>
                            <button className="btn-primary btn-sm"
                              disabled={savingImg || (!preview && !imgUrl.trim())}
                              onClick={saveImage}
                              style={{ backgroundColor:'#e3aaaa', borderColor:'#e3aaaa' }}>
                              {savingImg ? 'Guardando…' : 'Guardar'}
                            </button>
                            <button className="btn-sm" onClick={() => { setImgEditId(null); setImgUrl(''); clear(); setMsg(''); }}>
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                    <span style={{ fontSize:'0.72rem', fontWeight:700, color: product.is_available ? 'var(--success)':'var(--gray-400)', flexShrink:0 }}>
                      {product.is_available ? 'Activo' : 'Inactivo'}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )
      }
    </div>
  );
}

function EditorPanel({ title, name, setName, desc, setDesc, price, setPrice, msg, onSave, onCancel }) {
  return (
    <div className="card" style={{ border:'2px solid #e3aaaa', padding:'1rem', marginBottom:'0.5rem' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.75rem' }}>
        <span style={{ fontWeight:700, fontSize:'0.9rem' }}>{title}</span>
        <button onClick={onCancel} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--gray-500)', fontSize:'1.1rem', lineHeight:1 }}>✕</button>
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:'0.55rem', marginBottom:'0.65rem' }}>
        <label>Nombre del producto<input value={name} onChange={e => setName(e.target.value)} placeholder="Ej: Taco de pastor" /></label>
        <label>Descripción (opcional)<input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Ej: Con cebolla y cilantro" /></label>
        <label>Precio (pesos)<input value={price} onChange={e => setPrice(e.target.value)} placeholder="Ej: 35.00" inputMode="decimal" /></label>
      </div>
      {msg && <p className="flash flash-error" style={{ marginBottom:'0.5rem' }}>{msg}</p>}
      <div style={{ display:'flex', gap:'0.5rem' }}>
        <button className="btn-primary btn-sm" onClick={onSave}
          style={{ backgroundColor:'#e3aaaa', borderColor:'#e3aaaa' }}>
          Guardar
        </button>
        <button className="btn-sm" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}
