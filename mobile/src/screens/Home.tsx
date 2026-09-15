import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, ScrollView, RefreshControl, TouchableOpacity,
  ActivityIndicator, StyleSheet,
} from "react-native";
import { C, S } from "../theme";
import * as api from "../api";

// Достаём заголовок/текст из элемента, не зная точной схемы бэка (защитно).
function pickTitle(m: any): string {
  return String(m?.title || m?.subject || m?.stage_title || m?.name || "Сообщение плана");
}
function pickBody(m: any): string {
  const c = m?.content;
  return String(
    m?.text || m?.body || (c && (c.text || c.body || c.message)) || m?.message || ""
  );
}
function pickDate(m: any): string {
  const d = m?.delivered_at || m?.date || m?.scheduled_at || m?.created_at || "";
  return d ? String(d).replace("T", " ").slice(0, 16) : "";
}

export default function Home() {
  const [msgs, setMsgs] = useState<any[]>([]);
  const [schedule, setSchedule] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [m, s] = await Promise.allSettled([api.myMessages(), api.mySchedule()]);
      if (m.status === "fulfilled") setMsgs(m.value?.messages || []);
      if (s.status === "fulfilled") setSchedule(s.value);
      if (m.status === "rejected" && s.status === "rejected") {
        setErr((m.reason?.message as string) || "Не удалось загрузить данные");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function open(m: any) {
    if (!m?.read && m?.message_id) {
      try {
        await api.markRead(String(m.message_id));
        setMsgs((cur) => cur.map((x) => (x.message_id === m.message_id ? { ...x, read: true } : x)));
      } catch {}
    }
  }

  if (loading) {
    return (
      <View style={st.center}>
        <ActivityIndicator color={C.primary} size="large" />
      </View>
    );
  }

  const planStages: any[] = schedule?.stages || schedule?.plan?.stages || [];

  return (
    <ScrollView
      style={st.wrap}
      contentContainerStyle={{ padding: S.lg, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
    >
      {err ? <Text style={st.err}>{err}</Text> : null}

      <Text style={st.h}>Инбокс</Text>
      {msgs.length === 0 ? (
        <Text style={st.empty}>Пока нет сообщений плана.</Text>
      ) : (
        msgs.map((m, i) => (
          <TouchableOpacity key={m.message_id || i} style={st.card} onPress={() => open(m)} activeOpacity={0.7}>
            <View style={st.rowBetween}>
              <Text style={st.cardTitle}>{pickTitle(m)}</Text>
              {!m.read ? <View style={st.dot} /> : null}
            </View>
            {pickDate(m) ? <Text style={st.date}>{pickDate(m)}</Text> : null}
            {pickBody(m) ? <Text style={st.body}>{pickBody(m)}</Text> : null}
          </TouchableOpacity>
        ))
      )}

      {planStages.length > 0 ? (
        <>
          <Text style={[st.h, { marginTop: S.xl }]}>Мой план адаптации</Text>
          {planStages.map((s: any, i: number) => (
            <View key={s.id || i} style={st.card}>
              <Text style={st.cardTitle}>{String(s.title || s.name || `Этап ${i + 1}`)}</Text>
              {(s.substages || s.items || []).map((ss: any, j: number) => (
                <Text key={ss.id || j} style={st.sub}>• {String(ss.title || ss.name || "")}</Text>
              ))}
            </View>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.bg },
  h: { fontSize: 18, fontWeight: "700", color: C.text, marginBottom: S.sm },
  empty: { color: C.muted, fontSize: 14, paddingVertical: S.md },
  err: { color: C.danger, marginBottom: S.md },
  card: {
    backgroundColor: C.card, borderRadius: 12, padding: S.md, marginBottom: S.sm,
    shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 6, elevation: 1,
  },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { fontSize: 15, fontWeight: "600", color: C.text, flex: 1 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.primary, marginLeft: S.sm },
  date: { fontSize: 12, color: C.muted, marginTop: 2 },
  body: { fontSize: 14, color: C.text, marginTop: S.sm, lineHeight: 20 },
  sub: { fontSize: 14, color: C.muted, marginTop: S.xs },
});
