import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { useMe } from '../lib/useMe';
import Header from '../components/Header';
import type { Employee } from '../lib/types';

const EVENTS: Record<string, string> = {
  '': 'Все', login: 'Вход', logout: 'Выход', login_failed: 'Неудачный вход', page_view: 'Просмотр', click: 'Клик', action: 'Действие',
};
const roleTitle = (r?: string) => ({ owner: 'Суперадмин', admin: 'Администратор', employee: 'Сотрудник' } as Record<string, string>)[r || ''] || r || '';
function fmtTs(s?: string) {
  if (!s) return '—';
  const d = new Date(s);
  return isNaN(+d) ? s : d.toLocaleString('ru-RU', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function Logs() {
  const me = useMe();
  const [users, setUsers] = useState<Employee[]>([]);
  const [userId, setUserId] = useState('');
  const [eventType, setEventType] = useState('');
  const [events, setEvents] = useState<any[] | null>(null);

  useEffect(() => { api('/users').then((r) => r.json()).then((d) => setUsers(d.users || [])).catch(() => {}); }, []);

  const load = () => {
    const q = new URLSearchParams();
    if (userId) q.set('user_id', userId);
    if (eventType) q.set('event_type', eventType);
    q.set('limit', '500');
    setEvents(null);
    api('/api/activity?' + q.toString()).then((r) => r.json()).then((d) => setEvents(d.events || [])).catch(() => setEvents([]));
  };
  useEffect(load, [userId, eventType]);

  const scope = me?.role === 'owner' ? 'Суперадмин: журнал всех пользователей' : me ? 'Администратор: журнал пользователей вашего отдела' : 'Кто что делал в системе';

  return (
    <div className="admin-page">
      <Header title="Журнал действий" actions={<><button className="ghost-btn" onClick={load}><RefreshCw /> Обновить</button><a className="ghost-btn" href="/admin">← Админка</a></>} />
      <div className="stage-hint">{scope}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16, marginTop: 18 }} className="logs-layout">
        <div className="card" style={{ padding: 0, maxHeight: '72vh', overflow: 'auto' }}>
          <button className={`u${userId === '' ? ' on' : ''}`} style={rowStyle(userId === '')} onClick={() => setUserId('')}>
            <div style={{ fontWeight: 600 }}>Все пользователи</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>события всех, кого вы видите</div>
          </button>
          {users.map((u) => (
            <button key={u.id} style={rowStyle(userId === u.id)} onClick={() => setUserId(u.id)}>
              <div style={{ fontWeight: 600 }}>{u.full_name || u.username || '—'}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{u.username ? '@' + u.username : 'без логина'}{u.department ? ' · ' + u.department : ''}</div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>{roleTitle(u.role)}</div>
            </button>
          ))}
        </div>
        <div>
          <div className="toolbar" style={{ marginBottom: 12 }}>
            {Object.entries(EVENTS).map(([k, label]) => (
              <button key={k} className={`ghost-btn${eventType === k ? ' active-chip' : ''}`} style={eventType === k ? { background: 'var(--color-accent)', color: 'var(--color-bg)', borderColor: 'var(--color-accent)' } : undefined} onClick={() => setEventType(k)}>{label}</button>
            ))}
            <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 14 }}>{events ? `${events.length} событий` : ''}</span>
          </div>
          <table className="schedule">
            <thead><tr><th>Время</th><th>Пользователь</th><th>Событие</th><th>Страница / действие</th><th>Детали</th><th>IP</th></tr></thead>
            <tbody>
              {!events ? <tr><td colSpan={6} className="empty-hint">Загрузка…</td></tr>
                : !events.length ? <tr><td colSpan={6} className="empty-hint">Событий нет.</td></tr>
                : events.map((e, i) => {
                  const det = e.detail && Object.keys(e.detail).length ? JSON.stringify(e.detail) : '';
                  return (
                    <tr key={i}>
                      <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)', fontSize: 13 }}>{fmtTs(e.ts)}</td>
                      <td>{e.username || e.user_id || '—'}{e.role ? ` · ${roleTitle(e.role)}` : ''}</td>
                      <td><span className={`status-badge ${e.event_type}`}>{EVENTS[e.event_type] || e.event_type}</span></td>
                      <td style={{ color: 'var(--muted)' }}>{e.path || '—'}</td>
                      <td style={{ color: 'var(--muted)', fontSize: 13 }}>{det || '—'}</td>
                      <td className="mono" style={{ color: 'var(--muted)' }}>{e.ip || '—'}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const rowStyle = (on: boolean): React.CSSProperties => ({
  display: 'block', width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid var(--color-divider)',
  background: on ? 'var(--color-accent-100)' : 'none', padding: '10px 15px', cursor: 'pointer', font: 'inherit', color: 'var(--color-text)',
  boxShadow: on ? 'inset 3px 0 0 var(--color-accent)' : undefined,
});
