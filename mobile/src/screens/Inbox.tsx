// Инбокс в виде чата. scope="today" — только сегодняшние сообщения; scope="history" —
// все предыдущие дни, сгруппированные по датам. Сообщения — входящие «пузыри» слева,
// формат как в кабинете на сайте: «Этап — Подэтап» + текст.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, ScrollView, RefreshControl, ActivityIndicator, StyleSheet,
} from "react-native";
import { S, useTheme, Palette } from "../theme";
import * as api from "../api";
import { Msg, title, body, hhmm, dayOf, dayLabel, ymd } from "../format";

export default function Inbox({ scope }: { scope: "today" | "history" }) {
  const { c } = useTheme();
  const st = useMemo(() => makeStyles(c), [c]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await api.myMessages();
      const list: Msg[] = res?.messages || [];
      setMsgs(list);
      // Показанное в чате считаем прочитанным — гасим непрочитанные (best-effort).
      list.filter((m) => m.status === "delivered" && m.message_id)
        .forEach((m) => api.markRead(String(m.message_id)).catch(() => {}));
    } catch (e: any) {
      setErr(e?.message || "Не удалось загрузить сообщения");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Автообновление: новые доставленные сообщения (ответ на вопрос, тест, план)
  // подтягиваются без ручного pull. Пуш-баннер отдельно — нужен настроенный FCM.
  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  const today = ymd();
  // Сервер отдаёт по send_at DESC; для чата упорядочим по возрастанию времени.
  const asc = [...msgs].sort((a, b) => (dayOf(a) + hhmm(a)).localeCompare(dayOf(b) + hhmm(b)));

  if (loading) {
    return <View style={st.center}><ActivityIndicator color={c.primary} size="large" /></View>;
  }

  if (scope === "today") {
    const list = asc.filter((m) => dayOf(m) === today);
    return (
      <ScrollView style={st.wrap} contentContainerStyle={st.content}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={c.primary}
          onRefresh={() => { setRefreshing(true); load(); }} />}>
        {err ? <Text style={st.err}>{err}</Text> : null}
        {list.length === 0
          ? <Text style={st.empty}>Сегодня новых сообщений плана нет.</Text>
          : list.map((m, i) => <Bubble key={m.message_id || i} m={m} st={st} />)}
      </ScrollView>
    );
  }

  // history: всё до сегодня, группировка по дням (свежие дни сверху).
  const past = asc.filter((m) => dayOf(m) < today);
  const days = Array.from(new Set(past.map(dayOf))).sort().reverse();
  return (
    <ScrollView style={st.wrap} contentContainerStyle={st.content}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={c.primary}
        onRefresh={() => { setRefreshing(true); load(); }} />}>
      {err ? <Text style={st.err}>{err}</Text> : null}
      {days.length === 0 ? (
        <Text style={st.empty}>История пуста — прошлых сообщений ещё нет.</Text>
      ) : (
        days.map((d) => (
          <View key={d}>
            <View style={st.dayChip}><Text style={st.dayChipText}>{dayLabel(d)}</Text></View>
            {past.filter((m) => dayOf(m) === d)
              .map((m, i) => <Bubble key={m.message_id || i} m={m} st={st} />)}
          </View>
        ))
      )}
    </ScrollView>
  );
}

function Bubble({ m, st }: { m: Msg; st: ReturnType<typeof makeStyles> }) {
  const t = hhmm(m);
  return (
    <View style={st.bubble}>
      <Text style={st.bTitle}>{title(m)}</Text>
      {body(m) ? <Text style={st.bBody}>{body(m)}</Text> : null}
      {t ? <Text style={st.bTime}>{t}</Text> : null}
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  wrap: { flex: 1, backgroundColor: c.bg },
  content: { padding: S.lg, paddingBottom: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.bg },
  empty: { color: c.muted, fontSize: 14, textAlign: "center", marginTop: S.xl },
  err: { color: c.danger, marginBottom: S.md },
  dayChip: { alignSelf: "center", backgroundColor: c.chipBg, borderRadius: 12,
    paddingHorizontal: S.md, paddingVertical: 4, marginVertical: S.md },
  dayChipText: { color: c.chipText, fontSize: 12, fontWeight: "600" },
  bubble: {
    alignSelf: "flex-start", maxWidth: "92%", backgroundColor: c.card,
    borderRadius: S.r, borderBottomLeftRadius: S.xs, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
    padding: S.md, marginBottom: S.sm,
  },
  bTitle: { fontSize: 14, fontWeight: "700", color: c.primary, letterSpacing: 0.2 },
  bBody: { fontSize: 15, color: c.text, marginTop: S.xs, lineHeight: 21 },
  bTime: { fontSize: 11, color: c.muted, marginTop: S.sm, alignSelf: "flex-end" },
});
