import { useEffect, useRef } from 'react';

/** Периодический вызов fn: сразу и затем каждые interval мс. Во фоновой вкладке пауза,
 *  при возврате — сразу обновление. interval=0 — выключено. */
export function usePolling(fn: () => unknown, interval: number, deps: unknown[] = []) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!interval) return;
    let timer: number | undefined;
    const tick = () => { if (!document.hidden) ref.current(); };
    const start = () => { window.clearInterval(timer); timer = window.setInterval(tick, interval); };
    const onVisible = () => { if (!document.hidden) { ref.current(); start(); } };
    ref.current();
    start();
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interval, ...deps]);
}
