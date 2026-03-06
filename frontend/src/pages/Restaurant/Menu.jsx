import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';

function fmt(cents) { return `$${((cents ?? 0) / 100).toFixed(2)}`; }

function ProductImagePlaceholder({ size = 68 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: 6, background: 'var(--gray-100)',
      border: '1px solid var(--gray-200)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', flexShrink: 0
    }}>
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="1.5">
        <circle cx="12" cy="12" r="9"/>
        <path d="M8 12h8M12 8v8"/>
        <path d="M7 16c0-2.8 2.2-5 5-5s5 2.2 5 5"/>
      </svg>
    </div>
  );
}

function ProductImage({ src, size = 68 }) {
  const [err, setErr] = useState(false);
  if (!src || err) return <ProductImagePlaceholder size={size} />;
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      onError={() => setErr(true)}
      style={{ width: size, height: size, borderRadius: 6, objectFit: 'cover', border: '1px solid var(--gray-200)', flexShrink: 0 }}
    />
  );
}

export default function RestaurantMenu() {
  const { auth } = useAuth();
  const [products, setProducts] = useState([]);
  const [name, setName]         = useState('');
  const [description, setDesc]  = useState('');
  const [price, setPrice]       = useState('');
  const [msg, setMsg]           = useState('');
  const [editingImg, setEditingImg] = useState(null); // productId | null
  const [imgUrl, setImgUrl]         = useState('');
  const [savingImg, setSavingImg]   = useState(false);

  async function load() {
    try {
      const d = await apiFetch('/restaurants/my/menu', {}, auth.token);
      setProducts(d.menu || []);
    } catch (_) {}
  }

  useEffect(() => { load(); }, [auth.token]);

  async function addProduct() {
    if (!name.trim()) return setMsg('El nombre es requerido');
    const cents = Math.round(parseFloat(price.replace(',', '.')) * 100);
    if (isNaN(cents) || cents <= 0) return setMsg('Precio inválido');
    try {
      await apiFetch('/restaurants/menu-items', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), description: description.trim(), priceCents: cents })
      }, auth.token);
      setName(''); setDesc(''); setPrice(''); setMsg('');
      load();
    } catch (e) { setMsg(e.message); }
  }

  async function toggleAvailable(product) {
    try {
      await apiFetch(`/restaurants/menu-items/${product.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: product.name, description: product.description, priceCents: product.price_cents, isAvailable: !product.is_available })
      }, auth.token);
      load();
    } catch (e) { setMsg(e.message); }
  }

  async function saveImage(productId) {
    setSavingImg(true);
    try {
      await apiFetch(`/restaurants/menu-items/${productId}`, {
        method: 'PATCH',
        body: JSON.stringify({ imageUrl: imgUrl.trim() || null })
      }, auth.token);
      setEditingImg(null); setImgUrl('');
      load();
    } catch (e) { setMsg(e.message); }
    finally { setSavingImg(false); }
  }

  return (
    <div>
      <h2 style={{ fontSize:'1.1rem', fontWeight:800, marginBottom:'1.25rem' }}>Gestión de menú</h2>

      {/* Agregar producto */}
      <div className="card" style={{ marginBottom:'1.25rem' }}>
        <h3 style={{ fontSize:'0.88rem', fontWeight:700, marginBottom:'0.75rem' }}>Agregar producto</h3>
        <div style={{ display:'flex', flexDirection:'column', gap:'0.55rem', marginBottom:'0.65rem' }}>
          <label>Nombre del producto<input value={name} onChange={e => setName(e.target.value)} placeholder="Ej: Taco de pastor" /></label>
          <label>Descripción (opcional)<input value={description} onChange={e => setDesc(e.target.value)} placeholder="Ej: Con cebolla y cilantro" /></label>
          <label>Precio (pesos)<input value={price} onChange={e => setPrice(e.target.value)} placeholder="Ej: 35.00" inputMode="decimal" /></label>
        </div>
        {msg && <p className="flash flash-error" style={{ marginBottom:'0.5rem' }}>{msg}</p>}
        <button className="btn-primary" onClick={addProduct}>Agregar</button>
      </div>

      {/* Lista de productos */}
      {products.length === 0
        ? <p style={{ color:'var(--gray-600)', fontSize:'0.9rem' }}>Sin productos en el menú.</p>
        : (
          <ul style={{ listStyle:'none', padding:0 }}>
            {products.map(product => (
              <li key={product.id} className="card" style={{ marginBottom:'0.5rem', padding:'0.75rem' }}>
                <div style={{ display:'flex', gap:'0.75rem', alignItems:'flex-start' }}>
                  <ProductImage src={product.image_url} size={68} />
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:'0.5rem', flexWrap:'wrap' }}>
                      <span style={{ fontWeight:700, fontSize:'0.95rem' }}>{product.name}</span>
                      <span style={{ fontWeight:700, color:'var(--gray-800)', flexShrink:0 }}>{fmt(product.price_cents)}</span>
                    </div>
                    {product.description && (
                      <p style={{ fontSize:'0.82rem', color:'var(--gray-600)', margin:'0.15rem 0 0' }}>{product.description}</p>
                    )}
                    <div style={{ display:'flex', gap:'0.4rem', marginTop:'0.5rem', flexWrap:'wrap' }}>
                      <button className="btn-sm" onClick={() => toggleAvailable(product)}>
                        {product.is_available ? 'Desactivar' : 'Activar'}
                      </button>
                      <button className="btn-sm" onClick={() => { setEditingImg(product.id); setImgUrl(product.image_url || ''); }}>
                        {product.image_url ? 'Cambiar imagen' : 'Agregar imagen'}
                      </button>
                    </div>
                    {/* Editor de imagen */}
                    {editingImg === product.id && (
                      <div style={{ marginTop:'0.5rem', display:'flex', gap:'0.4rem', flexWrap:'wrap' }}>
                        <input
                          value={imgUrl}
                          onChange={e => setImgUrl(e.target.value)}
                          placeholder="URL de imagen (https://...)"
                          style={{ flex:1, minWidth:180 }}
                        />
                        <button className="btn-primary btn-sm" disabled={savingImg} onClick={() => saveImage(product.id)}>
                          {savingImg ? 'Guardando…' : 'Guardar'}
                        </button>
                        <button className="btn-sm" onClick={() => { setEditingImg(null); setImgUrl(''); }}>Cancelar</button>
                      </div>
                    )}
                  </div>
                  <div>
                    <span style={{ fontSize:'0.72rem', fontWeight:700, color: product.is_available ? 'var(--success)' : 'var(--gray-400)' }}>
                      {product.is_available ? 'Activo' : 'Inactivo'}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )
      }
    </div>
  );
}
