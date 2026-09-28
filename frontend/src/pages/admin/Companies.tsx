// Суперадмин: компании-клиенты (у каждой своя схема БД и свой администратор), сводка по ним
// и баланс DeepSeek. Логин и пароль администратора новой компании показываются один раз.
import { useCallback, useEffect, useState } from 'react';
import { Building2, Copy, Plus, RefreshCw, Wallet } from 'lucide-react';
import { api, messageOf } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Button, Callout, Card, Empty, Field, Input, PageHeader, Progress, SectionLabel, Spinner } from '../../ui';
import { Dialog } from '../../ui/Dialog';

type Company = {
  slug: string; schema: string; company: string; created_at: string; error?: string;
  admins?: number; curators?: number; employees?: number; employees_with_plan?: number;
  documents?: number; plans?: number; messages_delivered?: number; messages_read?: number;
  questions_open?: number; active_users_30d?: number; last_activity?: string; deepseek_tokens_30d?: number;
};
type Balance = { ok: boolean; error?: string; total?: number; currency?: string; budget?: number; percent_left?: number; available?: boolean };
type Created = { company: string; schema: string; admin: { full_name: string; username: string; password: string } };

const num = (n?: number) => (n ?? 0).toLocaleString('ru-RU');
const date = (s?: string) => {
  const d = s ? new Date(s) : null;
  return d && !isNaN(d.getTime()) ? d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
};

function BalanceCard({ b }: { b: Balance | null }) {
  if (!b) return <Card><Spinner label="Баланс DeepSeek…" /></Card>;
  if (!b.ok) return <Callout tone="warn" icon={Wallet}>{b.error || 'Баланс DeepSeek недоступен'}</Callout>;
  const left = (b.percent_left ?? 0) / 100;
  return (
    <Card>
      <div className="nm-row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <span className="nm-row" style={{ gap: 8 }}><Wallet aria-hidden style={{ width: 18, height: 18 }} /><b>Баланс DeepSeek</b></span>
        <span><b>{(b.total ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} {b.currency}</b>
          <span className="nm-muted"> из {(b.budget ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} · осталось {b.percent_left}%</span></span>
      </div>
      <Progress value={left} tone={left < 0.15 ? 'danger' : 'ok'} label="Остаток баланса DeepSeek" />
      <div className="nm-micro nm-muted" style={{ marginTop: 8 }}>
        100% — наибольший баланс после пополнения (или NEIROMASTER_DEEPSEEK_BUDGET).{!b.available && ' Счёт DeepSeek сейчас неактивен.'}
      </div>
    </Card>
  );
}

function CreateDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (c: Created) => void }) {
  const [company, setCompany] = useState('');
  const [slug, setSlug] = useState('');
  const [admin, setAdmin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setCompany(''); setSlug(''); setAdmin(''); setError(null); } }, [open]);
  const save = async () => {
    if (!company.trim()) { setError('Укажите название компании'); return; }
    setBusy(true);
    setError(null);
    try {
      onCreated(await api.post<Created>('/api/companies', { company, slug: slug || null, admin_full_name: admin || null }));
    } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onClose={onClose} title="Новая компания"
            subtitle="Своя изолированная база данных и один администратор. Он заводит кураторов и сотрудников."
            footer={<><Button variant="ghost" onClick={onClose}>Отмена</Button><Button variant="primary" loading={busy} onClick={save}>Создать</Button></>}>
      <form className="nm-stack" style={{ gap: 14 }} onSubmit={(e) => { e.preventDefault(); save(); }}>
        {error && <Callout tone="danger">{error}</Callout>}
        <Field label="Название *"><Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="ООО «Ромашка»" autoFocus /></Field>
        <Field label="Код компании" help="Латиница, цифры, подчёркивание. Пусто — из названия. Меняться не будет: по нему устроены база и хранилище.">
          <Input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} placeholder="romashka" />
        </Field>
        <Field label="ФИО администратора" help="Пусто — «Администратор <компания>». Логин и пароль появятся после создания.">
          <Input value={admin} onChange={(e) => setAdmin(e.target.value)} placeholder="Иванов Иван Иванович" />
        </Field>
      </form>
    </Dialog>
  );
}

