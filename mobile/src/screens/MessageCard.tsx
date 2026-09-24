// Карточка сообщения плана (COMPONENTS.md → MessageCard): «Этап · Подэтап» + время и тело
// по типу: текст, чек-лист, мини-тест (верно/неверно + пояснение), опрос. Ответ сохраняется
// сразу и виден на сайте — логика общая (shared/progress.ts).
import React from "react";
import { Pressable, View } from "react-native";
import type { Msg } from "../../../shared/types";
import { msgKicker, msgTime } from "../../../shared/format";
import { isChecklist, isQuestions, msgStats } from "../../../shared/progress";
import { S, useTheme } from "../theme";
import { GlassCard, Progress, Txt } from "../ui";
import { CheckIcon } from "../icons";

export default function MessageCard({ m, onAnswer }: { m: Msg; onAnswer: (m: Msg, key: string, value: string | null) => void }) {
  const { c } = useTheme();
  const p = m.payload, a = m.answers || {};
  const stats = msgStats(m);
  const intro = (p as { intro?: string } | null)?.intro;
  let body: React.ReactNode = null;
  if (isChecklist(p)) {
    body = (
      <>
        {intro ? <Txt>{intro}</Txt> : null}
        {p.items.map((it) => {
          const on = !!a[it.id];
          return (
            <Pressable key={it.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => onAnswer(m, it.id, null)}
                       style={{ flexDirection: "row", alignItems: "center", gap: S.md, minHeight: 44, paddingVertical: 4 }}>
              <View style={{ width: 22, height: 22, borderRadius: 7, borderWidth: 2, alignItems: "center", justifyContent: "center",
                             borderColor: on ? c.primary : c.lineStrong, backgroundColor: on ? c.primary : "transparent" }}>
                {on ? <CheckIcon color={c.primaryText} size={14} strokeWidth={3} /> : null}
              </View>
              <Txt style={{ flex: 1, textDecorationLine: on ? "line-through" : "none" }} color={on ? c.muted : c.text}>{it.text}</Txt>
            </Pressable>
          );
        })}
      </>
    );
  } else if (isQuestions(p)) {
    const quiz = p.type === "quiz";
    body = (
      <>
        {intro ? <Txt>{intro}</Txt> : null}
        {p.questions.map((q, qi) => {
          const chosen = a[q.id] as string | undefined;
          return (
            <View key={q.id} style={{ gap: S.sm, marginTop: qi ? S.sm : 0 }}>
              <Txt w="600">{p.questions.length > 1 ? `${qi + 1}. ` : ""}{q.text}</Txt>
              {(q.options || []).map((o) => {
                const picked = chosen === o.id;
                const state = quiz && chosen ? (o.correct ? "right" : picked ? "wrong" : null) : null;
                const border = state === "right" ? c.ok : state === "wrong" ? c.danger : picked ? c.primary : c.border;
                const bg = state === "right" ? c.okSoft : state === "wrong" ? c.dangerSoft : picked ? c.soft : "transparent";
                return (
                  <Pressable key={o.id} accessibilityRole="button" accessibilityState={{ selected: picked, disabled: quiz && !!chosen }}
                             disabled={quiz && !!chosen} onPress={() => onAnswer(m, q.id, o.id)}
                             style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 14, paddingVertical: 10,
                                      borderRadius: S.rSm, borderWidth: 1.5, borderColor: border, backgroundColor: bg }}>
                    <Txt>{o.text}</Txt>
                  </Pressable>
                );
              })}
              {quiz && chosen && q.explanation ? <Txt v="small" color={c.muted}>{q.explanation}</Txt> : null}
            </View>
          );
        })}
      </>
    );
  } else if (m.body) {
    body = <Txt>{m.body}</Txt>;
  }
  const ratio = stats.kind === "checklist" ? stats.done / (stats.total || 1)
    : stats.kind === "quiz" || stats.kind === "survey" ? stats.answered / (stats.total || 1) : 0;
  return (
    <GlassCard>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: S.md }}>
        <Txt v="small" w="600" color={c.softInk} style={{ flex: 1 }}>{msgKicker(m)}</Txt>
        <Txt v="micro" color={c.muted}>{msgTime(m)}</Txt>
      </View>
      {body}
      {stats.label ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: S.md, marginTop: 2 }}>
          {stats.kind !== "text" ? <View style={{ width: 48 }}><Progress value={ratio} tone="ok" height={4} /></View> : null}
          <Txt v="micro" color={c.muted}>{stats.label}</Txt>
        </View>
      ) : null}
    </GlassCard>
  );
}
