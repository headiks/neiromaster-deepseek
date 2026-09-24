// Смена своего пароля (администраторы; пароль сотрудника меняет администратор).
import { useState } from 'react';
import { api, messageOf } from '../lib/api';
import { Dialog } from '../ui/Dialog';
import { Button, Field, Input } from '../ui';
import { useToast } from '../lib/toast';

export function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [oldPw, setOld] = useState('');
  const [newPw, setNew] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/password', { old_password: oldPw, new_password: newPw });
      toast.ok('Пароль изменён. Войдите заново.');
      setTimeout(() => location.assign('/login'), 900);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title="Смена пароля" subtitle="После смены все сеансы завершатся — войдите с новым паролем."
            footer={<><Button variant="ghost" onClick={onClose}>Отмена</Button>
              <Button variant="primary" loading={busy} disabled={!oldPw || newPw.length < 8} onClick={submit}>Сменить</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="nm-stack">
        <Field label="Текущий пароль"><Input type="password" autoComplete="current-password" value={oldPw} onChange={(e) => setOld(e.target.value)} /></Field>
        <Field label="Новый пароль (от 8 символов)" error={error}>
          <Input type="password" autoComplete="new-password" value={newPw} onChange={(e) => setNew(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}
