import { useState } from 'react';
import { LogIn } from 'lucide-react';
import Logo from '../components/Logo';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (ok) {
          if (data.must_change_credentials) window.location.href = '/setup';
          else window.location.href = data.role === 'owner' || data.role === 'admin' ? '/admin' : '/';
          return;
        }
        setError(data.detail || 'Не удалось войти');
        setBusy(false);
      })
      .catch((err) => {
        setError(`Ошибка сети: ${err.message}`);
        setBusy(false);
      });
  };

  return (
    <div className="auth-page">
      <form className="login-card auth-card" onSubmit={submit}>
        <Logo size={34} />
        <h1>Вход</h1>
        <div className="subtitle">Вход в систему адаптации</div>
        {error && <div className="error" style={{ marginBottom: 14 }}>{error}</div>}
        <label htmlFor="username">Логин</label>
        <input id="username" type="text" autoComplete="username" autoFocus required value={username} onChange={(e) => setUsername(e.target.value)} />
        <label htmlFor="password">Пароль</label>
        <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <button type="submit" disabled={busy}><LogIn /> Войти</button>
        <a className="back" href="/register">Нет учётной записи? Зарегистрироваться</a>
      </form>
    </div>
  );
}
