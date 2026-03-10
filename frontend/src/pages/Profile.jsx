import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

function Collapsible({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card" style={{ marginBottom:'0.75rem', padding:0, overflow:'hidden' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width:'100%', display:'flex', justifyContent:'space-between', alignItems:'center',
          padding:'0.85rem 1rem', background:'none', border:'none', cursor:'pointer',
          fontWeight:700, fontSize:'0.9rem', color:'var(--gray-800)',
          borderBottom: open ? '1px solid var(--gray-200)' : 'none',
        }}
      >
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

// API de SEPOMEX gratuita (datos.gob.mx) para consulta por CP
async function fetchColoniasByPostal(cp) {
  try {
    const r = await fetch(`https://sepomex.icalialabs.com/api/v1/zip_codes?zip_code=${cp}`);
    if (!r.ok) throw new Error('no data');
    const data = await r.json();
    const zips = data.zip_codes || [];
    if (zips.length === 0) return null;
    return {
      estado: zips[0].d_estado,
      ciudad: zips[0].d_mnpio || zips[0].d_ciudad || '',
      colonias: zips.map(z => z.d_asenta).filter(Boolean).sort(),
    };
  } catch {
    // Fallback: intentar con otra API pública
    try {
      const r2 = await fetch(`https://api.copomex.com/query/info_cp/${cp}?type=colonia&token=pruebas`);
      if (!r2.ok) throw new Error('no data');
      const data2 = await r2.json();
      const items = Array.isArray(data2) ? data2 : [data2];
      if (!items[0]?.response) return null;
      return {
        estado: items[0].response.estado,
        ciudad: items[0].response.municipio || '',
        colonias: items.map(i => i.response?.asentamiento).filter(Boolean).sort(),
      };
    } catch {
      return null;
    }
  }
}

