// frontend/src/pages/Profile.jsx
import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { AccountManagementSection, PersonalInfoSection, ProfileHeaderCard, ProfileSecuritySection, ProfileSettingsSection } from '../features/profile/sections';
import { useProfilePersonalInfo } from '../features/profile/useProfilePersonalInfo';
import { useProfileSecurity } from '../features/profile/useProfileSecurity';
import { useProfileSettings } from '../features/profile/useProfileSettings';
import { updateBagCapacity, fetchBagCapacity } from '../features/driver/alerts/api';

function DriverSection({ token, bagCapacity, onBagCapacityChange }) {
  const [editing, setEditing] = useState(false);
  const [liters,  setLiters]  = useState(bagCapacity);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');

  const handleSave = async () => {
    const val = parseFloat(liters);
    if (isNaN(val) || val < 1)   { setError('La capacidad debe ser al menos 1 litro'); return; }
    if (val > 200)                { setError('La capacidad no puede exceder 200 litros'); return; }
    setSaving(true); setError('');
    try {
      await updateBagCapacity(val, token);
      onBagCapacityChange(val);
      setEditing(false);
    } catch (e) { setError(e.message || 'Error al guardar'); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: '1rem', marginBottom: '1rem', border: '1px solid var(--border-light)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '1.2rem', color: 'var(--brand)' }}>◆</span>
          <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>Capacidad de mochila</span>
        </div>
        {!editing && (
          <button onClick={() => setEditing(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--brand)', fontSize: '0.7rem', fontWeight: 600 }}>
            Editar
          </button>
        )}
      </div>

      {editing ? (
        <div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Define cuántos litros puedes cargar. Esto ayuda a calcular si un pedido cabe en tu ruta.
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input type="number" value={liters} onChange={e => setLiters(e.target.value)}
              step="1" min="1" max="200"
              style={{ width: '100px', padding: '0.4rem', borderRadius: 8, border: '1px solid var(--border)', fontSize: '0.9rem' }} />
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>litros</span>
            <button onClick={handleSave} disabled={saving}
              style={{ padding: '0.4rem 0.8rem', borderRadius: 8, background: 'var(--brand)', color: '#fff', border: 'none', fontSize: '0.75rem', fontWeight: 600, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.6 : 1 }}>
              {saving ? '…' : 'Guardar'}
            </button>
            <button onClick={() => { setEditing(false); setLiters(bagCapacity); setError(''); }}
              style={{ padding: '0.4rem 0.8rem', borderRadius: 8, background: 'var(--bg-raised)', border: '1px solid var(--border)', fontSize: '0.75rem', cursor: 'pointer' }}>
              Cancelar
            </button>
          </div>
          {error && <div style={{ fontSize: '0.7rem', color: '#dc2626', marginTop: '0.5rem' }}>{error}</div>}
        </div>
      ) : (
        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          {bagCapacity ?? '?'} litros
        </div>
      )}
    </div>
  );
}

export default function ProfilePage() {
  const { auth, patchUser, logout } = useAuth();
  const user = auth.user;
  const [bagCapacity, setBagCapacity] = useState(null);

  const personal  = useProfilePersonalInfo({ token: auth.token, user, patchUser });
  const settings  = useProfileSettings(auth.token, user?.role);
  const security  = useProfileSecurity({ token: auth.token, user, patchUser });

  const avatarLetter = (personal.alias[0] || '?').toUpperCase();
  const isDriver     = user?.role === 'driver';

  useEffect(() => {
    if (!isDriver || !auth.token) return;
    fetchBagCapacity(auth.token).then(cap => setBagCapacity(cap)).catch(() => {});
  }, [isDriver, auth.token]);

  const handleBagCapacityChange = (newCapacity) => {
    setBagCapacity(newCapacity);
    patchUser({ driver: { ...(user?.driver || {}), bag_capacity_liters: newCapacity } });
  };

  return (
    // Contenedor con scroll propio — fix para la página estática
    <div style={{ height: '100%', overflowY: 'auto', padding: '0 0 calc(var(--nav-h-mobile, 64px) + 1.5rem)' }}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '0 1rem' }}>

        <h2 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '1.25rem' }}>Mi perfil</h2>

        <ProfileHeaderCard alias={personal.alias} avatarLetter={avatarLetter} role={user?.role} />

        <PersonalInfoSection
          authToken={auth.token}
          alias={personal.alias}
          setAlias={personal.setAlias}
          homeLat={personal.homeLat}
          homeLng={personal.homeLng}
          onSelectAddress={({ lat, lng, estado: nextEstado, ciudad: nextCiudad, colonia: nextColonia, postalCode: cp, colonias }) => {
            if (lat != null)             personal.setHomeLat(lat);
            if (lng != null)             personal.setHomeLng(lng);
            if (nextEstado != null)      personal.setEstado(nextEstado);
            if (nextCiudad != null)      personal.setCiudad(nextCiudad);
            if (nextColonia != null && nextColonia !== '') personal.setColonia(nextColonia);
            if (cp != null)              personal.setPostalCode(cp);
            if (colonias?.length)        personal.setColoniasList(colonias);
          }}
          estado={personal.estado}       setEstado={personal.setEstado}
          ciudad={personal.ciudad}       setCiudad={personal.setCiudad}
          colonia={personal.colonia}     setColonia={personal.setColonia}
          coloniasList={personal.coloniasList}
          calle={personal.calle}         setCalle={personal.setCalle}
          numero={personal.numero}       setNumero={personal.setNumero}
          onClearHomePin={() => { personal.setHomeLat(null); personal.setHomeLng(null); }}
          onSave={personal.saveProfile}
          message={personal.profileMsg}
          isError={personal.profileErr}
        />

        {isDriver && (
          <DriverSection
            token={auth.token}
            bagCapacity={bagCapacity}
            onBagCapacityChange={handleBagCapacityChange}
          />
        )}

        <ProfileSettingsSection
          userRole={user?.role}
          permStatus={settings.permStatus}
          permLoading={settings.permLoading}
          permMsg={settings.permMsg}
          notifStatus={settings.notifStatus}
          notifEnabled={settings.notifEnabled}
          highPriorityNotifs={settings.highPriorityNotifs}
          notifMsg={settings.notifMsg}
          onToggleNotifEnabled={settings.toggleNotifEnabled}
          onToggleHighPriority={settings.toggleHighPriorityNotifs}
          onRequestWakeLock={settings.requestWakeLock}
          onRequestAllPermissions={settings.requestAllPermissions}
          theme={settings.theme}
          onApplyTheme={settings.applyTheme}
          isInstalled={settings.isInstalled}
          deferredInstall={settings.deferredInstall}
          onTriggerInstallPrompt={settings.triggerInstallPrompt}
          onRefreshOfflineCache={settings.refreshOfflineCache}
          offlineCacheMsg={settings.offlineCacheMsg}
        />

        <ProfileSecuritySection
          loginUsername={security.loginUsername}
          onChangeUsername={security.handleUsernameChange}
          usernameStatus={security.usernameStatus}
          currentPassword={security.currentPassword}
          setCurrentPassword={security.setCurrentPassword}
          newPassword={security.newPassword}
          setNewPassword={security.setNewPassword}
          confirmPassword={security.confirmPassword}
          setConfirmPassword={security.setConfirmPassword}
          onSave={security.changePasswordAndLogin}
          message={security.pwdMsg}
          isError={security.pwdErr}
        />

        <AccountManagementSection
          deleteConfirm={security.deleteConfirm}
          onDeleteAccount={security.deleteAccount}
          deletePwd={security.deletePwd}
          setDeletePwd={security.setDeletePwd}
          deleteLoading={security.deleteLoading}
          onCancelDelete={security.resetDeleteState}
          message={security.deleteMsg}
          isError={security.deleteErr}
        />

        <button onClick={logout} className="btn-sm"
          style={{ width: '100%', padding: '0.7rem', marginTop: '0.25rem', marginBottom: '0.75rem', fontWeight: 700, fontSize: '0.9rem' }}>
          Cerrar sesión
        </button>

      </div>
    </div>
  );
}

