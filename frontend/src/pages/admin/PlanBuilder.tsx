import { useEffect, useState } from 'react';
import { CalendarCog, CalendarDays, ChevronDown, ChevronUp, Save, X } from 'lucide-react';
import { api } from '../../lib/api';
import type { Catalog, Plan, PlanRef } from '../../lib/types';

const UNIT_TITLES: Record<string, string> = { hours: 'часы', days: 'дни', weeks: 'недели', months: 'месяцы' };
const UNIT_DAYS: Record<string, number> = { hours: 0, days: 1, weeks: 7, months: 30 };

let uidCounter = 0;
const nextUid = (p: string) => `${p}${++uidCounter}`;

function stageSpanDays(d: any): number {
  const value = Math.max(1, parseInt(d.value, 10) || 1);
  if (d.unit === 'hours') return Math.max(1, Math.ceil(value / 24));
  return Math.max(1, value * (UNIT_DAYS[d.unit] || 1));
}
const dayChoiceAllowed = (d: any) => d.unit !== 'hours';

function shiftDate(startDate: string, offsetDays: number): string {
  const d = new Date(`${startDate}T00:00:00`);
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const emptyPlan = (): Plan => ({ plan_id: null, title: '', role: '', start_date: '', stages: [] });

function ensureUids(plan: Plan): Plan {
  plan.stages?.forEach((s: any) => {
    if (!s.uid) s.uid = nextUid('u');
    s.substages?.forEach((sub: any) => { if (!sub.uid) sub.uid = nextUid('s'); });
  });
  return plan;
}

export default function PlanBuilder() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [planList, setPlanList] = useState<PlanRef[]>([]);
  const [selected, setSelected] = useState('');
  const [plan, setPlan] = useState<Plan>(emptyPlan());
  const [catStage, setCatStage] = useState('');
  const [status, setStatus] = useState('');
  const [defaultId, setDefaultId] = useState('');   // активный общий план (авто-назначение)

  useEffect(() => {
    Promise.all([api('/catalog').then((r) => r.json()), api('/plans').then((r) => r.json())])
      .then(([cat, plans]) => {
        setCatalog(cat);
        setPlanList(plans.plans || []);
        setDefaultId(plans.default_plan_id || '');
        setCatStage(cat.stages?.[0]?.id || '__custom__');
      })
      .catch((err) => setStatus(`Не удалось загрузить каталог этапов: ${err.message}`));
  }, []);

  const mutate = (fn: (p: Plan) => void) => setPlan((prev: Plan) => { const p = structuredClone(prev); fn(p); return p; });

  const onSelect = (id: string) => {
    setSelected(id);
    if (!id) { setPlan(emptyPlan()); setStatus('Выберите план для редактирования'); return; }
    api(`/plans/${encodeURIComponent(id)}`).then((r) => r.json()).then((data) => setPlan(ensureUids(data.plan)));
  };

  const refreshPlanList = () => api('/plans').then((r) => r.json()).then((d) => {
    setPlanList(d.plans || []);
    setDefaultId(d.default_plan_id || '');
  });

  // Сделать выбранный план активным общим: авто-назначается новым сотрудникам по
  // должности и сразу — всем без плана (ручные назначения не трогаются).
  const makeDefault = () => {
    if (!plan.plan_id) return;
    setStatus('Назначение активного плана...');
    api(`/plans/${encodeURIComponent(plan.plan_id)}/set-default`, { method: 'POST' })
      .then((r) => r.json())
      .then((d) => { setDefaultId(plan.plan_id || ''); setStatus(`План сделан активным. Назначен новым сотрудникам: ${d.assigned}`); })
      .catch((err) => setStatus(`Не удалось назначить активным: ${err.message}`));
  };

  const computeOffsets = (): Record<string, number> => {
    const offsets: Record<string, number> = {};
    const before = plan.stages.filter((s: any) => s.anchor === 'before_start');
    const after = plan.stages.filter((s: any) => s.anchor !== 'before_start');
    let cursor = -before.reduce((sum: number, s: any) => sum + stageSpanDays(s.duration), 0);
    before.forEach((s: any) => { offsets[s.uid] = cursor; cursor += stageSpanDays(s.duration); });
    cursor = 0;
    after.forEach((s: any) => { offsets[s.uid] = cursor; cursor += stageSpanDays(s.duration); });
    return offsets;
  };

  const sendDateLabel = (offsetDays: number, time: string) =>
    !plan.start_date ? `${offsetDays >= 0 ? '+' : ''}${offsetDays} дн. от даты выхода, ${time}` : `${shiftDate(plan.start_date, offsetDays)} ${time}`;

  const addStage = () => {
    if (!catalog) return;
    mutate((p) => {
      if (catStage === '__custom__') {
        p.stages.push({ uid: nextUid('u'), catalog_id: null, title: 'Новый этап', description: '', anchor: 'from_start', duration: { value: 1, unit: 'days' }, substages: [] });
      } else {
        const t = catalog.stages.find((s: any) => s.id === catStage);
        if (!t) return;
        p.stages.push({ uid: nextUid('u'), catalog_id: t.id, title: t.title, description: t.description, anchor: t.anchor, duration: { ...t.default_duration }, substages: [] });
      }
    });
  };

  const substageTemplates = (stage: any): any[] => {
    if (!stage.catalog_id || !catalog) return [];
    return catalog.stages.find((s: any) => s.id === stage.catalog_id)?.substage_templates || [];
  };

  const addSubstage = (si: number, tplId: string) => mutate((p) => {
    const stage = p.stages[si];
    const t = substageTemplates(stage).find((x) => x.id === tplId);
    if (t) stage.substages.push({ uid: nextUid('s'), catalog_id: t.id, title: t.title, kind: t.kind, brief: t.brief, source: 'template', tags: t.tags || [], schedule: { day: 1, time: t.default_time || '09:00' } });
    else stage.substages.push({ uid: nextUid('s'), catalog_id: null, title: 'Новый подэтап', kind: 'message', brief: '', source: 'manual', tags: [], schedule: { day: 1, time: '09:00' } });
  });

  const save = () => {
    if (!plan.plan_id) { setStatus('Выберите план для редактирования — создание нового отключено'); return; }
    setStatus('Сохранение...');
    const payload = {
      title: plan.title || 'План адаптации', role: plan.role || '', start_date: plan.start_date || null,
      stages: plan.stages.map((s: any) => ({
        id: s.id || null, catalog_id: s.catalog_id, title: s.title, description: s.description || '', anchor: s.anchor, duration: s.duration,
        substages: s.substages.map((sub: any) => ({ id: sub.id || null, catalog_id: sub.catalog_id, title: sub.title, kind: sub.kind, brief: sub.brief, source: sub.source, tags: sub.tags || [], schedule: sub.schedule })),
      })),
    };
    api(`/plans/${encodeURIComponent(plan.plan_id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then((r) => r.json())
      .then((saved) => { setPlan(ensureUids(saved)); setStatus(`Сохранено: ${saved.title}`); refreshPlanList(); })
      .catch((err) => setStatus(`Ошибка сохранения: ${err.message}`));
  };

  const offsets = computeOffsets();

  return (
    <div className="tab-pane active">
      <h2 className="section-title"><CalendarCog /> Конструктор плана адаптации</h2>
      <div className="toolbar">
        <div className="field">
          <label>Готовый план (редактирование)</label>
          <select value={selected} onChange={(e) => onSelect(e.target.value)}>
            <option value="">— выберите план —</option>
            {planList.map((p) => <option key={p.plan_id} value={p.plan_id}>{p.title}{p.role ? ' · ' + p.role : ''}{p.plan_id === defaultId ? ' · активный' : ''}</option>)}
          </select>
        </div>
        {plan.plan_id && (
          plan.plan_id === defaultId
            ? <span className="status-badge indexed" style={{ alignSelf: 'end' }}>✓ активный общий план</span>
            : <button className="ghost-btn" style={{ alignSelf: 'end' }} onClick={makeDefault}>Сделать активным (авто-назначать новым)</button>
        )}
      </div>
      <div className="stage-hint">План можно редактировать (этапы, подэтапы, сроки, тексты) и сохранять. Создание новых планов отключено — правьте существующий.</div>

      <div className="card">
        <div className="plan-meta">
          <div className="field"><label>Название плана</label><input type="text" placeholder="Например: Адаптация водителя" value={plan.title || ''} onChange={(e) => mutate((p) => { p.title = e.target.value; })} /></div>
          <div className="field"><label>Должность / роль</label><input type="text" placeholder="Водитель" value={plan.role || ''} onChange={(e) => mutate((p) => { p.role = e.target.value; })} /></div>
          <div className="field"><label>Дата выхода (для предпросмотра)</label><input type="date" value={plan.start_date || ''} onChange={(e) => mutate((p) => { p.start_date = e.target.value; })} /></div>
        </div>
        <div className="stage-hint">План — это шаблон. Дата здесь нужна только для предпросмотра дат; у каждого сотрудника своя дата выхода.</div>
      </div>

      <div id="stages-container">
        {!plan.stages.length ? (
          <div className="empty-hint">Этапов пока нет. Выберите этап из списка ниже и добавьте его в план.</div>
        ) : (
          plan.stages.map((stage: any, si: number) => {
            const span = stageSpanDays(stage.duration);
            const dayChoice = dayChoiceAllowed(stage.duration);
            const offset = offsets[stage.uid] || 0;
            return (
              <div className="stage-card" key={stage.uid}>
                <div className="stage-head">
                  <div style={{ flex: 1 }}>
                    <input type="text" className="stage-title-input" value={stage.title} onChange={(e) => mutate((p) => { p.stages[si].title = e.target.value; })} />
                  </div>
                  <div>
                    <button className="icon-btn" onClick={() => mutate((p) => { if (si > 0) { const [x] = p.stages.splice(si, 1); p.stages.splice(si - 1, 0, x); } })}><ChevronUp /></button>
                    <button className="icon-btn" onClick={() => mutate((p) => { if (si < p.stages.length - 1) { const [x] = p.stages.splice(si, 1); p.stages.splice(si + 1, 0, x); } })}><ChevronDown /></button>
                    <button className="icon-btn danger" onClick={() => mutate((p) => { p.stages.splice(si, 1); })}>Удалить этап</button>
                  </div>
                </div>
                {stage.description && <div className="stage-hint">{stage.description}</div>}
                <div className="stage-controls">
                  <div className="field"><label>Длительность</label><input type="number" min={1} style={{ width: 90 }} value={stage.duration.value} onChange={(e) => mutate((p) => { p.stages[si].duration.value = parseInt(e.target.value, 10) || 1; })} /></div>
                  <div className="field"><label>Единица</label>
                    <select value={stage.duration.unit} onChange={(e) => mutate((p) => { p.stages[si].duration.unit = e.target.value; })}>
                      {Object.entries(UNIT_TITLES).map(([id, t]) => <option key={id} value={id}>{t}</option>)}
                    </select>
                  </div>
                  <div className="field"><label>Отсчёт</label>
                    <select value={stage.anchor} onChange={(e) => mutate((p) => { p.stages[si].anchor = e.target.value; })}>
                      <option value="from_start">от даты выхода</option>
                      <option value="before_start">до выхода на работу</option>
                    </select>
                  </div>
                  <div className="stage-hint">{span} кал. дн. · старт этапа {offset >= 0 ? '+' : ''}{offset} дн. от даты выхода{dayChoice ? '' : ' · день не выбирается, только время'}</div>
                </div>

                <div style={{ marginTop: 14 }}>
                  {!stage.substages.length ? (
                    <div className="empty-hint">Подэтапов пока нет.</div>
                  ) : (
                    stage.substages.map((sub: any, sj: number) => {
                      const offsetDays = offset + (dayChoice ? (sub.schedule.day || 1) - 1 : 0);
                      return (
                        <div className="sub-item" key={sub.uid}>
                          <div className="sub-head">
                            <span style={{ color: '#94a3b8' }}>{sj + 1}.</span>
                            <input type="text" value={sub.title} onChange={(e) => mutate((p) => { p.stages[si].substages[sj].title = e.target.value; })} />
                            <button className="icon-btn" onClick={() => mutate((p) => { const a = p.stages[si].substages; if (sj > 0) { const [x] = a.splice(sj, 1); a.splice(sj - 1, 0, x); } })}><ChevronUp /></button>
                            <button className="icon-btn" onClick={() => mutate((p) => { const a = p.stages[si].substages; if (sj < a.length - 1) { const [x] = a.splice(sj, 1); a.splice(sj + 1, 0, x); } })}><ChevronDown /></button>
                            <button className="icon-btn danger" onClick={() => mutate((p) => { p.stages[si].substages.splice(sj, 1); })}><X /></button>
                          </div>
                          <div style={{ marginTop: 10 }}>
                            <label style={{ fontSize: 12, color: '#64748b' }}>Что должен написать бот (основа для генерации по документам)</label>
                            <textarea value={sub.brief} placeholder="Опишите, о чём сообщение." onChange={(e) => mutate((p) => { p.stages[si].substages[sj].brief = e.target.value; p.stages[si].substages[sj].source = 'manual'; })} />
                          </div>
                          <div className="sub-grid">
                            <div className="field"><label>Тип</label>
                              <select value={sub.kind} onChange={(e) => mutate((p) => { p.stages[si].substages[sj].kind = e.target.value; })}>
                                {(catalog?.substage_kinds || []).map((k: any) => <option key={k.id} value={k.id}>{k.title}</option>)}
                              </select>
                            </div>
                            <div className="field"><label>День внутри этапа</label>
                              <select disabled={!dayChoice} value={sub.schedule.day} onChange={(e) => mutate((p) => { p.stages[si].substages[sj].schedule.day = parseInt(e.target.value, 10) || 1; })}>
                                {dayChoice ? Array.from({ length: span }, (_, i) => <option key={i} value={i + 1}>День {i + 1}</option>) : <option>— этап задан в часах —</option>}
                              </select>
                            </div>
                            <div className="field"><label>Время</label><input type="time" value={sub.schedule.time} onChange={(e) => mutate((p) => { p.stages[si].substages[sj].schedule.time = e.target.value; })} /></div>
                            <div className="sub-when"><CalendarDays /> {sendDateLabel(offsetDays, sub.schedule.time)}</div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <AddSubstageRow templates={substageTemplates(stage)} onAdd={(tplId) => addSubstage(si, tplId)} />
              </div>
            );
          })
        )}
      </div>

      <div className="add-row">
        <select value={catStage} onChange={(e) => setCatStage(e.target.value)}>
          {(catalog?.stages || []).map((s: any) => <option key={s.id} value={s.id}>{s.title}</option>)}
          <option value="__custom__">— свой этап —</option>
        </select>
        <button className="ghost-btn" onClick={addStage}>＋ Добавить этап</button>
      </div>

      <div className="toolbar" style={{ marginTop: 24 }}>
        <button className="primary-btn" onClick={save}><Save /> Сохранить план</button>
        <span style={{ color: '#475569', fontSize: 14 }}>{status}</span>
      </div>
      <div className="stage-hint" style={{ marginTop: 12 }}>Генерация текстов, перегенерация и правка сообщений — на вкладке «Тексты плана».</div>
    </div>
  );
}

function AddSubstageRow({ templates, onAdd }: { templates: any[]; onAdd: (id: string) => void }) {
  const [val, setVal] = useState(templates[0]?.id || '__custom__');
  return (
    <div className="add-row">
      <select value={val} onChange={(e) => setVal(e.target.value)}>
        {templates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        <option value="__custom__">— свой подэтап (текст вручную) —</option>
      </select>
      <button className="ghost-btn" onClick={() => onAdd(val)}>＋ Добавить подэтап</button>
    </div>
  );
}
