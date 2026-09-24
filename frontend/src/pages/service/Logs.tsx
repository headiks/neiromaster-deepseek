// Журнал действий: входы, неудачные входы, просмотры, клики и действия пользователей.
// Суперадмин видит всех, администратор — свой отдел (фильтрует сервер).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { ROLE } from '@shared/status';
import { api } from '../../lib/api';
import { useMe } from '../../lib/me';
import type { AdminUser } from '../../lib/types';
import { Badge, Button, Card, Chip, Empty, Input, PageHeader, Select, Spinner } from '../../ui';

type Event = { ts: string; user_id?: string; username?: string; role?: string; event_type: string; path?: string; detail?: Record<string, unknown>; ip?: string };
const EVENTS: Record<string, string> = { '': 'Все', login: 'Вход', logout: 'Выход', login_failed: 'Неудачный вход', page_view: 'Просмотр', click: 'Клик', action: 'Действие', client_error: 'Ошибка интерфейса' };
const TONE: Record<string, 'ok' | 'danger' | 'accent' | 'muted' | 'warn'> = { login: 'ok', logout: 'muted', login_failed: 'danger', action: 'accent', click: 'muted', page_view: 'muted', client_error: 'danger' };

function ts(s?: string) {
  const d = s ? new Date(s) : null;
  return d && !isNaN(d.getTime()) ? d.toLocaleString('ru-RU', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : s || '—';
}

export default function Logs() {
  const { isOwner } = useMe();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userId, setUserId] = useState('');
  const [type, setType] = useState('');
  const [events, setEvents] = useState<Event[] | null>(null);
  const [query, setQuery] = useState('');
  useEffect(() => { document.title = 'Журнал действий · НейроМастер'; api.get<{ users: AdminUser[] }>('/users').then((d) => setUsers(d.users || [])).catch(() => {}); }, []);
  const load = useCallback(() => {
    setEvents(null);
    const q = new URLSearchParams({ limit: '500' });
    if (userId) q.set('user_id', userId);
    if (type) q.set('event_type', type);
    api.get<{ events: Event[] }>(`/api/activity?${q}`).then((d) => setEvents(d.events || [])).catch(() => setEvents([]));
  }, [userId, type]);
  useEffect(() => { load(); }, [load]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (events || []).filter((e) => !q || [e.username, e.path, e.ip, JSON.stringify(e.detail || {})].some((v) => (v || '').toLowerCase().includes(q)));
  }, [events, query]);
  return (
    <div className="nm-page">
      <PageHeader title="Журнал действий" subtitle={isOwner ? 'Суперадмин: журнал всех пользователей' : 'Администратор: журнал пользователей вашего отдела'}
                  actions={<Button variant="ghost" icon={RefreshCw} onClick={load}>Обновить</Button>} />
      <div className="nm-row">
        <Select small aria-label="Пользователь" value={userId} onChange={(e) => setUserId(e.target.value)} style={{ width: 'auto', minWidth: 240 }}>
          <option value="">Все пользователи</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.username}{u.username ? ` (@${u.username})` : ''}</option>)}
        </Select>
        <div className="nm-search" style={{ minWidth: 220 }}><Search aria-hidden /><Input small aria-label="Поиск" placeholder="Поиск по странице, IP, деталям" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
        <div className="nm-chips">{Object.entries(EVENTS).map(([k, t]) => <Chip key={k} pressed={type === k} onClick={() => setType(k)}>{t}</Chip>)}</div>
        {events && <span className="nm-small nm-muted">{shown.length} событий</span>}
      </div>
      {events === null ? <Spinner /> : !shown.length ? <Card pad={false}><Empty>Событий нет.</Empty></Card> : (
        <Card pad={false}>
          <div className="nm-table-wrap">
            <table className="nm-edit-table" style={{ fontSize: 13 }}>
              <thead><tr><th>Время</th><th>Пользователь</th><th>Событие</th><th>Страница / действие</th><th>Детали</th><th>IP</th></tr></thead>
              <tbody>
                {shown.map((e, i) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: 'nowrap' }} className="nm-muted">{ts(e.ts)}</td>
                    <td>{e.username || e.user_id || '—'}{e.role && <span className="nm-muted"> · {ROLE[e.role]?.label || e.role}</span>}</td>
                    <td><Badge tone={TONE[e.event_type] || 'muted'}>{EVENTS[e.event_type] || e.event_type}</Badge></td>
                    <td style={{ wordBreak: 'break-all' }}>{e.path || '—'}</td>
                    <td className="nm-micro nm-muted" style={{ maxWidth: 360, wordBreak: 'break-word' }}>{e.detail && Object.keys(e.detail).length ? JSON.stringify(e.detail) : '—'}</td>
                    <td className="nm-micro nm-muted" style={{ whiteSpace: 'nowrap' }}>{e.ip || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
