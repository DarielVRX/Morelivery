// frontend/src/pages/ResetPasswordPage.jsx
// El enlace de email llega como: /reset-password?token=<jwt>
// Este componente lee el token del query string y llama al backend.

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../api/client';

function validatePassword(pwd) {
  if (pwd.length < 8)   return 'Mínimo 8 caracteres';
  if (!/[A-Z]/.test(pwd)) return 'Al menos una mayúscula';
  if (!/[0-9]/.test(pwd)) return 'Al menos un número';
  return null;
}

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [pwd,      setPwd]      = useState('');
  const [pwdConf,  setPwdConf]  = useState('');
  const [pwdError, setPwdError] = useState('');
  const [message,  setMessage]  = useState({ text:'', ok:false });
  const [loading,  setLoading]  = useState(false);
  const [done,     setDone]     = useState(false);

  useEffect(() => {
    if (!pwd) { setPwdError(''); return; }
    setPwdError(validatePassword(pwd) || '');
  }, [pwd]);

  const submit = useCallback(async () => {
    const err = validatePassword(pwd);
    if (err)            { setMessage({ text: err, ok:false }); return; }
    if (pwd !== pwdConf){ setMessage({ text: 'Las contraseñas no coinciden', ok:false }); return; }
    if (!token)         { setMessage({ text: 'Enlace inválido o expirado', ok:false }); return; }

    setLoading(true);
    try {
      await apiFetch('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, newPassword: pwd }),
      });
      setDone(true);
      setMessage({ text: 'Contraseña actualizada. Redirigiendo al login…', ok:true });
      setTimeout(() => navigate('/login'), 2500);
    } catch (e) {
      setMessage({ text: e.message, ok:false });
    } finally {
      setLoading(false);
    }
  }, [pwd, pwdConf, token, navigate]);

  return (
    <section className="auth-card">
      <h2 style={{ marginBottom:'0.5rem' }}>Nueva contraseña</h2>
      <p style={{ fontSize:'0.875rem', color:'var(--text-secondary)', marginBottom:'1rem' }}>
        Elige una contraseña segura para tu cuenta.
      </p>

      {!done && (
        <>
          <div className="row">
            <label>
              Nueva contraseña
              <input
                value={pwd}
                onChange={e => setPwd(e.target.value)}
                type="password"
                placeholder="Mínimo 8 caracteres"
                autoComplete="new-password"
                onKeyDown={e => { if (e.key === 'Enter') submit(); }}
              />
              {pwdError && (
                <span style={{ fontSize:'0.73rem', color:'var(--error)', marginTop:'0.2rem', display:'block' }}>
                  {pwdError}
                </span>
              )}
            </label>

            <label>
              Confirmar contraseña
              <input
                value={pwdConf}
                onChange={e => setPwdConf(e.target.value)}
                type="password"
                placeholder="Repite la contraseña"
                autoComplete="new-password"
                onKeyDown={e => { if (e.key === 'Enter') submit(); }}
              />
            </label>
          </div>

          {/* Indicador de fuerza */}
          {pwd.length > 0 && <PasswordStrength pwd={pwd} />}

          <div className="row" style={{ marginTop:'0.75rem' }}>
            <button className="btn-primary" onClick={submit} disabled={loading}>
              {loading ? 'Guardando…' : 'Guardar contraseña'}
            </button>
          </div>
        </>
      )}

      {message.text && (
        <p className={`flash ${message.ok ? 'flash-ok' : 'flash-error'}`} style={{ marginTop:'0.75rem' }}>
          {message.text}
        </p>
      )}
    </section>
  );
}

function PasswordStrength({ pwd }) {
  let score = 0;
  if (pwd.length >= 8)           score++;
  if (/[A-Z]/.test(pwd))         score++;
  if (/[0-9]/.test(pwd))         score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  const labels = ['Muy débil','Débil','Regular','Fuerte','Muy fuerte'];
  const colors = ['#e53e3e','#dd6b20','#d69e2e','#38a169','#2b6cb0'];
  return (
    <div style={{ marginTop:'0.3rem' }}>
      <div style={{ display:'flex', gap:3 }}>
        {[0,1,2,3].map(i => (
          <div key={i} style={{
            flex:1, height:4, borderRadius:2,
            background: i < score ? colors[score] : 'var(--border)',
            transition:'background 0.3s',
          }} />
        ))}
      </div>
      <span style={{ fontSize:'0.72rem', color:colors[score]||'var(--text-secondary)', marginTop:'0.2rem', display:'block' }}>
        {labels[score]||''}
      </span>
    </div>
  );
}
