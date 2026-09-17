import { api } from './api';
import type { Job } from './types';

const TERMINAL = ['done', 'error', 'cancelled'];

/**
 * Опрос фоновой задачи по её URL до терминального статуса.
 * Возвращает функцию остановки. Используется и для /documents/jobs/{id}, и для /jobs/{id}.
 */
export function pollJob(
  url: string,
  opts: { onProgress?: (job: Job) => void; onDone?: (job: Job) => void; interval?: number } = {},
): () => void {
  const { onProgress, onDone, interval = 1500 } = opts;
  let stopped = false;
  const timer = setInterval(tick, interval);
  function stop() { if (!stopped) { stopped = true; clearInterval(timer); } }
  function tick() {
    api(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((job: Job | null) => {
        if (!job || stopped) return;
        onProgress?.(job);
        if (TERMINAL.includes(job.status)) {
          stop();
          onDone?.(job);
        }
      })
      .catch(() => {});
  }
  tick();
  return stop;
}
