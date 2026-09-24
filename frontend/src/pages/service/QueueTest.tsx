// Диагностика очередей (RQ/Redis): статус воркеров, длина очереди, тестовая задача.
import { useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { api, enc, messageOf } from '../../lib/api';
import { usePolling } from '../../lib/poll';
import { Badge, Button, Callout, Card, Checkbox, Empty, Field, Input, PageHeader } from '../../ui';

type Status = { redis: boolean; queue?: string; queued?: number; started?: number; finished?: number; failed?: number; worker_count?: number;
  deepseek_in_flight?: number; deepseek_max?: number; workers?: { name: string; state: string; current_job?: string; successful?: number; failed?: number }[] };
type JobState = { status: string; result?: { worker_pid?: number; finished_at?: string }; exc?: string };

const STATE: Record<string, ['ok' | 'warn' | 'danger' | 'muted', string]> = {
  queued: ['warn', 'в очереди'], started: ['warn', 'выполняется'], finished: ['ok', 'выполнено'], failed: ['danger', 'провал'], deferred: ['muted', 'отложена'],
};

export default function QueueTest() {
  const [s, setS] = useState<Status | null>(null);
  const [auto, setAuto] = useState(true);
  const [secs, setSecs] = useState(2);
  const [job, setJob] = useState<{ id: string; t0: number; state?: JobState } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => { document.title = 'Очереди · НейроМастер'; }, []);
  usePolling(() => api.get<Status>('/api/queue/status').then(setS).catch(() => {}), auto ? 2000 : 0, [auto]);
  useEffect(() => { if (!auto) api.get<Status>('/api/queue/status').then(setS).catch(() => {}); }, [auto]);

  const enqueue = async () => {
    setError(null);
    try {
      const d = await api.post<{ job_id: string }>(`/api/queue/selftest?seconds=${enc(String(secs))}`);
      setJob({ id: d.job_id, t0: Date.now() });
    } catch (e) { setError(messageOf(e)); }
  };
  useEffect(() => {
    if (!job || ['finished', 'failed'].includes(job.state?.status || '')) return;
    timer.current = window.setTimeout(async () => {
      try { const st = await api.get<JobState>(`/api/queue/job/${enc(job.id)}`); setJob((j) => (j && j.id === job.id ? { ...j, state: st } : j)); }
      catch { setJob((j) => (j ? { ...j } : j)); }
    }, 700);
    return () => window.clearTimeout(timer.current);
  }, [job]);

  const stats: [string, string | number | undefined, 'ok' | 'danger' | undefined][] = s?.redis ? [
    ['В очереди', s.queued, undefined], ['В работе', s.started, undefined], ['Выполнено', s.finished, 'ok'],
    ['Провалов', s.failed, s.failed ? 'danger' : undefined], ['Воркеров', s.worker_count, undefined], ['DeepSeek в полёте', `${s.deepseek_in_flight}/${s.deepseek_max}`, undefined],
  ] : s ? [['DeepSeek в полёте', `${s.deepseek_in_flight}/${s.deepseek_max}`, undefined]] : [];
  const st = job?.state?.status;
  return (
    <div className="nm-page">
      <PageHeader title="Очереди" subtitle="Фоновые задачи (Redis + RQ): разбор документов, генерация сообщений."
                  actions={<Checkbox label="Автообновление" checked={auto} onChange={setAuto} />} />
      {s && <Callout tone={s.redis ? 'ok' : 'danger'}>{s.redis ? <>Redis подключён · очередь <b>{s.queue}</b></> : <><b>Redis не подключён</b> — очередь в режиме потоков (один процесс). Воркеров нет.</>}</Callout>}
      <div className="nm-grid-3">
        {stats.map(([l, n, tone]) => <Card key={l} className="nm-stat"><b className={tone === 'danger' ? 'nm-danger-text' : tone === 'ok' ? 'nm-ok-text' : undefined}>{n ?? '—'}</b><span>{l}</span></Card>)}
      </div>
      {s?.redis && (
        <Card pad={false}>
          {!(s.workers || []).length ? <Empty>Воркеров нет — запустите rag-worker.</Empty> : (
            <div className="nm-table-wrap"><table className="nm-edit-table">
              <thead><tr><th>Воркер</th><th>Состояние</th><th>Текущая задача</th><th>Успешно</th><th>Провалов</th></tr></thead>
              <tbody>{s.workers!.map((w) => (
                <tr key={w.name}><td>{w.name}</td><td><Badge tone={w.state === 'busy' || w.state === 'started' ? 'warn' : w.state === 'idle' ? 'muted' : 'ok'}>{w.state || '—'}</Badge></td>
                  <td className="nm-muted">{w.current_job || '—'}</td><td>{w.successful ?? '—'}</td><td>{w.failed ?? '—'}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      )}
      <Card>
        <div className="nm-card-kicker"><span>Тестовая задача</span></div>
        <div className="nm-row" style={{ alignItems: 'flex-end' }}>
          <Field label="Длительность, сек"><Input small type="number" min={0} step={0.5} value={secs} onChange={(e) => setSecs(Number(e.target.value) || 0)} style={{ width: 120 }} /></Field>
          <Button variant="primary" icon={Play} onClick={enqueue} disabled={!!job && !['finished', 'failed'].includes(st || '')}>Поставить в очередь</Button>
        </div>
        {error && <Callout tone="danger">{error}</Callout>}
        {job && (
          <div className="nm-stack" style={{ gap: 6 }}>
            <div className="nm-row">Задача <code className="nm-code">{job.id}</code>
              {st ? <Badge tone={STATE[st]?.[0] || 'muted'}>{STATE[st]?.[1] || st}</Badge> : <Badge tone="muted">ставится…</Badge>}
              <span className="nm-small nm-muted">{((Date.now() - job.t0) / 1000).toFixed(1)} с</span></div>
            {st === 'finished' && <pre className="nm-json">Выполнено воркером pid {job.state?.result?.worker_pid} в {job.state?.result?.finished_at}{'\n'}{JSON.stringify(job.state?.result, null, 2)}</pre>}
            {st === 'failed' && <pre className="nm-json nm-danger-text">{job.state?.exc}</pre>}
          </div>
        )}
      </Card>
    </div>
  );
}
