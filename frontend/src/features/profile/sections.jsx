import { PasswordStrength } from '../../utils/passwordUtils.jsx';
import { Collapsible, CPSearchBar, Flash, ROLE_LABELS } from './components';

export function ProfileHeaderCard({ alias, avatarLetter, role }) {
  return (
    <div className="card" style={{ marginBottom:'0.75rem', display:'flex', gap:'0.75rem', alignItems:'center' }}>
      <div style={{ width:44, height:44, borderRadius:'50%', background:'var(--brand-light)', border:'2px solid var(--brand)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
        <span style={{ fontWeight:800, fontSize:'1.1rem', color:'var(--brand)' }}>{avatarLetter}</span>
      </div>
      <div>
        <div style={{ fontWeight:700 }}>{alias}</div>
        <div style={{ fontSize:'0.8rem', color:'var(--gray-600)' }}>{ROLE_LABELS[role] || role}</div>
      </div>
    </div>
  );
}

export function PersonalInfoSection({
  authToken,
  alias,
  setAlias,
  homeLat,
  homeLng,
  onSelectAddress,
  estado,
  setEstado,
  ciudad,
  setCiudad,
  colonia,
  setColonia,
  coloniasList,
  calle,
  setCalle,
  numero,
  setNumero,
  onClearHomePin,
  onSave,
  message,
  isError,
}) {
  return (
    <Collapsible title="Datos personales" defaultOpen={false}>
      <p style={{ fontSize:'0.8rem', color:'var(--gray-500)', marginBottom:'0.65rem' }}>
        Este nombre se muestra a otros usuarios en la plataforma.
      </p>
      <div style={{ display:'flex', flexDirection:'column', gap:'0.55rem', marginBottom:'0.65rem' }}>
        <label>
          Nombre para mostrar
          <input value={alias} onChange={e => setAlias(e.target.value)} placeholder="Ej: Juan García" />
        </label>

        <div>
          <span style={{ fontSize:'0.875rem', fontWeight:500, display:'block', marginBottom:'0.3rem' }}>Código postal</span>
          <CPSearchBar token={authToken} homeLat={homeLat} homeLng={homeLng} onSelectAddress={onSelectAddress} />
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.55rem' }}>
          <label>
            Estado
            <input value={estado} onChange={e => setEstado(e.target.value)} placeholder="Michoacán" />
          </label>
          <label>
            Municipio / Ciudad
            <input value={ciudad} onChange={e => setCiudad(e.target.value)} placeholder="Morelia" />
          </label>
        </div>

        <label>
          Colonia
          {coloniasList.length > 0 ? (
            <select value={colonia} onChange={e => setColonia(e.target.value)}>
              <option value="">Seleccionar colonia…</option>
              {coloniasList.map(item => <option key={item} value={item}>{item}</option>)}
            </select>
          ) : (
            <input value={colonia} onChange={e => setColonia(e.target.value)} placeholder="Ej: Col. Centro" />
          )}
        </label>

        <div style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:'0.55rem', alignItems:'end' }}>
          <label>
            Calle
            <input value={calle} onChange={e => setCalle(e.target.value)} placeholder="Ej: Av. Revolución" />
          </label>
          <label style={{ width:90 }}>
            Número
            <input value={numero} onChange={e => setNumero(e.target.value)} placeholder="1234" />
          </label>
        </div>

        {homeLat && homeLng && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'0.5rem' }}>
            <span style={{ fontSize:'0.75rem', color:'var(--success)', fontWeight:600 }}>🏠 Ubicación guardada</span>
            <button type="button" style={{ background:'none', border:'none', color:'var(--error)', cursor:'pointer', fontSize:'0.75rem', fontWeight:600 }} onClick={onClearHomePin}>
              Borrar
            </button>
          </div>
        )}
      </div>
      <button className="btn-primary btn-sm" onClick={onSave}>Guardar cambios</button>
      <Flash text={message} isError={isError} />
    </Collapsible>
  );
}

