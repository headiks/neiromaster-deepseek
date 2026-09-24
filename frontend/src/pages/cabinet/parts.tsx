// Части кабинета, общие для широкой и мобильной раскладок.
import { useEffect, useMemo, useState } from 'react';
import { BellRing, CalendarCheck, History as HistoryIcon, Inbox } from 'lucide-react';
import type { Msg } from '@shared/types';
import { dayLabel, msgDay, ymd } from '@shared/format';
import { whenNext } from '@shared/progress';
import { useInbox, notifyEnabled, NOTIFY_KEY } from '../../lib/inbox';
import { useCabinet } from '../../lib/cabinet';
import { useMe } from '../../lib/me';
import { api, messageOf } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { MessageCard } from '../../blocks/MessageCard';
import { Card, Empty, Spinner, Toggle } from '../../ui';

/** Сообщения сегодняшнего дня и прошлых дней (старые сверху, новые снизу). */
export function useSplitInbox() {
  const { messages } = useInbox();
  return useMemo(() => {
    const today = ymd();
    const own: Msg[] = [], past: Msg[] = [];
    messages.forEach((m) => { const d = msgDay(m); if (d === today) own.push(m); else if (d && d < today) past.push(m); });
    const days = [...new Set(past.map(msgDay))].sort();
    return { today: own, past, days };
  }, [messages]);
}

export function TodayList({ wide }: { wide?: boolean }) {
  const { loaded, answer, markRead } = useInbox();
  const { today } = useSplitInbox();
  // Показанное в «Сегодня» считаем прочитанным (как в приложении).
  useEffect(() => { if (today.some((m) => m.status === 'delivered')) markRead(today); }, [today, markRead]);
  if (!loaded) return <div className="nm-skeleton" aria-hidden />;
  if (!today.length) return <Card pad={false}><Empty icon={Inbox}>Сегодня новых сообщений плана нет.</Empty></Card>;
  return <div className="nm-stack" data-tour="today">{today.map((m) => <MessageCard key={m.id} m={m} onAnswer={answer} wide={wide} />)}</div>;
}

export function HistoryList({ wide }: { wide?: boolean }) {
  const { loaded, answer } = useInbox();
  const { past, days } = useSplitInbox();
  if (!loaded) return <Spinner />;
  if (!days.length) return <Card pad={false}><Empty icon={HistoryIcon}>История пуста — прошлых сообщений ещё нет.</Empty></Card>;
  return (
    <div className="nm-stack" data-tour="history">
      {days.map((d) => (
        <section key={d} className="nm-stack" aria-label={dayLabel(d)}>
          <div className="nm-day-label">{dayLabel(d)}</div>
          {past.filter((m) => msgDay(m) === d).map((m) => <MessageCard key={m.id} m={m} onAnswer={answer} wide={wide} />)}
        </section>
      ))}
    </div>
  );
}

export function UpNext() {
  const { progress, scheduleMissing } = useCabinet();
  if (scheduleMissing || !progress) return null;
  if (!progress.upcoming.length) {
    return <Card pad={false}><Empty icon={CalendarCheck}>{progress.finished ? 'Все сообщения плана уже пришли.' : 'Следующих сообщений по плану пока нет.'}</Empty></Card>;
  }
  return (
    <Card pad={false} data-tour="upnext">
      {progress.upcoming.slice(0, 4).map((u, i) => (
        <div className="nm-upnext" key={i}>
          <div className="nm-upnext-when">{whenNext(progress, u.at)}</div>
          <div>
            <div className="nm-upnext-title">{u.title}</div>
            {u.brief && <div className="nm-upnext-brief">{u.brief.length > 140 ? `${u.brief.slice(0, 140)}…` : u.brief}</div>}
          </div>
        </div>
      ))}
    </Card>
  );
}

/** Больничный: пауза доставки сообщений плана (сервер уведомит наставника). */
export function useSick() {
  const { me, setMe } = useMe();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const sick = me?.status === 'paused';
  const set = async (on: boolean) => {
    if (!me) return;
    setBusy(true);
    try {
      const r = await api.setSick(on);
      setMe({ ...me, status: r.sick ? 'paused' : r.status || 'active' });
      toast.ok(r.sick ? 'Отметили больничный: план на паузе.' : 'С возвращением! План продолжится с того места, где вы остановились.');
    } catch (e) {
      toast.error(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  return { sick, set, busy };
}

/** Уведомления браузера о новых сообщениях плана. */
export function useBrowserNotify() {
  const supported = 'Notification' in window;
  const [on, setOn] = useState(notifyEnabled);
  const set = async (want: boolean) => {
    if (!supported) return;
    if (want && Notification.permission !== 'granted') {
      const p = await Notification.requestPermission().catch(() => 'denied' as NotificationPermission);
      if (p !== 'granted') { setOn(false); return; }
    }
    try { localStorage.setItem(NOTIFY_KEY, want ? '1' : '0'); } catch { /* приватный режим */ }
    setOn(want);
  };
  return { supported, on, set, denied: supported && Notification.permission === 'denied' };
}

export function SettingsToggles({ withTheme }: { withTheme?: { dark: boolean; toggle: () => void } }) {
  const sick = useSick();
  const notify = useBrowserNotify();
  return (
    <div data-tour="settings-toggles">
      {withTheme && (
        <div className="nm-setting">
          <div className="nm-grow"><div className="nm-setting-title">Тёмная тема</div><div className="nm-setting-sub">Светлое или тёмное оформление</div></div>
          <Toggle label="Тёмная тема" checked={withTheme.dark} onChange={withTheme.toggle} />
        </div>
      )}
      {notify.supported && (
        <div className="nm-setting">
          <div className="nm-grow">
            <div className="nm-setting-title"><BellRing aria-hidden style={{ width: 15, height: 15, verticalAlign: '-2px', marginRight: 6 }} />Уведомления</div>
            <div className="nm-setting-sub">{notify.denied ? 'Запрещены в настройках браузера' : 'Сообщать о новых сообщениях плана'}</div>
          </div>
          <Toggle label="Уведомления" checked={notify.on} onChange={notify.set} disabled={notify.denied} />
        </div>
      )}
      <div className="nm-setting" data-tour="sick">
        <div className="nm-grow">
          <div className="nm-setting-title">Я на больничном</div>
          <div className="nm-setting-sub">План на паузе, наставник получит уведомление. После выхода план продолжится с того места, где вы остановились.</div>
        </div>
        <Toggle label="Я на больничном" checked={sick.sick} onChange={sick.set} disabled={sick.busy} />
      </div>
    </div>
  );
}
