import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

function ensureLeafletCSS() {
  if (document.getElementById('leaflet-css')) return;
  const lnk = document.createElement('link');
  lnk.id = 'leaflet-css'; lnk.rel = 'stylesheet';
  lnk.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  document.head.appendChild(lnk);
}

function Collapsible({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card" style={{ marginBottom:'0.75rem', padding:0, overflow:'hidden' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width:'100%', display:'flex', justifyContent:'space-between', alignItems:'center',
        padding:'0.85rem 1rem', background:'none', border:'none', cursor:'pointer',
        fontWeight:700, fontSize:'0.9rem', color:'var(--gray-800)',
        borderBottom: open ? '1px solid var(--gray-200)' : 'none',
      }}>
        <span>{title}</span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition:'transform 0.2s' }}>
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>
      {open && <div style={{ padding:'1rem' }}>{children}</div>}
    </div>
  );
}

function Flash({ text, isError }) {
  if (!text) return null;
  return <p className={`flash ${isError ? 'flash-error' : 'flash-ok'}`} style={{ marginTop:'0.5rem' }}>{text}</p>;
}

const ROLE_LABELS = { customer:'Cliente', restaurant:'Tienda', driver:'Conductor', admin:'Administrador' };

// Mapa embebido para colocar/editar pin de ubicación
function PinMap({ initialLat, initialLng, onConfirm }) {
  const containerRef = useRef(null);
  const mapRef       = useRef(null);
  const markerRef    = useRef(null);
  const [pickedPos, setPickedPos] = useState(
    initialLat && initialLng ? { lat: Number(initialLat), lng: Number(initialLng) } : null
  );

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    ensureLeafletCSS();
    const center = pickedPos || { lat: 19.755228, lng: -101.137419 };
    import('leaflet').then(L => {
      if (!containerRef.current || mapRef.current) return;
      delete L.Icon.Default.prototype._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });
      const map = L.map(containerRef.current, { zoomControl: true, attributionControl: false })
        .setView([center.lat, center.lng], 15);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { keepBuffer: 2 }).addTo(map);

      // Si ya hay pin guardado, mostrarlo al abrir
      if (pickedPos) {
        markerRef.current = L.marker([pickedPos.lat, pickedPos.lng]).addTo(map);
      }

      map.on('click', (e) => {
        const { lat, lng } = e.latlng;
        if (markerRef.current) markerRef.current.setLatLng([lat, lng]);
        else markerRef.current = L.marker([lat, lng]).addTo(map);
        setPickedPos({ lat, lng });
      });

      mapRef.current = map;
      setTimeout(() => map.invalidateSize(), 200);
    }).catch(() => {});
    return () => {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; markerRef.current = null; }
    };
  }, []);

  return (
    <div>
      <div ref={containerRef} style={{ height:230, borderRadius:8, border:'1px solid var(--gray-200)', marginBottom:'0.5rem' }} />
      <p style={{ fontSize:'0.75rem', color:'var(--gray-500)', marginBottom:'0.5rem' }}>
        Toca el mapa para colocar o mover el pin de tu domicilio.
      </p>
      <button className="btn-primary btn-sm" disabled={!pickedPos}
        onClick={() => pickedPos && onConfirm(pickedPos)}
        style={{ opacity: pickedPos ? 1 : 0.5 }}>
        ✓ Confirmar ubicación
      </button>
    </div>
  );
}

