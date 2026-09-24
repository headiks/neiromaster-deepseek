// Тест уведомлений: отправить пользователю одно или несколько сообщений (сразу или с задержкой)
// и проверить, что они приходят в кабинет, приложение и пушем.
import { useEffect, useState } from 'react';
import { Bell, Plus, Send, Sparkles, X } from 'lucide-react';
import { api, enc, messageOf } from '../../lib/api';
import { useMe } from '../../lib/me';
import { useInbox } from '../../lib/inbox';
import type { AdminUser } from '../../lib/types';
import { Badge, Button, Callout, Card, Field, Input, PageHeader, Select, Textarea } from '../../ui';

type Row = { title: string; body: string; delay: number };
const blank = (): Row => ({ title: '', body: '', delay: 0 });

export default function NotifyTest() {
  const { me } = useMe();
  const inbox = useInbox();
  const [users, setUsers] = useState<(AdminUser & { has_account?: boolean })[]>([]);
  const [userId, setUserId] = useState('');
  const [rows, setRows] = useState<Row[]>([blank()]);
  const [result, setResult] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>('Notification' in window ? Notification.permission : 'unsupported');
  useEffect(() => {
    document.title = 'Тест уведомлений · НейроМастер';
    api.get<{ users: (AdminUser & { has_account?: boolean })[] }>('/users').then((d) => {
      const list = (d.users || []).filter((u) => u.has_account ?? !!u.username);
      setUsers(list);
      setUserId((cur) => cur || (list.some((u) => u.id === me?.id) ? me!.id : list[0]?.id || ''));
    }).catch(() => {});
  }, [me]);
  const demo = () => setRows([
    { title: 'Добро пожаловать', body: 'Первый рабочий день — знакомство с командой в 10:00.', delay: 0 },
    { title: 'Охрана труда', body: 'Пройдите вводный инструктаж и распишитесь в журнале.', delay: 60 },
    { title: 'Пропуск', body: 'Заберите пропуск на ресепшене до конца дня.', delay: 120 },
  ]);
  const send = async () => {
    const messages = rows.map((r) => ({ title: r.title.trim(), body: r.body.trim(), delay: Math.max(0, r.delay || 0) })).filter((m) => m.title || m.body);
    if (!userId) { setResult({ tone: 'danger', text: 'Выберите пользователя.' }); return; }
    if (!messages.length) { setResult({ tone: 'danger', text: 'Добавьте хотя бы одно сообщение.' }); return; }
    setBusy(true); setResult(null);
    try {
      const d = await api.post<{ sent: number; target: string; unread: number; scheduled?: number }>(`/users/${enc(userId)}/notify-test`, { messages });
      setResult({ tone: 'ok', text: `Отправлено ${d.sent} для «${d.target}». Непрочитано: ${d.unread}.${d.scheduled ? ` По времени: ${d.scheduled} (выпустит планировщик, до ~минуты).` : ''}` });
      if (userId === me?.id) inbox.reload();
    } catch (e) { setResult({ tone: 'danger', text: messageOf(e) }); } finally { setBusy(false); }
  };
  const secure = window.isSecureContext;
  return (
    <div className="nm-page">
      <PageHeader title="Тест уведомлений" subtitle="Отправьте пользователю сообщения и проверьте, что они приходят в кабинет, приложение и пушем." />
      <Card>
        <div className="nm-row-between">
          <div className="nm-row"><Bell aria-hidden /><b>Уведомления этого браузера</b>
            <Badge tone={perm === 'granted' ? 'ok' : perm === 'denied' || perm === 'unsupported' || !secure ? 'danger' : 'muted'}>
              {perm === 'unsupported' ? 'не поддерживается' : !secure ? 'нужен HTTPS' : perm === 'granted' ? 'разрешено' : perm === 'denied' ? 'запрещено' : 'не задано'}</Badge>
          </div>
          {perm === 'default' && secure && <Button size="sm" onClick={() => Notification.requestPermission().then(setPerm)}>Разрешить</Button>}
        </div>
      </Card>
      <Card>
        <Field label="Кому">
          <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
            {!users.length && <option value="">Нет пользователей с учётной записью</option>}
            {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.username}{u.id === me?.id ? ' — это я' : ''}</option>)}
          </Select>
        </Field>
        {rows.map((r, i) => (
          <div key={i} className="nm-sub">
            <div className="nm-row-between"><b className="nm-small">Сообщение {i + 1}</b>
              {rows.length > 1 && <Button size="sm" variant="ghost" iconOnly icon={X} aria-label="Удалить сообщение" onClick={() => setRows(rows.filter((_, j) => j !== i))} />}</div>
            <Input small placeholder="Заголовок (необязательно)" value={r.title} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
            <Textarea placeholder="Текст сообщения" style={{ minHeight: 70 }} value={r.body} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)))} />
            <div className="nm-row"><span className="nm-small nm-muted">Отправить через</span>
              <Input small type="number" min={0} step={5} value={r.delay} style={{ width: 100 }} aria-label="Задержка, сек"
                     onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, delay: Number(e.target.value) || 0 } : x)))} />
              <span className="nm-small nm-muted">сек (0 — сразу)</span></div>
          </div>
        ))}
        <div className="nm-row">
          <Button icon={Plus} onClick={() => setRows([...rows, blank()])}>Ещё сообщение</Button>
          <Button variant="ghost" icon={Sparkles} onClick={demo}>Пример из трёх</Button>
          <span className="nm-grow" />
          <Button variant="primary" icon={Send} loading={busy} onClick={send}>Отправить</Button>
        </div>
        {result && <Callout tone={result.tone}>{result.text}</Callout>}
      </Card>
    </div>
  );
}
