// Данные кабинета сотрудника: расписание (прогресс), ассистент (диалог), вопросы специалисту.
// Живут над экранами, чтобы переход между вкладками не терял диалог.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { MyQuestion, MySchedule } from '@shared/types';
import { answerText } from '@shared/api';
import { adaptationProgress, type Progress } from '@shared/progress';
import { useMe } from './me';
import { api, ApiError } from './api';
import { usePolling } from './poll';

export type Turn = { id: number; q: string; a: string | null; status: 'pending' | 'done' | 'error'; escalated?: boolean; sources?: string[] };

type Ctx = {
  schedule: MySchedule | null; progress: Progress | null; scheduleMissing: string | null;
  turns: Turn[]; asking: boolean; ask: (q: string) => void; retry: (t: Turn) => void; newDialog: () => void;
  questions: MyQuestion[]; questionsLoaded: boolean; reloadQuestions: () => void;
};

const CabinetCtx = createContext<Ctx | null>(null);

function sessionId(reset = false): string {
  let sid: string | null = null;
  try { sid = reset ? null : sessionStorage.getItem('ragSessionId'); } catch { /* нет хранилища */ }
  if (!sid) {
    sid = crypto.randomUUID ? crypto.randomUUID() : `sid-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try { sessionStorage.setItem('ragSessionId', sid); } catch { /* нет хранилища */ }
  }
  return sid;
}

export function CabinetProvider({ children }: { children: ReactNode }) {
  const [schedule, setSchedule] = useState<MySchedule | null>(null);
  const [scheduleMissing, setMissing] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [questions, setQuestions] = useState<MyQuestion[]>([]);
  const [questionsLoaded, setQL] = useState(false);
  const seq = useRef(0);

  // Больничный поставили или сняли — даты плана сдвигаются, расписание берём заново.
  const status = useMe().me?.status;
  useEffect(() => {
    api.mySchedule().then((s) => { setSchedule(s); setMissing(null); }).catch((e) => {
      setMissing(e instanceof ApiError && e.status === 404 ? e.message : 'Не удалось загрузить план.');
    });
  }, [status]);

  const reloadQuestions = useCallback(() => {
    api.myQuestions().then((d) => {
      setQuestions((d.questions || []).slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))));
    }).catch(() => {}).finally(() => setQL(true));
  }, []);
  usePolling(reloadQuestions, 60000);

  const run = useCallback((id: number, q: string) => {
    api.ask(q, sessionId()).then((res) => {
      const v = answerText(res);
      setTurns((l) => l.map((t) => (t.id === id ? { ...t, a: v.text, status: v.error ? 'error' : 'done', escalated: v.escalated, sources: res.sources || [] } : t)));
      if (v.escalated) reloadQuestions();
    }).catch((e) => {
      setTurns((l) => l.map((t) => (t.id === id ? { ...t, a: e instanceof Error ? e.message : 'Ошибка запроса', status: 'error' } : t)));
    });
  }, [reloadQuestions]);

  const ask = useCallback((q: string) => {
    const text = q.trim();
    if (!text) return;
    const id = ++seq.current;
    setTurns((l) => [...l, { id, q: text, a: null, status: 'pending' }]);
    run(id, text);
  }, [run]);

  const retry = useCallback((t: Turn) => {
    setTurns((l) => l.map((x) => (x.id === t.id ? { ...x, a: null, status: 'pending' } : x)));
    run(t.id, t.q);
  }, [run]);

  const newDialog = useCallback(() => {
    const old = sessionId();
    api.del(`/session/${encodeURIComponent(old)}`).catch(() => {});
    sessionId(true);
    setTurns([]);
  }, []);

  const asking = turns.some((t) => t.status === 'pending');
  const progress = adaptationProgress(schedule);
  return (
    <CabinetCtx.Provider value={{ schedule, progress, scheduleMissing, turns, asking, ask, retry, newDialog, questions, questionsLoaded, reloadQuestions }}>
      {children}
    </CabinetCtx.Provider>
  );
}

export function useCabinet(): Ctx {
  const ctx = useContext(CabinetCtx);
  if (!ctx) throw new Error('useCabinet вне CabinetProvider');
  return ctx;
}