export function ProfileSettingsSection({
  userRole,
  permStatus,
  permLoading,
  permMsg,
  notifStatus,
  notifEnabled,
  highPriorityNotifs,
  notifMsg,
  onToggleNotifEnabled,
  onToggleHighPriority,
  onRequestWakeLock,
  onRequestAllPermissions,
  theme,
  onApplyTheme,
  reducedMotion,
  onToggleReducedMotion,
  isInstalled,
  deferredInstall,
  onTriggerInstallPrompt,
  onRefreshOfflineCache,
  offlineCacheMsg,
}) {
  return (
    <Collapsible title="Configuración">
      <div style={{ display:'flex', flexDirection:'column', gap:'0.75rem' }}>
        <div>
          <p style={{ fontSize:'0.72rem', fontWeight:700, color:'var(--text-tertiary)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'0.4rem' }}>
            Permisos del sistema
          </p>
          <div style={{ display:'flex', flexDirection:'column', gap:'0.4rem' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:'0.5rem', flexWrap:'wrap' }}>
              <div>
                <span style={{ fontSize:'0.82rem', color:'var(--gray-600)' }}>Notificaciones push</span>
                <span style={{ display:'block', fontSize:'0.72rem', color:
                  notifStatus === 'granted' ? 'var(--success)'
                  : notifStatus === 'denied' ? 'var(--danger)'
                  : 'var(--text-tertiary)' }}>
                  {notifStatus === 'granted' ? (notifEnabled ? '● Activo' : '● Pausado')
                    : notifStatus === 'denied' ? '● Bloqueado — activa en ajustes del navegador'
                    : notifStatus === 'default' ? '● Pendiente'
                    : '● No soportado'}
                </span>
              </div>
              <button type="button" className="btn-sm" onClick={onToggleNotifEnabled} disabled={notifStatus === 'denied' || notifStatus === 'unsupported'}>
                {notifStatus === 'granted' && notifEnabled ? 'Pausar' : 'Activar'}
              </button>
            </div>

            {notifStatus === 'granted' && (
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:'0.5rem', flexWrap:'wrap' }}>
                <div>
                  <span style={{ fontSize:'0.82rem', color:'var(--gray-600)' }}>Alta prioridad</span>
                  <span style={{ display:'block', fontSize:'0.72rem', color:'var(--text-tertiary)' }}>
                    Vibración y sonido más intensos
                  </span>
                </div>
                <button type="button" className="btn-sm" onClick={onToggleHighPriority}>
                  {highPriorityNotifs ? 'Activada' : 'Desactivada'}
                </button>
              </div>
            )}

            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:'0.5rem', flexWrap:'wrap' }}>
              <div>
                <span style={{ fontSize:'0.82rem', color:'var(--gray-600)' }}>Ubicación</span>
                <span style={{ display:'block', fontSize:'0.72rem', color:
                  permStatus.geolocation === 'granted' ? 'var(--success)'
                  : permStatus.geolocation === 'denied' ? 'var(--danger)'
                  : 'var(--text-tertiary)' }}>
                  {permStatus.geolocation === 'granted' ? '● Activa'
                    : permStatus.geolocation === 'denied' ? '● Bloqueada — activa en ajustes'
                    : permStatus.geolocation === 'unsupported' ? '● No soportada'
                    : '● Pendiente'}
                </span>
              </div>
            </div>

            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:'0.5rem', flexWrap:'wrap' }}>
              <div>
                <span style={{ fontSize:'0.82rem', color:'var(--gray-600)' }}>Caché persistente</span>
                <span style={{ display:'block', fontSize:'0.72rem', color:
                  permStatus.persistentStorage === 'granted' ? 'var(--success)' : 'var(--text-tertiary)' }}>
                  {permStatus.persistentStorage === 'granted'
                    ? '● Activo — los datos offline no se borrarán'
                    : '● Inactivo — el OS puede limpiar el caché'}
                </span>
              </div>
            </div>

            {userRole === 'driver' && permStatus.wakeLock !== 'unsupported' && (
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:'0.5rem', flexWrap:'wrap' }}>
                <div>
                  <span style={{ fontSize:'0.82rem', color:'var(--gray-600)' }}>Pantalla activa en ruta</span>
                  <span style={{ display:'block', fontSize:'0.72rem', color:
                    permStatus.wakeLock === 'active' ? 'var(--success)' : 'var(--text-tertiary)' }}>
                    {permStatus.wakeLock === 'active' ? '● Activa — la pantalla no se apagará' : '● Inactiva'}
                  </span>
                </div>
                <button type="button" className="btn-sm" onClick={onRequestWakeLock}>
                  {permStatus.wakeLock === 'active' ? 'Desactivar' : 'Activar'}
                </button>
              </div>
            )}

            <button type="button" className="btn-sm btn-primary" onClick={onRequestAllPermissions} disabled={permLoading} style={{ marginTop:'0.25rem', alignSelf:'flex-start' }}>
              {permLoading ? 'Configurando…' : '↺ Solicitar todos los permisos'}
            </button>

            {(permMsg || notifMsg) && (
              <div style={{ fontSize:'0.74rem', color:'var(--gray-500)' }}>
                {permMsg || notifMsg}
              </div>
            )}
          </div>
        </div>

        <div>
          <p style={{ fontSize:'0.72rem', fontWeight:700, color:'var(--text-tertiary)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'0.4rem' }}>
            Apariencia
          </p>
          <div style={{ display:'flex', flexDirection:'column', gap:'0.4rem' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:'0.5rem', flexWrap:'wrap' }}>
              <span style={{ fontSize:'0.82rem', color:'var(--gray-600)' }}>Tema</span>
              <div style={{ display:'flex', gap:'0.25rem' }}>
                {[['system','Auto'],['light','Claro'],['dark','Oscuro']].map(([val, label]) => (
                  <button key={val} type="button" onClick={() => onApplyTheme(val)}
                    style={{ padding:'0.2rem 0.55rem', fontSize:'0.75rem', cursor:'pointer',
                      border:`1.5px solid ${theme === val ? 'var(--brand)' : 'var(--border)'}`,
                      borderRadius:6,
                      background: theme === val ? 'var(--brand-light)' : 'var(--bg-card)',
                      color: theme === val ? 'var(--brand)' : 'var(--text-secondary)',
                      fontWeight: theme === val ? 700 : 400, minHeight:'unset' }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:'0.5rem', flexWrap:'wrap' }}>
              <span style={{ fontSize:'0.82rem', color:'var(--gray-600)' }}>Reducir animaciones</span>
              <button type="button" className="btn-sm" onClick={onToggleReducedMotion}>
                {reducedMotion ? 'Activado' : 'Desactivado'}
              </button>
            </div>
          </div>
        </div>

        <div>
          <p style={{ fontSize:'0.72rem', fontWeight:700, color:'var(--text-tertiary)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'0.4rem' }}>
            Aplicación
          </p>
          <div style={{ display:'flex', flexDirection:'column', gap:'0.4rem' }}>
            {!isInstalled && deferredInstall && (
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:'0.5rem', flexWrap:'wrap' }}>
                <span style={{ fontSize:'0.82rem', color:'var(--gray-600)' }}>Instalar en pantalla de inicio</span>
                <button type="button" className="btn-sm btn-primary" onClick={onTriggerInstallPrompt}>
                  Instalar
                </button>
              </div>
            )}
            {isInstalled && (
              <div style={{ fontSize:'0.82rem', color:'var(--success)', fontWeight:600 }}>
                ✓ App instalada
              </div>
            )}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:'0.5rem', flexWrap:'wrap' }}>
              <span style={{ fontSize:'0.82rem', color:'var(--gray-600)' }}>Verificar actualización</span>
              <button type="button" className="btn-sm" onClick={onRefreshOfflineCache}>
                Actualizar
              </button>
            </div>
            {offlineCacheMsg && <div style={{ fontSize:'0.74rem', color:'var(--gray-500)' }}>{offlineCacheMsg}</div>}
          </div>
        </div>
      </div>
    </Collapsible>
  );
}

