import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown, ArrowUp, Ban, CalendarDays, Check, Clock, Crown, Download,
  KeyRound, Pencil, Save, TriangleAlert, UserX, Users, X,
} from 'lucide-react';
import { api, apiJson } from '../../lib/api';
import type { Employee, Me, PlanRef } from '../../lib/types';
import Combobox from '../../components/Combobox';

const EMPLOYEE_STATUS_TITLES: Record<string, string> = {
  planned: 'Запланирован', active: 'Проходит адаптацию', paused: 'Приостановлен', done: 'Завершил',
};
const ROLE_TITLES: Record<string, string> = { owner: 'Суперадмин', admin: 'Администратор', employee: 'Сотрудник' };

const EMPTY_FORM = {
  full_name: '', username: '', password: '', position: '', department: '',
  plan_id: '', plan_profession: '', start_date: '', status: 'planned', mentor: '', manager: '', contact: '', notes: '',
};
type Form = typeof EMPTY_FORM;

function whenLabel(msg: any): string {
  if (msg.schedule.send_at) return msg.schedule.send_at.replace('T', ' ');
  const anchor = msg.schedule.anchor === 'before_start' ? 'до выхода' : 'от выхода';
  return `${msg.schedule.offset_days >= 0 ? '+' : ''}${msg.schedule.offset_days} дн. (${anchor}), ${msg.schedule.time}`;
}

