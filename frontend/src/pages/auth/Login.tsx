import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LogIn, Play } from 'lucide-react';
import { api, messageOf } from '../../lib/api';
import { Button, Callout, Field, Input } from '../../ui';
import { AuthLayout } from './AuthLayout';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [registration, setRegistration] = useState(false);
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    document.title = 'Вход · НейроМастер';
    api.get<{ registration?: boolean; demo?: boolean }>('/api/config')
      .then((c) => { setRegistration(!!c.registration); setDemo(!!c.demo); }).catch(() => {});
  }, []);
  /** Демо: вход без пароля — администратором, куратором или своим сотрудником-песочницей. */
  const enterDemo = async (role: 'admin' | 'curator' | 'employee') => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/demo/enter', { role });
      location.assign(role === 'employee' ? '/' : '/admin');
    } catch (e) {
      setError(messageOf(e));
      setBusy(false);
    }
  };
  const submit = async () => {
    if (!username.trim() || !password) { setError('Введите логин и пароль'); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await api.login(username.trim(), password);
      location.assign(r.must_change_credentials ? '/setup' : ['owner', 'admin', 'curator'].includes(r.role) ? '/admin' : '/');
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
      {demo && (
        <>
          <Button type="button" variant="primary" size="lg" block loading={busy} icon={Play} onClick={() => enterDemo('admin')}>
            Войти в демо
          </Button>
          <p className="nm-small nm-muted" style={{ margin: 0, textAlign: 'center' }}>
            Покажем всё за несколько минут — от администратора до сотрудника. Или войти сразу{' '}
            <button type="button" className="nm-link" onClick={() => enterDemo('curator')}>как куратор</button> ·{' '}
            <button type="button" className="nm-link" onClick={() => enterDemo('employee')}>как сотрудник</button>
          </p>
          <div className="nm-divider nm-small nm-muted">или по логину</div>
        </>
      )}
      <Field label="Логин">
        <Input autoComplete="username" autoFocus={!demo} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="ivanov.i" />
      </Field>
      <Field label="Пароль">
        <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Button type="submit" variant={demo ? 'secondary' : 'primary'} size="lg" block loading={busy} icon={LogIn}>Войти</Button>
      <p className="nm-small nm-muted" style={{ margin: 0, textAlign: 'center' }}>
        Логин и временный пароль выдаёт администратор. Забыли пароль — обратитесь к нему.
      </p>
    </AuthLayout>
  );
}
