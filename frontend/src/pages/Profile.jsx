import { useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { AccountManagementSection, PersonalInfoSection, ProfileHeaderCard, ProfileSecuritySection, ProfileSettingsSection } from '../features/profile/sections';
import { useProfilePersonalInfo } from '../features/profile/useProfilePersonalInfo';
import { useProfileSecurity } from '../features/profile/useProfileSecurity';
import { useProfileSettings } from '../features/profile/useProfileSettings';

export default function ProfilePage() {
  const { auth, patchUser, logout } = useAuth();
  const user = auth.user;

  const personal = useProfilePersonalInfo({ token: auth.token, user, patchUser });
  const settings = useProfileSettings(auth.token, user?.role);
  const security = useProfileSecurity({ token: auth.token, user, patchUser });

  const avatarLetter = (personal.alias[0] || '?').toUpperCase();

  useEffect(() => {
    if (import.meta.env.PROD) return;

    let observer;
    if ('PerformanceObserver' in window) {
      try {
        observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            console.warn(
              `[perf] Long task ${Math.round(entry.duration)}ms`,
              entry.attribution?.[0]?.name || 'unknown'
            );
          }
        });
        observer.observe({ type: 'longtask', buffered: true });
      } catch (_) {}
    }

    let lastFrame = performance.now();
    let rafId;
    function checkFrame(now) {
      const delta = now - lastFrame;
      if (delta > 33) {
        console.warn(`[perf] Frame drop: ${Math.round(delta)}ms (${Math.round(1000 / delta)}fps)`);
      }
      lastFrame = now;
      rafId = requestAnimationFrame(checkFrame);
    }
    rafId = requestAnimationFrame(checkFrame);

    return () => {
      observer?.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div>
      <h2 style={{ fontSize:'1.1rem', fontWeight:800, marginBottom:'1.25rem' }}>Mi perfil</h2>

      <ProfileHeaderCard alias={personal.alias} avatarLetter={avatarLetter} role={user?.role} />

      <PersonalInfoSection
        authToken={auth.token}
        alias={personal.alias}
        setAlias={personal.setAlias}
        homeLat={personal.homeLat}
        homeLng={personal.homeLng}
        onSelectAddress={({ lat, lng, estado: nextEstado, ciudad: nextCiudad, colonia: nextColonia, postalCode: cp, colonias }) => {
          if (lat != null) personal.setHomeLat(lat);
          if (lng != null) personal.setHomeLng(lng);
          if (nextEstado != null) personal.setEstado(nextEstado);
          if (nextCiudad != null) personal.setCiudad(nextCiudad);
          if (nextColonia != null && nextColonia !== '') personal.setColonia(nextColonia);
          if (cp != null) personal.setPostalCode(cp);
          if (colonias?.length) personal.setColoniasList(colonias);
        }}
        estado={personal.estado}
        setEstado={personal.setEstado}
        ciudad={personal.ciudad}
        setCiudad={personal.setCiudad}
        colonia={personal.colonia}
        setColonia={personal.setColonia}
        coloniasList={personal.coloniasList}
        calle={personal.calle}
        setCalle={personal.setCalle}
        numero={personal.numero}
        setNumero={personal.setNumero}
        onClearHomePin={() => { personal.setHomeLat(null); personal.setHomeLng(null); }}
        onSave={personal.saveProfile}
        message={personal.profileMsg}
        isError={personal.profileErr}
      />

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
        reducedMotion={settings.reducedMotion}
        onToggleReducedMotion={settings.toggleReducedMotion}
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

      <button
        onClick={logout}
        className="btn-sm"
        style={{
          width:'100%', padding:'0.7rem',
          marginTop:'0.25rem', marginBottom:'0.75rem',
          fontWeight:700, fontSize:'0.9rem',
        }}
      >
        Cerrar sesión
      </button>
    </div>
  );
}
