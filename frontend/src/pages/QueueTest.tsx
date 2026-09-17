import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import Header from '../components/Header';

const STATE_LABEL: Record<string, [string, string]> = {
  queued: ['processing', 'в очереди'], started: ['processing', 'выполняется'], finished: ['indexed', 'выполнено'],
  failed: ['error', 'провал'], deferred: ['', 'отложена'],
};

export default function QueueTest() {
  const [data, setData] = useState<any>(null);
  const [auto, setAuto] = useState(true);
  const [secs, setSecs] = useState(2);
  const [jobOut, setJobOut] = useState<React.ReactNode>(null);
  const [enqueueBusy, setEnqueueBusy] = useState(false);
  const autoRef = useRef(auto);
  autoRef.current = auto;
  const watchRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = () => api('/api/queue/status').then((r) => r.json()).then(setData).catch(() => {});
  useEffect(() => {
    refresh();
    const t = setInterval(() => { if (autoRef.current) refresh(); }, 2000);
    return () => { clearInterval(t); if (watchRef.current) clearInterval(watchRef.current); };
  }, []);

  const enqueue = async () => {
    setEnqueueBusy(true);
    setJobOut(<div className="empty-hint" style={{ marginTop: 10 }}>Ставлю задачу…</div>);
    try {
      const r = await api('/api/queue/selftest?seconds=' + encodeURIComponent(secs), { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || 'Ошибка');
      watchJob(d.job_id);
    } catch (e: any) {
      setJobOut(<pre className="error" style={{ padding: 10 }}>{e.message}</pre>);
      setEnqueueBusy(false);
    }
  };

  const watchJob = (id: string) => {
    const t0 = Date.now();
    if (watchRef.current) clearInterval(watchRef.current);
    const tick = async () => {
      let j: any;
      try { j = await api('/api/queue/job/' + encodeURIComponent(id)).then((r) => r.json()); } catch { return; }
      const el = ((Date.now() - t0) / 1000).toFixed(1);
      const [cls, label] = STATE_LABEL[j.status] || ['', j.status];
      const head = <div style={{ marginTop: 10 }}><b>Задача</b> <code>{id}</code> — <span className={`status-badge ${cls}`}>{label}</span> <span className="empty-hint">({el}с)</span></div>;
      if (j.status === 'finished') {
        finish(<>{head}<pre style={okPre}>Выполнено воркером pid {j.result?.worker_pid} в {j.result?.finished_at}{'\n'}result: {JSON.stringify(j.result)}</pre></>);
      } else if (j.status === 'failed') {
        finish(<>{head}<pre className="error" style={{ padding: 10 }}>Провалено:{'\n'}{j.exc || ''}</pre></>);
      } else {
        setJobOut(head);
      }
    };
    const finish = (node: React.ReactNode) => { if (watchRef.current) clearInterval(watchRef.current); setJobOut(node); setEnqueueBusy(false); };
    tick();
    watchRef.current = setInterval(tick, 700);
  };

  const redisOff = data && !data.redis;
  const stats: [string, any, string][] = data && data.redis ? [
    ['В очереди', data.queued, ''], ['В работе', data.started, ''], ['Выполнено', data.finished, ''],
    ['Провалов', data.failed, ''], ['Воркеров', data.worker_count, ''], ['DeepSeek в полёте', `${data.deepseek_in_flight}/${data.deepseek_max}`, ''],
  ] : [];

  return (
    <div className="app-page">
      <Header title="Проверка очередей" actions={<a className="ghost-btn" href="/admin">← Админка</a>} />
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div className="empty-hint">
            {!data ? 'Загрузка…' : redisOff ? 'Redis не подключён — очередь в режиме потоков (один процесс). Воркеров/очереди нет.' : <>Redis подключён · очередь <b>{data.queue}</b></>}
          </div>
          <label className="empty-hint"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> автообновление (2с)</label>
        </div>
      </div>

      {data && (redisOff ? (
        <div className="board-stats" style={{ display: 'flex', gap: 8, margin: '16px 0' }}>
          <div className="card" style={{ padding: 14 }}><div style={{ fontSize: 26, fontWeight: 700, color: 'var(--color-accent-700)' }}>{data.deepseek_in_flight}/{data.deepseek_max}</div><div style={{ fontSize: 12, color: 'var(--muted)' }}>DeepSeek в полёте</div></div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 12, margin: '16px 0' }}>
          {stats.map(([l, n]) => (
            <div className="card" style={{ padding: 14 }} key={l}><div style={{ fontSize: 26, fontWeight: 700, color: 'var(--color-accent-700)' }}>{n}</div><div style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase' }}>{l}</div></div>
          ))}
        </div>
      ))}

      <div className="card">
        <h3 style={{ margin: '0 0 10px' }}>Воркеры</h3>
        <table className="schedule">
          <thead><tr><th>Имя</th><th>Состояние</th><th>Текущая задача</th><th>Успешно</th><th>Ошибок</th></tr></thead>
          <tbody>
            {(data?.workers || []).map((w: any, i: number) => (
              <tr key={i}><td>{w.name}</td><td><span className="status-badge">{w.state || '—'}</span></td><td>{w.current_job || '—'}</td><td>{w.successful ?? '—'}</td><td>{w.failed ?? '—'}</td></tr>
            ))}
          </tbody>
        </table>
        {!(data?.workers || []).length && <div className="empty-hint">Активных воркеров нет.</div>}
      </div>

      <div className="card">
        <h3 style={{ margin: '0 0 10px' }}>Тест-задача</h3>
        <div className="stage-hint" style={{ marginBottom: 10 }}>Ставит безвредную задачу в очередь (ждёт N секунд и возвращает, какой воркер её выполнил). Проверяет цепочку web → Redis → worker.</div>
        <div className="row" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label>Длительность, сек: <input type="number" min={0} max={30} value={secs} onChange={(e) => setSecs(Number(e.target.value))} style={{ width: 80 }} /></label>
          <button className="primary-btn" disabled={enqueueBusy} onClick={enqueue}>Поставить в очередь</button>
        </div>
        <div>{jobOut}</div>
      </div>
    </div>
  );
}

const okPre: React.CSSProperties = { background: 'var(--color-accent-100)', border: '1px solid var(--color-divider)', padding: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13 };