export function ProfileSecuritySection({
  loginUsername,
  onChangeUsername,
  usernameStatus,
  currentPassword,
  setCurrentPassword,
  newPassword,
  setNewPassword,
  confirmPassword,
  setConfirmPassword,
  onSave,
  message,
  isError,
}) {
  return (
    <Collapsible title="Seguridad">
      <p style={{ fontSize:'0.8rem', color:'var(--gray-500)', marginBottom:'0.65rem' }}>
        El nombre de usuario es público y visible en la plataforma. La contraseña protege el acceso a tu cuenta.
      </p>
      <div style={{ display:'flex', flexDirection:'column', gap:'0.55rem', marginBottom:'0.65rem' }}>
        <div>
          <label style={{ display:'block', marginBottom:'0.25rem' }}>
            Nombre de usuario
          </label>
          <div style={{ position:'relative' }}>
            <input value={loginUsername} onChange={e => onChangeUsername(e.target.value)} placeholder="Ej: juangarcia91" autoComplete="username" style={{ paddingRight: '2.2rem' }} />
            {usernameStatus === 'checking' && (
              <span style={{ position:'absolute', right:'0.6rem', top:'50%', transform:'translateY(-50%)', fontSize:'0.72rem', color:'var(--text-tertiary)' }}>…</span>
            )}
            {usernameStatus === 'available' && (
              <span style={{ position:'absolute', right:'0.6rem', top:'50%', transform:'translateY(-50%)', fontSize:'0.8rem', color:'var(--success)' }}>✓</span>
            )}
            {usernameStatus === 'taken' && (
              <span style={{ position:'absolute', right:'0.6rem', top:'50%', transform:'translateY(-50%)', fontSize:'0.8rem', color:'var(--error)' }}>✗</span>
            )}
          </div>
          {usernameStatus === 'taken' && (
            <span style={{ fontSize:'0.72rem', color:'var(--error)', marginTop:'0.2rem', display:'block' }}>Ese nombre ya está en uso</span>
          )}
          {usernameStatus === 'error' && loginUsername.trim().length < 3 && (
            <span style={{ fontSize:'0.72rem', color:'var(--error)', marginTop:'0.2rem', display:'block' }}>Mínimo 3 caracteres</span>
          )}
        </div>
        <label>
          Contraseña actual <span style={{ fontWeight:400, color:'var(--text-tertiary)', fontSize:'0.78rem' }}>(requerida para guardar cambios)</span>
          <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} autoComplete="current-password" />
        </label>
        <label>
          Nueva contraseña <span style={{ fontWeight:400, color:'var(--text-tertiary)', fontSize:'0.78rem' }}>(opcional)</span>
          <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} autoComplete="new-password" placeholder="Dejar vacío para no cambiar" />
        </label>
        {newPassword && (
          <>
            <PasswordStrength pwd={newPassword} />
            <label>
              Confirmar nueva contraseña
              <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} autoComplete="new-password" />
            </label>
          </>
        )}
      </div>
      <button className="btn-primary btn-sm" onClick={onSave} disabled={usernameStatus === 'checking' || usernameStatus === 'taken'}>
        Guardar cambios
      </button>
      <Flash text={message} isError={isError} />
    </Collapsible>
  );
}

