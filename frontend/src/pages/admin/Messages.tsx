// Сообщения сотрудникам: тексты плана, которые ИИ пишет по документам. Одна кнопка
// «Обновить сообщения плана» — сервер сверяет отпечатки (документы, описание подэтапа,
// должность) и зовёт ИИ только там, где что-то изменилось. Правка вручную и перегенерация.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Info, Pencil, RefreshCw, Save, Sparkles, Square, TriangleAlert } from 'lucide-react';
import { ruDateTime, sourceLabel } from '@shared/format';
import { api, ApiError, enc, messageOf } from '../../lib/api';
import { useToast } from '../../lib/toast';
import type { Catalog, Job, Plan, PlanSummary, ScheduleMessage } from '../../lib/types';
import { Badge, Button, Callout, Card, Empty, Field, PageHeader, Progress, Select, Spinner, Textarea } from '../../ui';
import { useConfirm } from '../../ui/confirm';
import { NextStep } from '../../blocks/NextStep';

type Schedule = { messages: ScheduleMessage[]; generated_at?: string };

const STATUS: Record<string, { tone: 'warn' | 'danger' | 'accent' | 'muted'; label: string }> = {
  skipped: { tone: 'warn', label: 'пропущено — нет документа' },
  error: { tone: 'danger', label: 'ошибка' },
  edited: { tone: 'accent', label: 'правка вручную' },
  pending: { tone: 'muted', label: 'в очереди' },
};

function srcNames(m: ScheduleMessage) {
  return [...new Set((m.sources || []).map((s) => (typeof s === 'string' ? s : s.source || s.filename || s.title || '')).filter(Boolean))];
}

