import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import Logo from '../components/Logo';

export default function Register() {
  const [f, setF] = useState({ full_name: '', position: '', contact: '', username: '', password: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const upd = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setBusy(true);
    fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(f),
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) {
          setError(data.detail || 'Не удалось зарегистрироваться');
          setBusy(false);
          return;
        }
        setSuccess(
          data.needs_approval
            ? 'Заявка отправлена. Войти можно будет после подтверждения администратором.'
            : 'Готово! Сейчас перенаправим на страницу входа.',
        );
        setTimeout(() => { window.location.href = '/login'; }, data.needs_approval ? 4000 : 1500);
      })
      .catch((err) => {
        setError(`Ошибка сети: ${err.message}`);
        setBusy(false);
      });
  };

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={submit}>
        <Logo size={34} />
        <p className="kicker">Регистрация сотрудника</p>
        <h1>Новая учётная запись</h1>
        {error && <div className="error" style={{ marginBottom: 14 }}>{error}</div>}
        {success && <div className="success">{success}</div>}
        <label htmlFor="full_name">ФИО</label>
        <input id="full_name" type="text" autoComplete="name" placeholder="Иванов Иван Иванович" required value={f.full_name} onChange={upd('full_name')} />
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label htmlFor="position">Должность</label>
            <input id="position" type="text" placeholder="Водитель" value={f.position} onChange={upd('position')} />
          </div>
          <div style={{ flex: 1 }}>
            <label htmlFor="contact">Контакт</label>
            <input id="contact" type="text" placeholder="telegram / email" value={f.contact} onChange={upd('contact')} />
          </div>
        </div>
        <label htmlFor="username">Логин</label>
        <input id="username" type="text" autoComplete="username" placeholder="ivanov" required value={f.username} onChange={upd('username')} />
        <div className="hint">Латинские буквы, цифры, точка, дефис, подчёркивание. От 3 символов.</div>
        <label htmlFor="password">Пароль</label>
        <input id="password" type="password" autoComplete="new-password" required value={f.password} onChange={upd('password')} />
        <div className="hint">От 8 символов.</div>
        <button type="submit" disabled={busy}><UserPlus /> Зарегистрироваться</button>
        <a className="back" href="/login">← Уже есть учётная запись</a>
      </form>
    </div>
  );
}
