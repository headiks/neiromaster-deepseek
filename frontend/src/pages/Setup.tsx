import { useState } from 'react';
import { Info, KeyRound } from 'lucide-react';
import Logo from '../components/Logo';
import { useMe } from '../lib/useMe';

export default function Setup() {
  const me = useMe();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== password2) {
      setError('Пароли не совпадают');
      return;
    }
    setBusy(true);
    fetch('/api/setup-credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) {
          setError(data.detail || 'Не удалось сохранить');
          setBusy(false);
          return;
        }
        window.location.href = '/login';
      })
      .catch((err) => {
        setError(`Ошибка сети: ${err.message}`);
        setBusy(false);
      });
  };

  const greeting = me ? `${me.full_name || me.username}: задайте свои логин и пароль` : 'Задайте свои логин и пароль';

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={submit}>
        <Logo size={34} />
        <p className="kicker">Первый вход</p>
        <h1>Задайте свои данные</h1>
        <div className="subtitle">{greeting}</div>
        <div className="note" style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <Info style={{ flex: 'none', marginTop: 1 }} />
          <span>
            Вы вошли по данным, выданным при установке системы. Замените их своими —
            выданные логин и пароль перестанут действовать сразу после сохранения.
          </span>
        </div>
        {error && <div className="error" style={{ marginBottom: 14 }}>{error}</div>}
        <label htmlFor="username">Новый логин</label>
        <input id="username" type="text" autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} />
        <div className="hint">Латинские буквы, цифры, точка, дефис, подчёркивание. От 3 символов.</div>
        <label htmlFor="password">Новый пароль</label>
        <input id="password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="hint">От 8 символов.</div>
        <label htmlFor="password2">Повторите пароль</label>
        <input id="password2" type="password" autoComplete="new-password" required value={password2} onChange={(e) => setPassword2(e.target.value)} />
        <button type="submit" disabled={busy}><KeyRound /> Сохранить и войти заново</button>
      </form>
    </div>
  );
}
