// «Задать вопрос»: диалог с чат-ботом (/ask) + история эскалированных вопросов
// специалисту (/api/my/questions) — те же форматы, что в кабинете на сайте.
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator,
  StyleSheet, KeyboardAvoidingView, Platform, RefreshControl,
} from "react-native";
import { S, useTheme, Palette } from "../theme";
import * as api from "../api";

type Turn = { q: string; a: string | null; error?: boolean };
type View2 = "chat" | "questions";

export default function Ask() {
  const { c } = useTheme();
  const st = useMemo(() => makeStyles(c), [c]);
  const [view, setView] = useState<View2>("chat");

  return (
    <View style={st.wrap}>
      <View style={st.seg}>
        <SegBtn label="Диалог" active={view === "chat"} onPress={() => setView("chat")} st={st} />
        <SegBtn label="Мои вопросы" active={view === "questions"} onPress={() => setView("questions")} st={st} />
      </View>
      {view === "chat" ? <Dialog st={st} c={c} /> : <Questions st={st} c={c} />}
    </View>
  );
}

function SegBtn({ label, active, onPress, st }: {
  label: string; active: boolean; onPress: () => void; st: Styles;
}) {
  return (
    <TouchableOpacity style={[st.segBtn, active && st.segBtnOn]} onPress={onPress} activeOpacity={0.7}>
      <Text style={[st.segText, active && st.segTextOn]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Dialog({ st, c }: { st: Styles; c: Palette }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const sessionId = useRef<string | null>(null);
  const scroller = useRef<ScrollView>(null);

  async function send() {
    const q = input.trim();
    if (!q || busy) return;
    setInput("");
    setTurns((t) => [...t, { q, a: null }]);
    setBusy(true);
    setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 50);
    try {
      const res: any = await api.ask(q, sessionId.current);
      if (res?.session_id) sessionId.current = res.session_id;
      const answer = res?.answer
        || (res?.route === "escalate"
          ? "Вопрос передан специалисту — ответ появится в разделе «Мои вопросы»."
          : "Ответ не найден. Уточните вопрос или обратитесь к наставнику.");
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a: answer } : x)));
    } catch (e: any) {
      setTurns((t) => t.map((x, i) =>
        (i === t.length - 1 ? { ...x, a: e?.message || "Ошибка запроса", error: true } : x)));
    } finally {
      setBusy(false);
      setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 50);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <ScrollView ref={scroller} style={{ flex: 1 }} contentContainerStyle={{ padding: S.lg }}>
        {turns.length === 0
          ? <Text style={st.hint}>Задайте вопрос по адаптации, регламентам или процессам компании.</Text>
          : null}
        {turns.map((t, i) => (
          <View key={i} style={{ marginBottom: S.lg }}>
            <View style={st.q}><Text style={st.qText}>{t.q}</Text></View>
            {t.a === null ? (
              <View style={[st.a, st.aRow]}>
                <ActivityIndicator color={c.primary} />
                <Text style={st.thinking}>Ищу ответ…</Text>
              </View>
            ) : (
              <View style={st.a}>
                <Text style={[st.aText, t.error && { color: c.danger }]}>{t.a}</Text>
              </View>
            )}
          </View>
        ))}
      </ScrollView>
      <View style={st.bar}>
        <TextInput style={st.input} value={input} onChangeText={setInput}
          placeholder="Ваш вопрос…" placeholderTextColor={c.muted} multiline onSubmitEditing={send} />
        <TouchableOpacity style={[st.sendBtn, (busy || !input.trim()) && st.off]}
          onPress={send} disabled={busy || !input.trim()}>
          <Text style={st.sendText}>→</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function Questions({ st, c }: { st: Styles; c: Palette }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const scroller = useRef<ScrollView>(null);
  // Как в переписке: старые вопросы сверху, новые снизу.
  const load = () => api.myQuestions()
    .then((d) => setItems([...(d?.questions || [])].sort(
      (a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")))))
    .catch(() => {})
    .finally(() => { setLoading(false); setRefreshing(false); });
  useEffect(() => { load(); }, []);

  if (loading) {
    return <View style={st.center}><ActivityIndicator color={c.primary} size="large" /></View>;
  }
  return (
    <ScrollView ref={scroller} style={{ flex: 1 }} contentContainerStyle={{ padding: S.lg, paddingBottom: 40 }}
      onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={c.primary}
        onRefresh={() => { setRefreshing(true); load(); }} />}>
      {items.length === 0 ? (
        <Text style={st.hint}>Вопросов специалисту пока нет. Заданный в диалоге вопрос,
          на который бот не нашёл ответ, попадёт сюда.</Text>
      ) : items.map((q) => {
        const answered = q.status === "resolved";
        return (
          <View key={q.id} style={st.qCard}>
            <View style={st.badgeRow}>
              <View style={[st.badge, answered ? st.badgeOk : st.badgeWait]}>
                <Text style={[st.badgeText, { color: answered ? c.ok : c.muted }]}>
                  {answered ? "✓ отвечено" : "⏳ ждёт ответа"}
                </Text>
              </View>
              {q.reason === "escalate" ? (
                <View style={[st.badge, st.badgeSos]}>
                  <Text style={[st.badgeText, { color: c.danger }]}>⚠ ЧС</Text>
                </View>
              ) : null}
            </View>
            <Text style={st.qq}>{q.question}</Text>
            {answered ? (
              <>
                <Text style={st.qa}>{q.answer}</Text>
                <Text style={st.qmeta}>{[q.answered_by, q.answered_at].filter(Boolean).join(" · ")}</Text>
              </>
            ) : (
              <Text style={st.qpending}>Передано специалисту, ответ появится здесь.</Text>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

type Styles = ReturnType<typeof makeStyles>;
const makeStyles = (c: Palette) => StyleSheet.create({
  wrap: { flex: 1, backgroundColor: c.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  seg: { flexDirection: "row", padding: S.sm, gap: S.sm, backgroundColor: c.card,
    borderBottomWidth: 1, borderBottomColor: c.border },
  segBtn: { flex: 1, paddingVertical: S.sm, borderRadius: 8, alignItems: "center", backgroundColor: c.bg },
  segBtnOn: { backgroundColor: c.primary },
  segText: { color: c.muted, fontWeight: "600", fontSize: 14 },
  segTextOn: { color: c.primaryText },
  hint: { color: c.muted, fontSize: 14, textAlign: "center", marginTop: S.xl, paddingHorizontal: S.lg, lineHeight: 20 },
  q: { alignSelf: "flex-end", backgroundColor: c.primary, borderRadius: 14, borderBottomRightRadius: 4, padding: S.md, maxWidth: "85%" },
  qText: { color: c.primaryText, fontSize: 15 },
  a: { alignSelf: "flex-start", backgroundColor: c.card, borderRadius: 14, borderBottomLeftRadius: 4, padding: S.md, marginTop: S.sm, maxWidth: "90%", borderWidth: 1, borderColor: c.border },
  aRow: { flexDirection: "row", alignItems: "center" },
  aText: { color: c.text, fontSize: 15, lineHeight: 21 },
  thinking: { color: c.muted, marginLeft: S.sm },
  bar: { flexDirection: "row", padding: S.sm, borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.card, alignItems: "flex-end" },
  input: { flex: 1, maxHeight: 120, borderWidth: 1, borderColor: c.border, borderRadius: 20, paddingHorizontal: S.md, paddingVertical: S.sm, fontSize: 15, color: c.text, backgroundColor: c.inputBg },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.primary, alignItems: "center", justifyContent: "center", marginLeft: S.sm },
  off: { opacity: 0.5 },
  sendText: { color: c.primaryText, fontSize: 22, fontWeight: "700" },
  qCard: { backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.border, padding: S.md, marginBottom: S.sm },
  badgeRow: { flexDirection: "row", gap: S.sm, marginBottom: S.sm },
  badge: { alignSelf: "flex-start", borderRadius: 8, paddingHorizontal: S.sm, paddingVertical: 2 },
  badgeOk: { backgroundColor: c.chipBg },
  badgeWait: { backgroundColor: c.bg },
  badgeSos: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.danger },
  badgeText: { fontSize: 12, fontWeight: "600" },
  qq: { fontSize: 15, fontWeight: "700", color: c.text },
  qa: { fontSize: 15, color: c.text, marginTop: S.sm, lineHeight: 21 },
  qmeta: { fontSize: 12, color: c.muted, marginTop: S.xs },
  qpending: { fontSize: 14, color: c.muted, marginTop: S.xs },
});