function CreatedDialog({ created, onClose }: { created: Created | null; onClose: () => void }) {
  const toast = useToast();
  if (!created) return null;
  const text = `${created.company}\nАдрес: ${location.origin}\nЛогин: ${created.admin.username}\nПароль: ${created.admin.password}`;
  return (
    <Dialog open onClose={onClose} title="Компания создана" subtitle="Передайте данные администратору компании. Пароль показывается один раз — при первом входе он задаст свой."
            footer={<><Button icon={Copy} onClick={() => navigator.clipboard.writeText(text).then(() => toast.ok('Скопировано'))}>Скопировать</Button><Button variant="primary" onClick={onClose}>Готово</Button></>}>
      <div className="nm-stack" style={{ gap: 8 }}>
        <div><span className="nm-muted">Компания:</span> <b>{created.company}</b> <span className="nm-micro nm-muted">({created.schema})</span></div>
        <div><span className="nm-muted">Администратор:</span> {created.admin.full_name}</div>
        <div><span className="nm-muted">Логин:</span> <b>{created.admin.username}</b></div>
        <div><span className="nm-muted">Пароль:</span> <b style={{ fontFamily: 'monospace' }}>{created.admin.password}</b></div>
      </div>
    </Dialog>
  );
}

export default function Companies() {
  const toast = useToast();
  const [items, setItems] = useState<Company[] | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const load = useCallback(() => {
    setItems(null);
    api.get<{ companies: Company[] }>('/api/companies').then((d) => setItems(d.companies || [])).catch((e) => { toast.error(messageOf(e)); setItems([]); });
    api.get<Balance>('/api/companies/deepseek-balance').then(setBalance).catch((e) => setBalance({ ok: false, error: messageOf(e) }));
  }, [toast]);
  useEffect(() => { document.title = 'Компании · НейроМастер'; load(); }, [load]);

  return (
    <div className="nm-page">
      <PageHeader title="Компании" subtitle="Клиенты: у каждой своя база данных, хранилище и администратор. Здесь — только сводные цифры."
                  actions={<>
                    <Button variant="ghost" icon={RefreshCw} onClick={load}>Обновить</Button>
                    <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Новая компания</Button>
                  </>} />
      <BalanceCard b={balance} />
      <SectionLabel>Компании{items ? ` · ${items.length}` : ''}</SectionLabel>
      {items === null ? <Spinner /> : !items.length ? (
        <Card pad={false}><Empty icon={Building2} action={<Button icon={Plus} onClick={() => setCreating(true)}>Новая компания</Button>}>Компаний пока нет.</Empty></Card>
      ) : (
        <Card pad={false}>
          <div className="nm-table-wrap">
            <table className="nm-edit-table" style={{ fontSize: 13 }}>
              <thead><tr>
                <th>Компания</th><th>Кураторы</th><th>Сотрудники</th><th>С планом</th><th>Документы</th><th>Планы</th>
                <th>Сообщений доставлено / прочитано</th><th>Открытые вопросы</th><th>Активных за 30 дн.</th><th>Токены DeepSeek, 30 дн.</th><th>Последняя активность</th>
              </tr></thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.schema}>
                    <td><b>{c.company}</b><div className="nm-micro nm-muted">{c.slug} · с {date(c.created_at)}</div>
                      {c.error && <div className="nm-micro nm-danger-text">{c.error}</div>}</td>
                    <td>{num(c.curators)}</td>
                    <td>{num(c.employees)}</td>
                    <td>{num(c.employees_with_plan)}</td>
                    <td>{num(c.documents)}</td>
                    <td>{num(c.plans)}</td>
                    <td>{num(c.messages_delivered)} / {num(c.messages_read)}</td>
                    <td>{num(c.questions_open)}</td>
                    <td>{num(c.active_users_30d)}</td>
                    <td>{num(c.deepseek_tokens_30d)}</td>
                    <td className="nm-muted" style={{ whiteSpace: 'nowrap' }}>{date(c.last_activity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <CreateDialog open={creating} onClose={() => setCreating(false)} onCreated={(c) => { setCreating(false); setCreated(c); load(); }} />
      <CreatedDialog created={created} onClose={() => setCreated(null)} />
    </div>
  );
}
