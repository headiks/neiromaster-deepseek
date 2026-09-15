import React, { useRef, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform,
} from "react-native";
import { C, S } from "../theme";
import * as api from "../api";

type Turn = { q: string; a: string | null; error?: boolean };

export default function Chat() {
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
      const answer = res?.answer || "Ответ не найден. Вопрос передан специалисту.";
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a: answer } : x)));
    } catch (e: any) {
      setTurns((t) =>
        t.map((x, i) => (i === t.length - 1 ? { ...x, a: e?.message || "Ошибка запроса", error: true } : x))
      );
    } finally {
      setBusy(false);
      setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 50);
    }
  }

  return (
    <KeyboardAvoidingView
      style={st.wrap}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      <ScrollView ref={scroller} style={{ flex: 1 }} contentContainerStyle={{ padding: S.lg }}>
        {turns.length === 0 ? (
          <Text style={st.hint}>Задайте вопрос по адаптации, регламентам или процессам компании.</Text>
        ) : null}
        {turns.map((t, i) => (
          <View key={i} style={{ marginBottom: S.lg }}>
            <View style={st.q}>
              <Text style={st.qText}>{t.q}</Text>
            </View>
            {t.a === null ? (
              <View style={[st.a, st.aRow]}>
                <ActivityIndicator color={C.primary} />
                <Text style={st.thinking}>Ищу ответ…</Text>
              </View>
            ) : (
              <View style={st.a}>
                <Text style={[st.aText, t.error && { color: C.danger }]}>{t.a}</Text>
              </View>
            )}
          </View>
        ))}
      </ScrollView>

      <View style={st.bar}>
        <TextInput
          style={st.input}
          value={input}
          onChangeText={setInput}
          placeholder="Ваш вопрос…"
          placeholderTextColor={C.muted}
          multiline
          onSubmitEditing={send}
        />
        <TouchableOpacity style={[st.sendBtn, (busy || !input.trim()) && st.off]} onPress={send} disabled={busy || !input.trim()}>
          <Text style={st.sendText}>→</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  hint: { color: C.muted, fontSize: 14, textAlign: "center", marginTop: S.xl, paddingHorizontal: S.lg },
  q: { alignSelf: "flex-end", backgroundColor: C.primary, borderRadius: 14, borderBottomRightRadius: 4, padding: S.md, maxWidth: "85%" },
  qText: { color: C.primaryText, fontSize: 15 },
  a: { alignSelf: "flex-start", backgroundColor: C.card, borderRadius: 14, borderBottomLeftRadius: 4, padding: S.md, marginTop: S.sm, maxWidth: "90%", borderWidth: 1, borderColor: C.border },
  aRow: { flexDirection: "row", alignItems: "center" },
  aText: { color: C.text, fontSize: 15, lineHeight: 21 },
  thinking: { color: C.muted, marginLeft: S.sm },
  bar: { flexDirection: "row", padding: S.sm, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.card, alignItems: "flex-end" },
  input: { flex: 1, maxHeight: 120, borderWidth: 1, borderColor: C.border, borderRadius: 20, paddingHorizontal: S.md, paddingVertical: S.sm, fontSize: 15, color: C.text, backgroundColor: "#fff" },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.primary, alignItems: "center", justifyContent: "center", marginLeft: S.sm },
  off: { opacity: 0.5 },
  sendText: { color: C.primaryText, fontSize: 22, fontWeight: "700" },
});
