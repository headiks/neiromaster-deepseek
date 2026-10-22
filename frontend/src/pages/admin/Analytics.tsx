// «Аналитика»: сводка с графиками, оценки наставников по этапам, контроль мини-тестов, вопросы
// сотрудников. Общая выборка (поиск по ФИО, подразделение, наставник, должность) действует на все
// вкладки и на Excel-отчёт; ФИО везде открывает карточку сотрудника. Куратор видит только свой отдел.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Plus, RotateCcw, Save, Search, Trash2 } from 'lucide-react';
import { api, enc, messageOf } from '../../lib/api';
import { useMe } from '../../lib/me';
import { useToast } from '../../lib/toast';
import { Badge, Button, Card, Empty, Field, Input, PageHeader, SectionLabel, Segmented, Select, Spinner } from '../../ui';
import { useConfirm } from '../../ui/confirm';
import { DECISION_TONE, type Metric, type Review } from '../../blocks/ReviewDialog';
import { CAT_TONE, EmployeeCard, TEST_STATUS, shortDate as date, type CardTab } from '../../blocks/EmployeeCard';
import { BarList, Columns, Share, ShareRows, type Seg } from '../../blocks/Charts';

type Person = { id: string; full_name: string; position?: string; department?: string; mentor?: string };
type Open = (id: string, tab?: CardTab) => void;
type TabProps = { qs: string; open: Open };
const withQs = (path: string, qs: string) => (qs ? `${path}${path.includes('?') ? '&' : '?'}${qs}` : path);
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
/** ФИО — кнопка, открывает карточку сотрудника. */
const Name = ({ p, open, sub = true }: { p?: Person; open: Open; sub?: boolean }) => (p ? (
  <>
    <button type="button" className="nm-link" style={{ fontWeight: 600, textAlign: 'left' }} onClick={() => open(p.id)}>{p.full_name}</button>
    {sub && <div className="nm-micro nm-muted">{[p.position, p.department].filter(Boolean).join(' · ')}</div>}
  </>
) : null);

