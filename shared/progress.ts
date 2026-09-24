// Прогресс адаптации и итоги интерактивных сообщений — одна логика для сайта и приложения.
import { fromYmd, parseDate, ymd } from "./format";
import type { Answers, Msg, MySchedule, Payload, QuizQuestion, ScheduleItem } from "./types";

const DAY = 86400000;

export type Progress = {
  day: number;                    // какой сейчас день плана (0 — план ещё не начался)
  total: number;                  // сколько дней в плане
  ratio: number;                  // 0..1 для полосы прогресса
  stage: string;                  // текущий этап
  started: boolean;
  finished: boolean;
  next: { title: string; stage: string; substage: string; at: Date } | null;
  upcoming: { title: string; stage: string; substage: string; brief: string; at: Date }[];
};

const itemAt = (it: ScheduleItem) => parseDate(it.schedule?.send_at);

/** «День 3 из 30», текущий этап и что дальше — по расписанию из /api/my/schedule. */
export function adaptationProgress(s: MySchedule | null | undefined, now: Date = new Date()): Progress | null {
  if (!s || !Array.isArray(s.messages)) return null;
  const start = fromYmd(s.start_date);
  const dated = s.messages.map((it) => ({ it, at: itemAt(it) })).filter((x) => x.at) as
    { it: ScheduleItem; at: Date }[];
  dated.sort((a, b) => a.at.getTime() - b.at.getTime());
  if (!start) return null;
  const today = fromYmd(ymd(now)) as Date;
  const lastDay = dated.length ? fromYmd(ymd(dated[dated.length - 1].at)) as Date : start;
  const total = Math.max(1, Math.round((lastDay.getTime() - start.getTime()) / DAY) + 1);
  const raw = Math.floor((today.getTime() - start.getTime()) / DAY) + 1;
  const started = raw >= 1;
  const day = Math.min(Math.max(raw, 0), total);
  const past = dated.filter((x) => x.at.getTime() <= now.getTime());
  const future = dated.filter((x) => x.at.getTime() > now.getTime());
  const current = past.length ? past[past.length - 1].it : dated[0]?.it;
  const view = (x: { it: ScheduleItem; at: Date }) => ({
    title: [x.it.stage?.title, x.it.substage?.title].filter(Boolean).join(" · "),
    stage: x.it.stage?.title || "",
    substage: x.it.substage?.title || "",
    brief: x.it.substage?.brief || "",
    at: x.at,
  });
  return {
    day,
    total,
    ratio: Math.min(1, Math.max(0, day / total)),
    stage: current?.stage?.title || "",
    started,
    finished: started && !future.length && raw > total,
    next: future.length ? view(future[0]) : null,
    upcoming: future.slice(0, 6).map(view),
  };
}

// ---- Интерактивные сообщения ----
export type MsgStats =
  | { kind: "checklist"; done: number; total: number; label: string }
  | { kind: "quiz"; answered: number; total: number; right: number; label: string }
  | { kind: "survey"; answered: number; total: number; label: string }
  | { kind: "text"; label: "" };

export function isChecklist(p?: Payload | null): p is { type: "checklist"; intro?: string; items: { id: string; text: string }[] } {
  return !!p && p.type === "checklist" && Array.isArray((p as any).items);
}

export function isQuestions(p?: Payload | null): p is { type: "survey" | "quiz"; intro?: string; questions: QuizQuestion[] } {
  return !!p && (p.type === "survey" || p.type === "quiz") && Array.isArray((p as any).questions);
}

export function isRight(q: QuizQuestion, answers: Answers): boolean {
  return (q.options || []).some((o) => o.correct && answers[q.id] === o.id);
}

/** Итог под карточкой: «Выполнено: 1 из 4», «Результат: 2 из 3», «Спасибо, ответы отправлены». */
export function msgStats(m: Msg): MsgStats {
  const p = m.payload, a = m.answers || {};
  if (isChecklist(p)) {
    const done = p.items.filter((it) => a[it.id]).length;
    return { kind: "checklist", done, total: p.items.length, label: `Выполнено: ${done} из ${p.items.length}` };
  }
  if (isQuestions(p)) {
    const total = p.questions.length;
    const answered = p.questions.filter((q) => a[q.id]).length;
    if (p.type === "quiz") {
      const right = p.questions.filter((q) => isRight(q, a)).length;
      return { kind: "quiz", answered, total, right,
               label: answered === total ? `Результат: ${right} из ${total}` : answered ? `Отвечено: ${answered} из ${total}` : "Выберите вариант" };
    }
    return { kind: "survey", answered, total,
             label: answered === total ? "Спасибо, ответы отправлены" : `Отвечено: ${answered} из ${total}` };
  }
  return { kind: "text", label: "" };
}

/** Новый набор ответов: value=null — переключить пункт чек-листа, иначе выбранный вариант.
 *  В мини-тесте ответ не меняется после выбора (варианты блокируются). */
export function applyAnswer(m: Msg, key: string, value: string | null): Answers | null {
  const a: Answers = { ...(m.answers || {}) };
  if (value === null) a[key] = !a[key];
  else {
    if (m.payload?.type === "quiz" && a[key]) return null;
    a[key] = value;
  }
  return a;
}
