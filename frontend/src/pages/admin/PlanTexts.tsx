import { useEffect, useRef, useState } from 'react';
import { FilePlus, Layers, Pencil, RefreshCw, Sparkles, XCircle } from 'lucide-react';
import { api, apiJson } from '../../lib/api';
import { pollJob } from '../../lib/jobs';
import type { Job, PlanRef } from '../../lib/types';

const STATUS_LABELS: Record<string, string> = {
  skipped: 'пропущено — нет документа', error: 'ошибка', edited: 'правка вручную', pending: 'в очереди',
};

export default function PlanTexts() {
  const [plans, setPlans] = useState<PlanRef[]>([]);
  const [pid, setPid] = useState('');
  const [profs, setProfs] = useState<string[]>([]);
  const [prof, setProf] = useState('');
  const [schedule, setSchedule] = useState<any>(null);
  const [bodyMsg, setBodyMsg] = useState('Выберите план.');
  const [meta, setMeta] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ pct: number; label: string } | null>(null);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const stopRef = useRef<(() => void) | null>(null);
  const jobRef = useRef<string | null>(null);

  const loadPlans = () => api('/plans').then((r) => r.json()).then((d) => {
    const list: PlanRef[] = d.plans || [];
    setPlans(list);
    if (list.length && !pid) setPid(list[0].plan_id);
  }).catch(() => setBodyMsg('Не удалось загрузить список планов.'));
  useEffect(() => { loadPlans(); }, []);

  // при смене плана — грузим должности
  useEffect(() => {
    if (!pid) return;
    api(`/plans/${encodeURIComponent(pid)}/professions`).then((r) => (r.ok ? r.json() : { professions: [] }))
      .then((d) => setProfs((d.professions || []).map((p: any) => (typeof p === 'string' ? p : p.profession || p.slug || ''))))
      .finally(() => setProf(''));
  }, [pid]);

  // при смене плана/должности — грузим тексты
  useEffect(() => {
    if (!pid) { setSchedule(null); setBodyMsg('Выберите план.'); return; }
    setSchedule(null);
    setBodyMsg('Загрузка…');
    api(`/plans/${encodeURIComponent(pid)}/schedule${prof ? '?profession=' + encodeURIComponent(prof) : ''}`)
      .then((r) => (r.status === 404 ? null : r.json()))
      .then((sch) => {
        if (!sch) { setMeta(''); setSchedule(null); setBodyMsg('Тексты ещё не сгенерированы. Сгенерируйте план.'); return; }
        setSchedule(sch);
        const msgs = sch.messages || [];
        setMeta(`сообщений: ${msgs.length}${sch.generated_at ? ' · ' + sch.generated_at.replace('T', ' ') : ''}`);
      })
      .catch(() => setBodyMsg('Не удалось загрузить тексты.'));
  }, [pid, prof]);

  const refetch = () => {
    // повторно тянем расписание (после генерации/правки)
    api(`/plans/${encodeURIComponent(pid)}/schedule${prof ? '?profession=' + encodeURIComponent(prof) : ''}`)
      .then((r) => (r.status === 404 ? null : r.json()))
      .then((sch) => { if (sch) { setSchedule(sch); const m = sch.messages || []; setMeta(`сообщений: ${m.length}${sch.generated_at ? ' · ' + sch.generated_at.replace('T', ' ') : ''}`); } })
      .catch(() => {});
  };

  const runGen = (url: string, startMsg: string) => {
    setBusy(true);
    setStatus(startMsg);
    setProgress({ pct: 0, label: '' });
    apiJson(url, { method: 'POST' }).then(({ ok, data }) => {
      if (!ok || !data.job_id) { setStatus(data.detail || 'Не удалось запустить'); setBusy(false); setProgress(null); return; }
      jobRef.current = data.job_id;
      stopRef.current = pollJob(`/jobs/${encodeURIComponent(data.job_id)}`, {
        onProgress: (job: Job) => {
          const pct = job.total ? Math.round((100 * job.done) / job.total) : 0;
          const extra = `${job.skipped ? ' · пропущено: ' + job.skipped : ''}${job.errors ? ' · ошибок: ' + job.errors : ''}`;
          setProgress({ pct, label: job.status === 'running' ? `Подэтап ${job.done} из ${job.total}${job.current ? ' · ' + job.current : ''}${extra}` : `Статус: ${job.status} · ${job.done} из ${job.total}${extra}` });
        },
        onDone: (job: Job) => {
          setBusy(false);
          jobRef.current = null;
          const skippedNote = job.skipped ? ` · пропущено (нет документа): ${job.skipped}` : '';
          setStatus(job.status === 'done' ? `Генерация завершена${skippedNote}` : job.status === 'cancelled' ? 'Генерация отменена (сгенерированное сохранено)' : (job.error || 'Ошибка'));
          refetch();
        },
      });
    }).catch((err) => { setStatus(err.message); setBusy(false); setProgress(null); });
  };

  const cancel = () => { if (jobRef.current) { setStatus('Отмена…'); api(`/jobs/${encodeURIComponent(jobRef.current)}/cancel`, { method: 'POST' }).catch(() => {}); } };

  const genSelected = () => { if (!pid) return; runGen(`/plans/${encodeURIComponent(pid)}/generate?profession=${encodeURIComponent(prof)}`, prof ? `Генерация для «${prof}»…` : 'Генерация общего текста…'); };
  const regenPlan = () => { if (!pid) return; if (!confirm('Перегенерировать ВЕСЬ выбранный план — все должности?')) return; runGen(`/plans/${encodeURIComponent(pid)}/generate`, 'Перегенерация всего плана…'); };
  const genMissing = () => { if (!pid) return; runGen(`/plans/${encodeURIComponent(pid)}/generate-missing?profession=${encodeURIComponent(prof)}`, 'Догенерация недостающих…'); };

  const genAll = async () => {
    if (!confirm('Перегенерировать тексты ВСЕХ планов? Это может занять время.')) return;
    setBusy(true);
    const d = await api('/plans').then((r) => r.json());
    const ids: string[] = (d.plans || []).map((p: PlanRef) => p.plan_id);
    if (!ids.length) { setStatus('Планов нет.'); setBusy(false); return; }
    let i = 0;
    const next = () => {
      if (i >= ids.length) { setStatus(`Готово: перегенерировано планов — ${ids.length}`); setBusy(false); refetch(); return; }
      const id = ids[i++];
      setStatus(`Генерация плана ${i} из ${ids.length}…`);
      apiJson(`/plans/${encodeURIComponent(id)}/generate`, { method: 'POST' }).then(({ ok, data }) => {
        if (!ok || !data.job_id) { next(); return; }
        jobRef.current = data.job_id;
        stopRef.current = pollJob(`/jobs/${encodeURIComponent(data.job_id)}`, { onDone: () => { jobRef.current = null; next(); } });
      }).catch(() => next());
    };
    next();
  };

  const regenMsg = async (mid: string) => {
    if (!pid || !mid) return;
    const q = prof ? '?profession=' + encodeURIComponent(prof) : '';
    const r = await api(`/plans/${encodeURIComponent(pid)}/messages/${encodeURIComponent(mid)}/regenerate${q}`, { method: 'POST' });
    if (r.ok) refetch();
  };

  const saveMsg = async (mid: string) => {
    const text = editing[mid] ?? '';
    const { ok, data } = await apiJson(`/plans/${encodeURIComponent(pid)}/messages/${encodeURIComponent(mid)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, profession: prof }),
    });
    if (!ok) { alert(data.detail || 'Не удалось сохранить'); return; }
    setEditing((e) => { const n = { ...e }; delete n[mid]; return n; });
    refetch();
  };

  useEffect(() => () => { stopRef.current?.(); }, []);

  // группировка сообщений по этапам
  const grouped = (() => {
    if (!schedule) return [];
    const byStage: Record<string, { title: string; order: number; subs: any[] }> = {};
    const order: string[] = [];
    (schedule.messages || []).forEach((m: any) => {
      const sid = (m.stage || {}).id;
      if (!byStage[sid]) { byStage[sid] = { title: (m.stage || {}).title, order: (m.stage || {}).order || 0, subs: [] }; order.push(sid); }
      byStage[sid].subs.push(m);
    });
    order.sort((a, b) => byStage[a].order - byStage[b].order);
    return order.map((sid) => byStage[sid]);
  })();

  return (
    <div className="tab-pane active">
      <h2 className="section-title"><FilePlus /> Тексты плана адаптации</h2>
      <p className="hint">Сгенерированные сообщения плана по этапам и подэтапам. Выберите план и, при необходимости, должность.</p>
      <div className="row" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', margin: '10px 0' }}>
        <select value={pid} onChange={(e) => setPid(e.target.value)} style={{ minWidth: 280 }}>
          {!plans.length && <option value="">— планов нет —</option>}
          {plans.map((p) => <option key={p.plan_id} value={p.plan_id}>{p.title}{p.role ? ' · ' + p.role : ''}</option>)}
        </select>
        <select value={prof} onChange={(e) => setProf(e.target.value)} style={{ minWidth: 200 }}>
          <option value="">Общий текст</option>
          {profs.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button className="ghost-btn" onClick={loadPlans}><RefreshCw /> Обновить</button>
        <span className="hint" style={{ marginLeft: 'auto' }}>{meta}</span>
      </div>
      <div className="toolbar" style={{ margin: '10px 0', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="primary-btn" disabled={busy} onClick={genSelected}><Sparkles /> Сгенерировать (выбранная должность)</button>
        <button className="primary-btn" disabled={busy} onClick={regenPlan}><RefreshCw /> Перегенерировать план</button>
        <button className="ghost-btn" disabled={busy} onClick={genMissing}><FilePlus /> Догенерировать недостающие</button>
        <button className="ghost-btn" disabled={busy} onClick={genAll}><Layers /> Перегенерировать все планы</button>
        {busy && <button className="ghost-btn" onClick={cancel}><XCircle /> Отменить генерацию</button>}
        <span style={{ color: '#475569', fontSize: 14 }}>{status}</span>
      </div>
      {progress && (
        <div className="progress-wrap">
          <div className="progress-bar"><div style={{ width: `${progress.pct}%` }} /></div>
          <div className="progress-label">{progress.label}</div>
        </div>
      )}

      <div id="pt-body">
        {!schedule ? (
          <div className="empty-hint">{bodyMsg}</div>
        ) : !grouped.length ? (
          <div className="empty-hint">В расписании нет сообщений.</div>
        ) : (
          grouped.map((st, i) => (
            <section className="pt-stage" key={i}>
              <h3 className="pt-stage-h">{i + 1}. {st.title || ''}</h3>
              {st.subs.map((m: any) => {
                const mid = m.message_id || '';
                const txt = ((m.content || {}).text || '').trim();
                const kind = (m.substage || {}).kind || '';
                const srcNames = [...new Set((m.sources || []).map((s: any) => (typeof s === 'string' ? s : s.source || s.filename || s.title || '')).filter(Boolean))];
                const isEditing = mid in editing;
                return (
                  <div className="pt-sub" key={mid}>
                    <div className="pt-sub-h">
                      <b>{(m.substage || {}).title || ''}</b>
                      {kind && <span className="pt-kind"> {kind}</span>}
                      {m.status && m.status !== 'generated' && <span className={`pt-status pt-status-${m.status}`}> {STATUS_LABELS[m.status] || m.status}</span>}
                    </div>
                    {isEditing ? (
                      <>
                        <textarea className="pt-edit" style={{ width: '100%', minHeight: 140, marginTop: 6 }} value={editing[mid]} onChange={(e) => setEditing((ed) => ({ ...ed, [mid]: e.target.value }))} />
                        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                          <button className="primary-btn" onClick={() => saveMsg(mid)}>Сохранить</button>
                          <button className="ghost-btn" onClick={() => setEditing((ed) => { const n = { ...ed }; delete n[mid]; return n; })}>Отмена</button>
                        </div>
                      </>
                    ) : (
                      <div className="pt-text">{txt ? txt : <span className="empty-hint">— текст пуст —</span>}</div>
                    )}
                    {(m.status === 'skipped' || m.status === 'error') && m.error && (
                      <div className="pt-reason" style={{ color: '#92400e', fontSize: 13, marginTop: 4 }}>{m.error}</div>
                    )}
                    {srcNames.length > 0 && <div className="pt-src">Источники: {srcNames.join(', ')}</div>}
                    {mid && !isEditing && (
                      <div className="pt-actions" style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                        <button className="icon-btn" onClick={() => setEditing((ed) => ({ ...ed, [mid]: txt }))}><Pencil /> Редактировать</button>
                        <button className="icon-btn" onClick={() => regenMsg(mid)}><RefreshCw /> Перегенерировать</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          ))
        )}
      </div>
    </div>
  );
}
