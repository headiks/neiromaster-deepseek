// Мой кабинет. Широкий экран — приветствие, прогресс, «Сегодня» и «Дальше по плану» слева,
// ассистент и вопросы специалисту справа. Узкий экран — та же раскладка, что в приложении:
// крупный заголовок и плавающий таб-бар «Чат / История / Вопрос / Настройки».
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CircleHelp, GraduationCap, History, LogOut, MessageCircle, Settings2, ShieldCheck, ThermometerSun } from 'lucide-react';
import { firstName, greeting, initials, longDate, ruDate } from '@shared/format';
import { useMe } from '../../lib/me';
import { useInbox } from '../../lib/inbox';
import { useCabinet } from '../../lib/cabinet';
import { useThemeMode } from '../../lib/theme';
import { useNarrow } from '../../lib/media';
import { AppShell, logout } from '../../blocks/AppShell';
import { ProgressCard } from '../../blocks/ProgressCard';
import { Assistant, Composer } from '../../blocks/Assistant';
import { MyQuestions } from '../../blocks/MyQuestions';
import { startTour, useTourHooks } from '../../tour';
import { Avatar, Button, Card, Count, PageHeader, SectionLabel, Segmented } from '../../ui';
import { HistoryList, SettingsToggles, TodayList, UpNext, useSick, useSplitInbox } from './parts';

function Hello() {
  const { me } = useMe();
  const name = firstName(me?.full_name);
  return <PageHeader display kicker={longDate()} title={name ? `${greeting()}, ${name}` : greeting()} />;
}

function SickBanner() {
  const { sick, set, busy } = useSick();
  if (!sick) return null;
  return (
    <div className="nm-banner" role="status">
      <ThermometerSun aria-hidden />
      <span className="nm-grow">Вы на больничном — план на паузе. После выхода он продолжится с того же места.</span>
      <Button size="sm" variant="secondary" onClick={() => set(false)} loading={busy}>Снять больничный</Button>
    </div>
  );
}

