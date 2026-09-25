import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { api, messageOf } from '../../lib/api';
import { Button, Callout, Field, Input } from '../../ui';
import { AuthLayout } from './AuthLayout';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [registration, setRegistration] = useState(false);
  useEffect(() => {
    document.title = 'Вход · НейроМастер';
    api.get<{ registration?: boolean }>('/api/config').then((c) => setRegistration(!!c.registration)).catch(() => {});
  }, []);
  const submit = async () => {
    if (!username.trim() || !password) { setError('Введите логин и пароль'); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await api.login(username.trim(), password);
      location.assign(r.must_change_credentials ? '/setup' : (r.role === 'owner' || r.role === 'admin') ? '/admin' : '/');
    } catch (e) {
      setError(messageOf(e) || 'Не удалось войти — проверьте логин и пароль');
      setBusy(false);
    }
  };
  return (
    <AuthLayout title="НейроМастер" subtitle="Ассистент адаптации: план, сообщения и ответы на вопросы новичка"
                onSubmit={submit}
                footer={<>{registration && <Link to="/register">Нет учётной записи? Зарегистрироваться</Link>}
                        <Link to="/app">Скачать приложение для Android</Link></>}>
      {error && <Callout tone="danger">{error}</Callout>}
      <Field label="Логин">
        <Input autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} placeholder="ivanov.i" />
      </Field>
      <Field label="Пароль">
        <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Button type="submit" variant="primary" size="lg" block loading={busy} icon={LogIn}>Войти</Button>
      <p className="nm-small nm-muted" style={{ margin: 0, textAlign: 'center' }}>
        Логин и временный пароль выдаёт администратор. Забыли пароль — обратитесь к нему.
      </p>
    </AuthLayout>
  );
}