function MessageEditor({ m, kind, onSave, onRegen }: { m: ScheduleMessage; kind: string; onSave: (text: string) => Promise<void>; onRegen: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'save' | 'regen' | null>(null);
  const cur = (m.content?.text || '').trim();
  const st = m.status && m.status !== 'generated' ? STATUS[m.status] || { tone: 'muted' as const, label: m.status } : null;
  const sources = srcNames(m);
  return (
    <div className="nm-msg-admin">
      <div className="nm-row" style={{ gap: 8 }}>
        <b>{m.substage?.title}</b>
        {kind && <Badge tone="muted">{kind}</Badge>}
        {st && <Badge tone={st.tone}>{st.label}</Badge>}
      </div>
      {editing ? (
        <>
          <Textarea autosize value={text} onChange={(e) => setText(e.target.value)} aria-label="Текст сообщения" autoFocus />
          <div className="nm-row">
            <Button size="sm" variant="primary" icon={Save} loading={busy === 'save'}
                    onClick={async () => { setBusy('save'); try { await onSave(text); setEditing(false); } finally { setBusy(null); } }}>Сохранить</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Отмена</Button>
          </div>
        </>
      ) : (
        <div className="nm-msg-admin-text">{cur || <span className="nm-muted">— текст пуст —</span>}</div>
      )}
      {!editing && m.content?.hr_note && <div className="nm-small nm-warn-text" title="Служебная пометка — сотрудник её не видит">{m.content.hr_note}</div>}
      {(m.status === 'skipped' || m.status === 'error') && m.error && <div className="nm-small nm-warn-text">{m.error}</div>}
      {sources.length > 0 && <div className="nm-micro nm-muted">Источники: {sources.map(sourceLabel).join(', ')}</div>}
      {!editing && m.message_id && (
        <div className="nm-row" style={{ gap: 6 }}>
          <Button size="sm" variant="ghost" icon={Pencil} onClick={() => { setText(cur); setEditing(true); }}>Редактировать</Button>
          <Button size="sm" variant="ghost" icon={RefreshCw} loading={busy === 'regen'}
                  onClick={async () => { setBusy('regen'); try { await onRegen(); } finally { setBusy(null); } }}>Перегенерировать</Button>
        </div>
      )}
    </div>
  );
}

export default function Messages() {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  const [planId, setPlanId] = useState('');
  const [profs, setProfs] = useState<{ names: string[]; generated: Set<string> }>({ names: [], generated: new Set() });
  const [prof, setProf] = useState('');
  const [schedule, setSchedule] = useState<Schedule | null | undefined>(undefined);
  const [skeleton, setSkeleton] = useState<Plan | null>(null);
  const [kinds, setKinds] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('');
  const [job, setJob] = useState<{ id: string; prefix: string; data?: Job } | null>(null);
  const [starting, setStarting] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => { document.title = 'Сообщения · НейроМастер'; }, []);
  useEffect(() => {
    api.get<{ plans: PlanSummary[] }>('/plans').then((d) => { setPlans(d.plans || []); setPlanId((p) => p || d.plans?.[0]?.plan_id || ''); })
      .catch((e) => { setPlans([]); toast.error(messageOf(e)); });
    api.get<Catalog>('/catalog').then((c) => setKinds(Object.fromEntries(c.substage_kinds.map((k) => [k.id, k.title])))).catch(() => {});
  }, [toast]);

  const loadProfessions = useCallback(() => {
    if (!planId) return;
    api.get<{ generated_names?: string[]; available?: string[]; professions?: (string | { profession?: string; slug?: string })[] }>(`/plans/${enc(planId)}/professions`).then((d) => {
      const gen = new Set(d.generated_names || (d.professions || []).map((p) => (typeof p === 'string' ? p : p.profession || p.slug || '')));
      const names = [...new Set([...(d.available || []), ...gen])].filter(Boolean).sort((a, b) => a.localeCompare(b, 'ru'));
      setProfs({ names, generated: gen });
    }).catch(() => {});
  }, [planId]);

  const loadTexts = useCallback(async () => {
    if (!planId) return;
    setSchedule(undefined); setSkeleton(null);
    const skeletonOf = () => api.get<{ plan: Plan }>(`/plans/${enc(planId)}`).then((d) => setSkeleton(d.plan)).catch(() => {});
    try {
      // missing_ok: сообщений ещё нет — 200 с null; показываем структуру плана.
      const sch = await api.get<Schedule | null>(`/plans/${enc(planId)}/schedule?missing_ok=true${prof ? `&profession=${enc(prof)}` : ''}`);
      setSchedule(sch);
      if (!sch) skeletonOf();
    } catch (e) {
      setSchedule(null);
      if (e instanceof ApiError && e.status === 404) skeletonOf(); else toast.error(messageOf(e));
    }
  }, [planId, prof, toast]);

  useEffect(() => { setProf(''); loadProfessions(); }, [planId, loadProfessions]);
  useEffect(() => { loadTexts(); }, [loadTexts]);

  // Ход фоновой генерации
  useEffect(() => {
    if (!job) return;
    const poll = async () => {
      try {
        const d = await api.get<Job>(`/jobs/${enc(job.id)}`);
        setJob((j) => (j && j.id === job.id ? { ...j, data: d } : j));
        if (['done', 'error', 'cancelled'].includes(d.status)) {
          const calls = `запросов к ИИ: ${d.llm_calls || 0}${d.llm_planned ? ` из ~${d.llm_planned}` : ''}`;
          const skipped = d.skipped ? ` · без документов: ${d.skipped} — загрузите документы, эти сообщения допишутся сами` : '';
          setStatus(d.status === 'done' ? `Готово · ${calls}${skipped}` : d.status === 'cancelled' ? 'Остановлено (сгенерированное сохранено)' : d.error || 'Ошибка');
          setJob(null);
          loadTexts(); loadProfessions();
          return;
        }
      } catch { /* сеть — попробуем ещё */ }
      timer.current = window.setTimeout(poll, 1500);
    };
    timer.current = window.setTimeout(poll, 600);
    return () => window.clearTimeout(timer.current);
  }, [job?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const generate = async () => {
    if (!planId) { setStatus('Выберите план.'); return; }
    const q = prof ? `?profession=${enc(prof)}` : '';
    setStarting(true); setStatus('Проверяем, что изменилось…');
    try {
      const est = await api.get<{ llm_calls: number; up_to_date: number; skipped: number; professions: number }>(`/plans/${enc(planId)}/generate-estimate${q}`);
      if (!est.llm_calls) { setStatus(`Всё актуально — запросов к ИИ не нужно (актуальных: ${est.up_to_date}, без документов: ${est.skipped}).`); return; }
      const scope = prof ? `должность «${prof}»` : `должностей: ${est.professions}`;
      if (est.llm_calls > 5 && !(await confirm({ title: 'Запустить генерацию?', ok: 'Запустить',
        text: `Будет сгенерировано сообщений: ${est.llm_calls} (${scope}).\nАктуальные (${est.up_to_date}) не трогаем.` }))) { setStatus(''); return; }
      setStatus('Генерация…');
      const r = await api.post<{ status?: string; job_id?: string; already_running?: boolean }>(`/plans/${enc(planId)}/generate${q}`);
      if (r.status === 'up_to_date') { setStatus('Всё актуально — запросов к ИИ не нужно.'); return; }
      if (r.status === 'busy' || !r.job_id) { setStatus('Генерация этого плана уже запускается — подождите пару секунд.'); return; }
      if (r.already_running) setStatus('Генерация этого плана уже идёт — показываем её ход.');
      setJob({ id: r.job_id, prefix: prof ? `Должность: ${prof}` : 'Все должности' });
    } catch (e) {
      setStatus(messageOf(e));
    } finally {
      setStarting(false);
    }
  };

  const cancel = () => { if (job) { setStatus('Остановка…'); api.post(`/jobs/${enc(job.id)}/cancel`).catch(() => {}); } };

  const saveText = async (mid: string, text: string) => {
    try { await api.put(`/plans/${enc(planId)}/messages/${enc(mid)}`, { text, profession: prof }); toast.ok('Сообщение сохранено'); loadTexts(); }
    catch (e) { toast.error(messageOf(e)); throw e; }
  };
  const regen = async (mid: string) => {
    if (!(await confirm({ title: 'Переписать сообщение заново?', text: 'Текущий текст (в том числе ручные правки) будет заменён.', ok: 'Переписать' }))) return;
    try { await api.post(`/plans/${enc(planId)}/messages/${enc(mid)}/regenerate${prof ? `?profession=${enc(prof)}` : ''}`); loadTexts(); }
    catch (e) { toast.error(`Не удалось: ${messageOf(e)}`); }
  };

  const grouped = useMemo(() => {
    const byStage = new Map<string, { title: string; order: number; subs: ScheduleMessage[] }>();
    (schedule?.messages || []).forEach((m) => {
      const id = m.stage?.id || '';
      if (!byStage.has(id)) byStage.set(id, { title: m.stage?.title || '', order: m.stage?.order || 0, subs: [] });
      byStage.get(id)!.subs.push(m);
    });
    return [...byStage.values()].sort((a, b) => a.order - b.order);
  }, [schedule]);

  const d = job?.data;
  return (
    <div className="nm-page">
      <PageHeader title="Сообщения сотрудникам" subtitle="То, что получит сотрудник по плану: ИИ пишет сообщения по загруженным документам. Новые документы — недостающие и устаревшие сообщения обновятся сами; вручную правят только то, что хочется поправить." />
      <NextStep here="/admin/messages" />
      <Card>
        <div className="nm-field-row">
          <div data-tour="pt-plan">
            <Field label="План">
              <Select value={planId} onChange={(e) => setPlanId(e.target.value)} disabled={!plans?.length}>
                {!plans?.length && <option value="">— планов нет —</option>}
                {(plans || []).map((p) => <option key={p.plan_id} value={p.plan_id}>{p.title}{p.role ? ` · ${p.role}` : ''}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Для должности" help="Сообщения можно подстроить под должность. «Общие» получают сотрудники, для чьей должности отдельных нет. ✓ — уже сгенерированы.">
            <Select value={prof} onChange={(e) => setProf(e.target.value)}>
              <option value="">Общие (для всех должностей)</option>
              {profs.names.map((n) => <option key={n} value={n}>{profs.generated.has(n) ? '✓ ' : ''}{n}</option>)}
            </Select>
          </Field>
        </div>
        <div className="nm-row">
          <Button variant="primary" icon={Sparkles} onClick={generate} loading={starting} disabled={!!job || !planId} data-tour="pt-generate"
                  title="Сгенерирует только недостающие сообщения и те, чьи документы или описание изменились">Обновить сообщения плана</Button>
          {job && <Button variant="secondary" icon={Square} onClick={cancel}>Остановить</Button>}
          <span className="nm-small nm-muted nm-grow" role="status">{status}</span>
          {schedule && <span className="nm-micro nm-muted">сообщений: {schedule.messages.length}{schedule.generated_at ? ` · ${ruDateTime(schedule.generated_at)}` : ''}</span>}
        </div>
        {job && (
          <div className="nm-stack" style={{ gap: 6 }}>
            <Progress value={d?.total ? d.done / d.total : 0} indeterminate={!d?.total} label="Генерация сообщений" />
            <div className="nm-micro nm-muted">
              {job.prefix} · {d ? `${d.done} из ${d.total} · запросов к ИИ: ${d.llm_calls || 0}${d.llm_planned ? ` из ~${d.llm_planned}` : ''}${d.current ? ` · ${d.current}` : ''}${d.reused ? ` · актуальных: ${d.reused}` : ''}${d.skipped ? ` · без документов: ${d.skipped}` : ''}${d.errors ? ` · ошибок: ${d.errors}` : ''}` : 'запуск…'}
            </div>
          </div>
        )}
      </Card>
      <div data-tour="pt-body" className="nm-stack" style={{ gap: 16 }}>
        {plans !== null && !plans.length ? <Card pad={false}><Empty>Планов пока нет — создайте план в разделе «Планы».</Empty></Card>
          : schedule === undefined ? <Spinner />
          : schedule === null ? (
            <>
              <Callout icon={Info}>Сообщений по этому плану ещё нет. Нажмите «Обновить сообщения плана» — ИИ напишет их по загруженным документам.</Callout>
              {(skeleton?.stages || []).map((st, i) => (
                <Card key={i} pad={false}>
                  <div className="nm-plan-stage"><div className="nm-plan-stage-title">{i + 1}. {st.title}</div></div>
                  {(st.substages || []).map((sub, j) => (
                    <div className="nm-msg-admin" key={j}>
                      <div className="nm-row" style={{ gap: 8 }}><b>{sub.title}</b><Badge tone="muted">ещё не сгенерировано</Badge></div>
                      {sub.brief && <div className="nm-micro nm-muted">О чём: {sub.brief.slice(0, 220)}</div>}
                    </div>
                  ))}
                </Card>
              ))}
            </>
          ) : !grouped.length ? <Card pad={false}><Empty>В расписании нет сообщений.</Empty></Card>
          : grouped.map((st, i) => (
            <Card key={i} pad={false}>
              <div className="nm-plan-stage"><div className="nm-plan-stage-title">{i + 1}. {st.title}</div></div>
              {st.subs.map((m) => (
                <MessageEditor key={m.message_id} m={m} kind={kinds[m.substage?.kind || ''] || m.substage?.kind || ''}
                               onSave={(t) => saveText(m.message_id, t)} onRegen={() => regen(m.message_id)} />
              ))}
            </Card>
          ))}
        {schedule && schedule.messages.some((m) => m.status === 'error') && (
          <Callout tone="danger" icon={TriangleAlert}>Часть сообщений не сгенерировалась — нажмите «Перегенерировать» у сообщения или «Обновить сообщения плана».</Callout>
        )}
      </div>
    </div>
  );
}