export default function Accounts({ me, isOwner }: { me: Me | null; isOwner: boolean }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [plans, setPlans] = useState<PlanRef[]>([]);
  const [form, setForm] = useState<Form>({ ...EMPTY_FORM });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [credFor, setCredFor] = useState<Employee | null>(null);
  const [schedule, setSchedule] = useState<any>(null);
  const [planProfs, setPlanProfs] = useState<string[]>([]);   // профессии выбранного общего плана
  const scheduleRef = useRef<HTMLDivElement>(null);

  const loadEmployees = () => api('/users').then((r) => r.json()).then((d) => setEmployees(d.users || [])).catch(() => {});
  useEffect(() => {
    loadEmployees();
    api('/plans').then((r) => r.json()).then((d) => setPlans(d.plans || [])).catch(() => {});
  }, []);

  // Профессии, под которые у выбранного общего плана уже сгенерированы расписания —
  // из них выбирается «план по профессии» для рассылки.
  useEffect(() => {
    if (!form.plan_id) { setPlanProfs([]); return; }
    api(`/plans/${encodeURIComponent(form.plan_id)}/professions`)
      .then((r) => r.json()).then((d) => setPlanProfs(d.professions || [])).catch(() => setPlanProfs([]));
  }, [form.plan_id]);

  const upd = (k: keyof Form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const positions = [...new Set(employees.map((u) => (u.position || '').trim()).filter(Boolean))].sort();
  const names = [...new Set(employees.map((u) => (u.full_name || '').trim()).filter(Boolean))].sort();

  const resetForm = () => { setForm({ ...EMPTY_FORM }); setEditingId(null); setStatus(''); };

  const editEmployee = (e: Employee) => {
    setEditingId(e.id);
    setForm({
      ...EMPTY_FORM,
      full_name: e.full_name || '', username: e.username || '', password: '',
      position: e.position || '', department: e.department || '', plan_id: e.plan_id || '',
      plan_profession: (e as any).plan_profession || '',
      start_date: e.start_date || '', status: e.status || 'planned', mentor: e.mentor || '',
      manager: e.manager || '', contact: e.contact || '', notes: e.notes || '',
    });
    setStatus('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const save = async () => {
    if (!form.full_name) { setStatus('Укажите ФИО'); return; }
    const isUpdate = Boolean(editingId);
    const payload: Record<string, string | null> = {
      full_name: form.full_name || null, position: form.position || null, department: form.department || null,
      contact: form.contact || null, mentor: form.mentor || null, manager: form.manager || null,
      plan_id: form.plan_id || null, plan_profession: form.plan_profession || null,
      start_date: form.start_date || null, status: form.status || null,
      notes: form.notes || null,
    };
    if (!isUpdate) { payload.username = form.username || null; payload.password = form.password || null; }
    const url = isUpdate ? `/users/${encodeURIComponent(editingId!)}` : '/users';
    const { ok, data } = await apiJson(url, {
      method: isUpdate ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    if (!ok) { setStatus(data.detail || 'Не удалось сохранить'); return; }
    setStatus(`Сохранён: ${data.full_name}`);
    resetForm();
    loadEmployees();
  };

  const deleteEmployee = async (e: Employee) => {
    if (!confirm(`Удалить пользователя «${e.full_name}»? Действие необратимо.`)) return;
    const { ok, data } = await apiJson(`/users/${encodeURIComponent(e.id)}`, { method: 'DELETE' });
    if (!ok) { alert(data.detail || 'Не удалось удалить'); return; }
    if (editingId === e.id) resetForm();
    setSchedule(null);
    loadEmployees();
  };

  const deleteNonAdmins = async () => {
    if (!confirm('Удалить ВСЕХ пользователей, кроме администраторов? Профили и доступы будут удалены безвозвратно.')) return;
    if (!confirm('Точно удалить всех сотрудников? Действие необратимо.')) return;
    const { ok, data } = await apiJson('/users/delete-non-admins', { method: 'POST' });
    if (!ok) { alert(data.detail || 'Не удалось удалить (нужны права главного администратора).'); return; }
    alert(`Удалено пользователей: ${data.deleted}.`);
    loadEmployees();
  };

  const setUserActive = async (id: string, active: boolean) => {
    const { ok, data } = await apiJson(`/users/${encodeURIComponent(id)}/active`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active }),
    });
    if (!ok) { alert(data.detail || 'Не удалось изменить'); return; }
    loadEmployees();
  };

  const setUserRole = async (e: Employee, role: string) => {
    const questions: Record<string, string> = {
      owner: `Сделать «${e.full_name}» суперадмином? Он получит полный доступ: все документы всех администраторов и все сотрудники, раздача прав, удаление.`,
      admin: e.role === 'owner'
        ? `Убрать «${e.full_name}» из суперадминов? Останется обычным администратором (только свой отдел и свои документы).`
        : `Назначить «${e.full_name}» администратором? Он получит доступ к базе знаний, конструктору планов и заведению сотрудников.`,
      employee: `Убрать «${e.full_name}» из администраторов?`,
    };
    if (!confirm(questions[role] || 'Сменить роль?')) return;
    const { ok, data } = await apiJson(`/users/${encodeURIComponent(e.id)}/role`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }),
    });
    if (!ok) { alert(data.detail || 'Не удалось изменить роль'); return; }
    loadEmployees();
  };

  const showSchedule = async (id: string) => {
    setSchedule('loading');
    const { ok, data } = await apiJson(`/users/${encodeURIComponent(id)}/schedule`);
    setSchedule(ok ? { ...data, _id: id } : { error: data.detail });
    setTimeout(() => scheduleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const pending = employees.filter((u) => !u.active);

  return (
    <div className="tab-pane active">
      <h2 className="section-title"><Users /> Пользователи, роли и назначенные планы</h2>

      <div className="card">
        <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: 12 }}>
          {editingId ? `Редактирование: ${form.full_name}` : 'Новый сотрудник'}
        </div>
        <div className="employee-form">
          <Field label="ФИО *"><input type="text" placeholder="Иванов Иван Иванович" value={form.full_name} onChange={(e) => upd('full_name')(e.target.value)} /></Field>
          <Field label={<>Логин {!editingId && <span style={{ color: '#94a3b8' }}>(можно выдать позже)</span>}</>}>
            <input type="text" placeholder="ivanov" value={form.username} disabled={!!editingId} onChange={(e) => upd('username')(e.target.value)} />
          </Field>
          <Field label="Временный пароль"><input type="text" placeholder="сотрудник сменит его при первом входе" value={form.password} disabled={!!editingId} onChange={(e) => upd('password')(e.target.value)} /></Field>
          <Field label="Должность"><Combobox value={form.position} onChange={upd('position')} options={positions} placeholder="Выбор из штатки или введите свою" /></Field>
          <Field label="Подразделение"><input type="text" placeholder="Автотранспортный цех" value={form.department} onChange={(e) => upd('department')(e.target.value)} /></Field>
          <Field label="Общий план адаптации">
            <select value={form.plan_id} onChange={(e) => { upd('plan_id')(e.target.value); upd('plan_profession')(''); }}>
              <option value="">— план не назначен —</option>
              {plans.map((p) => <option key={p.plan_id} value={p.plan_id}>{p.title}{p.generated ? '' : ' (без ответов)'}</option>)}
            </select>
          </Field>
          <Field label="План по профессии (для рассылки)">
            <select value={form.plan_profession} onChange={(e) => upd('plan_profession')(e.target.value)} disabled={!form.plan_id}>
              <option value="">По должности сотрудника ({form.position || 'не указана'})</option>
              {planProfs.map((pr) => <option key={pr} value={pr}>{pr}</option>)}
              {form.plan_profession && !planProfs.includes(form.plan_profession)
                ? <option value={form.plan_profession}>{form.plan_profession}</option> : null}
            </select>
          </Field>
          <Field label="Дата выхода на работу"><input type="date" value={form.start_date} onChange={(e) => upd('start_date')(e.target.value)} /></Field>
          <Field label="Статус">
            <select value={form.status} onChange={(e) => upd('status')(e.target.value)}>
              <option value="planned">Запланирован</option>
              <option value="active">Проходит адаптацию</option>
              <option value="paused">Приостановлен</option>
              <option value="done">Завершил</option>
            </select>
          </Field>
          <Field label="Наставник"><Combobox value={form.mentor} onChange={upd('mentor')} options={names} placeholder="Выбор из сотрудников" /></Field>
          <Field label="Руководитель"><Combobox value={form.manager} onChange={upd('manager')} options={names} placeholder="Выбор из сотрудников" /></Field>
          <Field label="Контакт сотрудника"><input type="text" placeholder="телефон, telegram или email" value={form.contact} onChange={(e) => upd('contact')(e.target.value)} /></Field>
        </div>
        <Field label="Заметки" style={{ marginTop: 12 }}><textarea placeholder="Любые пометки по сотруднику" value={form.notes} onChange={(e) => upd('notes')(e.target.value)} /></Field>
        <div className="toolbar">
          <button className="primary-btn" onClick={save}><Save /> Сохранить</button>
          <button className="ghost-btn" onClick={resetForm}>Очистить форму</button>
          <span style={{ color: '#475569', fontSize: 14 }}>{status}</span>
        </div>
      </div>

      {pending.length > 0 && (
        <div className="warn" style={{ marginTop: 16 }}>
          <Clock /> Ждут подтверждения: {pending.map((u) => u.full_name).join(', ')}. Пока учётная запись не подтверждена, войти в систему нельзя.
        </div>
      )}

      <div className="section-head-row" style={{ marginTop: 24 }}>
        <h2 className="section-title"><Users /> Список пользователей</h2>
        <button className="del-btn" onClick={deleteNonAdmins}><UserX /> Удалить всех (кроме админов)</button>
      </div>

      {!employees.length ? (
        <div className="empty-hint">Пользователей пока нет — заведите первого в форме выше.</div>
      ) : (
        <table className="schedule">
          <thead><tr><th>Пользователь</th><th>Роль</th><th>План адаптации</th><th>Дата выхода</th><th>Статус</th><th>Действия</th></tr></thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.id} style={e.active ? undefined : { background: '#fffbeb' }}>
                <td>
                  <strong>{e.full_name}</strong>
                  <div className="msg-meta">{e.username ? '@' + e.username : <span style={{ color: '#b45309' }}>нет логина — войти не может</span>}{e.must_change_credentials ? ' · сменит пароль при входе' : ''}</div>
                  <div className="msg-meta">{[e.position, e.department].filter(Boolean).join(' · ') || '—'}</div>
                  {!e.active && <div className="msg-meta" style={{ color: '#b45309' }}>не подтверждён</div>}
                </td>
                <td><span className={`status-badge ${e.role === 'employee' ? 'planned' : 'active'}`}>{ROLE_TITLES[e.role] || e.role}</span></td>
                <td>
                  {e.plan_title ? e.plan_title : <span style={{ color: '#dc2626' }}>не назначен</span>}
                  {e.plan_title && !e.plan_generated && <div className="msg-meta" style={{ color: '#b45309' }}>ответы не сгенерированы</div>}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>{e.start_date || '—'}</td>
                <td><span className={`status-badge ${e.status}`}>{EMPLOYEE_STATUS_TITLES[e.status || ''] || e.status}</span></td>
                <td><UserActions e={e} me={me} isOwner={isOwner}
                  onSchedule={showSchedule} onEdit={editEmployee} onCred={setCredFor}
                  onActive={setUserActive} onRole={setUserRole} onDelete={deleteEmployee} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div id="employee-schedule" ref={scheduleRef}>
        {schedule === 'loading' && <div className="empty-hint">Считаем расписание...</div>}
        {schedule && schedule !== 'loading' && schedule.error && (
          <div className="warn"><TriangleAlert /> {schedule.error}</div>
        )}
        {schedule && schedule !== 'loading' && !schedule.error && <ScheduleView data={schedule} />}
      </div>

      {credFor && <CredentialsDialog employee={credFor} onClose={() => setCredFor(null)} onSaved={() => { setCredFor(null); loadEmployees(); }} />}
    </div>
  );
}