// ---------------------------------------------------------------- сводка
type Row = Person & {
  progress: number | null; delivered: number; engagement: number | null;
  reading: { read: number; skim: number; scroll: number } | null;
  tests: { given: number; passed: number; failed: number; overdue: number; waiting: number; percent: number | null };
  review: { decision: string | null } | null; risks: string[];
};
type Overview = {
  employees: Row[]; tests_by_title: { title: string; given: number; passed: number; failed: number; overdue: number }[];
  weeks: Record<string, Record<string, number>>; decisions: Record<string, string>; low_engagement: number;
};
const C = {
  ok: 'var(--nm-ok)', warn: 'var(--nm-warn)', danger: 'var(--nm-danger)', none: 'var(--nm-line-strong)',
  s1: 'var(--nm-series-1)', s2: 'var(--nm-series-2)',
};
const avg = (v: number[]) => (v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null);
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function SummaryTab({ qs, open, byPosition }: TabProps & { byPosition: boolean }) {
  const toast = useToast();
  const [d, setD] = useState<Overview | null>(null);
  useEffect(() => {
    setD(null);
    api.get<Overview>(withQs('/api/analytics/overview', qs)).then(setD).catch((e) => toast.error(messageOf(e)));
  }, [qs, toast]);
  if (!d) return <Spinner />;
  const rows = d.employees;
  if (!rows.length) return <Card pad={false}><Empty>В выборке нет новичков.</Empty></Card>;
  const started = rows.filter((r) => r.delivered > 0);
  const risky = rows.filter((r) => r.risks.length);
  // В выбранном подразделении группы — должности, иначе — подразделения.
  const groupOf = (r: Row) => ((byPosition ? r.position : r.department) || '').trim() || (byPosition ? 'Без должности' : 'Без подразделения');
  const groups = new Map<string, Row[]>();
  rows.forEach((r) => groups.set(groupOf(r), [...(groups.get(groupOf(r)) || []), r]));
  const progress = [...groups].map(([label, g]) => {
    const v = avg(g.filter((r) => r.delivered > 0).map((r) => (r.progress || 0) * 100));
    return { label, value: v ?? 0, text: `${v ?? '—'}% · ${g.length} чел.` };
  }).sort((a, b) => b.value - a.value);
  const low = d.low_engagement;
  const has = (r: Row) => r.engagement != null;
  const eng: Seg[] = [
    { key: 'hi', label: 'Высокая (от 70)', color: C.ok, value: rows.filter((r) => has(r) && r.engagement! >= 70).length },
    { key: 'mid', label: `Средняя (${low}–69)`, color: C.warn, value: rows.filter((r) => has(r) && r.engagement! >= low && r.engagement! < 70).length },
    { key: 'low', label: `Низкая (до ${low})`, color: C.danger, value: rows.filter((r) => has(r) && r.engagement! < low).length },
    { key: 'none', label: 'Нет данных', color: C.none, value: rows.filter((r) => !has(r)).length },
  ];
  const sum = (k: 'read' | 'skim' | 'scroll') => rows.reduce((n, r) => n + (r.reading?.[k] || 0), 0);
  const reading: Seg[] = [
    { key: 'read', label: 'Читают', color: C.ok, value: sum('read') },
    { key: 'skim', label: 'Бегло', color: C.warn, value: sum('skim') },
    { key: 'scroll', label: 'Пролистывают', color: C.danger, value: sum('scroll') },
  ];
  const tcount = (k: 'given' | 'passed' | 'failed' | 'overdue' | 'waiting') => rows.reduce((n, r) => n + r.tests[k], 0);
  const tests: Seg[] = [
    { key: 'passed', label: 'Сдано', color: C.ok, value: tcount('passed') },
    { key: 'failed', label: 'Не сдано', color: C.danger, value: tcount('failed') },
    { key: 'overdue', label: 'Не пройдено вовремя', color: C.warn, value: tcount('overdue') },
    { key: 'waiting', label: 'Ждут ответа', color: C.none, value: tcount('waiting') },
  ];
  const hard = d.tests_by_title
    .map((t) => ({ label: t.title, value: (t.failed + t.overdue) / t.given, text: `${Math.round((100 * (t.failed + t.overdue)) / t.given)}% · ${t.failed + t.overdue} из ${t.given}` }))
    .filter((t) => t.value > 0).sort((a, b) => b.value - a.value).slice(0, 5);
  const monday = new Date();
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const weeks = Array.from({ length: 12 }, (_, i) => {
    const w = new Date(monday);
    w.setDate(w.getDate() - 7 * (11 - i));
    return { label: w.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }), values: d.weeks[ymd(w)] || {} };
  });
  const decColor = (k: string) => (DECISION_TONE[k] === 'ok' ? C.ok : DECISION_TONE[k] === 'warn' ? C.warn : C.danger);
  const decSegs = (list: Row[]): Seg[] => Object.entries(d.decisions).map(([key, label]) => (
    { key, label, color: decColor(key), value: list.filter((r) => r.review?.decision === key).length }));
  const decisionRows = [...groups].map(([label, g]) => ({ label, segs: decSegs(g) })).filter((r) => r.segs.some((s) => s.value));
  return (
    <>
      <div className="nm-stat-grid">
        <Stat label="Новичков" value={rows.length} />
        <Stat label="Средний прогресс" value={`${avg(started.map((r) => (r.progress || 0) * 100)) ?? '—'}%`} />
        <Stat label="Средняя вовлечённость" value={avg(rows.filter(has).map((r) => r.engagement!)) ?? '—'} />
        <Stat label="Тестов сдано" value={`${tcount('passed')} из ${tcount('given')}`} />
        <Stat label="В зоне риска" value={risky.length} tone={risky.length ? 'danger' : undefined} />
      </div>
      <div className="nm-dash">
        <Card><h3>Прогресс адаптации {byPosition ? 'по должностям' : 'по подразделениям'}</h3>
          <BarList label="Средний прогресс по группам" items={progress} max={100} /></Card>
        <Card className="nm-stack" style={{ gap: 18 }}>
          <div><h3>Вовлечённость новичков</h3><Share label="Вовлечённость" segs={eng} /></div>
          <div><h3>Как читают сообщения</h3><Share label="Качество чтения" segs={reading} /></div>
        </Card>
        <Card className="nm-stack" style={{ gap: 18 }}>
          <div><h3>Мини-тесты</h3><Share label="Статусы тестов" segs={tests} /></div>
          <div><h3>Самые трудные тесты</h3>
            {hard.length ? <BarList label="Доля несданных и непройденных" items={hard} max={1} />
              : <span className="nm-small nm-muted">Несданных тестов нет.</span>}</div>
        </Card>
        <Card><h3>Вопросы ассистенту по неделям</h3>
          {!weeks.some((w) => Object.values(w.values).some(Boolean)) ? <span className="nm-small nm-muted">За 12 недель вопросов не было.</span> : <Columns label="Вопросы по неделям" cols={weeks}
                   series={[{ key: 'org', label: 'Организационные', color: C.s1 }, { key: 'work', label: 'Рабочие', color: C.s2 },
                            { key: 'unknown', label: 'Не определено', color: C.none }]} />}</Card>
        <Card><h3>Решения наставников {byPosition ? 'по должностям' : 'по подразделениям'}</h3>
          {decisionRows.length ? <ShareRows label="Решения наставников" rows={decisionRows} legend={decSegs(rows)} />
            : <span className="nm-small nm-muted">Оценок наставников пока нет.</span>}</Card>
      </div>
      <SectionLabel>В зоне риска · {risky.length}</SectionLabel>
      {!risky.length ? <Card pad={false}><Empty>Никого — у новичков выборки всё в порядке.</Empty></Card> : (
        <Card pad={false}>
          <Table head={['Новичок', 'Наставник', 'Почему']}>
            {risky.map((r) => (
              <tr key={r.id}>
                <td><Name p={r} open={open} /></td>
                <td>{r.mentor || <span className="nm-muted">не указан</span>}</td>
                <td><span className="nm-row" style={{ gap: 6, flexWrap: 'wrap' }}>{r.risks.map((x) => <Badge key={x} tone="danger">{x}</Badge>)}</span></td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </>
  );
}

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

function ReviewsTab({ qs, open }: TabProps) {
  const toast = useToast();
  const { isFull } = useMe();
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const load = useCallback(() => api.get<{ employees: ReviewRow[]; decisions: Record<string, string> }>(withQs('/api/analytics/reviews', qs))
    .then((d) => { setRows(d.employees); setDecisions(d.decisions); }).catch((e) => { toast.error(messageOf(e)); setRows([]); }), [toast, qs]);
  useEffect(() => { load(); }, [load]);
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
                <td><Name p={r} open={open} /></td>
                <td>{r.mentor || <span className="nm-warn-text">не указан</span>}{r.mentor && !r.mentor_user && <div className="nm-micro nm-warn-text">нет учётной записи — оценки не придут</div>}</td>
                <td>{r.last ? <>{r.last.avg ?? '—'} из 5<div className="nm-micro nm-muted">{r.last.stage_title}</div></> : '—'}</td>
                <td>{r.last?.decision ? <Badge tone={DECISION_TONE[r.last.decision]}>{decisions[r.last.decision]}</Badge> : '—'}</td>
                <td>{r.pending.length ? <Badge tone="warn">{r.pending.map((p) => p.stage_title).join(', ')}</Badge> : '—'}</td>
                <td><Button size="sm" variant="ghost" onClick={() => open(r.id, 'reviews')}>Этапы</Button></td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
      {isFull && <MetricsEditor positions={positions} />}
    </>
  );
}

// ---------------------------------------------------------------- тесты
type TestRow = { id: string; employee_id: string; title: string; delivered_at: string; right: number; total: number; status: string };

function TestsTab({ qs, open }: TabProps) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [d, setD] = useState<{ tests: TestRow[]; people: Record<string, Person>; pass_percent: number } | null>(null);
  const [filter, setFilter] = useState('all');
  const load = useCallback(() => api.get(withQs('/api/analytics/tests', qs)).then(setD).catch((e) => toast.error(messageOf(e))), [toast, qs]);
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
                <td><Name p={d.people[t.employee_id]} open={open} /></td>
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

function QuestionsTab({ qs, open }: TabProps) {
  const toast = useToast();
  const [days, setDays] = useState('30');
  const [cat, setCat] = useState('all');
  const [d, setD] = useState<QData | null>(null);
  useEffect(() => {
    setD(null);
    api.get<QData>(withQs(`/api/analytics/questions?days=${days}`, qs)).then(setD).catch((e) => toast.error(messageOf(e)));
  }, [days, toast, qs]);
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
                    <td><Name p={d.people[id]} open={open} /></td>
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
                      <td><Name p={d.people[q.user_id]} open={open} sub={false} /></td>
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

// ---------------------------------------------------------------- страница
type Filters = { q: string; department: string; mentor: string; position: string };
type Tab = 'summary' | 'reviews' | 'tests' | 'questions';

export default function Analytics() {
  const [tab, setTab] = useState<Tab>('summary');
  const [opts, setOpts] = useState<{ departments: string[]; mentors: string[]; positions: string[] }>({ departments: [], mentors: [], positions: [] });
  const [f, setF] = useState<Filters>({ q: '', department: '', mentor: '', position: '' });
  const [search, setSearch] = useState('');
  const [card, setCard] = useState<{ id: string; tab?: CardTab } | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    document.title = 'Аналитика · НейроМастер';
    api.get<typeof opts>('/api/analytics/filters').then(setOpts).catch(() => {});
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.q === search.trim() ? x : { ...x, q: search.trim() })), 350);
    return () => clearTimeout(t);
  }, [search]);
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const open: Open = (id, t) => setCard({ id, tab: t });
  const pick = (key: keyof Filters, label: string, all: string, list: string[]) => (
    <Select small aria-label={label} value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })}>
      <option value="">{all}</option>
      {list.map((v) => <option key={v} value={v}>{v}</option>)}
    </Select>
  );
  return (
    <div className="nm-page">
      <PageHeader title="Аналитика" subtitle="Как новички проходят адаптацию: сводка с графиками, оценки наставников по этапам, мини-тесты и вопросы. Нажмите на ФИО — откроется карточка сотрудника." />
      <div className="nm-filters">
        <div className="nm-search nm-grow" style={{ minWidth: 200, maxWidth: 300 }}>
          <Search aria-hidden />
          <Input small aria-label="Поиск по ФИО" placeholder="Поиск по ФИО" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {pick('department', 'Подразделение', 'Все подразделения', opts.departments)}
        {pick('mentor', 'Наставник', 'Все наставники', opts.mentors)}
        {pick('position', 'Должность', 'Все должности', opts.positions)}
        <a className="nm-btn nm-btn-secondary nm-btn-sm" href={withQs('/api/analytics/report.xlsx', qs)} download
           title="Строка на каждого новичка выборки: этап, тесты, вовлечённость, оценка наставника, вопросы, зона риска">
          <Download aria-hidden />Отчёт (Excel)</a>
      </div>
      <Segmented label="Раздел аналитики" value={tab} onChange={setTab}
                 options={[{ value: 'summary', label: 'Сводка' }, { value: 'reviews', label: 'Оценки наставников' }, { value: 'tests', label: 'Тесты' }, { value: 'questions', label: 'Вопросы' }]} />
      {tab === 'summary' ? <SummaryTab key={reload} qs={qs} open={open} byPosition={!!f.department} />
        : tab === 'reviews' ? <ReviewsTab key={reload} qs={qs} open={open} />
          : tab === 'tests' ? <TestsTab key={reload} qs={qs} open={open} /> : <QuestionsTab key={reload} qs={qs} open={open} />}
      <EmployeeCard id={card?.id || null} tab={card?.tab} onClose={() => { setCard(null); setReload((n) => n + 1); }} />
    </div>
  );
}
