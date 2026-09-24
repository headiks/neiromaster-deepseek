import { useEffect, useState } from 'react';

/** true, пока ширина окна не больше max (px). */
export function useNarrow(max = 760): boolean {
  const query = `(max-width: ${max}px)`;
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return narrow;
}
