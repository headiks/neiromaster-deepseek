// Одно сообщение инбокса по типу (как в кабинете на сайте, static/messages.js):
//  message/reminder/handover — текст; checklist/system_check — пункты с отметками;
//  survey — вопросы с вариантами; quiz — мини-тест с проверкой и пояснением.
// Ответы сохраняются на сервере (POST /api/my/messages/{id}/answer) — видны и на сайте.
import React, { useMemo, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { S, useTheme, Palette } from "../theme";
import * as api from "../api";
import { Msg, title, body, hhmm, KIND_LABEL } from "../format";

type Answers = Record<string, any>;

export default function MessageCard({ m }: { m: Msg }) {
  const { c } = useTheme();
  const st = useMemo(() => makeStyles(c), [c]);
  const [answers, setAnswers] = useState<Answers>(m.answers || {});
  const [saved, setSaved] = useState(!!m.answers && Object.keys(m.answers).length > 0);
  const p: any = m.payload || {};
  const kind = m.kind || "message";

  const save = (next: Answers) => {
    setAnswers(next);
    if (m.id) api.answer(m.id, next).then(() => setSaved(true)).catch(() => {});
  };

  let content: React.ReactNode;
  if ((p.type === "checklist") && Array.isArray(p.items)) {
    const done = p.items.filter((it: any) => answers[it.id]).length;
    content = (
      <>
        {p.intro ? <Text style={st.body}>{p.intro}</Text> : null}
        {p.items.map((it: any) => (
          <TouchableOpacity key={it.id} style={st.checkRow} activeOpacity={0.7}
            onPress={() => save({ ...answers, [it.id]: !answers[it.id] })}>
            <View style={[st.box, answers[it.id] && st.boxOn]}>
              {answers[it.id] ? <Text style={st.tick}>✓</Text> : null}
            </View>
            <Text style={[st.item, answers[it.id] && st.itemDone]}>{it.text}</Text>
          </TouchableOpacity>
        ))}
        <Text style={st.meta}>Выполнено: {done} из {p.items.length}</Text>
      </>
    );
  } else if ((p.type === "survey" || p.type === "quiz") && Array.isArray(p.questions)) {
    const quiz = p.type === "quiz";
    const total = p.questions.length;
    const right = quiz ? p.questions.filter((q: any) =>
      (q.options || []).some((o: any) => o.correct && answers[q.id] === o.id)).length : 0;
    const answered = p.questions.filter((q: any) => answers[q.id]).length;
    content = (
      <>
        {p.intro ? <Text style={st.body}>{p.intro}</Text> : null}
        {p.questions.map((q: any, qi: number) => {
          const chosen = answers[q.id];
          return (
            <View key={q.id} style={st.q}>
              <Text style={st.qText}>{qi + 1}. {q.text}</Text>
              {(q.options || []).map((o: any) => {
                const picked = chosen === o.id;
                // Тест: после ответа подсвечиваем верный вариант и ошибку.
                const good = quiz && chosen && o.correct;
                const bad = quiz && picked && !o.correct;
                return (
                  <TouchableOpacity key={o.id} activeOpacity={0.7} disabled={quiz && !!chosen}
                    style={[st.opt, picked && st.optOn, good && st.optGood, bad && st.optBad]}
                    onPress={() => save({ ...answers, [q.id]: o.id })}>
                    <Text style={[st.optText, (picked || good) && st.optTextOn]}>
                      {good ? "✓ " : bad ? "✗ " : ""}{o.text}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              {quiz && chosen && q.explanation ? <Text style={st.expl}>{q.explanation}</Text> : null}
            </View>
          );
        })}
        <Text style={st.meta}>
          {quiz ? (answered === total ? `Результат: ${right} из ${total}` : `Отвечено: ${answered} из ${total}`)
                : (answered === total && saved ? "Спасибо, ответы отправлены" : `Отвечено: ${answered} из ${total}`)}
        </Text>
      </>
    );
  } else {
    content = body(m) ? <Text style={st.body}>{body(m)}</Text> : null;
  }

  const t = hhmm(m);
  const label = KIND_LABEL[kind];
  return (
    <View style={st.bubble}>
      <View style={st.head}>
        <Text style={st.title}>{title(m)}</Text>
        {label ? <Text style={st.chip}>{label}</Text> : null}
      </View>
      {content}
      {t ? <Text style={st.time}>{t}</Text> : null}
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  bubble: {
    alignSelf: "flex-start", width: "94%", backgroundColor: c.card,
    borderRadius: S.r, borderBottomLeftRadius: S.xs, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
    padding: S.md, marginBottom: S.sm,
  },
  head: { flexDirection: "row", alignItems: "flex-start", gap: S.sm },
  title: { flex: 1, fontSize: 14, fontWeight: "700", color: c.primary, letterSpacing: 0.2 },
  chip: { fontSize: 11, color: c.chipText, backgroundColor: c.chipBg, borderRadius: 8,
    paddingHorizontal: 6, paddingVertical: 2, overflow: "hidden" },
  body: { fontSize: 15, color: c.text, marginTop: S.xs, lineHeight: 21 },
  meta: { fontSize: 12, color: c.muted, marginTop: S.sm },
  time: { fontSize: 11, color: c.muted, marginTop: S.sm, alignSelf: "flex-end" },
  checkRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: c.border,
    alignItems: "center", justifyContent: "center", marginRight: S.sm },
  boxOn: { backgroundColor: c.primary, borderColor: c.primary },
  tick: { color: c.primaryText, fontSize: 14, fontWeight: "800" },
  item: { flex: 1, fontSize: 15, color: c.text },
  itemDone: { color: c.muted, textDecorationLine: "line-through" },
  q: { marginTop: S.md },
  qText: { fontSize: 15, fontWeight: "600", color: c.text, marginBottom: 6 },
  opt: { borderWidth: 1, borderColor: c.border, borderRadius: 8, paddingVertical: 9,
    paddingHorizontal: S.md, marginBottom: 6, backgroundColor: c.inputBg },
  optOn: { borderColor: c.primary, backgroundColor: c.chipBg },
  optGood: { borderColor: c.ok },
  optBad: { borderColor: c.danger },
  optText: { fontSize: 14, color: c.text },
  optTextOn: { fontWeight: "600" },
  expl: { fontSize: 13, color: c.muted, marginTop: 2, lineHeight: 18 },
});
