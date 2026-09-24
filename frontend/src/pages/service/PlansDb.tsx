// База планов: структура плана (plans.data) и расписания по должностям (plan_schedules) как JSON.
import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, RefreshCw } from 'lucide-react';
import { ruDateTime } from '@shared/format';
import { api, enc } from '../../lib/api';
import { Badge, Button, Card, Empty, PageHeader, Spinner } from '../../ui';

type P = { plan_id: string; title?: string; role?: string; stages?: number; substages?: number; generated?: boolean };
type Detail = { plan: Record<string, any>; schedules: { key: string; sch: { messages?: unknown[]; generated_at?: string } }[] };

export default function PlansDb() {
  const [plans, setPlans] = useState<P[] | null>(null);
  const [current, setCurrent] = useState('');
  const [detail, setDetail] = useState<Detail | null | undefined>(undefined);
  useEffect(() => { document.title = 'База планов · НейроМастер'; }, []);
  const loadPlans = useCallback(() => { api.get<{ plans: P[] }>('/plans').then((d) => setPlans(d.plans || [])).catch(() => setPlans([])); }, []);
  useEffect(loadPlans, [loadPlans]);
  useEffect(() => {
    if (!current) return;
    setDetail(undefined);
    (async () => {
      try {
        const { plan } = await api.get<{ plan: Record<string, any> }>(`/plans/${enc(current)}`);
        const pr = await api.get<{ professions?: (string | { profession?: string })[] }>(`/plans/${enc(current)}/professions`).catch(() => ({ professions: [] }));
        const keys = [''].concat((pr.professions || []).map((x) => (typeof x === 'string' ? x : x.profession || '')));
        const list = await Promise.all(keys.map((k) => api.get<any>(`/plans/${enc(current)}/schedule?missing_ok=true${k ? `&profession=${enc(k)}` : ''}`)
          .then((sch) => ({ key: k, sch })).catch(() => ({ key: k, sch: null }))));
        setDetail({ plan, schedules: list.filter((x) => x.sch) as Detail['schedules'] });
      } catch { setDetail(null); }
    })();
  }, [current]);
  const plan = detail?.plan;
  const subs = (plan?.stages || []).reduce((a: number, s: any) => a + (s.substages || []).length, 0);
  return (
    <div className="nm-page">
      <PageHeader title="База планов" subtitle="Планы адаптации в БД: структура (plans) и расписания по должностям (plan_schedules)."
                  actions={<Button variant="ghost" icon={RefreshCw} onClick={loadPlans}>Обновить</Button>} />
      <div className="nm-two-pane" style={{ gridTemplateColumns: 'minmax(0, 340px) minmax(0, 1fr)' }}>
        <Card pad={false}>
          {plans === null ? <Spinner /> : !plans.length ? <Empty>Планов нет.</Empty> : plans.map((p) => (
            <button key={p.plan_id} type="button" className="nm-qcard nm-link" style={{ textAlign: 'left', width: '100%', color: 'inherit', background: current === p.plan_id ? 'var(--nm-fill)' : undefined }}
                    onClick={() => setCurrent(p.plan_id)} aria-pressed={current === p.plan_id}>
              <div className="nm-cell-title">{p.title || 'без названия'}</div>
              <div className="nm-cell-sub">{p.role ? `${p.role} · ` : ''}этапов: {p.stages || 0} · подэтапов: {p.substages || 0}</div>
              <div className="nm-row" style={{ gap: 6 }}><code className="nm-code">{p.plan_id}</code><Badge tone={p.generated ? 'ok' : 'warn'}>{p.generated ? 'есть расписания' : 'не сгенерирован'}</Badge></div>
            </button>
          ))}
        </Card>
        <div className="nm-stack">
          {!current ? <Card pad={false}><Empty>Выберите план слева.</Empty></Card> : detail === undefined ? <Spinner /> : detail === null ? <Card pad={false}><Empty>Не удалось загрузить план.</Empty></Card> : (
            <>
              <Card>
                <dl className="nm-kv">
                  <dt>plan_id</dt><dd><code className="nm-code">{plan?.plan_id}</code></dd>
                  <dt>Название</dt><dd>{plan?.title || '—'}</dd>
                  <dt>Роль</dt><dd>{plan?.role || '—'}</dd>
                  <dt>Обновлён</dt><dd>{ruDateTime(plan?.updated_at)}</dd>
                  <dt>Этапов / подэтапов</dt><dd>{(plan?.stages || []).length} / {subs}</dd>
                </dl>
              </Card>
              <details className="nm-details nm-glass" style={{ borderRadius: 'var(--nm-r)' }}>
                <summary><ChevronRight aria-hidden />plans.data <Badge tone="muted">JSONB</Badge></summary>
                <div className="nm-details-body"><pre className="nm-json">{JSON.stringify(plan, null, 2)}</pre></div>
              </details>
              <div className="nm-section-label">plan_schedules — расписания ({detail.schedules.length})</div>
              {!detail.schedules.length ? <Card pad={false}><Empty>Сгенерированных расписаний нет.</Empty></Card> : detail.schedules.map(({ key, sch }) => (
                <details key={key} className="nm-details nm-glass" style={{ borderRadius: 'var(--nm-r)' }}>
                  <summary><ChevronRight aria-hidden />{key || 'Общее расписание'} <span className="nm-small nm-muted">{(sch.messages || []).length} сообщений · {ruDateTime(sch.generated_at)}</span></summary>
                  <div className="nm-details-body"><pre className="nm-json">{JSON.stringify(sch, null, 2)}</pre></div>
                </details>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
