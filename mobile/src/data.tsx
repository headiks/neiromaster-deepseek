// Данные кабинета в приложении: входящие (опрос раз в 30 с), расписание (прогресс),
// вопросы специалисту, диалог с ассистентом, профиль. Логика — как у сайта (shared/).
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import type { Me, Msg, MyQuestion, MySchedule } from "../../shared/types";
import { oldestFirst } from "../../shared/format";
import { adaptationProgress, applyAnswer, type Progress } from "../../shared/progress";
import { api, answerText, ApiError } from "./api";
import { hasRemotePush, presentLocal } from "./notifications";

export type Turn = { id: number; q: string; a: string | null; status: "pending" | "done" | "error"; escalated?: boolean; sources?: string[] };

type Ctx = {
  me: Me | null; setMe: (m: Me) => void;
  messages: Msg[]; unread: number; loaded: boolean; error: string | null; reload: () => Promise<void>;
  answer: (m: Msg, key: string, value: string | null) => void; markRead: (list: Msg[]) => void;
  schedule: MySchedule | null; progress: Progress | null; scheduleMissing: string | null;
  questions: MyQuestion[]; reloadQuestions: () => void;
  turns: Turn[]; asking: boolean; ask: (q: string) => void; retry: (t: Turn) => void; newDialog: () => void;
};

const DataCtx = createContext<Ctx | null>(null);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [unread, setUnread] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<MySchedule | null>(null);
  const [scheduleMissing, setMissing] = useState<string | null>(null);
  const [questions, setQuestions] = useState<MyQuestion[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const seen = useRef<Set<string> | null>(null);
  const session = useRef<string | null>(null);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    try {
      const d = await api.myMessages();
      const list = oldestFirst(d.messages || []);
      // Запасной путь уведомлений без FCM: новое сообщение — локальное уведомление.
      if (seen.current && !hasRemotePush()) {
        for (const m of list.filter((x) => !seen.current!.has(x.id) && x.status === "delivered").slice(-3)) {
          await presentLocal(m.title || "НейроМастер", m.body || "", { message_row_id: m.id, kind: m.kind || "message" });
        }
      }
      seen.current = new Set(list.map((m) => m.id));
      setMessages(list);
      setUnread(d.unread || 0);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить сообщения");
    } finally {
      setLoaded(true);
    }
  }, []);

  const reloadQuestions = useCallback(() => {
    api.myQuestions().then((d) => setQuestions((d.questions || []).slice()
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))))).catch(() => {});
  }, []);

  useEffect(() => {
    api.me().then(setMe).catch(() => {});
    reload();
    reloadQuestions();
    const id = setInterval(() => { if (AppState.currentState === "active") reload(); }, 30000);
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") { reload(); reloadQuestions(); } });
    return () => { clearInterval(id); sub.remove(); };
  }, [reload, reloadQuestions]);

  // Больничный поставили или сняли — даты плана сдвигаются, расписание берём заново.
  const status = me?.status;
  useEffect(() => {
    if (status === undefined) return;
    api.mySchedule().then((s) => { setSchedule(s); setMissing(null); })
      .catch((e) => setMissing(e instanceof ApiError && e.status === 404 ? e.message : "Не удалось загрузить план."));
  }, [status]);

  const answer = useCallback((m: Msg, key: string, value: string | null) => {
    const next = applyAnswer(m, key, value);
    if (!next) return;
    setMessages((l) => l.map((x) => (x.id === m.id ? { ...x, answers: next } : x)));
    api.answer(m.id, next).catch(() => {});
  }, []);

  const markRead = useCallback((list: Msg[]) => {
    const ids = list.filter((m) => m.status === "delivered").map((m) => m.id);
    if (!ids.length) return;
    setMessages((all) => all.map((x) => (ids.includes(x.id) ? { ...x, status: "read" } : x)));
    setUnread((n) => Math.max(0, n - ids.length));
    ids.forEach((id) => api.markRead(id).catch(() => {}));
  }, []);

  const run = useCallback((id: number, q: string) => {
    api.ask(q, session.current).then((res) => {
      if (res.session_id) session.current = res.session_id;
      const v = answerText(res);
      setTurns((l) => l.map((t) => (t.id === id ? { ...t, a: v.text, status: v.error ? "error" : "done", escalated: v.escalated, sources: res.sources || [] } : t)));
      if (v.escalated) reloadQuestions();
    }).catch((e) => {
      setTurns((l) => l.map((t) => (t.id === id ? { ...t, a: e instanceof Error ? e.message : "Ошибка запроса", status: "error" } : t)));
    });
  }, [reloadQuestions]);

  const ask = useCallback((q: string) => {
    const text = q.trim();
    if (!text) return;
    const id = ++seq.current;
    setTurns((l) => [...l, { id, q: text, a: null, status: "pending" }]);
    run(id, text);
  }, [run]);

  const retry = useCallback((t: Turn) => {
    setTurns((l) => l.map((x) => (x.id === t.id ? { ...x, a: null, status: "pending" } : x)));
    run(t.id, t.q);
  }, [run]);

  const newDialog = useCallback(() => {
    if (session.current) api.del(`/session/${encodeURIComponent(session.current)}`).catch(() => {});
    session.current = null;
    setTurns([]);
  }, []);

  return (
    <DataCtx.Provider value={{
      me, setMe, messages, unread, loaded, error, reload, answer, markRead,
      schedule, progress: adaptationProgress(schedule), scheduleMissing, questions, reloadQuestions,
      turns, asking: turns.some((t) => t.status === "pending"), ask, retry, newDialog,
    }}>{children}</DataCtx.Provider>
  );
}

export function useData(): Ctx {
  const ctx = useContext(DataCtx);
  if (!ctx) throw new Error("useData вне DataProvider");
  return ctx;
}
