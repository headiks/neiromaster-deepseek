// Конструктор плана адаптации: этапы (длительность, отсчёт от даты выхода) и подэтапы —
// одно сообщение каждый (тип, день внутри этапа, время, «о чём» — задание для ИИ).
// Стандартный план из каталога, копия под смежную должность, оптимистичная блокировка
// (сервер сверяет, что план не менял другой администратор), покрытие документами.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, ChevronDown, ChevronUp, Copy, FileCheck2, Plus, Save, Trash2, X } from 'lucide-react';
import { plural } from '@shared/format';
import { COVERAGE } from '@shared/status';
import { api, ApiError, enc, messageOf } from '../../lib/api';
import { useToast } from '../../lib/toast';
import type { Board, Catalog, Coverage, Plan, PlanSummary, Stage, Substage } from '../../lib/types';
import { useTourHooks } from '../../tour';
import {
  Button, Callout, Card, Checkbox, Empty, Field, Help, Input, PageHeader, Progress, Select, Spinner, StatusBadge, Textarea, useDismiss,
} from '../../ui';
import { useConfirm } from '../../ui/confirm';
import { NextStep } from '../../blocks/NextStep';

const NEW = '';
const TEMPLATE = '__template';

/** Выбор плана: как выпадающий список, но у каждого сохранённого плана — «Удалить». */
function PlanPicker({ value, plans, onOpen, onDelete }: {
  value: string; plans: PlanSummary[]; onOpen: (id: string) => void; onDelete: (p: PlanSummary) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref);
  const name = (p: PlanSummary) => `${p.title}${p.role ? ` · ${p.role}` : ''}`;
  const cur = plans.find((p) => p.plan_id === value);
  const pick = (id: string) => { setOpen(false); onOpen(id); };
  return (
    <div className="nm-combo" ref={ref}>
      <button type="button" className="nm-input nm-combo-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="nm-grow">{cur ? name(cur) : '＋ Создать свой план'}</span><ChevronDown aria-hidden />
      </button>
      {open && (
        <div className="nm-combo-panel">
          <ul className="nm-combo-list" role="listbox" aria-label="Планы">
            <li role="option" aria-selected={value === NEW}><button type="button" className="nm-combo-pick" autoFocus onClick={() => pick(NEW)}>＋ Создать свой план</button></li>
            <li role="option" aria-selected={false}><button type="button" className="nm-combo-pick" onClick={() => pick(TEMPLATE)}>＋ Стандартный план (все этапы, ≈3 месяца)</button></li>
            {plans.length > 0 && <li className="nm-combo-note">Сохранённые планы</li>}
            {plans.map((p) => (
              <li key={p.plan_id} role="option" aria-selected={p.plan_id === value}>
                <button type="button" className="nm-combo-pick" onClick={() => pick(p.plan_id)}>{name(p)}</button>
                <button type="button" className="nm-combo-del" title="Удалить план" aria-label={`Удалить план «${p.title}»`}
                        onClick={() => { setOpen(false); onDelete(p); }}><Trash2 style={{ width: 15, height: 15 }} /></button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
const CUSTOM = '__custom__';
const UNIT_TITLES = { hours: 'часы', days: 'дни', weeks: 'недели', months: 'месяцы' } as const;
const UNIT_DAYS = { hours: 0, days: 1, weeks: 7, months: 30 } as const;

let uidCounter = 0;
const nextUid = (p: string) => `${p}${++uidCounter}`;
const emptyPlan = (): Plan => ({ plan_id: null, title: '', role: '', stages: [] });

function spanDays(d: Stage['duration']) {
  const v = Math.max(1, Number(d.value) || 1);
  if (d.unit === 'hours') return Math.max(1, Math.ceil(v / 24));
  return Math.max(1, v * (UNIT_DAYS[d.unit] || 1));
}

function offsets(stages: Stage[]) {
  const out: Record<string, number> = {};
  const before = stages.filter((s) => s.anchor === 'before_start');
  const after = stages.filter((s) => s.anchor !== 'before_start');
  let cursor = -before.reduce((sum, s) => sum + spanDays(s.duration), 0);
  before.forEach((s) => { out[s.uid!] = cursor; cursor += spanDays(s.duration); });
  cursor = 0;
  after.forEach((s) => { out[s.uid!] = cursor; cursor += spanDays(s.duration); });
  return out;
}

const whenLabel = (offset: number, time: string) =>
  offset === 0 ? `в день выхода, ${time}` : `${Math.abs(offset)} дн. ${offset > 0 ? 'после' : 'до'} выхода, ${time}`;

function withUids(p: Plan): Plan {
  return { ...p, stages: (p.stages || []).map((s) => ({ ...s, uid: s.uid || nextUid('u'), substages: (s.substages || []).map((x) => ({ ...x, uid: x.uid || nextUid('s') })) })) };
}

function payload(plan: Plan) {
  return {
    title: plan.title || 'План адаптации',
    group_daily: !!plan.group_daily,
    stages: plan.stages.map((s) => ({
      id: s.id || null, catalog_id: s.catalog_id, title: s.title, description: s.description || '', anchor: s.anchor, duration: s.duration,
      substages: s.substages.map((x) => ({ id: x.id || null, catalog_id: x.catalog_id, title: x.title, kind: x.kind, brief: x.brief, source: x.source, tags: x.tags || [], schedule: x.schedule })),
    })),
  };
}

// ---------------------------------------------------------------- подэтап
function SubEditor({ sub, index, count, span, dayChoice, offset, kinds, coverage, onChange, onMove, onRemove, first }: {
  sub: Substage; index: number; count: number; span: number; dayChoice: boolean; offset: number;
  kinds: Catalog['substage_kinds']; coverage?: boolean; first: boolean;
  onChange: (patch: Partial<Substage>) => void; onMove: (d: number) => void; onRemove: () => void;
}) {
  const sendOffset = offset + (dayChoice ? (sub.schedule.day || 1) - 1 : 0);
  return (
    <div className="nm-sub" data-tour={first ? 'sub' : undefined}>
      <div className="nm-sub-head">
        <span className="nm-muted nm-small" style={{ width: 22 }}>{index + 1}.</span>
        <Input value={sub.title} aria-label="Название подэтапа" onChange={(e) => onChange({ title: e.target.value })} />
        {coverage !== undefined && <StatusBadge view={coverage ? COVERAGE.found : COVERAGE.missing} />}
        <Button size="sm" variant="ghost" iconOnly icon={ChevronUp} aria-label="Выше" disabled={index === 0} onClick={() => onMove(-1)} />
        <Button size="sm" variant="ghost" iconOnly icon={ChevronDown} aria-label="Ниже" disabled={index === count - 1} onClick={() => onMove(1)} />
        <Button size="sm" variant="ghost" iconOnly icon={X} aria-label="Удалить подэтап" onClick={onRemove} />
      </div>
      <div data-tour={first ? 'brief' : undefined}>
        <Field label="О чём сообщение" help="Задание для ИИ, а не готовый текст. Опишите, что сотрудник должен узнать или сделать в этот момент, например: «Рассказать, где получить пропуск и спецодежду, к кому подойти в первый день». Готовое сообщение ИИ напишет сам по документам компании — его можно поправить в разделе «Сообщения».">
          <Textarea autosize value={sub.brief} placeholder="Что сотрудник должен узнать или сделать. Например: где получить пропуск и к кому подойти в первый день."
                    onChange={(e) => onChange({ brief: e.target.value, source: 'manual' })} />
        </Field>
      </div>
      {!sub.catalog_id && (
        <div className="nm-micro nm-muted">Свой подэтап: подходящие документы подберутся по смыслу названия и описания при сохранении плана
          {(sub.topic_keys || []).length ? ` · подобрано тем: ${sub.topic_keys!.length}` : ''}.</div>
      )}
      <div className="nm-sub-grid">
        <Field label="Тип" help="Сообщение — просто текст. Чек-лист — список дел с отметками. Опрос — вопросы о самочувствии и впечатлениях. Мини-тест — вопросы с вариантами ответа для проверки знаний. Напоминание — короткое напоминание о событии.">
          <Select small value={sub.kind} onChange={(e) => onChange({ kind: e.target.value })}>
            {kinds.map((k) => <option key={k.id} value={k.id}>{k.title}</option>)}
          </Select>
        </Field>
        <Field label="День внутри этапа" help="В какой день этапа отправить сообщение. Этап, заданный в часах, длится меньше суток — выбирается только время.">
          <Select small disabled={!dayChoice} value={String(sub.schedule.day || 1)} onChange={(e) => onChange({ schedule: { ...sub.schedule, day: Number(e.target.value) } })}>
            {dayChoice ? Array.from({ length: span }, (_, i) => <option key={i} value={i + 1}>День {i + 1}</option>) : <option>— этап в часах —</option>}
          </Select>
        </Field>
        <Field label="Время"><Input small type="time" value={sub.schedule.time} onChange={(e) => onChange({ schedule: { ...sub.schedule, time: e.target.value } })} /></Field>
        <div className="nm-sub-when"><CalendarDays aria-hidden />{whenLabel(sendOffset, sub.schedule.time)}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- этап
function StageEditor({ stage, index, count, offset, catalog, covered, onChange, onMove, onRemove }: {
  stage: Stage; index: number; count: number; offset: number; catalog: Catalog; covered: Map<string, boolean> | null;
  onChange: (s: Stage) => void; onMove: (d: number) => void; onRemove: () => void;
}) {
  const [tpl, setTpl] = useState(CUSTOM);
  const span = spanDays(stage.duration);
  const dayChoice = stage.duration.unit !== 'hours';
  const templates = catalog.stages.find((s) => s.id === stage.catalog_id)?.substage_templates || [];
  useEffect(() => { setTpl(templates[0]?.id || CUSTOM); }, [stage.catalog_id]); // eslint-disable-line react-hooks/exhaustive-deps
  const setDuration = (patch: Partial<Stage['duration']>) => {
    const duration = { ...stage.duration, ...patch };
    const s2 = spanDays(duration);
    onChange({ ...stage, duration, substages: stage.substages.map((x) => ({ ...x, schedule: { ...x.schedule, day: Math.max(1, Math.min(s2, x.schedule.day || 1)) } })) });
  };
  const subs = stage.substages;
  const addSub = () => {
    const t = templates.find((x) => x.id === tpl);
    const sub: Substage = t
      ? { uid: nextUid('s'), catalog_id: t.id, title: t.title, kind: t.kind, brief: t.brief, source: 'template', tags: t.tags || [], schedule: { day: 1, time: t.default_time || '09:00' } }
      : { uid: nextUid('s'), catalog_id: null, title: 'Новый подэтап', kind: 'message', brief: '', source: 'manual', tags: [], schedule: { day: 1, time: '09:00' } };
    onChange({ ...stage, substages: [...subs, sub] });
  };
  return (
    <Card className="nm-stage" data-tour={index === 0 ? 'stage' : undefined}>
      <div className="nm-stage-head">
        <span className="nm-stage-num">{index + 1}</span>
        <input className="nm-stage-title" aria-label="Название этапа" value={stage.title} onChange={(e) => onChange({ ...stage, title: e.target.value })} />
        <Button size="sm" variant="ghost" iconOnly icon={ChevronUp} aria-label="Этап выше" disabled={index === 0} onClick={() => onMove(-1)} />
        <Button size="sm" variant="ghost" iconOnly icon={ChevronDown} aria-label="Этап ниже" disabled={index === count - 1} onClick={() => onMove(1)} />
        <Button size="sm" variant="danger" icon={Trash2} onClick={onRemove}>Удалить этап</Button>
      </div>
      {stage.description && <div className="nm-small nm-muted">{stage.description}</div>}
      <div className="nm-stage-controls">
        <Field label="Длительность"><Input small type="number" min={1} value={stage.duration.value} onChange={(e) => setDuration({ value: Number(e.target.value) || 1 })} /></Field>
        <Field label="Единица">
          <Select small value={stage.duration.unit} onChange={(e) => setDuration({ unit: e.target.value as Stage['duration']['unit'] })}>
            {Object.entries(UNIT_TITLES).map(([id, t]) => <option key={id} value={id}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Отсчёт" help="«До выхода на работу» — этап идёт перед первым рабочим днём (приглашение, документы). «От даты выхода» — после.">
          <Select small value={stage.anchor} onChange={(e) => onChange({ ...stage, anchor: e.target.value as Stage['anchor'] })}>
            <option value="from_start">от даты выхода</option>
            <option value="before_start">до выхода на работу</option>
          </Select>
        </Field>
        <div className="nm-small nm-muted" style={{ paddingBottom: 10 }}>
          {span} {plural(span, 'календарный день', 'календарных дня', 'календарных дней')} · старт этапа {offset >= 0 ? '+' : ''}{offset} дн. от даты выхода
          {dayChoice ? '' : ' · день не выбирается, только время'}
        </div>
      </div>
      <div className="nm-stack">
        {subs.length ? subs.map((sub, i) => (
          <SubEditor key={sub.uid} sub={sub} index={i} count={subs.length} span={span} dayChoice={dayChoice} offset={offset}
                     kinds={catalog.substage_kinds} first={index === 0 && i === 0}
                     coverage={covered && sub.id ? covered.get(sub.id) : undefined}
                     onChange={(patch) => onChange({ ...stage, substages: subs.map((x, j) => (j === i ? { ...x, ...patch } : x)) })}
                     onMove={(d) => { const t = i + d; if (t < 0 || t >= subs.length) return; const n = subs.slice(); const [it] = n.splice(i, 1); n.splice(t, 0, it); onChange({ ...stage, substages: n }); }}
                     onRemove={() => onChange({ ...stage, substages: subs.filter((_, j) => j !== i) })} />
        )) : <div className="nm-small nm-muted">Подэтапов пока нет.</div>}
      </div>
      <div className="nm-add-row">
        <Field label="Подэтап из каталога или свой">
          <Select small value={tpl} onChange={(e) => setTpl(e.target.value)}>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            <option value={CUSTOM}>＋ Свой подэтап (создать)</option>
          </Select>
        </Field>
        <Button size="sm" icon={Plus} onClick={addSub}>Добавить подэтап</Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- страница
export default function Plans() {
  const toast = useToast();
  const { confirm, prompt } = useConfirm();
  const navigate = useNavigate();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [plan, setPlan] = useState<Plan>(emptyPlan);
  const [selected, setSelected] = useState(NEW);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [covered, setCovered] = useState<Map<string, boolean> | null>(null);
  const [stageTpl, setStageTpl] = useState(CUSTOM);
  const [loadError, setLoadError] = useState<string | null>(null);
  const planRef = useRef(plan);
  planRef.current = plan;

  useEffect(() => { document.title = 'Планы · НейроМастер'; }, []);
  const refreshPlans = useCallback(() => api.get<{ plans: PlanSummary[] }>('/plans').then((d) => setPlans(d.plans || [])), []);
  useEffect(() => {
    Promise.all([api.get<Catalog>('/catalog'), refreshPlans()]).then(([c]) => {
      setCatalog(c);
      setStageTpl(c.stages[0]?.id || CUSTOM);
    }).catch((e) => setLoadError(messageOf(e)));
  }, [refreshPlans]);

  // Покрытие документами: по плану (N из M) и по подэтапам (доска «этапы ↔ документы»).
  useEffect(() => {
    setCoverage(null); setCovered(null);
    const id = plan.plan_id;
    if (!id) return;
    api.get<{ plans: Coverage[] }>('/plans/coverage').then((d) => setCoverage((d.plans || []).find((p) => p.plan_id === id) || null)).catch(() => {});
    api.get<Board>(`/documents/board?plan_id=${enc(id)}`).then((b) => {
      const m = new Map<string, boolean>();
      (b.stages || []).forEach((s) => (s.substages || []).forEach((x) => { if (x.id) m.set(x.id, (x.documents || []).length > 0); }));
      setCovered(m);
    }).catch(() => {});
  }, [plan.plan_id, plan.updated_at]);

  const open = async (id: string) => {
    if (id === TEMPLATE) {
      if (!(await confirm({ title: 'Создать стандартный план?', text: 'В нём будут все этапы и подэтапы с датами отправки — дальше его можно поправить под себя.', ok: 'Создать' }))) return;
      setStatus('Создаю стандартный план…');
      try {
        const d = await api.post<Plan>('/plans/template');
        setPlan(withUids(d)); setSelected(d.plan_id!);
        await refreshPlans();
        setStatus('Стандартный план создан и сохранён — отредактируйте под задачу.');
      } catch (e) { setStatus(messageOf(e)); }
      return;
    }
    setSelected(id);
    if (!id) { setPlan(emptyPlan()); setStatus('Новый план: задайте название, добавьте этапы и подэтапы, затем сохраните.'); return; }
    try {
      const d = await api.get<{ plan: Plan }>(`/plans/${enc(id)}`);
      setPlan(withUids(d.plan)); setStatus('');
    } catch (e) { toast.error(messageOf(e)); }
  };

  const removePlan = async (p: { plan_id?: string | null; title: string }) => {
    if (!p.plan_id) { setPlan(emptyPlan()); return; }
    if (!(await confirm({ title: 'Удалить план?', text: `«${p.title}» будет удалён вместе с его сообщениями. Сотрудники с этим планом останутся без плана.`, ok: 'Удалить', danger: true }))) return;
    try {
      await api.del(`/plans/${enc(p.plan_id)}`);
      if (p.plan_id === planRef.current.plan_id) { setPlan(emptyPlan()); setSelected(NEW); }
      await refreshPlans();
      setStatus(`План «${p.title}» удалён`);
    } catch (e) { toast.error(messageOf(e)); }
  };
  const remove = () => removePlan(plan);

  const duplicate = async () => {
    if (!plan.plan_id) return;
    const title = await prompt({ title: 'Копия плана', text: 'Копия под смежную должность — структура та же, сообщения сгенерируются заново.', label: 'Название копии', value: `${plan.title} (копия)`, ok: 'Создать копию' });
    if (title === null) return;
    try {
      const d = await api.post<Plan>(`/plans/${enc(plan.plan_id)}/duplicate${title.trim() ? `?title=${enc(title.trim())}` : ''}`);
      setPlan(withUids(d)); setSelected(d.plan_id!); await refreshPlans();
      setStatus('Создана копия — отредактируйте под должность и сохраните.');
    } catch (e) { toast.error(messageOf(e)); }
  };

  const save = async (force = false): Promise<void> => {
    const cur = planRef.current;
    if (cur.__demo) { setStatus('Демо-план для тура — не сохраняется.'); return; }
    if (!(cur.title || '').trim()) { setStatus('Укажите название плана'); return; }
    if (!cur.stages.some((s) => s.substages.length)) { setStatus('Добавьте хотя бы один этап с подэтапом'); return; }
    setSaving(true); setStatus('Сохранение…');
    const body: Record<string, unknown> = payload(cur);
    if (cur.plan_id && cur.updated_at && !force) body.expected_updated_at = cur.updated_at;
    try {
      const saved = await (cur.plan_id ? api.put<Plan>(`/plans/${enc(cur.plan_id)}`, body) : api.post<Plan>('/plans', body));
      // uid сохраняем, чтобы React не пересоздавал поля (фокус и прокрутка остаются).
      const merged: Plan = { ...saved, stages: saved.stages.map((s, i) => ({ ...s, uid: cur.stages[i]?.uid || nextUid('u'),
        substages: s.substages.map((x, j) => ({ ...x, uid: cur.stages[i]?.substages[j]?.uid || nextUid('s') })) })) };
      setPlan(merged); setSelected(saved.plan_id!);
      await refreshPlans();
      setStatus(`Сохранено: ${saved.title}.`);
      toast.push({ tone: 'ok', text: 'План сохранён. Дальше — документы, затем сообщения.', action: { label: 'К документам →', onClick: () => navigate('/admin/documents') } });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const msg = (e.data?.detail && e.data.detail.message) || 'План изменил другой администратор.';
        setSaving(false);
        if (await confirm({ title: 'План изменён другим администратором', text: `${msg}\n\nСохранить ваши правки поверх (его изменения пропадут) или загрузить актуальную версию?`, ok: 'Сохранить мои правки', cancel: 'Загрузить актуальную' })) {
          return save(true);
        }
        await open(cur.plan_id!);
        setStatus('Загружена актуальная версия плана.');
        return;
      }
      setStatus(`Ошибка сохранения: ${messageOf(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const addStage = () => {
    if (!catalog) return;
    const t = catalog.stages.find((s) => s.id === stageTpl);
    const stage: Stage = t
      ? { uid: nextUid('u'), catalog_id: t.id, title: t.title, description: t.description, anchor: t.anchor, duration: { ...t.default_duration }, substages: [] }
      : { uid: nextUid('u'), catalog_id: null, title: 'Новый этап', description: '', anchor: 'from_start', duration: { value: 1, unit: 'days' }, substages: [] };
    setPlan((p) => ({ ...p, stages: [...p.stages, stage] }));
  };

  // Тур: демо-план из двух этапов каталога (не сохраняется), потом возврат к исходному.
  useTourHooks('plans', {
    ready: () => !!catalog,
    demoActive: () => !!planRef.current.__demo,
    showDemo: () => {
      if (!catalog) return;
      const stages: Stage[] = catalog.stages.slice(0, 2).map((st, i) => ({
        uid: nextUid('u'), catalog_id: st.id, title: st.title, description: st.description, anchor: st.anchor, duration: { ...st.default_duration },
        substages: st.substage_templates.slice(0, i ? 1 : 2).map((t) => ({ uid: nextUid('s'), catalog_id: t.id, title: t.title, kind: t.kind, brief: t.brief, source: 'template', tags: t.tags || [], schedule: { day: 1, time: t.default_time || '09:00' } })),
      }));
      setPlan({ plan_id: null, title: '', role: '', group_daily: false, stages, __demo: true });
      setSelected(NEW);
      setStatus('Демо-план для тура — не сохраняется.');
    },
    snapshot: () => ({ plan: planRef.current, selected, status }),
    restore: (s) => { const x = s as { plan: Plan; selected: string; status: string }; setPlan(x.plan); setSelected(x.selected); setStatus(x.status); },
  });

  const offs = useMemo(() => offsets(plan.stages), [plan.stages]);
  const messages = plan.stages.reduce((n, s) => n + s.substages.length, 0);
  const totalDays = plan.stages.filter((s) => s.anchor !== 'before_start').reduce((n, s) => n + spanDays(s.duration), 0);

  if (loadError) return <div className="nm-page"><PageHeader title="Планы" /><Callout tone="danger">Не удалось загрузить каталог этапов: {loadError}</Callout></div>;
  if (!catalog) return <div className="nm-page"><PageHeader title="Планы" /><Spinner /></div>;

  return (
    <div className="nm-page">
      <PageHeader title="Планы адаптации" subtitle="План — шаблон: сроки считаются от даты выхода, у каждого сотрудника она своя, и расписание пересчитывается само."
                  actions={plan.plan_id ? <>
                    <Button icon={Copy} onClick={duplicate} title="Копия плана под смежную должность">Копия</Button>
                    <Button variant="danger" icon={Trash2} onClick={remove}>Удалить план</Button>
                  </> : undefined} />
      <NextStep here="/admin/plans" />
      <Card>
        <div className="nm-field-row">
          <div data-tour="plan-select">
            <Field label="План">
              <PlanPicker value={selected} plans={plans} onOpen={open} onDelete={removePlan} />
            </Field>
          </div>
          <div data-tour="plan-title">
            <Field label="Название плана"><Input value={plan.title} placeholder="Например: Адаптация водителя" onChange={(e) => setPlan({ ...plan, title: e.target.value })} /></Field>
          </div>
        </div>
        <div className="nm-row" data-tour="group-daily">
          <Checkbox label="Сообщения одного дня — одной сессией" checked={!!plan.group_daily} onChange={(v) => setPlan({ ...plan, group_daily: v })} />
          <Help text="Все сообщения, запланированные на один день, придут вместе — во время первого из них и одним уведомлением, а не россыпью каждые час-два." />
        </div>
        <div className="nm-row-between nm-small nm-muted">
          <span>Этапов: {plan.stages.length} · сообщений: {messages} · длительность после выхода: {totalDays} дн.</span>
          {!plan.stages.length && <span>Не знаете, с чего начать — выберите «Стандартный план» и поправьте его.</span>}
        </div>
        {coverage && (
          <div className="nm-stack" style={{ gap: 6 }}>
            <div className="nm-row-between nm-small"><span><FileCheck2 aria-hidden style={{ width: 15, height: 15, verticalAlign: '-3px', marginRight: 6 }} />Покрытие документами</span>
              <b>{coverage.covered} из {coverage.total}</b></div>
            <Progress small value={coverage.total ? coverage.covered / coverage.total : 0} tone={coverage.covered === coverage.total ? 'ok' : undefined} label="Покрытие документами" />
          </div>
        )}
      </Card>

      {plan.stages.length ? plan.stages.map((s, i) => (
        <StageEditor key={s.uid} stage={s} index={i} count={plan.stages.length} offset={offs[s.uid!] || 0} catalog={catalog} covered={covered}
                     onChange={(st) => setPlan((p) => ({ ...p, stages: p.stages.map((x, j) => (j === i ? st : x)) }))}
                     onMove={(d) => setPlan((p) => { const t = i + d; if (t < 0 || t >= p.stages.length) return p; const n = p.stages.slice(); const [it] = n.splice(i, 1); n.splice(t, 0, it); return { ...p, stages: n }; })}
                     onRemove={() => setPlan((p) => ({ ...p, stages: p.stages.filter((_, j) => j !== i) }))} />
      )) : <Card pad={false}><Empty icon={CalendarDays}>Этапов пока нет. Выберите этап из списка ниже и добавьте его в план.</Empty></Card>}

      <Card>
        <div className="nm-add-row" data-tour="add-stage">
          <Field label="Выберите этап или создайте свой">
            <Select value={stageTpl} onChange={(e) => setStageTpl(e.target.value)}>
              {catalog.stages.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              <option value={CUSTOM}>＋ Свой этап (создать)</option>
            </Select>
          </Field>
          <Button icon={Plus} onClick={addStage}>Добавить этап</Button>
        </div>
      </Card>

      <div className="nm-row" style={{ position: 'sticky', bottom: 12, zIndex: 5 }}>
        <Button variant="primary" size="lg" icon={Save} loading={saving} onClick={() => save()} data-tour="save-plan" style={{ boxShadow: 'var(--nm-shadow-float)' }}>Сохранить план</Button>
        {status && <span className="nm-small nm-muted nm-glass" style={{ padding: '8px 14px', borderRadius: 999 }} role="status">{status}</span>}
      </div>
      <p className="nm-small nm-muted" style={{ margin: 0 }}>Сообщения сотрудникам по плану генерируются и правятся в разделе «Сообщения».</p>
    </div>
  );
}
