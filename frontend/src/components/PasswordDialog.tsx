import { useEffect, useRef, useState } from 'react';
import { apiJson } from '../lib/api';

/** Смена собственного пароля. Управляется через open/onClose. */
export default function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open) {
      setOldPw('');
      setNewPw('');
      setError('');
      if (!dlg.open) dlg.showModal();
    } else if (dlg.open) {
      dlg.close();
    }
  }, [open]);

  const submit = async () => {
    const { ok, data } = await apiJson('/api/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ old_password: oldPw, new_password: newPw }),
    });
    if (!ok) {
      setError(data.detail || 'Не удалось сменить пароль');
      return;
    }
    alert('Пароль изменён. Войдите заново.');
    window.location.href = '/login';
  };

  return (
    <dialog ref={ref} onClose={onClose}>
      <h3 style={{ marginTop: 0 }}>Смена пароля</h3>
      <label>Текущий пароль</label>
      <input type="password" autoComplete="current-password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
      <label>Новый пароль (от 8 символов)</label>
      <input type="password" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="primary-btn" style={{ flex: 1, padding: 9 }} onClick={submit}>Сменить</button>
        <button className="ghost-btn" onClick={onClose}>Отмена</button>
      </div>
    </dialog>
  );
}
