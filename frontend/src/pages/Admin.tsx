import { useEffect, useState } from 'react';
import {
  Bell, CalendarCog, Database, FileText, HelpCircle, ScrollText,
  Table, User, Users,
} from 'lucide-react';
import { api } from '../lib/api';
import { useMe } from '../lib/useMe';
import { startNotifications } from '../lib/notify';
import Header, { whoamiLabel } from '../components/Header';
import Staffing from './admin/Staffing';
import PlanBuilder from './admin/PlanBuilder';
import PlanTexts from './admin/PlanTexts';
import Knowledge from './admin/Knowledge';
import Questions from './admin/Questions';
import Accounts from './admin/Accounts';

type TabId = 'staffing' | 'builder' | 'plantexts' | 'docs' | 'questions' | 'employees';

export default function Admin() {
  const me = useMe();
  const isOwner = me?.role === 'owner';
  const [tab, setTab] = useState<TabId>('staffing');
  const [openCount, setOpenCount] = useState(0);

  const refreshBadge = () => {
    api('/questions?status=open').then((r) => r.json()).then((d) => setOpenCount(d.open_count || 0)).catch(() => {});
  };
  useEffect(() => { refreshBadge(); startNotifications(); }, []);

  const tabs: { id: TabId; icon: JSX.Element; label: string }[] = [
    { id: 'staffing', icon: <Table />, label: 'Штатное расписание' },
    { id: 'builder', icon: <CalendarCog />, label: 'Планы' },
    { id: 'plantexts', icon: <FileText />, label: 'Тексты плана' },
    { id: 'docs', icon: <Database />, label: 'База знаний' },
    { id: 'questions', icon: <HelpCircle />, label: 'Вопросы' },
    { id: 'employees', icon: <Users />, label: 'Аккаунты' },
  ];

  return (
    <div className="admin-page">
      <Header
        title="Админка"
        whoami={whoamiLabel(me, isOwner ? 'суперадмин' : me ? 'администратор' : undefined)}
        actions={
          <>
            <a className="ghost-btn" href="/logs"><ScrollText /> Журнал действий</a>
            <a className="ghost-btn" href="/plans-db"><Database /> База планов</a>
            <a className="ghost-btn" href="/"><User /> Страница сотрудника</a>
            <a className="ghost-btn" href="/notify-test"><Bell /> Тест уведомлений</a>
          </>
        }
      />

      <div className="tabs">
        {tabs.map((t) => (
          <button key={t.id} className={`tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
            {t.icon} {t.label}
            {t.id === 'questions' && openCount > 0 && <span className="q-badge">{openCount}</span>}
          </button>
        ))}
      </div>

      {tab === 'staffing' && <Staffing />}
      {tab === 'builder' && <PlanBuilder />}
      {tab === 'plantexts' && <PlanTexts />}
      {tab === 'docs' && <Knowledge isOwner={isOwner} />}
      {tab === 'questions' && <Questions onBadge={setOpenCount} />}
      {tab === 'employees' && <Accounts me={me} isOwner={isOwner} />}
    </div>
  );
}
