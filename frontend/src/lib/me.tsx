// Текущий пользователь (/api/me) — один запрос на всё приложение.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Me } from '@shared/types';
import { api, ApiError } from './api';

type Ctx = {
  me: Me | null;
  loading: boolean;
  error: string | null;
  isAdmin: boolean;
  isOwner: boolean;
  reload: () => Promise<void>;
  setMe: (m: Me) => void;
};

const MeCtx = createContext<Ctx | null>(null);

export function MeProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    // На входе и регистрации сессии нет — не спрашиваем (иначе 401 в консоли).
    if (['/login', '/register'].includes(location.pathname)) { setLoading(false); return; }
    try {
      setMe(await api.me());
      setError(null);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  const isOwner = me?.role === 'owner';
  const isAdmin = isOwner || me?.role === 'admin';
  return <MeCtx.Provider value={{ me, loading, error, isAdmin, isOwner, reload, setMe }}>{children}</MeCtx.Provider>;
}

export function useMe(): Ctx {
  const ctx = useContext(MeCtx);
  if (!ctx) throw new Error('useMe вне MeProvider');
  return ctx;
}
