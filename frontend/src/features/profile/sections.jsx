// frontend/src/features/profile/sections.jsx
import { PasswordStrength } from '../../utils/passwordUtils.jsx';
import { Collapsible, CPSearchBar, Flash, ROLE_LABELS } from './components';

// ── Icons ─────────────────────────────────────────────────────────────────────
function IconCheck() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>;
}
function IconX() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
}
function IconDot() {
  return <svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" fill="currentColor"/></svg>;
}

export function ProfileHeaderCard({ alias, avatarLetter, role }) {
  return (
    <div className="card" style={{ marginBottom: '0.75rem', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
      <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--brand-light)',
        border: '2px solid var(--brand)', display: 'flex', alignItems: 'center',
        justifyContent: 'center', flexShrink: 0 }}>
        <span style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--brand)' }}>{avatarLetter}</span>
      </div>
      <div>
        <div style={{ fontWeight: 700 }}>{alias}</div>
        <div style={{ fontSize: '0.8rem', color: 'var(--gray-600)' }}>{ROLE_LABELS[role] || role}</div>
      </div>
    </div>
  );
}

export function PersonalInfoSection({
  authToken, alias, setAlias,
  homeLat, homeLng, onSelectAddress,
  estado, setEstado, ciudad, setCiudad,
  colonia, setColonia, coloniasList,
  calle, setCalle, numero, setNumero,
  onClearHomePin, onSave, message, isError,
}) {
  return (
    <Collapsible title="Datos personales" defaultOpen={false}>
      <p style={{ fontSize: '0.8rem', color: 'var(--gray-500)', marginBottom: '0.65rem' }}>
        Este nombre se muestra a otros usuarios en la plataforma.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem', marginBottom: '0.65rem' }}>
        <label>
          Nombre para mostrar
          <input value={alias} onChange={e => setAlias(e.target.value)} placeholder="Ej: Juan García" />
        </label>

        <div>
          <span style={{ fontSize: '0.875rem', fontWeight: 500, display: 'block', marginBottom: '0.3rem' }}>
            Código postal
          </span>
          <CPSearchBar token={authToken} homeLat={homeLat} homeLng={homeLng} onSelectAddress={onSelectAddress} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.55rem' }}>
          <label>Estado<input value={estado} onChange={e => setEstado(e.target.value)} placeholder="Michoacán" /></label>
          <label>Municipio / Ciudad<input value={ciudad} onChange={e => setCiudad(e.target.value)} placeholder="Morelia" /></label>
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

        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.55rem', alignItems: 'end' }}>
          <label>Calle<input value={calle} onChange={e => setCalle(e.target.value)} placeholder="Ej: Av. Revolución" /></label>
          <label style={{ width: 90 }}>Número<input value={numero} onChange={e => setNumero(e.target.value)} placeholder="1234" /></label>
        </div>

        {homeLat && homeLng && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--success)', fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <IconCheck /> Ubicación de casa guardada
            </span>
            <button type="button"
              style={{ background: 'none', border: 'none', color: 'var(--error)',
                cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}
              onClick={onClearHomePin}>
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

// ── PermRow ───────────────────────────────────────────────────────────────────
function PermRow({ label, sub, status, statusLabel, onAction, actionLabel, disabled }) {
  const isGranted = status === 'granted' || status === 'active';
  const isDenied  = status === 'denied'  || status === 'blocked';
  const color     = isGranted ? 'var(--success)' : isDenied ? 'var(--danger)' : 'var(--text-tertiary)';
  const Icon      = isGranted ? IconCheck : isDenied ? IconX : IconDot;

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      gap: '0.5rem', flexWrap: 'wrap', padding: '0.4rem 0',
      borderBottom: '1px solid var(--border-light)' }}>
      <div>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 500 }}>{label}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem',
          fontSize: '0.72rem', color, marginTop: 1 }}>
          <Icon /> {statusLabel}
        </span>
        {sub && <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>{sub}</span>}
      </div>
      {onAction && (
        <button type="button" className="btn-sm" onClick={onAction} disabled={disabled}>
          {actionLabel}
        </button>
      )}
    </div>
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
  isInstalled,
  deferredInstall,
  onTriggerInstallPrompt,
  onRefreshOfflineCache,
  offlineCacheMsg,
}) {
  function notifLabel() {
    if (notifStatus === 'granted') return notifEnabled ? 'Activas' : 'Pausadas temporalmente';
    if (notifStatus === 'denied')  return 'Bloqueadas — actívalas en ajustes del navegador';
    if (notifStatus === 'default') return 'Pendiente de activar';
    return 'No soportadas en este navegador';
  }
  function geoLabel() {
    if (permStatus.geolocation === 'granted')     return 'Activa';
    if (permStatus.geolocation === 'denied')      return 'Bloqueada — actívala en ajustes';
    if (permStatus.geolocation === 'unsupported') return 'No disponible';
    return 'Pendiente';
  }
  function storageLabel() {
    return permStatus.persistentStorage === 'granted'
      ? 'Activo — el caché no se borrará automáticamente'
      : 'Inactivo — el sistema puede limpiar el caché';
  }
  function wakeLockLabel() {
    if (permStatus.wakeLock === 'active')      return 'Activa — la pantalla permanecerá encendida';
    if (permStatus.wakeLock === 'unsupported') return 'No disponible en este dispositivo';
    return 'Inactiva';
  }

  const notifPermStatus = notifStatus === 'granted' && notifEnabled ? 'active'
    : notifStatus === 'denied' ? 'denied' : 'default';

  return (
    <Collapsible title="Configuración">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

        {/* Permisos */}
        <div>
          <p style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
            Permisos del sistema
          </p>

          <PermRow
            label="Notificaciones"
            status={notifPermStatus}
            statusLabel={notifLabel()}
            onAction={onToggleNotifEnabled}
            actionLabel={notifStatus === 'granted' && notifEnabled ? 'Pausar' : 'Activar'}
            disabled={notifStatus === 'denied' || notifStatus === 'unsupported'}
          />

          {notifStatus === 'granted' && (
            <PermRow
              label="Alta prioridad"
              sub="Vibración y sonido más intensos para ofertas y alertas"
              status={highPriorityNotifs ? 'active' : 'default'}
              statusLabel={highPriorityNotifs ? 'Activada' : 'Desactivada'}
              onAction={onToggleHighPriority}
              actionLabel={highPriorityNotifs ? 'Desactivar' : 'Activar'}
            />
          )}

          <PermRow
            label="Ubicación GPS"
            sub={userRole === 'driver'
              ? 'Necesaria para recibir y gestionar pedidos'
              : 'Mejora la precisión de tu dirección de entrega'}
            status={permStatus.geolocation}
            statusLabel={geoLabel()}
          />

          <PermRow
            label="Caché persistente"
            sub="Evita que el sistema operativo borre la app en segundo plano"
            status={permStatus.persistentStorage}
            statusLabel={storageLabel()}
          />

          {userRole === 'driver' && permStatus.wakeLock !== 'unsupported' && (
            <PermRow
              label="Pantalla activa en ruta"
              sub="Mantiene la pantalla encendida mientras repartes"
              status={permStatus.wakeLock}
              statusLabel={wakeLockLabel()}
              onAction={onRequestWakeLock}
              actionLabel={permStatus.wakeLock === 'active' ? 'Desactivar' : 'Activar'}
            />
          )}

          <div style={{ marginTop: '0.75rem' }}>
            <button type="button" className="btn-sm btn-primary"
              onClick={onRequestAllPermissions} disabled={permLoading}>
              {permLoading ? 'Configurando…' : 'Solicitar todos los permisos'}
            </button>
            {(permMsg || notifMsg) && (
              <p style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)', marginTop: '0.4rem' }}>
                {permMsg || notifMsg}
              </p>
            )}
          </div>
        </div>

        {/* Apariencia */}
        <div>
          <p style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
            Apariencia
          </p>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>Tema</span>
            <div style={{ display: 'flex', gap: '0.25rem' }}>
              {[['system','Auto'],['light','Claro'],['dark','Oscuro']].map(([val, label]) => (
                <button key={val} type="button" onClick={() => onApplyTheme(val)}
                  style={{ padding: '0.2rem 0.55rem', fontSize: '0.78rem', cursor: 'pointer',
                    border: `1.5px solid ${theme === val ? 'var(--brand)' : 'var(--border)'}`,
                    borderRadius: 6,
                    background: theme === val ? 'var(--brand-light)' : 'var(--bg-card)',
                    color: theme === val ? 'var(--brand)' : 'var(--text-secondary)',
                    fontWeight: theme === val ? 700 : 400, minHeight: 'unset' }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Aplicación */}
        <div>
          <p style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
            Aplicación
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {isInstalled ? (
              <p style={{ fontSize: '0.82rem', color: 'var(--success)', fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <IconCheck /> Instalada en pantalla de inicio
              </p>
            ) : deferredInstall ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.85rem' }}>Instalar en pantalla de inicio</span>
                <button type="button" className="btn-sm btn-primary" onClick={onTriggerInstallPrompt}>
                  Instalar
                </button>
              </div>
            ) : null}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.85rem' }}>Verificar actualización</span>
              <button type="button" className="btn-sm" onClick={onRefreshOfflineCache}>Actualizar</button>
            </div>
            {offlineCacheMsg && (
              <p style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)' }}>{offlineCacheMsg}</p>
            )}
          </div>
        </div>

      </div>
    </Collapsible>
  );
}

export function ProfileSecuritySection({
  loginUsername, onChangeUsername, usernameStatus,
  currentPassword, setCurrentPassword,
  newPassword, setNewPassword,
  confirmPassword, setConfirmPassword,
  onSave, message, isError,
}) {
  return (
    <Collapsible title="Seguridad">
      <p style={{ fontSize: '0.8rem', color: 'var(--gray-500)', marginBottom: '0.65rem' }}>
        El nombre de usuario es visible en la plataforma. La contraseña protege el acceso a tu cuenta.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem', marginBottom: '0.65rem' }}>
        <div>
          <label style={{ display: 'block', marginBottom: '0.25rem' }}>Nombre de usuario</label>
          <div style={{ position: 'relative' }}>
            <input value={loginUsername} onChange={e => onChangeUsername(e.target.value)}
              placeholder="Ej: juangarcia91" autoComplete="username"
              style={{ paddingRight: '2.2rem' }} />
            {usernameStatus === 'checking'  && <span style={{ position: 'absolute', right: '0.6rem', top: '50%', transform: 'translateY(-50%)', fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>…</span>}
            {usernameStatus === 'available' && <span style={{ position: 'absolute', right: '0.6rem', top: '50%', transform: 'translateY(-50%)', fontSize: '0.8rem', color: 'var(--success)' }}>✓</span>}
            {usernameStatus === 'taken'     && <span style={{ position: 'absolute', right: '0.6rem', top: '50%', transform: 'translateY(-50%)', fontSize: '0.8rem', color: 'var(--error)' }}>✗</span>}
          </div>
          {usernameStatus === 'taken' && (
            <span style={{ fontSize: '0.72rem', color: 'var(--error)', marginTop: '0.2rem', display: 'block' }}>
              Ese nombre ya está en uso
            </span>
          )}
        </div>
        <label>
          Contraseña actual{' '}
          <span style={{ fontWeight: 400, color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>
            (requerida para guardar cambios)
          </span>
          <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)}
            autoComplete="current-password" />
        </label>
        <label>
          Nueva contraseña{' '}
          <span style={{ fontWeight: 400, color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>
            (opcional)
          </span>
          <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
            autoComplete="new-password" placeholder="Dejar vacío para no cambiar" />
        </label>
        {newPassword && (
          <>
            <PasswordStrength pwd={newPassword} />
            <label>
              Confirmar nueva contraseña
              <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                autoComplete="new-password" />
            </label>
          </>
        )}
      </div>
      <button className="btn-primary btn-sm" onClick={onSave}
        disabled={usernameStatus === 'checking' || usernameStatus === 'taken'}>
        Guardar cambios
      </button>
      <Flash text={message} isError={isError} />
    </Collapsible>
  );
}

export function AccountManagementSection({
  deleteConfirm, onDeleteAccount, deletePwd, setDeletePwd,
  deleteLoading, onCancelDelete, message, isError,
}) {
  return (
    <Collapsible title="Administración de cuenta">
      <p style={{ fontSize: '0.85rem', color: 'var(--gray-600)', marginBottom: '0.75rem' }}>
        Eliminar tu cuenta es permanente e irreversible.
      </p>
      {!deleteConfirm ? (
        <button className="btn-danger btn-sm" onClick={onDeleteAccount}>Eliminar cuenta</button>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <p style={{ fontSize: '0.82rem', color: 'var(--error)', fontWeight: 600, margin: 0 }}>
            Esta acción no se puede deshacer.
          </p>
          <label style={{ fontSize: '0.82rem' }}>
            Ingresa tu contraseña para confirmar
            <input type="password" value={deletePwd} onChange={e => setDeletePwd(e.target.value)}
              autoComplete="current-password" placeholder="Tu contraseña"
              style={{ marginTop: '0.25rem' }} />
          </label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn-danger btn-sm" onClick={onDeleteAccount} disabled={deleteLoading}>
              {deleteLoading ? 'Eliminando…' : 'Confirmar eliminación'}
            </button>
            <button className="btn-sm" onClick={onCancelDelete}>Cancelar</button>
          </div>
        </div>
      )}
      <Flash text={message} isError={isError} />
    </Collapsible>
  );
}
