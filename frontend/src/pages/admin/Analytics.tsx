// «Аналитика»: оценки наставников по этапам, контроль мини-тестов, вопросы сотрудников
// (организационные / рабочие, что осталось без ответа). Куратор видит только свой отдел.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { api, enc, messageOf } from '../../lib/api';
import { useMe } from '../../lib/me';
import { useToast } from '../../lib/toast';
import { Badge, Button, Card, Empty, Field, Input, PageHeader, SectionLabel, Segmented, Select, Spinner } from '../../ui';
import { Dialog } from '../../ui/Dialog';
import { useConfirm } from '../../ui/confirm';
import { DECISION_TONE, ReviewDialog, type Metric, type Review, type ReviewStage } from '../../blocks/ReviewDialog';
import { MenteeStages } from '../mentor/Mentees';

type Person = { id: string; full_name: string; position?: string; department?: string; mentor?: string };
const date = (s?: string) => {
  const d = s ? new Date(s) : null;
  return d && !isNaN(d.getTime()) ? d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';
};
const Table = ({ head, children }: { head: string[]; children: React.ReactNode }) => (
  <div className="nm-table-wrap">
    <table className="nm-edit-table" style={{ fontSize: 13 }}>
      <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>
);
const Stat = ({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) => (
  <Card><div className="nm-micro nm-muted">{label}</div><div style={{ fontSize: 26, fontWeight: 700 }} className={tone ? `nm-${tone}-text` : undefined}>{value}</div></Card>
);

// ---------------------------------------------------------------- оценки наставников
type ReviewRow = Person & {
  mentor_user: boolean; pending: Review[]; reviews: Review[];
  last: { stage_title: string; avg: number | null; decision: string | null } | null;
};

function MetricsEditor({ positions }: { positions: string[] }) {
  const toast = useToast();
  const [cfg, setCfg] = useState<Record<string, Metric[]> | null>(null);
  const [pos, setPos] = useState('');
  useEffect(() => { api.get<{ metrics: Record<string, Metric[]> }>('/api/analytics/metrics').then((d) => setCfg(d.metrics)).catch(() => {}); }, []);
  if (!cfg) return null;
  const list = cfg[pos] ?? cfg[''] ?? [];
  const set = (items: Metric[]) => setCfg({ ...cfg, [pos]: items });
  const save = () => api.put<{ metrics: Record<string, Metric[]> }>('/api/analytics/metrics', { metrics: cfg })
    .then((d) => { setCfg(d.metrics); toast.ok('Показатели сохранены'); }).catch((e) => toast.error(messageOf(e)));
  return (
    <Card>
      <b>Производственные показатели в оценке этапа</b>
      <p className="nm-small nm-muted" style={{ margin: 0 }}>Наставник вносит эти числа, когда оценивает этап. Для каждой должности можно задать свои; если не заданы — берутся показатели «для всех должностей».</p>
      <Field label="Должность">
        <Select value={pos} onChange={(e) => setPos(e.target.value)}>
          <option value="">Для всех должностей</option>
          {positions.map((p) => <option key={p} value={p}>{p}{cfg[p] ? ' · свои показатели' : ''}</option>)}
        </Select>
      </Field>
      {list.map((m, i) => (
        <div key={i} className="nm-row" style={{ gap: 8 }}>
          <Input small value={m.label} placeholder="Показатель" onChange={(e) => set(list.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          <Input small value={m.unit} placeholder="Ед." style={{ maxWidth: 90 }} onChange={(e) => set(list.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))} />
          <Button size="sm" variant="ghost" iconOnly icon={Trash2} aria-label="Убрать показатель" onClick={() => set(list.filter((_, j) => j !== i))} />
        </div>
      ))}
      <div className="nm-row" style={{ gap: 8 }}>
        <Button size="sm" icon={Plus} onClick={() => set([...list, { key: '', label: '', unit: '' }])}>Добавить показатель</Button>
        <Button size="sm" variant="primary" icon={Save} onClick={save}>Сохранить</Button>
      </div>
    </Card>
  );
}

function ReviewsTab() {
  const toast = useToast();
  const { isFull } = useMe();
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<ReviewRow | null>(null);
  const [card, setCard] = useState<{ id: string; full_name: string; stages: ReviewStage[]; metrics: Metric[] } | null>(null);
  const [stage, setStage] = useState<ReviewStage | null>(null);
  const load = useCallback(() => api.get<{ employees: ReviewRow[]; decisions: Record<string, string> }>('/api/analytics/reviews')
    .then((d) => { setRows(d.employees); setDecisions(d.decisions); }).catch((e) => { toast.error(messageOf(e)); setRows([]); }), [toast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    setCard(null);
    if (open) api.get(`/api/reviews/${enc(open.id)}`).then(setCard).catch((e) => toast.error(messageOf(e)));
  }, [open, toast]);
  const positions = useMemo(() => [...new Set((rows || []).map((r) => (r.position || '').trim()).filter(Boolean))].sort(), [rows]);
  if (rows === null) return <Spinner />;
  const done = rows.filter((r) => r.last);
  const risk = rows.filter((r) => r.last?.decision === 'risk').length;
  const pending = rows.reduce((n, r) => n + r.pending.length, 0);
  return (
    <>
      <div className="nm-stat-grid">
        <Stat label="Новичков" value={rows.length} />
        <Stat label="С оценкой наставника" value={done.length} />
        <Stat label="Ждут оценки этапа" value={pending} tone={pending ? 'warn' : undefined} />
        <Stat label="Наставник видит риск" value={risk} tone={risk ? 'danger' : undefined} />
      </div>
      {!rows.length ? <Card pad={false}><Empty>Новичков пока нет.</Empty></Card> : (
        <Card pad={false}>
          <Table head={['Новичок', 'Наставник', 'Последняя оценка', 'Решение', 'Ждут оценки', '']}>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><b>{r.full_name}</b><div className="nm-micro nm-muted">{[r.position, r.department].filter(Boolean).join(' · ')}</div></td>
                <td>{r.mentor || <span className="nm-warn-text">не указан</span>}{r.mentor && !r.mentor_user && <div className="nm-micro nm-warn-text">нет учётной записи — оценки не придут</div>}</td>
                <td>{r.last ? <>{r.last.avg ?? '—'} из 5<div className="nm-micro nm-muted">{r.last.stage_title}</div></> : '—'}</td>
                <td>{r.last?.decision ? <Badge tone={DECISION_TONE[r.last.decision]}>{decisions[r.last.decision]}</Badge> : '—'}</td>
                <td>{r.pending.length ? <Badge tone="warn">{r.pending.map((p) => p.stage_title).join(', ')}</Badge> : '—'}</td>
                <td><Button size="sm" variant="ghost" onClick={() => setOpen(r)}>Этапы</Button></td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
      {isFull && <MetricsEditor positions={positions} />}
      {open && (
        <Dialog open onClose={() => setOpen(null)} wide title={`Оценки по этапам: ${open.full_name}`}
                subtitle="Обычно оценивает наставник. Администратор может оценить сам, если наставника нет."
                footer={<Button variant="primary" onClick={() => setOpen(null)}>Закрыть</Button>}>
          {!card ? <Spinner /> : card.stages.length ? <MenteeStages m={card as never} onReview={setStage} /> : <span className="nm-muted">План адаптации не назначен.</span>}
          {card?.stages.flatMap((s) => (s.review?.comment ? [<p key={s.id} className="nm-small" style={{ margin: '8px 0 0' }}><b>{s.title}:</b> {s.review.comment}</p>] : []))}
        </Dialog>
      )}
      {card && <ReviewDialog employee={card} stage={stage} metrics={card.metrics} onClose={() => setStage(null)}
                             onSaved={() => { setStage(null); const o = open; setOpen(null); setTimeout(() => setOpen(o), 0); load(); }} />}
    </>
  );
}

// ---------------------------------------------------------------- тесты
type TestRow = { id: string; employee_id: string; title: string; delivered_at: string; right: number; total: number; status: string };
const TEST_STATUS: Record<string, { tone: 'ok' | 'danger' | 'warn' | 'muted'; label: string }> = {
  passed: { tone: 'ok', label: 'Сдан' }, failed: { tone: 'danger', label: 'Не сдан' },
  overdue: { tone: 'warn', label: 'Не пройден' }, waiting: { tone: 'muted', label: 'Ждёт ответа' },
};

function TestsTab() {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [d, setD] = useState<{ tests: TestRow[]; people: Record<string, Person>; pass_percent: number } | null>(null);
  const [filter, setFilter] = useState('all');
  const load = useCallback(() => api.get('/api/analytics/tests').then(setD).catch((e) => toast.error(messageOf(e))), [toast]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <Spinner />;
  const byTest = new Map<string, Record<string, number>>();
  d.tests.forEach((t) => { const s = byTest.get(t.title) || { all: 0 }; s.all++; s[t.status] = (s[t.status] || 0) + 1; byTest.set(t.title, s); });
  const count = (st: string) => d.tests.filter((t) => t.status === st).length;
  const shown = d.tests.filter((t) => filter === 'all' || t.status === filter);
  const retake = async (t: TestRow) => {
    if (!(await confirm({ title: 'Разрешить пересдачу?', text: `Ответы «${d.people[t.employee_id]?.full_name}» на тест «${t.title}» будут удалены — он пройдёт тест заново.`, ok: 'Разрешить' }))) return;
    api.post(`/api/analytics/tests/${enc(t.id)}/retake`).then(() => { toast.ok('Пересдача разрешена'); load(); }).catch((e) => toast.error(messageOf(e)));
  };
  return (
    <>
      <div className="nm-stat-grid">
        <Stat label="Выдано тестов" value={d.tests.length} />
        <Stat label={`Сдано (от ${d.pass_percent}% верных)`} value={count('passed')} tone="ok" />
        <Stat label="Не сдано" value={count('failed')} tone={count('failed') ? 'danger' : undefined} />
        <Stat label="Не пройдено вовремя" value={count('overdue')} tone={count('overdue') ? 'warn' : undefined} />
      </div>
      {byTest.size > 0 && (
        <Card pad={false}>
          <Table head={['Тест', 'Выдан', 'Сдан', 'Не сдан', 'Не пройден']}>
            {[...byTest].map(([title, s]) => (
              <tr key={title}><td>{title}</td><td>{s.all}</td><td>{s.passed || 0}</td><td>{s.failed || 0}</td><td>{s.overdue || 0}</td></tr>
            ))}
          </Table>
        </Card>
      )}
      <Segmented label="Какие тесты" value={filter} onChange={setFilter}
                 options={[{ value: 'all', label: 'Все' }, { value: 'failed', label: 'Не сданы' }, { value: 'overdue', label: 'Не пройдены' }, { value: 'passed', label: 'Сданы' }]} />
      {!shown.length ? <Card pad={false}><Empty>Тестов нет.</Empty></Card> : (
        <Card pad={false}>
          <Table head={['Новичок', 'Тест', 'Выдан', 'Результат', 'Статус', '']}>
            {shown.map((t) => (
              <tr key={t.id}>
                <td>{d.people[t.employee_id]?.full_name}<div className="nm-micro nm-muted">{d.people[t.employee_id]?.department}</div></td>
                <td>{t.title}</td>
                <td className="nm-muted">{date(t.delivered_at)}</td>
                <td>{t.right} из {t.total}</td>
                <td><Badge tone={TEST_STATUS[t.status].tone}>{TEST_STATUS[t.status].label}</Badge></td>
                <td>{t.status === 'failed' && <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => retake(t)}>Разрешить пересдачу</Button>}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </>
  );
}

// ---------------------------------------------------------------- вопросы
type QData = {
  total: number; by_category: Record<string, number>; by_outcome: Record<string, number>;
  by_employee: Record<string, { total: number; org: number; work: number; unknown: number; unanswered: number }>;
  items: { id: number; ts: string; user_id: string; category: string; outcome: string; question: string }[];
  people: Record<string, Person>; categories: Record<string, string>; outcomes: Record<string, string>;
};
const CAT_TONE: Record<string, 'accent' | 'ok' | 'muted'> = { org: 'accent', work: 'ok', unknown: 'muted' };

function QuestionsTab() {
  const toast = useToast();
  const [days, setDays] = useState('30');
  const [cat, setCat] = useState('all');
  const [d, setD] = useState<QData | null>(null);
  useEffect(() => {
    setD(null);
    api.get<QData>(`/api/analytics/questions?days=${days}`).then(setD).catch((e) => toast.error(messageOf(e)));
  }, [days, toast]);
  const catName = (c: string) => d?.categories[c] || 'Не определено';
  const unanswered = (d?.by_outcome.escalated || 0) + (d?.by_outcome.no_answer || 0);
  return (
    <>
      <Segmented label="Период" value={days} onChange={setDays} options={[{ value: '7', label: '7 дней' }, { value: '30', label: '30 дней' }, { value: '90', label: '90 дней' }]} />
      {!d ? <Spinner /> : (
        <>
          <div className="nm-stat-grid">
            <Stat label="Всего вопросов" value={d.total} />
            <Stat label="Организационные" value={d.by_category.org || 0} />
            <Stat label="Рабочие" value={d.by_category.work || 0} />
            <Stat label="Без ответа ассистента" value={unanswered} tone={unanswered ? 'warn' : undefined} />
          </div>
          <p className="nm-small nm-muted" style={{ margin: 0 }}>
            Организационные — оформление, документы, зарплата, график, пропуск, спецодежда. Рабочие — как выполнять работу, оборудование, нормы, охрана труда на рабочем месте.
            Много вопросов без ответа по одной теме — значит, в документах этого нет: стоит дополнить.
          </p>
          {Object.keys(d.by_employee).length > 0 && (
            <Card pad={false}>
              <Table head={['Новичок', 'Всего', 'Организационные', 'Рабочие', 'Без ответа']}>
                {Object.entries(d.by_employee).sort((a, b) => b[1].total - a[1].total).map(([id, e]) => (
                  <tr key={id}>
                    <td>{d.people[id]?.full_name}<div className="nm-micro nm-muted">{[d.people[id]?.position, d.people[id]?.department].filter(Boolean).join(' · ')}</div></td>
                    <td>{e.total}</td><td>{e.org}</td><td>{e.work}</td><td>{e.unanswered || '—'}</td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}
          <SectionLabel>Вопросы</SectionLabel>
          <Segmented label="Категория" value={cat} onChange={setCat}
                     options={[{ value: 'all', label: 'Все' }, { value: 'org', label: 'Организационные' }, { value: 'work', label: 'Рабочие' }, { value: 'unanswered', label: 'Без ответа' }]} />
          {(() => {
            const list = d.items.filter((q) => cat === 'all' || q.category === cat || (cat === 'unanswered' && ['escalated', 'no_answer'].includes(q.outcome)));
            return !list.length ? <Card pad={false}><Empty>Вопросов за этот период нет.</Empty></Card> : (
              <Card pad={false}>
                <Table head={['Когда', 'Новичок', 'Вопрос', 'Категория', 'Итог']}>
                  {list.map((q) => (
                    <tr key={q.id}>
                      <td className="nm-muted" style={{ whiteSpace: 'nowrap' }}>{date(q.ts)}</td>
                      <td>{d.people[q.user_id]?.full_name}</td>
                      <td>{q.question}</td>
                      <td><Badge tone={CAT_TONE[q.category] || 'muted'}>{catName(q.category)}</Badge></td>
                      <td className="nm-small">{d.outcomes[q.outcome] || q.outcome}</td>
                    </tr>
                  ))}
                </Table>
              </Card>
            );
          })()}
        </>
      )}
    </>
  );
}

export default function Analytics() {
  const [tab, setTab] = useState<'reviews' | 'tests' | 'questions'>('reviews');
  useEffect(() => { document.title = 'Аналитика · НейроМастер'; }, []);
  return (
    <div className="nm-page">
      <PageHeader title="Аналитика" subtitle="Как новички проходят адаптацию: оценки наставников по этапам, мини-тесты и вопросы, которые они задают." />
      <Segmented label="Раздел аналитики" value={tab} onChange={setTab}
                 options={[{ value: 'reviews', label: 'Оценки наставников' }, { value: 'tests', label: 'Тесты' }, { value: 'questions', label: 'Вопросы' }]} />
      {tab === 'reviews' ? <ReviewsTab /> : tab === 'tests' ? <TestsTab /> : <QuestionsTab />}
    </div>
  );
}
