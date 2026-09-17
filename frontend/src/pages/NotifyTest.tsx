import { useEffect, useState } from 'react';
import { Bell, BellRing, Plus, SendHorizontal, X } from 'lucide-react';
import { api, apiJson } from '../lib/api';
import { useMe } from '../lib/useMe';
import { pollNow, startNotifications } from '../lib/notify';
import Header from '../components/Header';
import type { Employee } from '../lib/types';

interface Row { title: string; body: string; delay: number }
const DEMO: Row[] = [
  { title: 'Добро пожаловать', body: 'Первый рабочий день — знакомство с командой в 10:00.', delay: 0 },
  { title: 'Охрана труда', body: 'Пройди вводный инструктаж и распишись в журнале.', delay: 60 },
  { title: 'Пропуск', body: 'Забери пропуск на ресепшене до конца дня.', delay: 120 },
];

export default function NotifyTest() {
  const me = useMe();
  const [users, setUsers] = useState<Employee[]>([]);
  const [userId, setUserId] = useState('');
  const [rows, setRows] = useState<Row[]>([{ title: '', body: '', delay: 0 }]);
  const [perm, setPerm] = useState<string>('');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const secure = typeof window !== 'undefined' && window.isSecureContext;

  useEffect(() => {
    startNotifications();
    renderPerm();
    if ('Notification' in window && secure && Notification.permission === 'default') Notification.requestPermission().then(renderPerm);
    api('/users').then((r) => r.json()).then((d) => {
      const list = (d.users || []).filter((u: any) => u.has_account);
      setUsers(list);
    }).catch(() => {});
  }, []);
  useEffect(() => { if (me?.id) setUserId(me.id); }, [me]);

  const renderPerm = () => {
    if (!('Notification' in window)) { setPerm('не поддерживается'); return; }
    if (!secure) { setPerm('недоступно (нужен HTTPS)'); return; }
    setPerm(Notification.permission === 'granted' ? 'разрешено' : Notification.permission === 'denied' ? 'запрещено' : 'не задано');
  };
  const askPerm = () => { if ('Notification' in window && secure) Notification.requestPermission().then(renderPerm); };

  const setRow = (i: number, k: keyof Row, v: string | number) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  const send = async () => {
    setResult(null);
    const messages = rows.map((r) => ({ title: r.title.trim(), body: r.body.trim(), delay: Math.max(0, r.delay || 0) })).filter((m) => m.title || m.body);
    if (!userId) { setResult({ ok: false, text: 'Выбери пользователя.' }); return; }
    if (!messages.length) { setResult({ ok: false, text: 'Добавь хотя бы одно сообщение.' }); return; }
    setBusy(true);
    const { ok, data } = await apiJson(`/users/${encodeURIComponent(userId)}/notify-test`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages }),
    });
    setBusy(false);
    if (!ok) { setResult({ ok: false, text: data.detail || 'Не удалось отправить' }); return; }
    const self = me && userId === me.id;
    const sched = data.scheduled ? ` Из них по времени: ${data.scheduled} (выпустит планировщик, до ~минуты).` : '';
    setResult({ ok: true, text: `Отправлено ${data.sent} для «${data.target}». Непрочитано у него: ${data.unread}.${sched}${self && !data.scheduled ? ' Сейчас всплывёт здесь ↗' : ''}` });
    if (self) pollNow();
  };

  return (
    <div className="app-page">
      <Header title="Тест уведомлений" actions={<a className="ghost-btn" href="/admin">← Админка</a>} />

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Браузерные уведомления</h3>
        <div className="row" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>Статус разрешения: <span className="status-badge">{perm || '…'}</span></span>
          <button className="ghost-btn" disabled={!secure} onClick={askPerm}><BellRing /> Разрешить</button>
        </div>
        {secure ? (
          <div className="stage-hint" style={{ marginTop: 8 }}>Без разрешения всплывашки в углу страницы всё равно работают — не работает только системное уведомление ОС.</div>
        ) : (
          <div className="error" style={{ marginTop: 10 }}>Сайт открыт по HTTP — браузер запрещает системные уведомления (нужен HTTPS или localhost). Всплывашки на этой странице работают — отправь себе и проверь очередь.</div>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Отправка</h3>
        <label>Кому</label>
        <select value={userId} onChange={(e) => setUserId(e.target.value)}>
          {!users.length && <option value="">Нет пользователей с аккаунтом</option>}
          {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.username}{u.id === me?.id ? ' — это я' : ''} · {u.role || 'employee'}</option>)}
        </select>
        <div className="stage-hint" style={{ marginTop: 6 }}>Выбери <b>себя</b> — уведомления всплывут прямо здесь. Выберешь другого — увидит очередь на своей странице.</div>

        <div style={{ marginTop: 14 }}>
          {rows.map((r, i) => (
            <div key={i} style={{ border: '1px solid var(--color-divider)', padding: 12, marginBottom: 10 }}>
              <input type="text" placeholder="Заголовок (необязательно)" value={r.title} onChange={(e) => setRow(i, 'title', e.target.value)} />
              <textarea rows={2} placeholder="Текст сообщения" value={r.body} onChange={(e) => setRow(i, 'body', e.target.value)} style={{ marginTop: 8 }} />
              <div className="row" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                <label style={{ margin: 0 }}>Отправить через</label>
                <input type="number" min={0} step={5} value={r.delay} onChange={(e) => setRow(i, 'delay', parseInt(e.target.value, 10) || 0)} style={{ width: 90 }} />
                <span className="stage-hint">сек (0 — сразу)</span>
                <button className="icon-btn danger" style={{ marginLeft: 'auto' }} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}><X /></button>
              </div>
            </div>
          ))}
        </div>
        <button className="ghost-btn" onClick={() => setRows((rs) => [...rs, { title: '', body: '', delay: 0 }])}><Plus /> Добавить сообщение</button>

        {result && <div className={result.ok ? 'success' : 'error'} style={{ marginTop: 12 }}>{result.text}</div>}
        <div className="row" style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
          <button className="primary-btn" disabled={busy} onClick={send}><SendHorizontal /> Отправить</button>
          <button className="ghost-btn" onClick={() => setRows(DEMO.map((d) => ({ ...d })))}><Bell /> Заполнить примером (3 шт.)</button>
        </div>
      </div>
    </div>
  );
}
