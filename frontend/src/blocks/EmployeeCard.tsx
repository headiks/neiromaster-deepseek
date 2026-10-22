// Карточка новичка — всё по одному человеку: этап и вовлечённость, оценки наставника по этапам,
// мини-тесты, вопросы ассистенту, зона риска (GET /api/analytics/employee/{id}).
// Открывается из «Пользователей» и из любой таблицы «Аналитики» нажатием на ФИО.
import { useCallback, useEffect, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { ruDate } from '@shared/format';
import { api, enc, messageOf } from '../lib/api';
import { Badge, Button, Callout, Progress, Segmented, Spinner } from '../ui';
import { Dialog } from '../ui/Dialog';
import { ReviewDialog, type Metric, type ReviewStage } from './ReviewDialog';
import { MenteeStages } from '../pages/mentor/Mentees';

export type Stats = {
  stage: string; progress: number; delivered: number; total: number; read: number; reaction_min: number | null;
  reading: { read: number; skim: number; scroll: number };
  tests: { given: number; passed: number; percent: number | null }; engagement: number | null;
};
type StatsDetail = Stats & { messages: { id: string; title: string; kind: string; delivered_at: string; opened_at: string;
  reaction_min: number | null; view_s: number; expected_s: number; reading: 'read' | 'skim' | 'scroll' | null;
  quiz?: { right: number; answered: number; total: number } }[] };
export const READING: Record<string, { tone: 'ok' | 'warn' | 'danger'; label: string }> = {
  read: { tone: 'ok', label: 'читает' }, skim: { tone: 'warn', label: 'бегло' }, scroll: { tone: 'danger', label: 'пролистывает' },
};
export const toneOf = (v: number | null | undefined, ok = 70, warn = 40) => (v == null ? 'muted' : v >= ok ? 'ok' : v >= warn ? 'warn' : 'danger');
const minutes = (m: number | null | undefined) => (m == null ? '—' : m < 60 ? `${m} мин` : m < 48 * 60 ? `${Math.round(m / 60)} ч` : `${Math.round(m / 1440)} дн`);
export const mainReading = (r: Stats['reading']) => {
  const [k, n] = Object.entries(r).sort((a, b) => b[1] - a[1])[0] || [];
  return n ? READING[k] : null;
};
export const TEST_STATUS: Record<string, { tone: 'ok' | 'danger' | 'warn' | 'muted'; label: string }> = {
  passed: { tone: 'ok', label: 'Сдан' }, failed: { tone: 'danger', label: 'Не сдан' },
  overdue: { tone: 'warn', label: 'Не пройден' }, waiting: { tone: 'muted', label: 'Ждёт ответа' },
};
export const CAT_TONE: Record<string, 'accent' | 'ok' | 'muted'> = { org: 'accent', work: 'ok', unknown: 'muted' };
export const shortDate = (s?: string) => {
  const d = s ? new Date(s) : null;
  return d && !isNaN(d.getTime()) ? d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';
};

type Card = {
  id: string; full_name: string; position?: string; department?: string; mentor?: string; start_date?: string;
  stats: StatsDetail; stages: ReviewStage[]; metrics: Metric[];
  overview: { mentor_user: boolean; risks: string[] };
  tests: { id: string; title: string; delivered_at: string; right: number; total: number; status: string }[];
  questions: { id: number; ts: string; category: string; outcome: string; question: string }[];
  categories: Record<string, string>; outcomes: Record<string, string>;
};
export type CardTab = 'stats' | 'reviews' | 'tests' | 'questions';

const Table = ({ head, children }: { head: string[]; children: React.ReactNode }) => (
  <div className="nm-table-wrap">
    <table className="nm-edit-table" style={{ fontSize: 13 }}>
      <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>
);

function StatsPart({ d }: { d: StatsDetail }) {
  if (!d.total) return <Callout tone="accent">Сообщений плана у сотрудника пока нет — статистика появится после первых сообщений.</Callout>;
  const main = mainReading(d.reading);
  return (
    <div className="nm-stack" style={{ gap: 14 }}>
      <div className="nm-stat-grid">
        <div><div className="nm-micro nm-muted">Этап</div><b>{d.stage || '—'}</b>
          <Progress value={d.progress} small label="Пройдено по плану" /><div className="nm-micro nm-muted">{d.delivered} из {d.total} сообщений</div></div>
        <div><div className="nm-micro nm-muted">Мини-тесты</div>
          <b>{d.tests.percent == null ? '—' : `${d.tests.percent}% верных`}</b>
          <div className="nm-micro nm-muted">пройдено {d.tests.passed} из {d.tests.given}</div></div>
        <div><div className="nm-micro nm-muted">Вовлечённость</div>
          <Badge tone={toneOf(d.engagement)}>{d.engagement == null ? '—' : `${d.engagement} / 100`}</Badge>
          <div className="nm-micro nm-muted">прочитано {d.read} из {d.delivered} · открывает через {minutes(d.reaction_min)}{main ? ` · ${main.label}` : ''}</div></div>
      </div>
      <Table head={['Сообщение', 'Открыл через', 'На экране', 'Чтение', 'Тест']}>
        {d.messages.map((m) => (
          <tr key={m.id}>
            <td>{m.title}</td>
            <td className="nm-muted">{m.opened_at ? minutes(m.reaction_min) : 'не открыл'}</td>
            <td className="nm-muted">{m.view_s ? `${m.view_s} с из ~${m.expected_s} с` : '—'}</td>
            <td>{m.reading ? <Badge tone={READING[m.reading].tone}>{READING[m.reading].label}</Badge> : '—'}</td>
            <td>{m.quiz ? (m.quiz.answered ? `${m.quiz.right} из ${m.quiz.total}` : 'не пройден') : ''}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

export function EmployeeCard({ id, tab: initial = 'stats', onClose }: { id: string | null; tab?: CardTab; onClose: () => void }) {
  const [d, setD] = useState<Card | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<CardTab>(initial);
  const [stage, setStage] = useState<ReviewStage | null>(null);
  const load = useCallback(() => {
    if (id) api.get<Card>(`/api/analytics/employee/${enc(id)}`).then(setD).catch((e) => setError(messageOf(e)));
  }, [id]);
  useEffect(() => { setD(null); setError(null); setTab(initial); load(); }, [load, initial]);
  if (!id) return null;
  const sub = d ? [d.position, d.department, d.mentor ? `наставник: ${d.mentor}` : 'наставник не указан',
    d.start_date ? `выход ${ruDate(d.start_date)}` : ''].filter(Boolean).join(' · ') : undefined;
  return (
    <>
      <Dialog open onClose={onClose} wide title={d?.full_name || 'Карточка сотрудника'} subtitle={sub}
              footer={<Button variant="primary" onClick={onClose}>Закрыть</Button>}>
        {error ? <Callout tone="danger">{error}</Callout> : !d ? <Spinner /> : (
          <div className="nm-stack" style={{ gap: 14 }}>
            {d.overview.risks.length > 0 && <Callout tone="danger" icon={TriangleAlert}>В зоне риска: {d.overview.risks.join(' · ')}</Callout>}
            <Segmented label="Раздел карточки" value={tab} onChange={setTab}
                       options={[{ value: 'stats', label: 'Статистика' }, { value: 'reviews', label: 'Оценки наставника' },
                                 { value: 'tests', label: `Тесты · ${d.tests.length}` }, { value: 'questions', label: `Вопросы · ${d.questions.length}` }]} />
            {tab === 'stats' ? <StatsPart d={d.stats} /> : tab === 'reviews' ? (
              <>
                {d.mentor && !d.overview.mentor_user && <Callout tone="warn">У наставника «{d.mentor}» нет учётной записи — запросы оценки ему не приходят. Оценить этап может администратор.</Callout>}
                {d.stages.length ? <MenteeStages m={d as never} onReview={setStage} /> : <span className="nm-muted">План адаптации не назначен.</span>}
                {d.stages.flatMap((s) => (s.review?.comment ? [<p key={s.id} className="nm-small" style={{ margin: 0 }}><b>{s.title}:</b> {s.review.comment}</p>] : []))}
              </>
            ) : tab === 'tests' ? (
              !d.tests.length ? <span className="nm-muted">Тестов пока не было.</span> : (
                <Table head={['Тест', 'Выдан', 'Результат', 'Статус']}>
                  {d.tests.map((t) => (
                    <tr key={t.id}><td>{t.title}</td><td className="nm-muted">{shortDate(t.delivered_at)}</td><td>{t.right} из {t.total}</td>
                      <td><Badge tone={TEST_STATUS[t.status].tone}>{TEST_STATUS[t.status].label}</Badge></td></tr>
                  ))}
                </Table>
              )
            ) : !d.questions.length ? <span className="nm-muted">Вопросов не было.</span> : (
              <Table head={['Когда', 'Вопрос', 'Категория', 'Итог']}>
                {d.questions.map((q) => (
                  <tr key={q.id}><td className="nm-muted" style={{ whiteSpace: 'nowrap' }}>{shortDate(q.ts)}</td><td>{q.question}</td>
                    <td><Badge tone={CAT_TONE[q.category] || 'muted'}>{d.categories[q.category] || 'Не определено'}</Badge></td>
                    <td className="nm-small">{d.outcomes[q.outcome] || q.outcome}</td></tr>
                ))}
              </Table>
            )}
          </div>
        )}
      </Dialog>
      {d && <ReviewDialog employee={d} stage={stage} metrics={d.metrics} onClose={() => setStage(null)}
                          onSaved={() => { setStage(null); load(); }} />}
    </>
  );
}