export default function ProfilePage() {
  const { auth, patchUser, logout } = useAuth();
  const user = auth.user;

  const [alias,   setAlias]   = useState(user?.alias || user?.display_name || user?.full_name || '');
  const [street,  setStreet]  = useState('');
  const [numExt,  setNumExt]  = useState('');
  const [numInt,  setNumInt]  = useState('');
  const [colonia, setColonia] = useState('');
  const [city,    setCity]    = useState('');
  const [state,   setState_]  = useState('');
  const [pinLat,  setPinLat]  = useState(user?.lat  ? Number(user.lat)  : null);
  const [pinLng,  setPinLng]  = useState(user?.lng  ? Number(user.lng)  : null);
  const [showMap, setShowMap] = useState(false);
  const [profileMsg, setProfileMsg] = useState('');
  const [profileErr, setProfileErr] = useState(false);

  const [loginUsername,   setLoginUsername]   = useState(user?.username || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword,     setNewPassword]     = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdMsg, setPwdMsg] = useState('');
  const [pwdErr, setPwdErr] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState('');
  const [deleteErr, setDeleteErr] = useState(false);

  // Parsear dirección raw al montar
  useEffect(() => {
    const raw = user?.address && user.address !== 'address-pending' ? user.address : '';
    if (!raw) return;
    // Formato: "Calle NumExt, Int. X, Colonia, Ciudad, Estado"
    const parts = raw.split(',').map(s => s.trim());
    const firstPart = parts[0] || '';
    // Separar número del final de la calle: "Av. Revolución 1234"
    const numMatch = firstPart.match(/^(.*?)\s+(\d+\w*)$/);
    setStreet(numMatch ? numMatch[1] : firstPart);
    setNumExt(numMatch ? numMatch[2] : '');
    // Si segundo segmento empieza con "Int." es interior, si no es colonia
    let colIdx = 1;
    if (parts[1]?.startsWith('Int.')) {
      setNumInt(parts[1].replace(/^Int\.\s*/, ''));
      colIdx = 2;
    }
    setColonia(parts[colIdx] || '');
    setCity(parts[colIdx + 1] || '');
    setState_(parts[colIdx + 2] || '');
  }, []);

  const buildAddress = () => {
    const streetFull = [street.trim(), numExt.trim()].filter(Boolean).join(' ');
    const parts = [
      streetFull,
      numInt.trim() ? `Int. ${numInt.trim()}` : '',
      colonia.trim(), city.trim(), state.trim(),
    ].filter(Boolean);
    return parts.join(', ');
  };

  async function saveProfile() {
    if (!alias.trim()) { setProfileMsg('El nombre no puede estar vacío'); setProfileErr(true); return; }
    try {
      const body = { displayName: alias.trim() };
      const addr = buildAddress();
      if (addr) body.address = addr;
      if (pinLat !== null && pinLng !== null) { body.lat = pinLat; body.lng = pinLng; }
      const data = await apiFetch('/auth/profile', { method:'PATCH', body: JSON.stringify(body) }, auth.token);
      patchUser({
        alias:    data.profile.alias ?? data.profile.displayName,
        full_name: data.profile.alias ?? data.profile.displayName,
        address:  data.profile.address,
        lat:      data.profile.lat,
        lng:      data.profile.lng,
      });
      setProfileMsg('Perfil actualizado'); setProfileErr(false);
    } catch (e) { setProfileMsg(e.message); setProfileErr(true); }
  }

  async function changePasswordAndLogin() {
    if (!currentPassword) { setPwdMsg('Ingresa tu contraseña actual'); setPwdErr(true); return; }
    const changingPwd  = !!newPassword;
    const changingUser = loginUsername.trim() && loginUsername.trim() !== user?.username;
    if (!changingPwd && !changingUser) { setPwdMsg('No hay cambios que guardar'); setPwdErr(false); return; }
    if (changingPwd) {
      if (newPassword !== confirmPassword) { setPwdMsg('Las contraseñas no coinciden'); setPwdErr(true); return; }
      if (newPassword.length < 6) { setPwdMsg('Mínimo 6 caracteres'); setPwdErr(true); return; }
    }
    try {
      if (changingPwd) await apiFetch('/auth/password', { method:'PATCH', body: JSON.stringify({ currentPassword, newPassword }) }, auth.token);
      if (changingUser) {
        await apiFetch('/auth/login-username', { method:'PATCH', body: JSON.stringify({ currentPassword, newUsername: loginUsername.trim() }) }, auth.token);
        patchUser({ username: loginUsername.trim() });
      }
      setPwdMsg(changingPwd && changingUser ? 'Contraseña y usuario actualizados' : changingPwd ? 'Contraseña actualizada' : 'Usuario de acceso actualizado');
      setPwdErr(false); setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    } catch (e) { setPwdMsg(e.message); setPwdErr(true); }
  }

  async function deleteAccount() {
    if (!window.confirm('¿Eliminar tu cuenta permanentemente? Esta acción no se puede deshacer.')) return;
    try { await apiFetch('/auth/account', { method:'DELETE' }, auth.token); logout(); }
    catch (e) { setDeleteMsg(e.message); setDeleteErr(true); }
  }

  const avatarLetter = (alias[0] || '?').toUpperCase();

  return (
    <div>
      <h2 style={{ fontSize:'1.1rem', fontWeight:800, marginBottom:'1.25rem' }}>Mi perfil</h2>

      {/* Tarjeta */}
      <div className="card" style={{ marginBottom:'0.75rem', display:'flex', gap:'0.75rem', alignItems:'center' }}>
        <div style={{ width:44, height:44, borderRadius:'50%', background:'var(--brand-light)', border:'2px solid var(--brand)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
          <span style={{ fontWeight:800, fontSize:'1.1rem', color:'var(--brand)' }}>{avatarLetter}</span>
        </div>
        <div>
          <div style={{ fontWeight:700 }}>{alias}</div>
          <div style={{ fontSize:'0.8rem', color:'var(--gray-600)' }}>{ROLE_LABELS[user?.role] || user?.role}</div>
        </div>
      </div>

      <Collapsible title="Datos personales" defaultOpen={false}>
        <p style={{ fontSize:'0.8rem', color:'var(--gray-500)', marginBottom:'0.65rem' }}>
          Este nombre se muestra a otros usuarios en la plataforma.
        </p>
        <div style={{ display:'flex', flexDirection:'column', gap:'0.55rem', marginBottom:'0.65rem' }}>

          <label>Nombre para mostrar
            <input value={alias} onChange={e => setAlias(e.target.value)} placeholder="Ej: Juan García" />
          </label>

          <div style={{ fontWeight:600, fontSize:'0.8rem', color:'var(--gray-500)', marginTop:'0.2rem' }}>Dirección de entrega</div>

          <label>Calle
            <input value={street} onChange={e => setStreet(e.target.value)} placeholder="Ej: Av. Revolución" />
          </label>
          <div style={{ display:'flex', gap:'0.5rem' }}>
            <label style={{ flex:1 }}>Núm. exterior
              <input value={numExt} onChange={e => setNumExt(e.target.value)} placeholder="1234" />
            </label>
            <label style={{ flex:1 }}>Núm. interior
              <input value={numInt} onChange={e => setNumInt(e.target.value)} placeholder="Opcional" />
            </label>
          </div>
          <label>Colonia
            <input value={colonia} onChange={e => setColonia(e.target.value)} placeholder="Ej: Col. Centro" />
          </label>
          <div style={{ display:'flex', gap:'0.5rem' }}>
            <label style={{ flex:2 }}>Ciudad / Municipio
              <input value={city} onChange={e => setCity(e.target.value)} placeholder="Ej: Morelia" />
            </label>
            <label style={{ flex:1 }}>Estado
              <input value={state} onChange={e => setState_(e.target.value)} placeholder="Ej: Mich." />
            </label>
          </div>

          {/* Pin de mapa */}
          <div style={{ marginTop:'0.1rem' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'0.35rem', flexWrap:'wrap' }}>
              <span style={{ fontWeight:600, fontSize:'0.8rem', color:'var(--gray-500)' }}>Pin de ubicación</span>
              {pinLat && pinLng && (
                <span style={{ fontSize:'0.72rem', color:'var(--success)', fontWeight:700 }}>
                  ✓ Guardado ({Number(pinLat).toFixed(4)}, {Number(pinLng).toFixed(4)})
                </span>
              )}
            </div>
            <button className="btn-sm" onClick={() => setShowMap(m => !m)}
              style={{ display:'flex', alignItems:'center', gap:'0.4rem' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
              </svg>
              {showMap ? 'Ocultar mapa' : pinLat ? 'Editar pin' : 'Colocar pin en mapa'}
            </button>
            {showMap && (
              <div style={{ marginTop:'0.5rem' }}>
                <PinMap
                  initialLat={pinLat} initialLng={pinLng}
                  onConfirm={({ lat, lng }) => { setPinLat(lat); setPinLng(lng); setShowMap(false); }}
                />
              </div>
            )}
          </div>
        </div>
        <button className="btn-primary btn-sm" onClick={saveProfile}>Guardar cambios</button>
        <Flash text={profileMsg} isError={profileErr} />
      </Collapsible>

      <Collapsible title="Seguridad">
        <p style={{ fontSize:'0.8rem', color:'var(--gray-500)', marginBottom:'0.65rem' }}>
          El usuario de acceso es el que usas para iniciar sesión.
        </p>
        <div style={{ display:'flex', flexDirection:'column', gap:'0.55rem', marginBottom:'0.65rem' }}>
          <label>Usuario de acceso
            <input value={loginUsername} onChange={e => setLoginUsername(e.target.value)}
              placeholder="Ej: juangarcia91" autoComplete="username" />
          </label>
          <label>Contraseña actual (requerida)
            <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)}
              autoComplete="current-password" />
          </label>
          <label>Nueva contraseña (opcional)
            <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
              autoComplete="new-password" placeholder="Dejar vacío para no cambiar" />
          </label>
          {newPassword && (
            <label>Confirmar nueva contraseña
              <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                autoComplete="new-password" />
            </label>
          )}
        </div>
        <button className="btn-primary btn-sm" onClick={changePasswordAndLogin}>Guardar cambios</button>
        <Flash text={pwdMsg} isError={pwdErr} />
      </Collapsible>

      <button onClick={logout} style={{
        width:'100%', padding:'0.7rem', background:'var(--gray-100)', border:'1px solid var(--gray-200)',
        borderRadius:'var(--radius)', fontWeight:700, fontSize:'0.9rem', cursor:'pointer',
        marginBottom:'0.75rem', color:'var(--gray-800)', transition:'background 0.15s',
      }}
        onMouseEnter={e => e.currentTarget.style.background='var(--gray-200)'}
        onMouseLeave={e => e.currentTarget.style.background='var(--gray-100)'}
      >Cerrar sesión</button>

      <Collapsible title="Administración de cuenta">
        <p style={{ fontSize:'0.85rem', color:'var(--gray-600)', marginBottom:'0.75rem' }}>
          Eliminar tu cuenta es permanente. No podrás recuperarla.
        </p>
        <button className="btn-danger btn-sm" onClick={deleteAccount}>Eliminar cuenta</button>
        <Flash text={deleteMsg} isError={deleteErr} />
      </Collapsible>
    </div>
  );
}
