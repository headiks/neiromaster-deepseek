import { useEffect, useState } from 'react';
import { KeyRound, Info } from 'lucide-react';
import type { Me } from '@shared/types';
import { api, messageOf } from '../../lib/api';
import { Button, Callout, Field, Input } from '../../ui';
import { AuthLayout } from './AuthLayout';

export default function Setup() {
  const [me, setMe] = useState<Me | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    document.title = 'Первый вход · НейроМастер';
    api.me().then(setMe).catch(() => {});
  }, []);
  const submit = async () => {
    if (pw.length < 8) { setError('Пароль — от 8 символов'); return; }
    if (pw !== pw2) { setError('Пароли не совпадают'); return; }
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/setup-credentials', { password: pw });
      location.assign('/login');
    } catch (e) {
      setError(messageOf(e));
      setBusy(false);
    }
  };
  return (
    <AuthLayout title="Задайте свой пароль" subtitle={me ? `${me.full_name || me.username}, это первый вход` : 'Первый вход'} onSubmit={submit}>
      <Callout icon={Info}>
        Вы вошли по временному паролю. Задайте свой — временный перестанет действовать сразу после сохранения.
        Логин остаётся прежним{me?.username ? <>: <b>{me.username}</b></> : ''}.
      </Callout>
      {error && <Callout tone="danger">{error}</Callout>}
      <Field label="Новый пароль (от 8 символов)"><Input type="password" autoComplete="new-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      <Field label="Повторите пароль"><Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
      <Button type="submit" variant="primary" size="lg" block loading={busy} icon={KeyRound}>Сохранить и войти заново</Button>
    </AuthLayout>
  );
}
