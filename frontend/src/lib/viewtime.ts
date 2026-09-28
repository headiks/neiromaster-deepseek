// Сколько сообщение плана было на экране — для статистики вовлечённости (backend/stats.py):
// читает сотрудник или пролистывает. Время копится, пока карточка видна (60 % её площади или
// половина экрана) и вкладка активна; уходит на сервер раз в 15 с и при уходе со страницы.
import { useEffect, type RefObject } from 'react';
import { api } from './api';

const pending = new Map<string, number>();

function flush() {
  pending.forEach((ms, id) => { if (ms >= 500) api.view(id, Math.round(ms)).catch(() => {}); });
  pending.clear();
}

if (typeof window !== 'undefined') {
  window.setInterval(flush, 15000);
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
}

export function useViewTime(id: string, ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    let inView = false;
    let since = 0;
    const pause = () => {
      if (since) pending.set(id, (pending.get(id) || 0) + performance.now() - since);
      since = 0;
    };
    const resume = () => { if (inView && !document.hidden && !since) since = performance.now(); };
    const io = new IntersectionObserver(([e]) => {
      inView = e.intersectionRatio >= 0.6 || e.intersectionRect.height >= window.innerHeight * 0.5;
      if (inView) resume(); else pause();
    }, { threshold: [0, 0.25, 0.6, 1] });
    io.observe(el);
    const onVis = () => (document.hidden ? pause() : resume());
    document.addEventListener('visibilitychange', onVis);
    return () => { io.disconnect(); document.removeEventListener('visibilitychange', onVis); pause(); };
  }, [id, ref]);
}
