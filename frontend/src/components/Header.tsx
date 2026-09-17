import { useState, type ReactNode } from 'react';
import { KeyRound, LogOut, User } from 'lucide-react';
import type { Me } from '../lib/types';
import { logout } from '../lib/useMe';
import Logo from './Logo';
import PasswordDialog from './PasswordDialog';

/** Общая шапка страниц. `whoami` — подпись пользователя; `actions` — доп. ссылки/кнопки. */
export default function Header({
  title,
  whoami,
  actions,
}: {
  title: string;
  whoami?: ReactNode;
  actions?: ReactNode;
}) {
  const [pwOpen, setPwOpen] = useState(false);
  return (
    <div className="page-head">
      <h1><Logo /> {title}</h1>
      <div className="head-actions">
        {whoami !== undefined && <span id="whoami">{whoami}</span>}
        {actions}
        <button className="ghost-btn" onClick={() => setPwOpen(true)}><KeyRound /> Сменить пароль</button>
        <button className="ghost-btn" onClick={logout}><LogOut /> Выйти</button>
      </div>
      <PasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  );
}

/** Стандартная подпись «Имя · роль» для шапки. */
export function whoamiLabel(me: Me | null, roleSuffix?: string): ReactNode {
  if (!me) return null;
  return (
    <>
      <User /> {me.full_name || me.username}
      {roleSuffix ? ` · ${roleSuffix}` : ''}
    </>
  );
}
