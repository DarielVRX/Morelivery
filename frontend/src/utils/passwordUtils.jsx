// frontend/src/utils/passwordUtils.jsx

export function validatePassword(pwd) {
  if (pwd.length < 8)     return 'Mínimo 8 caracteres';
  if (!/[A-Z]/.test(pwd)) return 'Al menos una mayúscula';
  if (!/[0-9]/.test(pwd)) return 'Al menos un número';
  return null;
}

export function PasswordStrength({ pwd }) {
  let score = 0;
  if (pwd.length >= 8)           score++;
  if (/[A-Z]/.test(pwd))         score++;
  if (/[0-9]/.test(pwd))         score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;

  const labels = ['Muy débil', 'Débil', 'Regular', 'Fuerte', 'Muy fuerte'];
  const colors = ['#e53e3e', '#dd6b20', '#d69e2e', '#38a169', '#2b6cb0'];

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
      <span style={{ fontSize:'0.72rem', color: colors[score] || 'var(--text-secondary)', marginTop:'0.2rem', display:'block' }}>
        {labels[score] || ''}
      </span>
    </div>
  );
}