export default function ProfilePage() {
  const { auth, patchUser, logout } = useAuth();
  const user = auth.user;

  // Datos personales
  const [alias, setAlias]             = useState(user?.alias || user?.display_name || user?.full_name || '');
  const [address, setAddress]         = useState(user?.address && user.address !== 'address-pending' ? user.address : '');
  const [profileMsg, setProfileMsg]   = useState('');
  const [profileErr, setProfileErr]   = useState(false);

  // Código postal + dirección estructurada
  const [postalCode,   setPostalCode]   = useState(user?.postal_code  || '');
  const [estado,       setEstado]       = useState(user?.estado        || '');
  const [ciudad,       setCiudad]       = useState(user?.ciudad        || '');
  const [colonia,      setColonia]      = useState(user?.colonia       || '');
  const [coloniasList, setColoniasList] = useState([]);
  const [cpLoading,    setCpLoading]    = useState(false);
  const [cpError,      setCpError]      = useState('');
  const cpTimerRef = useRef(null);

  // Pin Casa
  const [homeLat, setHomeLat] = useState(user?.home_lat ?? null);
  const [homeLng, setHomeLng] = useState(user?.home_lng ?? null);

  // Seguridad
  const [loginUsername,    setLoginUsername]    = useState(user?.username || '');
  const [currentPassword,  setCurrentPassword]  = useState('');
  const [newPassword,      setNewPassword]       = useState('');
  const [confirmPassword,  setConfirmPassword]   = useState('');
  const [pwdMsg,  setPwdMsg]  = useState('');
  const [pwdErr,  setPwdErr]  = useState(false);

  // Eliminar cuenta
  const [deleteMsg, setDeleteMsg] = useState('');
  const [deleteErr, setDeleteErr] = useState(false);

  // Buscar CP cuando cambia (debounce 600ms)
  useEffect(() => {
    const cp = postalCode.trim();
    if (cp.length !== 5 || !/^\d{5}$/.test(cp)) {
      setColoniasList([]);
      return;
    }
    clearTimeout(cpTimerRef.current);
    cpTimerRef.current = setTimeout(async () => {
      setCpLoading(true);
      setCpError('');
      const result = await fetchColoniasByPostal(cp);
      setCpLoading(false);
      if (!result) {
        setCpError('CP no encontrado — ingresa estado, ciudad y colonia manualmente');
        setColoniasList([]);
      } else {
        setEstado(result.estado || '');
        setCiudad(result.ciudad || '');
        setColoniasList(result.colonias || []);
        // Si la colonia actual no está en la lista nueva, limpiar
        if (result.colonias && result.colonias.length > 0 && !result.colonias.includes(colonia)) {
          setColonia('');
        }
      }
    }, 600);
    return () => clearTimeout(cpTimerRef.current);
  }, [postalCode]);

  // Geocodificar dirección → home_lat/home_lng al guardar
  const geocodeAddress = useCallback(async (fullAddress) => {
    try {
      const q = encodeURIComponent(fullAddress + ', México');
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${q}&limit=1`);
      const data = await r.json();
      if (data.length > 0) {
        return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      }
    } catch {}
    return null;
  }, []);

  async function saveProfile() {
    if (!alias.trim()) { setProfileMsg('El nombre no puede estar vacío'); setProfileErr(true); return; }
    try {
      // Construir dirección compuesta si tenemos los campos estructurados
      let finalAddress = address.trim();
      if (colonia && ciudad && estado) {
        const parts = [colonia, ciudad, estado, postalCode].filter(Boolean);
        finalAddress = finalAddress || parts.join(', ');
      }

      // Geocodificar para obtener pin Casa si tenemos dirección
      let newHomeLat = homeLat;
      let newHomeLng = homeLng;
      if (finalAddress && (!homeLat || !homeLng)) {
        const coords = await geocodeAddress(finalAddress);
        if (coords) { newHomeLat = coords.lat; newHomeLng = coords.lng; }
      }

      const body = {
        displayName:  alias.trim(),
        address:      finalAddress || undefined,
        postalCode:   postalCode   || undefined,
        colonia:      colonia      || undefined,
        estado:       estado       || undefined,
        ciudad:       ciudad       || undefined,
        homeLat:      newHomeLat   ?? undefined,
        homeLng:      newHomeLng   ?? undefined,
      };

      const data = await apiFetch('/auth/profile', { method:'PATCH', body: JSON.stringify(body) }, auth.token);
      patchUser({
        alias:        data.profile.alias ?? data.profile.displayName,
        full_name:    data.profile.alias ?? data.profile.displayName,
        address:      data.profile.address,
        postal_code:  data.profile.postal_code,
        colonia:      data.profile.colonia,
        estado:       data.profile.estado,
        ciudad:       data.profile.ciudad,
        home_lat:     data.profile.home_lat,
        home_lng:     data.profile.home_lng,
      });
      const newAlias = data.profile.alias ?? data.profile.displayName;
      if (newAlias)               setAlias(newAlias);
      if (data.profile.address)   setAddress(data.profile.address);
      if (data.profile.home_lat)  setHomeLat(data.profile.home_lat);
      if (data.profile.home_lng)  setHomeLng(data.profile.home_lng);
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
      if (changingPwd) {
        await apiFetch('/auth/password', { method:'PATCH', body: JSON.stringify({ currentPassword, newPassword }) }, auth.token);
      }
      if (changingUser) {
        await apiFetch('/auth/login-username', { method:'PATCH', body: JSON.stringify({ currentPassword, newUsername: loginUsername.trim() }) }, auth.token);
        patchUser({ username: loginUsername.trim() });
      }
      setPwdMsg(changingPwd && changingUser ? 'Contraseña y usuario actualizados' : changingPwd ? 'Contraseña actualizada' : 'Usuario de acceso actualizado');
      setPwdErr(false);
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    } catch (e) { setPwdMsg(e.message); setPwdErr(true); }
  }

  async function deleteAccount() {
    if (!window.confirm('¿Eliminar tu cuenta permanentemente? Esta acción no se puede deshacer.')) return;
    try {
      await apiFetch('/auth/account', { method:'DELETE' }, auth.token);
      logout();
    } catch (e) { setDeleteMsg(e.message); setDeleteErr(true); }
  }

  const avatarLetter = (alias[0] || '?').toUpperCase();
  const hasHomePin = homeLat && homeLng;

  return (
    <div>
      <h2 style={{ fontSize:'1.1rem', fontWeight:800, marginBottom:'1.25rem' }}>Mi perfil</h2>

      {/* Tarjeta de cuenta */}
      <div className="card" style={{ marginBottom:'0.75rem', display:'flex', gap:'0.75rem', alignItems:'center' }}>
        <div style={{ width:44, height:44, borderRadius:'50%', background:'var(--brand-light)', border:'2px solid var(--brand)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
          <span style={{ fontWeight:800, fontSize:'1.1rem', color:'var(--brand)' }}>{avatarLetter}</span>
        </div>
        <div>
          <div style={{ fontWeight:700 }}>{alias}</div>
          <div style={{ fontSize:'0.8rem', color:'var(--gray-600)' }}>{ROLE_LABELS[user?.role] || user?.role}</div>
        </div>
      </div>

      {/* Datos personales */}
      <Collapsible title="Datos personales" defaultOpen={false}>
        <p style={{ fontSize:'0.8rem', color:'var(--gray-500)', marginBottom:'0.65rem' }}>
          Este nombre se muestra a otros usuarios en la plataforma.
        </p>
        <div style={{ display:'flex', flexDirection:'column', gap:'0.55rem', marginBottom:'0.65rem' }}>

          <label>
            Nombre para mostrar
            <input value={alias} onChange={e => setAlias(e.target.value)} placeholder="Ej: Juan García" />
          </label>

          {/* Código postal */}
          <label>
            Código postal
            <div style={{ position:'relative' }}>
              <input
                value={postalCode}
                onChange={e => setPostalCode(e.target.value.replace(/\D/g, '').slice(0, 5))}
                placeholder="Ej: 44100"
                maxLength={5}
                inputMode="numeric"
              />
              {cpLoading && (
                <span style={{ position:'absolute', right:'0.6rem', top:'50%', transform:'translateY(-50%)', fontSize:'0.75rem', color:'var(--gray-400)' }}>
                  Buscando…
                </span>
              )}
            </div>
            {cpError && <span style={{ fontSize:'0.72rem', color:'var(--error)', marginTop:'0.2rem', display:'block' }}>{cpError}</span>}
          </label>

          {/* Estado y Ciudad — auto-rellenados o manuales */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.55rem' }}>
            <label>
              Estado
              <input value={estado} onChange={e => setEstado(e.target.value)} placeholder="Jalisco" />
            </label>
            <label>
              Municipio / Ciudad
              <input value={ciudad} onChange={e => setCiudad(e.target.value)} placeholder="Guadalajara" />
            </label>
          </div>

          {/* Colonia — dropdown si hay datos del CP, input manual si no */}
          <label>
            Colonia
            {coloniasList.length > 0 ? (
              <div style={{ display:'flex', gap:'0.4rem', alignItems:'center' }}>
                <select
                  value={colonia}
                  onChange={e => setColonia(e.target.value)}
                  style={{ flex:1 }}
                >
                  <option value="">Seleccionar colonia…</option>
                  {coloniasList.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            ) : (
              <input value={colonia} onChange={e => setColonia(e.target.value)} placeholder="Ej: Col. Centro" />
            )}
            {coloniasList.length > 0 && (
              <span style={{ fontSize:'0.72rem', color:'var(--gray-400)', marginTop:'0.2rem', display:'block' }}>
                O escribe directamente:
                <input
                  value={colonia}
                  onChange={e => setColonia(e.target.value)}
                  placeholder="Colonia manual"
                  style={{ marginTop:'0.25rem' }}
                />
              </span>
            )}
          </label>

          {/* Calle y número */}
          <label>
            Calle y número
            <input value={address} onChange={e => setAddress(e.target.value)}
              placeholder="Ej: Av. Revolución 1234" />
          </label>

          {/* Pin Casa */}
          {hasHomePin && (
            <div style={{ fontSize:'0.78rem', color:'var(--gray-500)', background:'var(--gray-100)', borderRadius:6, padding:'0.5rem 0.75rem', display:'flex', alignItems:'center', gap:'0.4rem' }}>
              <span>🏠</span>
              <span>Pin Casa guardado · {homeLat?.toFixed(5)}, {homeLng?.toFixed(5)}</span>
              <button
                onClick={() => { setHomeLat(null); setHomeLng(null); }}
                style={{ marginLeft:'auto', background:'none', border:'none', color:'var(--error)', cursor:'pointer', fontSize:'0.75rem', fontWeight:600 }}
              >
                Borrar pin
              </button>
            </div>
          )}
          {!hasHomePin && address && (
            <p style={{ fontSize:'0.72rem', color:'var(--gray-400)', margin:0 }}>
              Al guardar se intentará geocodificar tu dirección para el pin Casa.
            </p>
          )}
        </div>
        <button className="btn-primary btn-sm" onClick={saveProfile}>Guardar cambios</button>
        <Flash text={profileMsg} isError={profileErr} />
      </Collapsible>

      {/* Seguridad */}
      <Collapsible title="Seguridad">
        <p style={{ fontSize:'0.8rem', color:'var(--gray-500)', marginBottom:'0.65rem' }}>
          El usuario de acceso es el que usas para iniciar sesión. Es distinto al nombre que ven otros usuarios.
        </p>
        <div style={{ display:'flex', flexDirection:'column', gap:'0.55rem', marginBottom:'0.65rem' }}>
          <label>
            Usuario de acceso
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

      {/* Cerrar sesión */}
      <button
        onClick={logout}
        className="btn-sm"
        style={{
          width:'100%', padding:'0.7rem',
          marginBottom:'0.75rem',
          fontWeight:700, fontSize:'0.9rem',
        }}
      >
        Cerrar sesión
      </button>

      {/* Administración */}
      <Collapsible title="Administración de cuenta">
        <p style={{ fontSize:'0.85rem', color:'var(--gray-600)', marginBottom:'0.75rem' }}>
          Eliminar tu cuenta es permanente. No podrás recuperarla ni tienes pedidos activos pendientes.
        </p>
        <button className="btn-danger btn-sm" onClick={deleteAccount}>Eliminar cuenta</button>
        <Flash text={deleteMsg} isError={deleteErr} />
      </Collapsible>
    </div>
  );
}
