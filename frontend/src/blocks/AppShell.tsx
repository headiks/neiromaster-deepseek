// Оболочка сайта (PRINCIPLES.md → AppShell): сайдбар 250px — группы «Сотрудник» и
// «Администратор», внизу карточка профиля с меню (тема, пароль, служебные страницы, выход).
import { useCallback, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Building2, CalendarRange, ClipboardList, Database, GraduationCap, House, Inbox, KeyRound, LogOut, MessageCircleQuestion, MessagesSquare, Moon, Settings, Smartphone, Sun, Users,
} from 'lucide-react';
import { initials } from '@shared/format';
import { ROLE } from '@shared/status';
import { useMe } from '../lib/me';
import { useInbox } from '../lib/inbox';
import { useThemeMode } from '../lib/theme';
import { api } from '../lib/api';
import { usePolling } from '../lib/poll';
import { startTour } from '../tour';
import { Avatar, Button, Count, Logo } from '../ui';
import { Menu } from '../ui/Menu';
import { PasswordDialog } from './PasswordDialog';

export const ADMIN_NAV = [
  { to: '/admin/users', label: 'Пользователи', icon: Users, tour: 'nav-users' },
  { to: '/admin/plans', label: 'Планы', icon: CalendarRange, tour: 'nav-plans' },
  { to: '/admin/documents', label: 'Документы', icon: Database, tour: 'nav-documents' },
  { to: '/admin/messages', label: 'Сообщения', icon: MessagesSquare, tour: 'nav-messages' },
  { to: '/admin/questions', label: 'Вопросы', icon: MessageCircleQuestion, tour: 'nav-questions' },
];

export async function logout() {
  try { await api.logout(); } catch { /* сессия уже могла истечь */ }
  location.assign('/login');
}

function useOpenQuestions(enabled: boolean) {
  const [n, setN] = useState(0);
  const load = useCallback(() => {
    api.get<{ open_count?: number }>('/questions?status=open').then((d) => setN(d.open_count || 0)).catch(() => {});
  }, []);
  usePolling(load, enabled ? 60000 : 0, [enabled]);
  return n;
}

function useNewLeads(enabled: boolean) {
  const [n, setN] = useState(0);
  const load = useCallback(() => {
    api.get<{ new?: number }>('/api/companies/leads').then((d) => setN(d.new || 0)).catch(() => {});
  }, []);
  usePolling(load, enabled ? 120000 : 0, [enabled]);
  return n;
}

/** Суперадмин в открытой компании / вошёл как её администратор — всегда видно, где он. */
function ScopeBanner() {
  const { me, inCompany } = useMe();
  const exit = async () => {
    try { await api.post('/api/companies/exit'); } finally { location.assign('/admin/companies'); }
  };
  const back = async () => {
    try { await api.post('/api/return-to-owner'); } finally { location.assign('/admin/companies'); }
  };
  if (inCompany) {
    return (
      <div className="nm-banner nm-scope" role="status">
        <Building2 aria-hidden /><span className="nm-grow">Суперадмин · компания <b>{me?.company_name || me?.company}</b></span>
        <Button size="sm" onClick={exit}>Выйти из компании</Button>
      </div>
    );
  }
  if (me?.owner_return) {
    return (
      <div className="nm-banner nm-scope" role="status">
        <Building2 aria-hidden /><span className="nm-grow">Вы вошли как администратор <b>{me.full_name || me.username}</b> · {me.company_name}</span>
        <Button size="sm" onClick={back}>Вернуться к суперадмину</Button>
      </div>
    );
  }
  return null;
}

export function AppShell({ children }: { children: ReactNode }) {
  const { me, isAdmin, isOwner, inCompany } = useMe();
  const newLeads = useNewLeads(isOwner && !inCompany);
  const { unread } = useInbox();
  const { dark, toggle } = useThemeMode();
  const openQuestions = useOpenQuestions(isAdmin);
  const [pwOpen, setPwOpen] = useState(false);
  const navigate = useNavigate();
  const role = me ? ROLE[me.role]?.label.toLowerCase() : '';
  return (
    <div className="nm-shell">
      <aside className="nm-sidebar" aria-label="Навигация">
        <a className="nm-brand" href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}><Logo /><span>НейроМастер</span></a>
        <nav className="nm-nav" aria-label="Разделы">
          {!isAdmin && (
            <div className="nm-nav-group">
              <div className="nm-nav-label">Сотрудник</div>
              <NavLink to="/" end className="nm-nav-item" data-tour="nav-cabinet">
                <span><House aria-hidden />Мой кабинет</span><Count n={unread} />
              </NavLink>
              <NavLink to="/app" className="nm-nav-item" data-tour="nav-app">
                <span><Smartphone aria-hidden />Приложение</span>
              </NavLink>
            </div>
          )}
          {isAdmin && (
            <div className="nm-nav-group" data-tour="admin-nav">
              <div className="nm-nav-label">{ROLE[me?.role || '']?.label || 'Администратор'}</div>
              {isOwner && !inCompany && (
                <>
                  <NavLink to="/admin/companies" className="nm-nav-item" data-tour="nav-companies">
                    <span><Building2 aria-hidden />Компании</span>
                  </NavLink>
                  <NavLink to="/admin/leads" className="nm-nav-item" data-tour="nav-leads">
                    <span><Inbox aria-hidden />Заявки</span><Count n={newLeads} />
                  </NavLink>
                </>
              )}
              {ADMIN_NAV.map((it) => (
                <NavLink key={it.to} to={it.to} className="nm-nav-item" data-tour={it.tour}>
                  <span><it.icon aria-hidden />{it.label}</span>
                  {it.to === '/admin/questions' && <Count n={openQuestions} />}
                </NavLink>
              ))}
              <NavLink to="/app" className="nm-nav-item" data-tour="nav-app">
                <span><Smartphone aria-hidden />Приложение</span>
              </NavLink>
            </div>
          )}
        </nav>
        <div className="nm-sidebar-foot">
          <div className="nm-profile" data-tour="profile">
            <Avatar text={initials(me?.full_name || me?.username)} />
            <span className="nm-grow nm-profile-text">
              <span className="nm-profile-name">{me?.full_name || me?.username || '…'}</span>
              <span className="nm-profile-role">{role}</span>
            </span>
            <Menu side="top" anchor=".nm-profile" label="Настройки" items={[
              { label: 'Как пользоваться', icon: GraduationCap, onClick: () => startTour() },
              { label: dark ? 'Светлая тема' : 'Тёмная тема', icon: dark ? Sun : Moon, onClick: toggle },
              { label: 'Сменить пароль', icon: KeyRound, onClick: () => setPwOpen(true), hidden: !isAdmin },
              { section: 'Служебное', hidden: !isAdmin },
              { label: 'Журнал действий', icon: ClipboardList, href: '/logs', hidden: !isAdmin },
            ]} trigger={(p) => <Button variant="ghost" iconOnly size="sm" icon={Settings} aria-label="Настройки" title="Настройки" data-tour="profile-menu" {...p} />} />
            <Button variant="ghost" iconOnly size="sm" icon={LogOut} aria-label="Выйти" title="Выйти" onClick={logout} />
          </div>
        </div>
      </aside>
      <main className="nm-main" id="main"><ScopeBanner />{children}</main>
      <PasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  );
}
