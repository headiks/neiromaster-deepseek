// «Чат» — сегодня: дата и «Добрый день, {имя}», карточка прогресса адаптации
// (/api/my/schedule), баннер больничного и сообщения за сегодня (старые сверху).
import React, { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { firstName, fromYmd, greeting, longDate, msgDay, plural, ruDate, shortWhen, ymd } from "../../../shared/format";
import { useData } from "../data";
import { S, useTheme } from "../theme";
import { Button, Glass, GlassCard, Progress, ScreenTitle, Txt } from "../ui";
import { InboxIcon, ThermometerIcon, CalendarIcon } from "../icons";
import { api } from "../api";
import MessageCard from "./MessageCard";
import { Screen } from "./Screen";

export function ProgressCard() {
  const { c } = useTheme();
  const { progress, schedule, scheduleMissing } = useData();
  if (scheduleMissing) {
    return (
      <GlassCard>
        <View style={{ flexDirection: "row", gap: S.md, alignItems: "center" }}>
          <CalendarIcon color={c.muted} />
          <View style={{ flex: 1 }}>
            <Txt w="600">План адаптации ещё не назначен</Txt>
            <Txt v="small" color={c.muted}>Обратитесь к администратору или наставнику.</Txt>
          </View>
        </View>
      </GlassCard>
    );
  }
  if (!progress || !schedule) return null;
  const start = fromYmd(schedule.start_date);
  const daysLeft = start ? Math.ceil((start.getTime() - Date.now()) / 86400000) : 0;
  const title = !progress.started ? (daysLeft > 0 ? `До выхода ${daysLeft} ${plural(daysLeft, "день", "дня", "дней")}` : "Скоро старт")
    : progress.finished ? "План пройден" : `День ${progress.day} из ${progress.total}`;
  const next = progress.next ? `Дальше: ${progress.next.substage || progress.next.title} — ${shortWhen(progress.next.at)}`
    : `План «${schedule.plan_title || "адаптации"}» · выход ${ruDate(schedule.start_date)}`;
  return (
    <GlassCard>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: S.md }}>
        <Txt v="h2">{title}</Txt>
        {progress.stage ? <Txt v="small" color={c.muted} numberOfLines={1} style={{ flexShrink: 1, textAlign: "right" }}>{progress.stage}</Txt> : null}
      </View>
      <Progress value={progress.started ? progress.ratio : 0} />
      <Txt v="small" color={c.muted}>{next}</Txt>
    </GlassCard>
  );
}

export function SickBanner() {
  const { c } = useTheme();
  const { me, setMe } = useData();
  const [busy, setBusy] = useState(false);
  if (me?.status !== "paused") return null;
  return (
    <Glass fill={c.warnSoft} radius={S.rSm}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: S.md, padding: S.md }}>
        <ThermometerIcon color={c.warn} />
        <Txt v="small" style={{ flex: 1 }}>Вы на больничном — сообщения плана на паузе.</Txt>
        <Button title="Снять" variant="secondary" loading={busy}
                onPress={async () => { setBusy(true); try { const r = await api.setSick(false); setMe({ ...me, status: r.status }); } finally { setBusy(false); } }} />
      </View>
    </Glass>
  );
}

export default function Today() {
  const { c } = useTheme();
  const { me, messages, loaded, answer, markRead, reload } = useData();
  const [refreshing, setRefreshing] = useState(false);
  const today = useMemo(() => messages.filter((m) => msgDay(m) === ymd()), [messages]);
  useEffect(() => { if (today.some((m) => m.status === "delivered")) markRead(today); }, [today, markRead]);
  const name = firstName(me?.full_name);
  return (
    <Screen stickToBottom refreshing={refreshing} onRefresh={() => { setRefreshing(true); reload().finally(() => setRefreshing(false)); }}>
      <ScreenTitle kicker={longDate()} title={name ? `${greeting()}, ${name}` : greeting()} />
      <SickBanner />
      <ProgressCard />
      {loaded && !today.length ? (
        <GlassCard>
          <View style={{ alignItems: "center", gap: S.sm, paddingVertical: S.lg }}>
            <InboxIcon color={c.muted} />
            <Txt v="small" color={c.muted} style={{ textAlign: "center" }}>Сегодня новых сообщений плана нет.</Txt>
          </View>
        </GlassCard>
      ) : today.map((m) => <MessageCard key={m.id} m={m} onAnswer={answer} />)}
    </Screen>
  );
}