function Field({ label, children, style }: { label: React.ReactNode; children: React.ReactNode; style?: React.CSSProperties }) {
  return <div className="field" style={style}><label>{label}</label>{children}</div>;
}

function UserActions({ e, me, isOwner, onSchedule, onEdit, onCred, onActive, onRole, onDelete }: {
  e: Employee; me: Me | null; isOwner: boolean;
  onSchedule: (id: string) => void; onEdit: (e: Employee) => void; onCred: (e: Employee) => void;
  onActive: (id: string, active: boolean) => void; onRole: (e: Employee, role: string) => void; onDelete: (e: Employee) => void;
}) {
  const isSelf = me?.id === e.id;
  const manageable = isOwner || e.role === 'employee';
  return (
    <>
      <button className="icon-btn" onClick={() => onSchedule(e.id)}><CalendarDays /> Расписание</button>
      {manageable && <>
        <button className="icon-btn" onClick={() => onEdit(e)}><Pencil /> Изменить</button>
        <button className="icon-btn" onClick={() => onCred(e)}><KeyRound /> Доступ</button>
        {!isSelf && (e.active
          ? <button className="icon-btn" onClick={() => onActive(e.id, false)}><Ban /> Заблокировать</button>
          : <button className="icon-btn" onClick={() => onActive(e.id, true)}><Check /> Подтвердить</button>)}
      </>}
      {isOwner && !isSelf && <>
        {e.role === 'owner' ? (
          <button className="icon-btn" onClick={() => onRole(e, 'admin')}><ArrowDown /> Убрать из суперадминов</button>
        ) : e.role === 'admin' ? (
          <>
            <button className="icon-btn" onClick={() => onRole(e, 'employee')}><ArrowDown /> Убрать из администраторов</button>
            <button className="icon-btn" onClick={() => onRole(e, 'owner')}><Crown /> Сделать суперадмином</button>
          </>
        ) : (
          <button className="icon-btn" onClick={() => onRole(e, 'admin')}><ArrowUp /> Назначить администратором</button>
        )}
        <button className="icon-btn danger" onClick={() => onDelete(e)}><X /> Удалить</button>
      </>}
    </>
  );
}

