import { useEffect, useState } from 'react';
import { api } from './api';
import type { Me } from './types';

/** Текущий пользователь из /api/me. null пока грузится или при ошибке (401 уже уводит на /login). */
export function useMe(): Me | null {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    api('/api/me')
      .then((r) => r.json())
      .then(setMe)
      .catch(() => {});
  }, []);
  return me;
}

export function logout(): void {
  fetch('/api/logout', { method: 'POST' }).finally(() => {
    window.location.href = '/login';
  });
}
