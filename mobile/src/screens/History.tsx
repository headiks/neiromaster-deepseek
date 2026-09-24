// «История»: сообщения прошлых дней, по датам — старые сверху, свежие снизу.
import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { dayLabel, msgDay, ymd } from "../../../shared/format";
import { useData } from "../data";
import { S, useTheme } from "../theme";
import { GlassCard, ScreenTitle, Txt } from "../ui";
import { HistoryIcon } from "../icons";
import MessageCard from "./MessageCard";
import { Screen } from "./Screen";

export default function History() {
  const { c } = useTheme();
  const { messages, loaded, answer, reload } = useData();
  const [refreshing, setRefreshing] = useState(false);
  const { past, days } = useMemo(() => {
    const today = ymd();
    const p = messages.filter((m) => { const d = msgDay(m); return d && d < today; });
    return { past: p, days: [...new Set(p.map(msgDay))].sort() };
  }, [messages]);
  return (
    <Screen stickToBottom refreshing={refreshing} onRefresh={() => { setRefreshing(true); reload().finally(() => setRefreshing(false)); }}>
      <ScreenTitle title="История" />
      {loaded && !days.length ? (
        <GlassCard>
          <View style={{ alignItems: "center", gap: S.sm, paddingVertical: S.lg }}>
            <HistoryIcon color={c.muted} />
            <Txt v="small" color={c.muted} style={{ textAlign: "center" }}>История пуста — прошлых сообщений ещё нет.</Txt>
          </View>
        </GlassCard>
      ) : days.map((d) => (
        <View key={d} style={{ gap: S.md }}>
          <Txt v="micro" w="600" color={c.muted} style={{ textAlign: "center", marginTop: S.sm }}>{dayLabel(d)}</Txt>
          {past.filter((m) => msgDay(m) === d).map((m) => <MessageCard key={m.id} m={m} onAnswer={answer} />)}
        </View>
      ))}
    </Screen>
  );
}
