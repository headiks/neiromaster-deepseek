import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import Header from '../components/Header';

interface PlanRow { plan_id: string; title?: string; role?: string; stages?: number; substages?: number; generated?: boolean }
function fmtTs(s?: string) {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T'));
  return isNaN(+d) ? String(s) : d.toLocaleString('ru-RU', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function PlansDb() {
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [current, setCurrent] = useState('');
  const [detail, setDetail] = useState<{ plan: any; schedules: { key: string; sch: any }[] } | null>(null);
  const [detailMsg, setDetailMsg] = useState('Выберите план слева.');

  const loadPlans = () => api('/plans').then((r) => r.json()).then((d) => setPlans(d.plans || [])).catch(() => {});
  useEffect(() => { loadPlans(); }, []);

  const loadDetail = async (id: string) => {
    setDetail(null); setDetailMsg('Загрузка…');
    try {
      const plan = (await api(`/plans/${encodeURIComponent(id)}`).then((r) => r.json())).plan || {};
      const pr = await api(`/plans/${encodeURIComponent(id)}/professions`).then((r) => (r.ok ? r.json() : { professions: [] }));
      const profs: string[] = (pr.professions || []).map((x: any) => (typeof x === 'string' ? x : x.profession || ''));
      const keys = [''].concat(profs);
      const schedules = await Promise.all(keys.map((k) =>
        api(`/plans/${encodeURIComponent(id)}/schedule${k ? '?profession=' + encodeURIComponent(k) : ''}`)
          .then((r) => (r.status === 404 ? null : r.json())).then((sch) => ({ key: k, sch })).catch(() => ({ key: k, sch: null }))));
      setDetail({ plan, schedules });
    } catch { setDetailMsg('Не удалось загрузить план.'); }
  };

  const pick = (id: string) => { setCurrent(id); loadDetail(id); };

  const stages = (detail?.plan.stages || []).length;
  const subs = (detail?.plan.stages || []).reduce((a: number, s: any) => a + ((s.substages || []).length), 0);
  const rows = (detail?.schedules || []).filter((x) => x.sch);

  return (
    <div className="admin-page">
      <Header title="База планов" actions={<><button className="ghost-btn" onClick={loadPlans}><RefreshCw /> Обновить</button><a className="ghost-btn" href="/admin">← Админка</a></>} />
      <div className="stage-hint">Планы адаптации в БД: структура (plans) и расписания (plan_schedules, JSONB).</div>
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16, marginTop: 18 }}>
        <div className="card" style={{ padding: 0, maxHeight: '74vh', overflow: 'auto' }}>
          {!plans.length ? <div className="empty-hint" style={{ padding: 16 }}>Планов нет.</div> : plans.map((p) => (
            <button key={p.plan_id} onClick={() => pick(p.plan_id)} style={{
              display: 'block', width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid var(--color-divider)',
              background: current === p.plan_id ? 'var(--color-accent-100)' : 'none', padding: '11px 15px', cursor: 'pointer', font: 'inherit', color: 'var(--color-text)',
              boxShadow: current === p.plan_id ? 'inset 3px 0 0 var(--color-accent)' : undefined,
            }}>
              <div style={{ fontWeight: 600 }}>{p.title || 'без названия'}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{p.role ? p.role + ' · ' : ''}этапов: {p.stages || 0} · подэтапов: {p.substages || 0}</div>
              <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{p.plan_id}</div>
              <span className={`status-badge ${p.generated ? 'indexed' : ''}`} style={{ marginTop: 3 }}>{p.generated ? 'есть расписания' : 'не сгенерирован'}</span>
            </button>
          ))}
        </div>
        <div className="card">
          {!detail ? <div className="empty-hint">{detailMsg}</div> : (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px', marginBottom: 14, fontSize: 13 }}>
                <div><b style={{ color: 'var(--muted)' }}>plan_id:</b> <span className="mono">{detail.plan.plan_id || '—'}</span></div>
                <div><b style={{ color: 'var(--muted)' }}>Название:</b> {detail.plan.title || '—'}</div>
                <div><b style={{ color: 'var(--muted)' }}>Роль:</b> {detail.plan.role || '—'}</div>
                <div><b style={{ color: 'var(--muted)' }}>Обновлён:</b> {fmtTs(detail.plan.updated_at)}</div>
                <div><b style={{ color: 'var(--muted)' }}>Этапов/подэтапов:</b> {stages}/{subs}</div>
              </div>
              <div className="lbl" style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--muted)', margin: '18px 0 8px' }}>plans — структура плана (JSONB)</div>
              <details><summary>plans.data — {stages} этапов · {subs} подэтапов</summary><pre style={preStyle}>{JSON.stringify(detail.plan, null, 2)}</pre></details>
              <div className="lbl" style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--muted)', margin: '18px 0 8px' }}>plan_schedules — расписания ({rows.length})</div>
              {!rows.length ? <div className="empty-hint">Сгенерированных расписаний нет.</div> : detail.schedules.map(({ key, sch }, i) => sch && (
                <details key={i}><summary>{key || "Общее расписание (profession = '')"} — {(sch.messages || []).length} сообщений · {fmtTs(sch.generated_at)}</summary><pre style={preStyle}>{JSON.stringify(sch, null, 2)}</pre></details>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const preStyle: React.CSSProperties = { margin: 0, padding: 13, maxHeight: 520, overflow: 'auto', background: 'var(--color-surface)', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, whiteSpace: 'pre', color: 'var(--color-text)', border: '1px solid var(--color-divider)' };