function CredentialsDialog({ employee, onClose, onSaved }: { employee: Employee; onClose: () => void; onSaved: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [username, setUsername] = useState(employee.username || '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { ref.current?.showModal(); }, []);

  const submit = async () => {
    if (!username.trim() && !password) { setError('Укажите логин или пароль'); return; }
    const { ok, data } = await apiJson(`/users/${encodeURIComponent(employee.id)}/credentials`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.trim() || null, password: password || null }),
    });
    if (!ok) { setError(data.detail || 'Не удалось сохранить'); return; }
    onSaved();
  };

  return (
    <dialog ref={ref} onClose={onClose}>
      <h3 style={{ marginTop: 0 }}>Доступ: {employee.full_name}</h3>
      <label>Логин</label>
      <input type="text" placeholder="ivanov" value={username} onChange={(e) => setUsername(e.target.value)} />
      <label>Новый временный пароль</label>
      <input type="text" placeholder="оставьте пустым, чтобы не менять" value={password} onChange={(e) => setPassword(e.target.value)} />
      <div style={{ fontSize: 12, color: '#94a3b8', margin: '-8px 0 14px' }}>
        После смены пароля пользователь при следующем входе задаст свой собственный.
      </div>
      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="primary-btn" style={{ flex: 1, padding: 9 }} onClick={submit}>Сохранить</button>
        <button className="ghost-btn" onClick={onClose}>Отмена</button>
      </div>
    </dialog>
  );
}

function ScheduleView({ data }: { data: any }) {
  const base = `/users/${encodeURIComponent(data._id)}/export`;
  return (
    <>
      <h2 className="section-title"><CalendarDays /> Расписание: {data.employee.full_name}</h2>
      <div className="stage-hint">
        План «{data.plan_title}» · дата выхода {data.start_date} · сообщений: {(data.messages || []).length}
      </div>
      {!data.plan_generated && (
        <div className="warn"><TriangleAlert /> У плана «{data.plan_title}» ещё не сгенерированы ответы. Даты рассчитаны, тексты пустые — запустите генерацию на вкладке «Тексты плана».</div>
      )}
      <div className="export-links">
        <a href={`${base}/schedule.md`} download><Download /> schedule.md</a>
        <a href={`${base}/schedule.json`} download><Download /> schedule.json</a>
      </div>
      <table className="schedule">
        <thead><tr><th>Этап</th><th>Подэтап</th><th>Дата и время</th><th>Сообщение</th></tr></thead>
        <tbody>
          {(data.messages || []).map((msg: any, i: number) => (
            <tr key={i}>
              <td>{msg.stage.order}. {msg.stage.title}</td>
              <td>{msg.substage.order}. {msg.substage.title}<div className="msg-meta">{msg.substage.kind}</div></td>
              <td style={{ whiteSpace: 'nowrap' }}>{whenLabel(msg)}</td>
              <td>
                <div className="msg-text">{msg.content.text || '—'}</div>
                {msg.error && <div className="msg-error"><TriangleAlert /> {msg.error}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
