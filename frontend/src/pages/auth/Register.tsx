import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import { api, messageOf } from '../../lib/api';
import { Button, Callout, Field, Input } from '../../ui';
import { AuthLayout } from './AuthLayout';

export default function Register() {
  const [f, setF] = useState({ full_name: '', position: '', contact: '', username: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { document.title = 'Регистрация · НейроМастер'; }, []);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ needs_approval?: boolean }>('/api/register', f);
      setDone(r.needs_approval
        ? 'Заявка отправлена. Войти можно будет после подтверждения администратором.'
        : 'Готово! Сейчас перенаправим на страницу входа.');
      setTimeout(() => location.assign('/login'), r.needs_approval ? 4000 : 1500);
    } catch (e) {
      setError(messageOf(e));
      setBusy(false);
    }
  };
  return (
    <AuthLayout title="Регистрация" subtitle="Новая учётная запись сотрудника" onSubmit={submit}
                footer={<Link to="/login">← Уже есть учётная запись</Link>}>
      {error && <Callout tone="danger">{error}</Callout>}
      {done && <Callout tone="ok">{done}</Callout>}
      <Field label="ФИО"><Input autoComplete="name" placeholder="Иванов Иван Иванович" value={f.full_name} onChange={set('full_name')} required /></Field>
      <div className="nm-field-row">
        <Field label="Должность"><Input placeholder="Водитель" value={f.position} onChange={set('position')} /></Field>
        <Field label="Контакт"><Input placeholder="телефон / email" value={f.contact} onChange={set('contact')} /></Field>
      </div>
      <Field label="Логин" help="Латинские буквы, цифры, точка, дефис, подчёркивание. От 3 символов.">
        <Input autoComplete="username" placeholder="ivanov" value={f.username} onChange={set('username')} required />
      </Field>
      <Field label="Пароль (от 8 символов)"><Input type="password" autoComplete="new-password" value={f.password} onChange={set('password')} required /></Field>
      <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={!!done} icon={UserPlus}>Зарегистрироваться</Button>
    </AuthLayout>
  );
}
