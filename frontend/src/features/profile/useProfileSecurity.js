import { useRef, useState } from 'react';

import { apiFetch } from '../../api/client';
import { validatePassword } from '../../utils/passwordUtils.jsx';

export function useProfileSecurity({ token, user, patchUser }) {
  const [loginUsername, setLoginUsername] = useState(user?.username || '');
  const [usernameStatus, setUsernameStatus] = useState('idle');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdMsg, setPwdMsg] = useState('');
  const [pwdErr, setPwdErr] = useState(false);
  const usernameTimerRef = useRef(null);
  const [deleteMsg, setDeleteMsg] = useState('');
  const [deleteErr, setDeleteErr] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deletePwd, setDeletePwd] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);

  // ── 2FA ───────────────────────────────────────────────────────────────────
  const [twoFaEnabled,  setTwoFaEnabled]  = useState(user?.two_fa_enabled ?? false);
  const [twoFaLoading,  setTwoFaLoading]  = useState(false);
  const [twoFaMsg,      setTwoFaMsg]      = useState('');
  const [twoFaErr,      setTwoFaErr]      = useState(false);

  async function toggleTwoFa() {
    setTwoFaLoading(true);
    setTwoFaMsg('');
    try {
      const result = await apiFetch('/auth/2fa', {
        method: 'PATCH',
        body: JSON.stringify({ enable: !twoFaEnabled }),
      }, token);
      setTwoFaEnabled(result.two_fa_enabled);
      patchUser({ two_fa_enabled: result.two_fa_enabled });
      setTwoFaMsg(result.two_fa_enabled ? 'Verificación en dos pasos activada.' : 'Verificación en dos pasos desactivada.');
      setTwoFaErr(false);
    } catch (e) {
      setTwoFaMsg(e.message || 'Error al actualizar');
      setTwoFaErr(true);
    } finally { setTwoFaLoading(false); }
  }

  async function deleteAccount() {
    if (!deleteConfirm) {
      setDeleteConfirm(true);
      return;
    }
    if (!deletePwd.trim()) {
      setDeleteMsg('Ingresa tu contraseña para confirmar');
      setDeleteErr(true);
      return;
    }
    setDeleteLoading(true);
    try {
      await apiFetch('/auth/account', {
        method: 'DELETE',
        body: JSON.stringify({ password: deletePwd }),
        skipLogoutOn401: true,
      }, token);
    } catch (error) {
      setDeleteMsg(error.message);
      setDeleteErr(true);
    } finally {
      setDeleteLoading(false);
    }
  }

  function handleUsernameChange(value) {
    setLoginUsername(value);
    setUsernameStatus('idle');
    clearTimeout(usernameTimerRef.current);
    const trimmed = value.trim();
    if (!trimmed || trimmed === user?.username) return;
    if (trimmed.length < 3) {
      setUsernameStatus('error');
      return;
    }
    setUsernameStatus('checking');
    usernameTimerRef.current = setTimeout(async () => {
      try {
        await apiFetch(`/auth/check-username?username=${encodeURIComponent(trimmed)}`, {}, token);
        setUsernameStatus('available');
      } catch (error) {
        setUsernameStatus(error.message?.includes('disponible') || error.message?.includes('taken') ? 'taken' : 'error');
      }
    }, 500);
  }

  async function changePasswordAndLogin() {
    if (!currentPassword) {
      setPwdMsg('Ingresa tu contraseña actual para confirmar cambios');
      setPwdErr(true);
      return;
    }
    const changingPwd = Boolean(newPassword);
    const changingUser = loginUsername.trim() && loginUsername.trim() !== user?.username;
    if (!changingPwd && !changingUser) {
      setPwdMsg('No hay cambios que guardar');
      setPwdErr(false);
      return;
    }
    if (changingUser && usernameStatus === 'taken') {
      setPwdMsg('Ese nombre de usuario ya está en uso');
      setPwdErr(true);
      return;
    }
    if (changingUser && usernameStatus === 'checking') {
      setPwdMsg('Espera — verificando disponibilidad del usuario');
      setPwdErr(true);
      return;
    }
    if (changingPwd) {
      if (newPassword !== confirmPassword) {
        setPwdMsg('Las contraseñas no coinciden');
        setPwdErr(true);
        return;
      }
      const pwdValidation = validatePassword(newPassword);
      if (pwdValidation) {
        setPwdMsg(pwdValidation);
        setPwdErr(true);
        return;
      }
    }

    try {
      if (changingPwd) {
        await apiFetch('/auth/password', {
          method: 'PATCH',
          body: JSON.stringify({ currentPassword, newPassword }),
          skipLogoutOn401: true,
        }, token);
      }
      if (changingUser) {
        await apiFetch('/auth/login-username', {
          method: 'PATCH',
          body: JSON.stringify({ currentPassword, newUsername: loginUsername.trim() }),
          skipLogoutOn401: true,
        }, token);
        patchUser({ username: loginUsername.trim() });
      }
      setPwdMsg(changingPwd && changingUser
        ? 'Contraseña y nombre de usuario actualizados'
        : changingPwd ? 'Contraseña actualizada' : 'Nombre de usuario actualizado');
      setPwdErr(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setUsernameStatus('idle');
    } catch (error) {
      setPwdMsg(error.message);
      setPwdErr(true);
    }
  }

  return {
    loginUsername,
    setLoginUsername,
    usernameStatus,
    currentPassword,
    setCurrentPassword,
    newPassword,
    setNewPassword,
    confirmPassword,
    setConfirmPassword,
    pwdMsg,
    pwdErr,
    deleteMsg,
    deleteErr,
    deleteConfirm,
    deletePwd,
    setDeletePwd,
    deleteLoading,
    deleteAccount,
    handleUsernameChange,
    changePasswordAndLogin,
    resetDeleteState: () => {
      setDeleteConfirm(false);
      setDeletePwd('');
      setDeleteMsg('');
    },
    twoFaEnabled,
    twoFaLoading,
    twoFaMsg,
    twoFaErr,
    toggleTwoFa,
  };
}