export function AccountManagementSection({
  deleteConfirm,
  onDeleteAccount,
  deletePwd,
  setDeletePwd,
  deleteLoading,
  onCancelDelete,
  message,
  isError,
}) {
  return (
    <Collapsible title="Administración de cuenta">
      <p style={{ fontSize:'0.85rem', color:'var(--gray-600)', marginBottom:'0.75rem' }}>
        Eliminar tu cuenta es permanente e irreversible.
      </p>
      {!deleteConfirm ? (
        <button className="btn-danger btn-sm" onClick={onDeleteAccount}>Eliminar cuenta</button>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
          <p style={{ fontSize:'0.82rem', color:'var(--error)', fontWeight:600, margin:0 }}>
            ¿Seguro? Esta acción no se puede deshacer.
          </p>
          <label style={{ fontSize:'0.82rem' }}>
            Ingresa tu contraseña para confirmar
            <input type="password" value={deletePwd} onChange={e => setDeletePwd(e.target.value)} autoComplete="current-password" placeholder="Tu contraseña" style={{ marginTop:'0.25rem' }} />
          </label>
          <div style={{ display:'flex', gap:'0.5rem' }}>
            <button className="btn-danger btn-sm" onClick={onDeleteAccount} disabled={deleteLoading}>
              {deleteLoading ? 'Eliminando…' : 'Confirmar eliminación'}
            </button>
            <button className="btn-sm" onClick={onCancelDelete}>
              Cancelar
            </button>
          </div>
        </div>
      )}
      <Flash text={message} isError={isError} />
    </Collapsible>
  );
}