function Desktop() {
  const { schedule, progress, scheduleMissing } = useCabinet();
  const { past } = useSplitInbox();
  const [showHistory, setShowHistory] = useState(false);
  return (
    <AppShell>
      <div className="nm-page">
        <Hello />
        <SickBanner />
        <ProgressCard progress={progress} schedule={schedule} missing={scheduleMissing} />
        <div className="nm-cabinet">
          <div className="nm-stack" style={{ gap: 20 }}>
            <section className="nm-section">
              <SectionLabel>Сегодня</SectionLabel>
              <TodayList wide />
            </section>
            <section className="nm-section">
              <SectionLabel>Дальше по плану</SectionLabel>
              <UpNext />
            </section>
            {past.length > 0 && (
              <section className="nm-section">
                <SectionLabel action={<Button variant="ghost" size="sm" icon={History} onClick={() => setShowHistory((v) => !v)}>
                  {showHistory ? 'Скрыть' : `Показать (${past.length})`}</Button>}>История сообщений</SectionLabel>
                {showHistory && <HistoryList wide />}
              </section>
            )}
          </div>
          <div className="nm-stack nm-sticky" style={{ gap: 20 }}>
            <section className="nm-section">
              <SectionLabel>Ассистент</SectionLabel>
              <Card data-tour="assistant"><Assistant /></Card>
            </section>
            <section className="nm-section">
              <SectionLabel>Мои вопросы специалисту</SectionLabel>
              <MyQuestions />
            </section>
            <section className="nm-section">
              <SectionLabel>Настройки</SectionLabel>
              <Card style={{ paddingBlock: 6 }}><SettingsToggles /></Card>
            </section>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

type Tab = 'chat' | 'history' | 'ask' | 'settings';
const TABS: { id: Tab; label: string; icon: typeof MessageCircle }[] = [
  { id: 'chat', label: 'Чат', icon: MessageCircle },
  { id: 'history', label: 'История', icon: History },
  { id: 'ask', label: 'Вопрос', icon: CircleHelp },
  { id: 'settings', label: 'Настройки', icon: Settings2 },
];

/** Как в мессенджере: при появлении новых сообщений — вниз, к свежим. */
function useStickToBottom(key: string, count: number) {
  const last = useRef<{ key: string; count: number }>({ key: '', count: -1 });
  useLayoutEffect(() => {
    if (last.current.key !== key || count > last.current.count) {
      if (count > 0) window.scrollTo({ top: document.documentElement.scrollHeight });
    }
    last.current = { key, count };
  }, [key, count]);
}

function Mobile() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'chat') as Tab;
  const setTab = (t: Tab) => { setParams(t === 'chat' ? {} : { tab: t }, { replace: true }); window.scrollTo({ top: 0 }); };
  const { unread } = useInbox();
  const { today, past } = useSplitInbox();
  const { schedule, progress, scheduleMissing, questions, asking, ask, turns } = useCabinet();
  const { me, isAdmin } = useMe();
  const { dark, toggle } = useThemeMode();
  const navigate = useNavigate();
  const [askView, setAskView] = useState<'dialog' | 'questions'>('dialog');
  useTourHooks('cabinet', { setAskView });
  useStickToBottom(tab, tab === 'chat' ? today.length : tab === 'history' ? past.length : tab === 'ask' ? turns.length : 0);
  useEffect(() => { document.title = 'Мой кабинет · НейроМастер'; }, []);
  const name = firstName(me?.full_name);

  let screen;
  if (tab === 'chat') {
    screen = (
      <>
        <header><div className="nm-kicker">{longDate()}</div><h1>{name ? `${greeting()}, ${name}` : greeting()}</h1></header>
        <SickBanner />
        <ProgressCard stacked progress={progress} schedule={schedule} missing={scheduleMissing} />
        <TodayList />
      </>
    );
  } else if (tab === 'history') {
    screen = (<><header><h1>История</h1></header><HistoryList /></>);
  } else if (tab === 'ask') {
    const open = questions.filter((q) => q.status !== 'resolved').length;
    screen = (
      <>
        <header><h1>Вопрос</h1></header>
        <Segmented label="Раздел" value={askView} onChange={setAskView}
                   options={[{ value: 'dialog', label: 'Диалог' }, { value: 'questions', label: `Мои вопросы${questions.length ? ` · ${open || questions.length}` : ''}` }]} />
        {askView === 'dialog' ? (
          <div className="nm-chat-screen" data-tour="assistant">
            <Assistant compact />
            <div className="nm-composer-dock"><Composer onSend={ask} busy={asking} /></div>
          </div>
        ) : <MyQuestions />}
      </>
    );
  } else {
    screen = (
      <>
        <header><h1>Настройки</h1></header>
        <Card className="nm-row" style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Avatar large text={initials(me?.full_name || me?.username)} />
          <div className="nm-grow">
            <div style={{ fontWeight: 700, fontSize: 18 }}>{me?.full_name || '—'}</div>
            <div className="nm-small nm-muted">{[me?.position, me?.department].filter(Boolean).join(' · ') || `@${me?.username || ''}`}</div>
          </div>
        </Card>
        <Card>
          <dl className="nm-kv">
            <dt>План</dt><dd>{schedule?.plan_title || '—'}</dd>
            <dt>Дата выхода</dt><dd>{ruDate(me?.start_date)}</dd>
            <dt>Наставник</dt><dd>{me?.mentor || '—'}</dd>
            {me?.manager ? <><dt>Руководитель</dt><dd>{me.manager}</dd></> : null}
            <dt>Логин</dt><dd>{me?.username || '—'}</dd>
          </dl>
        </Card>
        <Card style={{ paddingBlock: 6 }}><SettingsToggles withTheme={{ dark, toggle }} /></Card>
        <div className="nm-stack">
          <Button icon={GraduationCap} onClick={() => startTour()}>Как пользоваться</Button>
          {isAdmin && <Button icon={ShieldCheck} onClick={() => navigate('/admin')}>Админка</Button>}
          <Button variant="danger" icon={LogOut} onClick={logout}>Выйти</Button>
        </div>
        <p className="nm-small nm-muted" style={{ textAlign: 'center', margin: 0 }}>Забыли пароль или нужно его сменить — обратитесь к администратору.</p>
      </>
    );
  }

  return (
    <div className="nm-app">
      <main className="nm-app-screen" id="main">{screen}</main>
      <nav className="nm-tabbar" aria-label="Разделы" data-tour="tabbar">
        {TABS.map((t) => (
          <button key={t.id} type="button" aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)} data-tour={`tab-${t.id}`}>
            <t.icon aria-hidden />{t.label}
            {t.id === 'chat' && <Count n={unread} />}
          </button>
        ))}
      </nav>
    </div>
  );
}

export default function Cabinet() {
  const narrow = useNarrow(760);
  useEffect(() => { document.title = 'Мой кабинет · НейроМастер'; }, []);
  return narrow ? <Mobile /> : <Desktop />;
}
